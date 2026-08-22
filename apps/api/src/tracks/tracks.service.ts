import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DatabaseClient,
  eq,
  ilike,
  or,
  sql,
  Track,
  tracks,
  type NewTrack,
} from "@repo/database";
import {
  buildPlatformUrl,
  derivePlatformAndIdFromUrl,
  normalizePlatform,
  type ResolvedLink,
  type ResolveResult,
} from "@repo/music-resolver";
import { LyricsEngine } from "@repo/lyrics";
import type {
  FormattedLyricsResult,
  GetLyricsOptions,
  GetOrSyncTrackOptions,
  LyricsType,
  ProgressLogEvent,
  ResolverTrackMetadata,
  SanitizedTrack,
  StreamEventStage,
  StreamLyricsOptions,
  SyncedLyricsPayload,
} from "@repo/types";

import { ActivityService } from "../activity/activity.service";
import { DATABASE_CONNECTION } from "../database/database.constants";
import { ResolverService } from "../resolver/resolver.service";
import { StorageService } from "../storage/storage.service";
import { IpRateLimiterService } from "../common/rate-limiter/ip-rate-limiter.service";

export type {
  GetOrSyncTrackOptions,
  GetLyricsOptions,
  StreamLyricsOptions,
  ProgressLogEvent,
};

interface VerifiedPlatformIds {
  spotifyId?: string;
  deezerId?: string;
  neteaseId?: string;
  appleMusicId?: string;
  qqMusicId?: string;
}

@Injectable()

export class TracksService {
  // In-flight request deduplication map to prevent thundering herd
  private inFlightRequests = new Map<string, Promise<Track>>();
  private lyricsEngine = new LyricsEngine();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly resolverService: ResolverService,
    private readonly storageService: StorageService,
    private readonly ipRateLimiter: IpRateLimiterService,
    private readonly activityService: ActivityService,
  ) {}

  // Universal Read-Through Endpoint:
  // 1. Checks PostgreSQL database first (Instant ~2ms response, limited to 60 RPM / IP).
  // 2. If not found, enforces uncached rate limit (6 RPM / IP), resolves across platforms, and caches.
  async getOrSyncTrack(
    options: GetOrSyncTrackOptions,
    clientIp = "127.0.0.1",
  ): Promise<Track> {
    const { platform, id, url } = options;

    let targetPlatform = platform ? normalizePlatform(platform) : undefined;
    let targetId = id?.trim();
    let targetUrl = url?.trim();

    if (!targetUrl && (!targetPlatform || !targetId)) {
      throw new BadRequestException(
        'Please provide either "url" or both "platform" and "id".',
      );
    }

    // If URL is provided without platform/id, derive them
    if (targetUrl && (!targetPlatform || !targetId)) {
      const derived = derivePlatformAndIdFromUrl(targetUrl);
      if (derived) {
        targetPlatform = derived.platform;
        targetId = derived.id;
      }
    }

    // Step 1: Check Database (Cache Hit -> 60 RPM per IP)
    if (targetPlatform && targetId) {
      const cached = await this.findByPlatformId(targetPlatform, targetId);
      if (cached) {
        this.ipRateLimiter.consume(clientIp, "cached");
        return cached;
      }
    }

    // Step 2: Cache Miss -> Live upstream resolution (6 RPM per IP)
    this.ipRateLimiter.consume(clientIp, "uncached");

    // Build target URL if not provided
    if (!targetUrl && targetPlatform && targetId) {
      try {
        targetUrl = buildPlatformUrl(targetPlatform, targetId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid platform/id";
        throw new BadRequestException(message);
      }
    }

    if (!targetUrl) {
      throw new BadRequestException(
        "Could not determine streaming URL to resolve.",
      );
    }

    // Step 3: Deduplicate concurrent requests (Thundering Herd protection)
    // Canonicalize key so requests with URL and platform+id coalesce to the exact same promise
    const lockKey =
      targetPlatform && targetId
        ? `${targetPlatform}:${targetId}`
        : targetUrl;

    if (this.inFlightRequests.has(lockKey)) {
      return this.inFlightRequests.get(lockKey)!;
    }

    // Step 4: Resolve, ingest into PostgreSQL, and clean up lock
    const syncPromise = this.executeSyncAndStore(targetUrl)
      .then((track) => {
        this.inFlightRequests.delete(lockKey);
        return track;
      })
      .catch((err) => {
        this.inFlightRequests.delete(lockKey);
        throw err;
      });

    this.inFlightRequests.set(lockKey, syncPromise);
    return syncPromise;
  }

  private getHighConfidencePlatformId(
    link?: ResolvedLink | null,
  ): string | undefined {
    return link?.isVerified || (link?.score ?? 0) >= 0.8 ? link?.id : undefined;
  }

  // Find a track by internal database UUID (fast cache -> 60 RPM per IP)
  async findById(id: string, clientIp = "127.0.0.1"): Promise<Track> {
    this.ipRateLimiter.consume(clientIp, "cached");

    const result = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.id, id))
      .limit(1);

    if (result.length === 0 || !result[0]) {
      throw new NotFoundException(`Track with id ${id} not found.`);
    }

    return result[0];
  }

  // Fast O(1) indexed lookup by streaming platform ID (Spotify, Apple, Deezer, NetEase, QQ, ISRC)
  async findByPlatformId(platform: string, id: string): Promise<Track | null> {
    const norm = normalizePlatform(platform);

    const columnMap: Record<
      string,
      | typeof tracks.spotifyId
      | typeof tracks.appleMusicId
      | typeof tracks.deezerId
      | typeof tracks.neteaseId
      | typeof tracks.qqMusicId
      | typeof tracks.isrc
    > = {
      spotify: tracks.spotifyId,
      apple: tracks.appleMusicId,
      deezer: tracks.deezerId,
      netease: tracks.neteaseId,
      qq: tracks.qqMusicId,
      isrc: tracks.isrc,
    };

    const col = columnMap[norm];
    if (!col) return null;

    const result = await this.db
      .select()
      .from(tracks)
      .where(eq(col, id))
      .limit(1);
    return result[0] ?? null;
  }

  // Strip raw lyrics from track object for API responses
  public sanitizeTrack<T extends Track>(track: T): SanitizedTrack<T> {
    const { lyrics, ...rest } = track;
    const hasLyrics = Boolean(
      (track.lyricsStoragePath && track.lyricsStoragePath.trim().length > 0) ||
      (lyrics &&
        (Array.isArray(lyrics)
          ? lyrics.length > 0
          : typeof lyrics === "string"
            ? lyrics.trim().length > 0
            : true)),
    );
    return {
      ...rest,
      hasLyrics,
    };
  }

  // Resolve lyrics payload from PostgreSQL or Object Storage (Supabase/R2/S3)
  public async resolveTrackLyrics(
    track: Track,
  ): Promise<SyncedLyricsPayload | string | Record<string, unknown> | null> {
    if (track.lyrics) {
      return track.lyrics;
    }
    if (track.lyricsStoragePath) {
      return this.storageService.getLyrics(track.lyricsStoragePath);
    }
    return null;
  }

  // Get formatted lyrics for a track
  async getLyrics(
    options: GetLyricsOptions,
    clientIp = "127.0.0.1",
  ): Promise<FormattedLyricsResult> {
    let track: Track | null = null;

    if (options.trackId) {
      track = await this.findById(options.trackId, clientIp);
    } else {
      track = await this.getOrSyncTrack(options, clientIp);
    }

    const rawLyrics = await this.resolveTrackLyrics(track);

    if (
      !rawLyrics ||
      (Array.isArray(rawLyrics) && rawLyrics.length === 0) ||
      (typeof rawLyrics === "string" && !rawLyrics.trim())
    ) {
      throw new NotFoundException("Lyrics not available for this track.");
    }

    return this.lyricsEngine.formatLyrics(rawLyrics, options.format || "json");
  }

  // Search tracks by title or artist in database (fast cache -> 60 RPM per IP)
  async search(
    query: string,
    limit = 20,
    clientIp = "127.0.0.1",
  ): Promise<Array<SanitizedTrack<Track>>> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    this.ipRateLimiter.consume(clientIp, "cached");

    // Escape SQL LIKE wildcards (%, _, \) to prevent pattern injection and excessive table scans
    const escapedQuery = query.trim().replace(/[%_\\]/g, "\\$&");
    const searchTerm = `%${escapedQuery}%`;
    const results = await this.db
      .select()
      .from(tracks)
      .where(
        or(
          ilike(tracks.title, searchTerm),
          sql`${tracks.artists}::text ILIKE ${searchTerm}`,
          ilike(tracks.album, searchTerm),
        ),
      )
      .limit(limit);

    return results.map((t) => this.sanitizeTrack(t));
  }

  // Internal method: Resolves link and persists to PostgreSQL
  private async executeSyncAndStore(url: string): Promise<Track> {

    const resolved: ResolveResult = await this.resolverService.resolveUrl(url);
    const meta = resolved.metadata;

    const validIds = this.extractHighConfidencePlatformIds(resolved.links);
    const existingTrack = await this.findExistingTrackByPlatformLinks(
      resolved.links,
    );

    const lyricsData = await this.resolveAndStoreLyrics(
      meta,
      validIds,
      existingTrack,
    );

    const newTrackData = this.assembleTrackEntity(
      meta,
      validIds,
      lyricsData,
      existingTrack,
    );

    return this.safeSaveTrack(newTrackData);
  }

  private extractHighConfidencePlatformIds(
    links: Record<string, ResolvedLink | null | undefined>,
  ): VerifiedPlatformIds {
    const spotifyLink = links["spotify"];
    const deezerLink = links["deezer"];
    const neteaseLink = links["netease"];
    const appleLink =
      links["appleMusic"] || links["applemusic"] || links["apple"];
    const qqLink = links["qqMusic"] || links["qqmusic"] || links["qq"];

    return {
      spotifyId: this.getHighConfidencePlatformId(spotifyLink),
      deezerId: this.getHighConfidencePlatformId(deezerLink),
      neteaseId: this.getHighConfidencePlatformId(neteaseLink),
      appleMusicId: this.getHighConfidencePlatformId(appleLink),
      qqMusicId: this.getHighConfidencePlatformId(qqLink),
    };
  }

  private async findExistingTrackByPlatformLinks(
    links: Record<string, ResolvedLink | null | undefined>,
  ): Promise<Track | null> {
    const spotifyLink = links["spotify"];
    const deezerLink = links["deezer"];
    const neteaseLink = links["netease"];
    const appleLink =
      links["appleMusic"] || links["applemusic"] || links["apple"];
    const qqLink = links["qqMusic"] || links["qqmusic"] || links["qq"];

    const platformLinks: Array<[string, ResolvedLink | null | undefined]> = [
      ["spotify", spotifyLink],
      ["deezer", deezerLink],
      ["netease", neteaseLink],
      ["apple", appleLink],
      ["qq", qqLink],
    ];

    for (const [platform, link] of platformLinks) {
      const platformId = this.getHighConfidencePlatformId(link);
      if (platformId) {
        const existing = await this.findByPlatformId(platform, platformId);
        if (existing) return existing;
      }
    }
    return null;
  }

  private async resolveAndStoreLyrics(
    meta: ResolverTrackMetadata,
    validIds: VerifiedPlatformIds,
    existingTrack?: Track | null,
    onProgress?: (event: {
      stage: "lyrics_searching" | "lyrics_found";
      provider: string;
      lyricsType?: LyricsType;
      status?: "searching" | "found" | "miss" | "fallback";
    }) => void,
  ): Promise<{
    lyricsType: LyricsType | null;
    lyrics: SyncedLyricsPayload | string | Record<string, unknown> | null;
    lyricsStoragePath: string | null;
    lyricsProvider: string | null;
    resolvedRawLyrics:
      | SyncedLyricsPayload
      | string
      | Record<string, unknown>
      | null;
  }> {
    let lyricsType = existingTrack?.lyricsType ?? null;
    let lyrics = existingTrack?.lyrics ?? null;
    let lyricsStoragePath = existingTrack?.lyricsStoragePath ?? null;
    let lyricsProvider = existingTrack?.lyricsProvider ?? null;
    let resolvedRawLyrics:
      | SyncedLyricsPayload
      | string
      | Record<string, unknown>
      | null = null;

    const hasExistingLyrics = Boolean(
      (lyrics &&
        (Array.isArray(lyrics)
          ? lyrics.length > 0
          : typeof lyrics === "string"
            ? lyrics.trim().length > 0
            : true)) ||
      (lyricsStoragePath && lyricsStoragePath.trim().length > 0),
    );

    if (!hasExistingLyrics) {
      const resolvedLyrics = await this.lyricsEngine.resolveLyrics({
        title: meta.title,
        artist: meta.artist,
        artists: meta.artists,
        album: meta.album,
        durationMs: meta.durationMs,
        isrc: meta.isrc || existingTrack?.isrc || undefined,
        deezerId: validIds.deezerId || existingTrack?.deezerId || undefined,
        neteaseId: validIds.neteaseId || existingTrack?.neteaseId || undefined,
        qqMusicId: validIds.qqMusicId || existingTrack?.qqMusicId || undefined,
        appleMusicId:
          validIds.appleMusicId || existingTrack?.appleMusicId || undefined,
        spotifyId:
          validIds.spotifyId || existingTrack?.spotifyId || undefined,
        onProgress,
      });

      if (resolvedLyrics) {
        lyricsType = resolvedLyrics.lyricsType;
        lyricsProvider = resolvedLyrics.provider;
        resolvedRawLyrics = resolvedLyrics.lyrics;

        if (this.storageService.isConfigured()) {
          const trackKey = existingTrack?.id || randomUUID();
          lyricsStoragePath = await this.storageService.saveLyrics(
            trackKey,
            resolvedLyrics.lyrics,
          );
          lyrics = null;
        } else {
          lyrics = resolvedLyrics.lyrics;
          lyricsStoragePath = null;
        }
      }
    } else if (existingTrack) {
      resolvedRawLyrics = await this.resolveTrackLyrics(existingTrack);
    }

    return {
      lyricsType,
      lyrics,
      lyricsStoragePath,
      lyricsProvider,
      resolvedRawLyrics,
    };
  }

  private assembleTrackEntity(
    meta: ResolverTrackMetadata,
    validIds: VerifiedPlatformIds,
    lyricsData: {
      lyricsType: LyricsType | null;
      lyrics: SyncedLyricsPayload | string | Record<string, unknown> | null;
      lyricsStoragePath: string | null;
      lyricsProvider: string | null;
    },
    existingTrack?: Track | null,
  ): NewTrack {
    return {
      ...(existingTrack?.id ? { id: existingTrack.id } : {}),
      title: meta.title,
      artists: meta.artists?.length
        ? meta.artists
        : meta.artist
          ? [meta.artist]
          : [],
      album: meta.album,
      durationMs: meta.durationMs || 0,
      artwork:
        meta.artwork ||
        existingTrack?.artwork ||
        (meta.image ? { url: meta.image } : null),
      isrc: meta.isrc || existingTrack?.isrc,
      spotifyId: validIds.spotifyId || existingTrack?.spotifyId,
      deezerId: validIds.deezerId || existingTrack?.deezerId,
      neteaseId: validIds.neteaseId || existingTrack?.neteaseId,
      appleMusicId: validIds.appleMusicId || existingTrack?.appleMusicId,
      qqMusicId: validIds.qqMusicId || existingTrack?.qqMusicId,
      lyricsType: lyricsData.lyricsType,
      lyrics: lyricsData.lyrics,
      lyricsStoragePath: lyricsData.lyricsStoragePath,
      lyricsProvider: lyricsData.lyricsProvider,
      isVerified: existingTrack?.isVerified ?? false,
    };
  }


  // Concurrency-Safe Database Ingestion & Conflict Handler:
  // 1. Sanity Guard: Validates metadata before writing to PostgreSQL to prevent spam and DB pollution.
  // 2. Race-Condition Recovery: If concurrent workers try to insert the same new track,
  //    catches duplicate key / unique constraint errors and updates the existing record cleanly.
  private async safeSaveTrack(newTrackData: NewTrack): Promise<Track> {
    const cleanTitle = newTrackData.title?.trim();
    if (!cleanTitle) {
      throw new BadRequestException("Invalid track: title cannot be empty.");
    }
    const cleanArtists = (
      Array.isArray(newTrackData.artists) ? newTrackData.artists : []
    )
      .map((a) => (typeof a === "string" ? a.trim() : ""))
      .filter(Boolean);
    if (cleanArtists.length === 0) {
      throw new BadRequestException(
        "Invalid track: artists list cannot be empty.",
      );
    }

    const sanitizedData: NewTrack = {
      ...newTrackData,
      title: cleanTitle.slice(0, 500),
      artists: cleanArtists.map((a) => a.slice(0, 500)),
      album: newTrackData.album?.trim()?.slice(0, 500) || null,
      durationMs: Math.max(0, Number(newTrackData.durationMs) || 0),
    };

    try {
      if (sanitizedData.id) {
        const saved = await this.db
          .insert(tracks)
          .values(sanitizedData)
          .onConflictDoUpdate({
            target: tracks.id,
            set: {
              ...sanitizedData,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (saved[0]) return saved[0];
      } else {
        const saved = await this.db
          .insert(tracks)
          .values(sanitizedData)
          .returning();
        if (saved[0]) {
          this.activityService.recordTrackAdded(saved[0]);
          return saved[0];
        }
      }
    } catch (err: unknown) {
      // Concurrency race condition handling:
      // If another concurrent request inserted a track with the same unique index,
      // catch the unique violation error and update the existing row instead of throwing a 500 error!
      const isUniqueConflict =
        (err &&
          typeof err === "object" &&
          (err as { code?: string }).code === "23505") ||
        (err instanceof Error &&
          (err.message.includes("unique") ||
            err.message.includes("duplicate key") ||
            err.message.includes("violates unique constraint")));

      if (isUniqueConflict) {
        let existing: Track | null = null;
        if (sanitizedData.spotifyId)
          existing = await this.findByPlatformId(
            "spotify",
            sanitizedData.spotifyId,
          );
        if (!existing && sanitizedData.appleMusicId)
          existing = await this.findByPlatformId(
            "apple",
            sanitizedData.appleMusicId,
          );
        if (!existing && sanitizedData.deezerId)
          existing = await this.findByPlatformId(
            "deezer",
            sanitizedData.deezerId,
          );
        if (!existing && sanitizedData.neteaseId)
          existing = await this.findByPlatformId(
            "netease",
            sanitizedData.neteaseId,
          );
        if (!existing && sanitizedData.qqMusicId)
          existing = await this.findByPlatformId(
            "qq",
            sanitizedData.qqMusicId,
          );
        if (!existing && sanitizedData.isrc)
          existing = await this.findByPlatformId("isrc", sanitizedData.isrc);

        if (existing) {
          const updated = await this.db
            .update(tracks)
            .set({
              ...sanitizedData,
              id: existing.id,
              isrc: sanitizedData.isrc || existing.isrc,
              spotifyId: sanitizedData.spotifyId || existing.spotifyId,
              deezerId: sanitizedData.deezerId || existing.deezerId,
              neteaseId: sanitizedData.neteaseId || existing.neteaseId,
              appleMusicId:
                sanitizedData.appleMusicId || existing.appleMusicId,
              qqMusicId: sanitizedData.qqMusicId || existing.qqMusicId,
              artwork:
                sanitizedData.artwork || existing.artwork,
              lyrics: sanitizedData.lyrics || existing.lyrics,
              lyricsType: sanitizedData.lyricsType || existing.lyricsType,
              lyricsProvider:
                sanitizedData.lyricsProvider || existing.lyricsProvider,
              lyricsStoragePath:
                sanitizedData.lyricsStoragePath ||
                existing.lyricsStoragePath,
              updatedAt: new Date(),
            })
            .where(eq(tracks.id, existing.id))
            .returning();
          if (updated[0]) return updated[0];
          return existing;
        }
      }

      throw err;
    }

    throw new BadRequestException("Failed to persist track metadata.");
  }

  // Real-time EventStream (SSE) live track and lyrics resolution
  async streamLyrics(
    options: StreamLyricsOptions,
    emitEvent: (event: ProgressLogEvent) => void,
    clientIp = "127.0.0.1",
  ): Promise<void> {
    const format = options.format || "json";
    const { platform, id, url, forceRefresh } = options;

    let targetPlatform = platform ? normalizePlatform(platform) : undefined;
    let targetId = id?.trim();
    let targetUrl = url?.trim();

    emitEvent({
      stage: "init",
      data: { platform: targetPlatform, id: targetId, url: targetUrl, format },
      timestamp: Date.now(),
    });

    // Step 1: Derive platform and id if needed
    if (targetUrl && (!targetPlatform || !targetId)) {
      const derived = derivePlatformAndIdFromUrl(targetUrl);
      if (derived) {
        targetPlatform = derived.platform;
        targetId = derived.id;
      }
    }

    // Step 2: Check Database Cache (unless forceRefresh)
    let cachedTrack: Track | null = null;
    if (!forceRefresh && targetPlatform && targetId) {
      cachedTrack = await this.findByPlatformId(targetPlatform, targetId);
    }

    if (cachedTrack) {
      // Consume from 60 RPM cached bucket
      this.ipRateLimiter.consume(clientIp, "cached");

      const sanitized = this.sanitizeTrack(cachedTrack);
      let formattedLyrics: FormattedLyricsResult | undefined;
      const rawLyrics = await this.resolveTrackLyrics(cachedTrack);
      if (rawLyrics) {
        formattedLyrics = this.lyricsEngine.formatLyrics(rawLyrics, format);
      }

      emitEvent({
        stage: "cache_hit",
        data: {
          id: cachedTrack.id,
          title: cachedTrack.title,
          artists: cachedTrack.artists,
          isrc: cachedTrack.isrc,
          spotifyId: cachedTrack.spotifyId,
          appleMusicId: cachedTrack.appleMusicId,
          deezerId: cachedTrack.deezerId,
          neteaseId: cachedTrack.neteaseId,
          qqMusicId: cachedTrack.qqMusicId,
          lyricsType: cachedTrack.lyricsType,
          lyricsProvider: cachedTrack.lyricsProvider,
        },
        timestamp: Date.now(),
      });

      emitEvent({
        stage: "done",
        data: {
          track: sanitized,
          lyrics: formattedLyrics?.content,
          format,
          contentType: formattedLyrics?.contentType,
        },
        timestamp: Date.now(),
      });
      return;
    }

    // Cache Miss -> Consume from 6 RPM uncached live resolution bucket
    this.ipRateLimiter.consume(clientIp, "uncached");

    if (!forceRefresh) {
      emitEvent({
        stage: "cache_miss",
        data: { platform: targetPlatform, id: targetId, url: targetUrl },
        timestamp: Date.now(),
      });
    }

    // Step 3: Build target URL if not provided
    if (!targetUrl && targetPlatform && targetId) {
      try {
        targetUrl = buildPlatformUrl(targetPlatform, targetId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid platform/id";
        emitEvent({
          stage: "error",
          data: { error: message },
          timestamp: Date.now(),
        });
        return;
      }
    }

    if (!targetUrl) {
      emitEvent({
        stage: "error",
        data: {
          error:
            'Could not determine streaming URL to resolve. Please provide "url" or both "platform" and "id".',
        },
        timestamp: Date.now(),
      });
      return;
    }

    // Step 4: Live Resolution with onProgress
    try {
      const resolved: ResolveResult = await this.resolverService.resolveUrl(
        targetUrl,
        undefined,
        {
          onProgress: (pEvent) => {
            emitEvent({
              stage: pEvent.stage as StreamEventStage,
              data: {
                step: pEvent.step,
                platform: pEvent.platform,
                id: pEvent.id,
                score: pEvent.score,
                ...pEvent.data,
              },
              timestamp: Date.now(),
            });
          },
        },
      );

      const meta = resolved.metadata;
      const validIds = this.extractHighConfidencePlatformIds(resolved.links);
      const existingTrack = await this.findExistingTrackByPlatformLinks(
        resolved.links,
      );

      // Step 5: Live Lyrics Fetching with onProgress
      const lyricsData = await this.resolveAndStoreLyrics(
        meta,
        validIds,
        existingTrack,
        (lEvent) => {
          emitEvent({
            stage: lEvent.stage,
            data: {
              provider: lEvent.provider,
              lyricsType: lEvent.lyricsType,
              status: lEvent.status,
            },
            timestamp: Date.now(),
          });
        },
      );

      if (
        !lyricsData.resolvedRawLyrics &&
        !existingTrack?.lyrics &&
        !existingTrack?.lyricsStoragePath
      ) {
        emitEvent({
          stage: "lyrics_searching",
          data: { status: "not_found" },
          timestamp: Date.now(),
        });
      } else if (existingTrack?.lyrics || existingTrack?.lyricsStoragePath) {
        emitEvent({
          stage: "lyrics_found",
          data: {
            lyricsType: lyricsData.lyricsType,
            lyricsProvider: lyricsData.lyricsProvider,
            status: "cached",
          },
          timestamp: Date.now(),
        });
      }

      // Step 6: Ingest / Update PostgreSQL
      emitEvent({
        stage: "saving",
        data: { status: "saving" },
        timestamp: Date.now(),
      });

      const newTrackData = this.assembleTrackEntity(
        meta,
        validIds,
        lyricsData,
        existingTrack,
      );

      const finalTrack = await this.safeSaveTrack(newTrackData);
      const sanitized = this.sanitizeTrack(finalTrack);
      let formattedLyrics: FormattedLyricsResult | undefined;
      const lyricsToFormat =
        lyricsData.resolvedRawLyrics ||
        (await this.resolveTrackLyrics(finalTrack));
      if (lyricsToFormat) {
        formattedLyrics = this.lyricsEngine.formatLyrics(
          lyricsToFormat,
          format,
        );
      }

      emitEvent({
        stage: "done",
        data: {
          track: sanitized,
          lyrics: formattedLyrics?.content,
          format,
          contentType: formattedLyrics?.contentType,
        },
        timestamp: Date.now(),
      });

    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An error occurred during resolution";
      emitEvent({
        stage: "error",
        data: { error: message },
        timestamp: Date.now(),
      });
    }
  }
}
