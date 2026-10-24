import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  and,
  backfillTrackPlatformIds,
  DatabaseClient,
  eq,
  ilike,
  inArray,
  isPlatformIdKey,
  or,
  PLATFORM_ID_COLUMNS,
  sql,
  Track,
  trackPlatformIds,
  tracks,
  type NewTrack,
} from "@repo/database";
import {
  buildPlatformUrl,
  derivePlatformAndIdFromUrl,
  normalizePlatform,
  currentAbortSignal,
  rejectOnAbort,
  runWithAbortSignal,
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
import {
  collectPlatformIds,
  pickTrackMatch,
  PLATFORM_TRACK_FIELDS,
  platformIdKey,
  type PlatformIdRef,
  type VerifiedPlatformIds,
} from "./platform-ids";

export type {
  GetOrSyncTrackOptions,
  GetLyricsOptions,
  StreamLyricsOptions,
  ProgressLogEvent,
};

// A track saved without lyrics (no provider had them, or providers were failing)
// gets a fresh live attempt on the next request once this long has passed.
const LYRICS_RETRY_INTERVAL_MS = 60 * 60 * 1000;

// End-to-end budget for one live sync (metadata resolution + lyrics search + save).
// Upstream calls inside it are cancelled once it runs out.
const SYNC_TIMEOUT_MS = 45_000;
const SYNC_TIMEOUT_MESSAGE =
  "Timed out resolving this track upstream. Please try again shortly.";

const VERIFIED_REFRESH_ERROR =
  "This track has been verified as correct and can't be refreshed.";

@Injectable()

export class TracksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TracksService.name);
  // In-flight request deduplication map to prevent thundering herd
  private inFlightRequests = new Map<string, Promise<Track>>();
  // Last background enrichment attempt per imported track
  private enrichAttempts = new Map<string, number>();
  private lyricsEngine = new LyricsEngine();
  private readonly syncTimeoutMs = SYNC_TIMEOUT_MS;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly resolverService: ResolverService,
    private readonly storageService: StorageService,
    private readonly ipRateLimiter: IpRateLimiterService,
    private readonly activityService: ActivityService,
  ) {}

  // Copies primary IDs into track_platform_ids for rows saved before the table existed.
  // Runs in the background: lookups also check the columns, so nothing waits on it.
  onApplicationBootstrap(): void {
    backfillTrackPlatformIds(this.db)
      .then((inserted) => {
        if (inserted > 0) {
          this.logger.log(`Backfilled ${inserted} track platform IDs`);
        }
      })
      .catch((err: unknown) => {
        this.logger.warn(`Track platform ID backfill failed: ${err}`);
      });
  }

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
        this.enrichInBackground(cached, clientIp);
        return this.retryMissingLyrics(cached, clientIp);
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

    // Step 4: Resolve and ingest into PostgreSQL
    return this.syncDeduped(lockKey, targetUrl);
  }

  // Deadline for a live sync, optionally also cancelled by the caller (e.g. SSE disconnect)
  private syncDeadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.syncTimeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  // Coalesces concurrent syncs of the same track onto a single promise.
  // The deadline belongs to the shared sync, not to whichever caller started it.
  private syncDeduped(lockKey: string, url: string): Promise<Track> {
    const inFlight = this.inFlightRequests.get(lockKey);
    if (inFlight) return inFlight;

    const deadline = this.syncDeadline();
    const syncPromise = Promise.race([
      runWithAbortSignal(deadline, () => this.executeSyncAndStore(url)),
      rejectOnAbort(deadline),
    ])
      .catch((err: unknown) => {
        if (deadline.aborted) {
          throw new GatewayTimeoutException(SYNC_TIMEOUT_MESSAGE);
        }
        throw err;
      })
      .finally(() => {
        this.inFlightRequests.delete(lockKey);
      });

    this.inFlightRequests.set(lockKey, syncPromise);
    return syncPromise;
  }

  private hasLyrics(
    track: Pick<Track, "lyrics" | "lyricsStoragePath">,
  ): boolean {
    const { lyrics, lyricsStoragePath } = track;
    return Boolean(
      (lyricsStoragePath && lyricsStoragePath.trim().length > 0) ||
      (lyrics &&
        (Array.isArray(lyrics)
          ? lyrics.length > 0
          : typeof lyrics === "string"
            ? lyrics.trim().length > 0
            : true)),
    );
  }

  private shouldRetryLyrics(track: Track): boolean {
    if (this.hasLyrics(track)) return false;
    const lastAttempt = new Date(track.updatedAt).getTime();
    return Date.now() - lastAttempt >= LYRICS_RETRY_INTERVAL_MS;
  }

  private platformRefFor(
    track: Track,
  ): { platform: string; id: string } | null {
    const candidates: Array<[string, string | null]> = [
      ["spotify", track.spotifyId],
      ["apple", track.appleMusicId],
      ["deezer", track.deezerId],
      ["netease", track.neteaseId],
      ["qq", track.qqMusicId],
    ];
    for (const [platform, id] of candidates) {
      if (id) return { platform, id };
    }
    return null;
  }

  // Records a lyrics attempt on a track so retries back off even when the attempt failed
  private async touchTrack(id: string): Promise<void> {
    try {
      await this.db
        .update(tracks)
        .set({ updatedAt: new Date() })
        .where(eq(tracks.id, id));
    } catch (err) {
      this.logger.warn(`Failed to record lyrics attempt for track ${id}: ${err}`);
    }
  }

  // Cached tracks without lyrics may come from a transient provider outage, so they
  // get a live re-sync once their last attempt is stale. Any failure (including an
  // exhausted uncached budget) falls back to the cached row.
  private async retryMissingLyrics(
    track: Track,
    clientIp: string,
  ): Promise<Track> {
    if (!this.shouldRetryLyrics(track)) return track;

    const ref = this.platformRefFor(track);
    if (!ref || !this.ipRateLimiter.tryConsume(clientIp, "uncached")) {
      return track;
    }

    try {
      return await this.syncDeduped(
        `${ref.platform}:${ref.id}`,
        buildPlatformUrl(ref.platform, ref.id),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Lyrics retry failed for track ${track.id}: ${message}`);
      await this.touchTrack(track.id);
      return track;
    }
  }

  // Imported tracks are served right away; a live resolve in the background fills
  // in their artwork, duration and other platforms' IDs, keeping their lyrics.
  // Spends the client's uncached budget, and backs off per track on failure.
  private enrichInBackground(track: Track, clientIp: string): void {
    if (!track.needsEnrichment) return;

    const lastAttempt = this.enrichAttempts.get(track.id);
    if (lastAttempt && Date.now() - lastAttempt < LYRICS_RETRY_INTERVAL_MS) {
      return;
    }
    const ref = this.platformRefFor(track);
    if (!ref || !this.ipRateLimiter.tryConsume(clientIp, "uncached")) return;

    this.enrichAttempts.set(track.id, Date.now());
    this.syncDeduped(
      `${ref.platform}:${ref.id}`,
      buildPlatformUrl(ref.platform, ref.id),
    )
      .then(() => this.enrichAttempts.delete(track.id))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Enriching track ${track.id} failed: ${message}`);
      });
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

    this.enrichInBackground(result[0], clientIp);
    return result[0];
  }

  // Flag a track's metadata and lyrics as confirmed correct by a human
  async markVerified(id: string, clientIp = "127.0.0.1"): Promise<Track> {
    this.ipRateLimiter.consume(clientIp, "cached");

    const result = await this.db
      .update(tracks)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(tracks.id, id))
      .returning();

    if (result.length === 0 || !result[0]) {
      throw new NotFoundException(`Track with id ${id} not found.`);
    }

    return result[0];
  }

  // Fast indexed lookup by streaming platform ID (Spotify, Apple, Deezer, NetEase, QQ, ISRC).
  // Matches the track's primary column or any other ID recorded for it.
  async findByPlatformId(platform: string, id: string): Promise<Track | null> {
    const norm = normalizePlatform(platform);
    if (!isPlatformIdKey(norm)) return null;

    const aliasOwner = this.db
      .select({ trackId: trackPlatformIds.trackId })
      .from(trackPlatformIds)
      .where(
        and(
          eq(trackPlatformIds.platform, norm),
          eq(trackPlatformIds.platformId, id),
        ),
      );

    const result = await this.db
      .select()
      .from(tracks)
      .where(or(eq(PLATFORM_ID_COLUMNS[norm], id), inArray(tracks.id, aliasOwner)))
      .limit(1);
    return result[0] ?? null;
  }

  // Which stored tracks each ID belongs to, via the alias table or a primary column
  private async findPlatformIdOwners(
    ids: PlatformIdRef[],
  ): Promise<Map<string, Set<string>>> {
    const owners = new Map<string, Set<string>>();
    if (ids.length === 0) return owners;

    const addOwner = (ref: PlatformIdRef, trackId: string) => {
      const key = platformIdKey(ref);
      const set = owners.get(key) ?? new Set<string>();
      set.add(trackId);
      owners.set(key, set);
    };

    const [aliasRows, columnRows] = await Promise.all([
      this.db
        .select()
        .from(trackPlatformIds)
        .where(
          or(
            ...ids.map((ref) =>
              and(
                eq(trackPlatformIds.platform, ref.platform),
                eq(trackPlatformIds.platformId, ref.platformId),
              ),
            ),
          ),
        ),
      this.db
        .select()
        .from(tracks)
        .where(
          or(
            ...ids.map((ref) =>
              eq(PLATFORM_ID_COLUMNS[ref.platform], ref.platformId),
            ),
          ),
        ),
    ]);

    for (const row of aliasRows) {
      if (isPlatformIdKey(row.platform)) {
        addOwner({ platform: row.platform, platformId: row.platformId }, row.trackId);
      }
    }
    for (const track of columnRows) {
      for (const ref of ids) {
        if (track[PLATFORM_TRACK_FIELDS[ref.platform]] === ref.platformId) {
          addOwner(ref, track.id);
        }
      }
    }
    return owners;
  }

  // Drops primary IDs that already belong to a different track, so saving never
  // steals another row's ID (or trips its unique index).
  private async dropIdsOwnedElsewhere(data: NewTrack): Promise<NewTrack> {
    const ids = collectPlatformIds({}, null, data);
    const owners = await this.findPlatformIdOwners(ids);
    const cleaned: NewTrack = { ...data };

    for (const ref of ids) {
      const ownerIds = owners.get(platformIdKey(ref));
      if (ownerIds && [...ownerIds].some((ownerId) => ownerId !== data.id)) {
        cleaned[PLATFORM_TRACK_FIELDS[ref.platform]] = null;
      }
    }
    return cleaned;
  }

  // Records every ID for a track. IDs already owned by another track are left alone.
  // Best-effort: lookups still have the primary columns if this fails.
  private async recordPlatformIds(
    trackId: string,
    ids: PlatformIdRef[],
  ): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.db
        .insert(trackPlatformIds)
        .values(ids.map((ref) => ({ ...ref, trackId })))
        .onConflictDoNothing();
    } catch (err) {
      this.logger.warn(`Failed to record platform IDs for track ${trackId}: ${err}`);
    }
  }

  // Strip raw lyrics from track object for API responses
  public sanitizeTrack<T extends Track>(track: T): SanitizedTrack<T> {
    const { lyrics, ...rest } = track;
    return {
      ...rest,
      hasLyrics: this.hasLyrics({
        lyrics,
        lyricsStoragePath: track.lyricsStoragePath,
      }),
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
      track = await this.retryMissingLyrics(
        await this.findById(options.trackId, clientIp),
        clientIp,
      );
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
      meta.isrc,
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

    return this.saveTrackWithPlatformIds(newTrackData, validIds, meta.isrc);
  }

  // Saves a resolved track, then records every ID it was reached by
  private async saveTrackWithPlatformIds(
    newTrackData: NewTrack,
    validIds: VerifiedPlatformIds,
    isrc?: string,
  ): Promise<Track> {
    const saved = await this.safeSaveTrack(
      await this.dropIdsOwnedElsewhere(newTrackData),
    );
    await this.recordPlatformIds(
      saved.id,
      collectPlatformIds(validIds, isrc, saved),
    );
    return saved;
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

  // Finds the stored track a resolve belongs to, through any of its high-confidence
  // IDs or its ISRC. When those point at several tracks, pickTrackMatch decides.
  private async findExistingTrackByPlatformLinks(
    links: Record<string, ResolvedLink | null | undefined>,
    isrc?: string,
  ): Promise<Track | null> {
    const sourceLink = Object.values(links).find(
      (link) => link?.matchReason === "direct" && link.id,
    );
    const sourceKey = sourceLink?.id
      ? `${normalizePlatform(sourceLink.platform)}:${sourceLink.id.trim()}`
      : null;

    const ids = collectPlatformIds(
      this.extractHighConfidencePlatformIds(links),
      isrc,
    );
    const owners = await this.findPlatformIdOwners(ids);
    const candidateIds = new Set(
      [...owners.values()].flatMap((set) => [...set]),
    );
    if (candidateIds.size === 0) return null;

    const candidates = await this.db
      .select()
      .from(tracks)
      .where(inArray(tracks.id, [...candidateIds]));

    return pickTrackMatch(
      candidates.map((track) => ({
        track,
        matchedIds: ids.filter((ref) =>
          owners.get(platformIdKey(ref))?.has(track.id),
        ).length,
        ownsSource: Boolean(
          sourceKey && owners.get(sourceKey)?.has(track.id),
        ),
      })),
    );
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
    forceRefresh = false,
  ): Promise<{
    lyricsType: LyricsType | null;
    lyrics: SyncedLyricsPayload | string | Record<string, unknown> | null;
    lyricsStoragePath: string | null;
    lyricsProvider: string | null;
    hasTranslation: boolean;
    hasRomaji: boolean;
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
    let hasTranslation = existingTrack?.hasTranslation ?? false;
    let hasRomaji = existingTrack?.hasRomaji ?? false;
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

    if (!hasExistingLyrics || forceRefresh) {
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
        hasTranslation = Boolean(resolvedLyrics.hasTranslation);
        hasRomaji = Boolean(resolvedLyrics.hasRomaji);

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
    }
    if (!resolvedRawLyrics && existingTrack) {
      resolvedRawLyrics = await this.resolveTrackLyrics(existingTrack);
    }

    return {
      lyricsType,
      lyrics,
      lyricsStoragePath,
      lyricsProvider,
      hasTranslation,
      hasRomaji,
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
      hasTranslation?: boolean;
      hasRomaji?: boolean;
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
      // An existing row keeps its first-seen IDs; other versions' IDs go to track_platform_ids
      isrc: existingTrack?.isrc || meta.isrc,
      spotifyId: existingTrack?.spotifyId || validIds.spotifyId,
      deezerId: existingTrack?.deezerId || validIds.deezerId,
      neteaseId: existingTrack?.neteaseId || validIds.neteaseId,
      appleMusicId: existingTrack?.appleMusicId || validIds.appleMusicId,
      qqMusicId: existingTrack?.qqMusicId || validIds.qqMusicId,
      lyricsType: lyricsData.lyricsType,
      lyrics: lyricsData.lyrics,
      lyricsStoragePath: lyricsData.lyricsStoragePath,
      lyricsProvider: lyricsData.lyricsProvider,
      hasTranslation:
        lyricsData.hasTranslation ?? existingTrack?.hasTranslation ?? false,
      hasRomaji:
        lyricsData.hasRomaji ?? existingTrack?.hasRomaji ?? false,
      isVerified: existingTrack?.isVerified ?? false,
      needsEnrichment: false,
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
        const conditions = collectPlatformIds({}, null, sanitizedData).map(
          (ref) => eq(PLATFORM_ID_COLUMNS[ref.platform], ref.platformId),
        );

        let existing: Track | null = null;
        if (conditions.length > 0) {
          const res = await this.db
            .select()
            .from(tracks)
            .where(or(...conditions))
            .limit(1);
          existing = res[0] || null;
        }

        if (existing) {
          const updated = await this.db
            .update(tracks)
            .set({
              ...sanitizedData,
              id: existing.id,
              isrc: existing.isrc || sanitizedData.isrc,
              spotifyId: existing.spotifyId || sanitizedData.spotifyId,
              deezerId: existing.deezerId || sanitizedData.deezerId,
              neteaseId: existing.neteaseId || sanitizedData.neteaseId,
              appleMusicId:
                existing.appleMusicId || sanitizedData.appleMusicId,
              qqMusicId: existing.qqMusicId || sanitizedData.qqMusicId,
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
  // `signal` aborts when the SSE client disconnects; the sync deadline applies on top.
  async streamLyrics(
    options: StreamLyricsOptions,
    emitEvent: (event: ProgressLogEvent) => void,
    clientIp = "127.0.0.1",
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = this.syncDeadline(signal);
    try {
      await Promise.race([
        runWithAbortSignal(deadline, () =>
          this.runLyricsStream(options, emitEvent, clientIp),
        ),
        rejectOnAbort(deadline),
      ]);
    } catch (err) {
      if (!deadline.aborted) throw err;
      // Nobody is listening after a disconnect; only report a timeout
      if (!signal?.aborted) {
        emitEvent({
          stage: "error",
          data: { error: SYNC_TIMEOUT_MESSAGE },
          timestamp: Date.now(),
        });
      }
    }
  }

  private async runLyricsStream(
    options: StreamLyricsOptions,
    emitEvent: (event: ProgressLogEvent) => void,
    clientIp: string,
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

    // Verified tracks are locked; reject before spending any upstream budget
    if (forceRefresh && targetPlatform && targetId) {
      this.ipRateLimiter.consume(clientIp, "cached");
      const lockedTrack = await this.findByPlatformId(targetPlatform, targetId);
      if (lockedTrack?.isVerified) {
        emitEvent({
          stage: "error",
          data: { error: VERIFIED_REFRESH_ERROR, trackId: lockedTrack.id },
          timestamp: Date.now(),
        });
        return;
      }
    }

    // A cached row without lyrics whose last attempt is stale gets a live re-sync,
    // if the client still has uncached budget; otherwise it is served from cache.
    let retryingTrack: Track | null = null;
    if (
      cachedTrack &&
      this.shouldRetryLyrics(cachedTrack) &&
      this.ipRateLimiter.tryConsume(clientIp, "uncached")
    ) {
      retryingTrack = cachedTrack;
      cachedTrack = null;
    }

    if (cachedTrack) {
      // Consume from 60 RPM cached bucket
      this.ipRateLimiter.consume(clientIp, "cached");
      this.enrichInBackground(cachedTrack, clientIp);

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
    if (!retryingTrack) {
      this.ipRateLimiter.consume(clientIp, "uncached");
    }

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
        meta.isrc,
      );

      // The refresh may reach a verified track through another platform's link
      if (forceRefresh && existingTrack?.isVerified) {
        emitEvent({
          stage: "error",
          data: { error: VERIFIED_REFRESH_ERROR, trackId: existingTrack.id },
          timestamp: Date.now(),
        });
        return;
      }

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
        Boolean(forceRefresh),
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

      const finalTrack = await this.saveTrackWithPlatformIds(
        newTrackData,
        validIds,
        meta.isrc,
      );
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
      if (retryingTrack) {
        await this.touchTrack(retryingTrack.id);
      }
      // Deadline / disconnect: let streamLyrics report it
      if (currentAbortSignal()?.aborted) {
        throw err;
      }
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
