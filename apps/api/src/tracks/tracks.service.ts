import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DatabaseClient,
  eq,
  ilike,
  or,
  sql,
  Track,
  tracks,
  type NewTrack,
} from '@repo/database';
import {
  buildPlatformUrl,
  derivePlatformAndIdFromUrl,
  normalizePlatform,
  type ResolvedLink,
  type ResolveResult,
} from '@repo/music-resolver';
import { LyricsEngine } from '@repo/lyrics';
import type {
  FormattedLyricsResult,
  GetLyricsOptions,
  GetOrSyncTrackOptions,
  SanitizedTrack,
} from '@repo/types';
import { DATABASE_CONNECTION } from '../database/database.constants';
import { ResolverService } from '../resolver/resolver.service';

export type { GetOrSyncTrackOptions, GetLyricsOptions };

@Injectable()
export class TracksService {
  // In-flight request deduplication map to prevent thundering herd
  private inFlightRequests = new Map<string, Promise<Track>>();
  private lyricsEngine = new LyricsEngine();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly resolverService: ResolverService
  ) {}

  // Universal Read-Through Endpoint:
  // 1. Checks PostgreSQL database first (Instant ~2ms response).
  // 2. If not found, resolves across all platforms, stores in PostgreSQL, and returns the unified track.
  async getOrSyncTrack(options: GetOrSyncTrackOptions): Promise<Track> {
    const { platform, id, url } = options;

    let targetPlatform = platform ? normalizePlatform(platform) : undefined;
    let targetId = id?.trim();
    let targetUrl = url?.trim();

    if (!targetUrl && (!targetPlatform || !targetId)) {
      throw new BadRequestException(
        'Please provide either "url" or both "platform" and "id".'
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

    // Step 1: Check Database (Cache Hit)
    if (targetPlatform && targetId) {
      const cached = await this.findByPlatformId(targetPlatform, targetId);
      if (cached) {
        return cached;
      }
    }

    // Step 2: Build target URL if not provided
    if (!targetUrl && targetPlatform && targetId) {
      try {
        targetUrl = buildPlatformUrl(targetPlatform, targetId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid platform/id';
        throw new BadRequestException(message);
      }
    }

    if (!targetUrl) {
      throw new BadRequestException('Could not determine streaming URL to resolve.');
    }

    // Step 3: Deduplicate concurrent requests (Thundering Herd protection)
    const lockKey = `${targetPlatform || 'url'}:${targetId || targetUrl}`;
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

  private getHighConfidencePlatformId(link?: ResolvedLink | null): string | undefined {
    return link?.isVerified || (link?.score ?? 0) >= 0.8 ? link?.id : undefined;
  }

  // Find a track by internal database UUID
  async findById(id: string): Promise<Track> {
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

    const columnMap: Record<string, typeof tracks.spotifyId | typeof tracks.appleMusicId | typeof tracks.deezerId | typeof tracks.neteaseId | typeof tracks.qqMusicId | typeof tracks.isrc> = {
      spotify: tracks.spotifyId,
      apple: tracks.appleMusicId,
      deezer: tracks.deezerId,
      netease: tracks.neteaseId,
      qq: tracks.qqMusicId,
      isrc: tracks.isrc,
    };

    const col = columnMap[norm];
    if (!col) return null;

    const result = await this.db.select().from(tracks).where(eq(col, id)).limit(1);
    return result[0] ?? null;
  }

  // Strip raw lyrics from track object for API responses
  public sanitizeTrack<T extends Track>(track: T): SanitizedTrack<T> {
    const { lyrics, ...rest } = track;
    const hasLyrics = Boolean(
      lyrics &&
        (Array.isArray(lyrics)
          ? lyrics.length > 0
          : typeof lyrics === 'string'
            ? lyrics.trim().length > 0
            : true)
    );
    return {
      ...rest,
      hasLyrics,
    };
  }

  // Get formatted lyrics for a track
  async getLyrics(options: GetLyricsOptions): Promise<FormattedLyricsResult> {
    let track: Track | null = null;

    if (options.trackId) {
      track = await this.findById(options.trackId);
    } else {
      track = await this.getOrSyncTrack(options);
    }

    if (
      !track ||
      !track.lyrics ||
      (Array.isArray(track.lyrics) && track.lyrics.length === 0) ||
      (typeof track.lyrics === 'string' && !track.lyrics.trim())
    ) {
      throw new NotFoundException('Lyrics not available for this track.');
    }

    return this.lyricsEngine.formatLyrics(track.lyrics, options.format || 'json');
  }

  // Search tracks by title or artist in database
  async search(query: string, limit = 20): Promise<Array<SanitizedTrack<Track>>> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = `%${query.trim()}%`;
    const results = await this.db
      .select()
      .from(tracks)
      .where(
        or(
          ilike(tracks.title, searchTerm),
          sql`${tracks.artists}::text ILIKE ${searchTerm}`,
          ilike(tracks.album, searchTerm)
        )
      )
      .limit(limit);

    return results.map((t) => this.sanitizeTrack(t));
  }

  // Internal method: Resolves link and persists to PostgreSQL
  private async executeSyncAndStore(url: string): Promise<Track> {
    const resolved: ResolveResult = await this.resolverService.resolveUrl(url);
    const meta = resolved.metadata;

    const spotifyLink = resolved.links['spotify'];
    const deezerLink = resolved.links['deezer'];
    const neteaseLink = resolved.links['netease'];
    const appleLink = resolved.links['appleMusic'] || resolved.links['applemusic'];
    const qqLink = resolved.links['qqMusic'] || resolved.links['qqmusic'];

    const platformLinks: Array<[string, ResolvedLink | null | undefined]> = [
      ['spotify', spotifyLink],
      ['deezer', deezerLink],
      ['netease', neteaseLink],
      ['apple', appleLink],
      ['qq', qqLink],
    ];

    // Check if track already exists by any verified platform ID
    let existingTrack: Track | null = null;
    for (const [platform, link] of platformLinks) {
      const platformId = this.getHighConfidencePlatformId(link);
      if (platformId) {
        existingTrack = await this.findByPlatformId(platform, platformId);
        if (existingTrack) break;
      }
    }

    // Only save IDs that have high confidence score (>= 0.8 or isVerified)
    const validSpotifyId = this.getHighConfidencePlatformId(spotifyLink);
    const validDeezerId = this.getHighConfidencePlatformId(deezerLink);
    const validNeteaseId = this.getHighConfidencePlatformId(neteaseLink);
    const validAppleId = this.getHighConfidencePlatformId(appleLink);
    const validQqId = this.getHighConfidencePlatformId(qqLink);

    // Resolve lyrics if not already present
    let lyricsType = existingTrack?.lyricsType ?? null;
    let lyrics = existingTrack?.lyrics ?? null;
    let lyricsProvider = existingTrack?.lyricsProvider ?? null;

    if (!lyrics) {
      const resolvedLyrics = await this.lyricsEngine.resolveLyrics({
        title: meta.title,
        artist: meta.artist,
        artists: meta.artists,
        album: meta.album,
        durationMs: meta.durationMs,
        isrc: meta.isrc || existingTrack?.isrc || undefined,
        deezerId: validDeezerId || existingTrack?.deezerId || undefined,
        neteaseId: validNeteaseId || existingTrack?.neteaseId || undefined,
        qqMusicId: validQqId || existingTrack?.qqMusicId || undefined,
        appleMusicId: validAppleId || existingTrack?.appleMusicId || undefined,
        spotifyId: validSpotifyId || existingTrack?.spotifyId || undefined,
      });

      if (resolvedLyrics) {
        lyricsType = resolvedLyrics.lyricsType;
        lyrics = resolvedLyrics.lyrics;
        lyricsProvider = resolvedLyrics.provider;
      }
    }

    const newTrackData: NewTrack = {
      ...(existingTrack?.id ? { id: existingTrack.id } : {}),
      title: meta.title,
      artists: meta.artists?.length ? meta.artists : (meta.artist ? [meta.artist] : []),
      album: meta.album,
      durationMs: meta.durationMs || 0,
      artworkUrl: meta.image,
      isrc: meta.isrc || existingTrack?.isrc,
      spotifyId: validSpotifyId || existingTrack?.spotifyId,
      deezerId: validDeezerId || existingTrack?.deezerId,
      neteaseId: validNeteaseId || existingTrack?.neteaseId,
      appleMusicId: validAppleId || existingTrack?.appleMusicId,
      qqMusicId: validQqId || existingTrack?.qqMusicId,
      lyricsType,
      lyrics,
      lyricsProvider,
      isVerified: existingTrack?.isVerified ?? false,
    };

    const saved = await this.db
      .insert(tracks)
      .values(newTrackData)
      .onConflictDoUpdate({
        target: tracks.id,
        set: {
          ...newTrackData,
          updatedAt: new Date(),
        },
      })
      .returning();

    return saved[0]!;
  }
}
