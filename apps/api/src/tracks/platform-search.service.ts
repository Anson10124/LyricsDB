import {
  BadGatewayException,
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  and,
  DatabaseClient,
  eq,
  inArray,
  ne,
  PLATFORM_ID_COLUMNS,
  type Track,
  trackPlatformIds,
  trackRejectedPlatformIds,
  tracks,
} from "@repo/database";
import {
  ProviderQueueFullError,
  ProviderQueueTimeoutError,
  ProviderRateLimitedError,
  type ScoredCandidateResult,
  type TrackMetadata,
} from "@repo/music-resolver";
import type {
  PlatformSearchResponse,
  PlatformSearchResult,
  SearchablePlatform,
} from "@repo/types";

import { DATABASE_CONNECTION } from "../database/database.constants";
import { ResolverService } from "../resolver/resolver.service";
import { ID_FORMATS } from "./track-edit.service";

// Track platform name -> the resolver adapter that searches it
export const SEARCH_ADAPTERS: Record<SearchablePlatform, string> = {
  spotify: "spotify",
  apple: "appleMusic",
  deezer: "deezer",
  netease: "netease",
  qq: "qqMusic",
};

const PLATFORM_NAMES: Record<SearchablePlatform, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  deezer: "Deezer",
  netease: "NetEase",
  qq: "QQ Music",
};

// Results shown to the person; more are fetched so filtering still leaves enough
const RESULT_LIMIT = 8;
const FETCH_LIMIT = 15;
// Below this a result is a different song (an unrelated title the platform's
// search padded the list with), not worth showing
const MIN_SCORE = 0.2;

// Searches are kept briefly so repeat clicks (or several people on one track)
// don't reach the platform again. Only successes are kept.
export const CACHE_TTL_MS = 10 * 60_000;
export const CACHE_MAX_ENTRIES = 500;

// Below resolves (0) in the provider queues, so editor searches never delay them
const SEARCH_PRIORITY = -1;
const SEARCH_TIMEOUT_MS = 8_000;

interface CacheEntry {
  expiresAt: number;
  results: Promise<ScoredCandidateResult[]>;
}

@Injectable()
export class PlatformSearchService {
  private readonly logger = new Logger(PlatformSearchService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly resolverService: ResolverService,
  ) {}

  /**
   * Searches one platform for a stored track, for the editor to fill in a
   * missing ID. The query comes from the track's own details, never from the
   * caller. IDs already rejected for this track are left out, and IDs another
   * track owns are flagged, since saving them would fail.
   */
  async search(
    trackId: string,
    platform: SearchablePlatform,
  ): Promise<PlatformSearchResponse> {
    const [track] = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.id, trackId))
      .limit(1);
    if (!track) throw new NotFoundException(`Track with id ${trackId} not found.`);
    if (track.isVerified) {
      throw new ConflictException(
        "This track has been verified as correct and can't be edited.",
      );
    }

    const ranked = await this.cachedSearch(track, platform);

    const rejected = new Set(
      (
        await this.db
          .select({ platformId: trackRejectedPlatformIds.platformId })
          .from(trackRejectedPlatformIds)
          .where(
            and(
              eq(trackRejectedPlatformIds.trackId, track.id),
              eq(trackRejectedPlatformIds.platform, platform),
            ),
          )
      ).map((row) => row.platformId),
    );

    const usable = ranked
      .filter(({ candidate, score }) => {
        if (score < MIN_SCORE) return false;
        const id = candidate.id?.trim();
        // An ID the edit endpoint would refuse is no use to offer
        return Boolean(id && ID_FORMATS[platform].test(id) && !rejected.has(id));
      })
      .slice(0, RESULT_LIMIT);

    const owners = await this.findOwners(
      track.id,
      platform,
      usable.map(({ candidate }) => candidate.id!.trim()),
    );

    return {
      platform,
      results: usable.map((match) => this.toResult(match, owners)),
    };
  }

  private toResult(
    { candidate, score, isVerified }: ScoredCandidateResult,
    owners: Map<string, string>,
  ): PlatformSearchResult {
    const id = candidate.id!.trim();
    const artists =
      candidate.artists ?? (candidate.artist ? [candidate.artist] : []);
    return {
      id,
      url: candidate.url,
      title: candidate.title,
      artists,
      album: candidate.album || undefined,
      durationMs: candidate.durationMs || undefined,
      isrc: candidate.isrc || undefined,
      artworkUrl: candidate.artworkUrl,
      score: Math.round(score * 1000) / 1000,
      confident: isVerified,
      takenByTrackId: owners.get(id),
    };
  }

  // The tracks (other than this one) that already own any of these IDs
  private async findOwners(
    trackId: string,
    platform: SearchablePlatform,
    ids: string[],
  ): Promise<Map<string, string>> {
    const owners = new Map<string, string>();
    if (ids.length === 0) return owners;

    const column = PLATFORM_ID_COLUMNS[platform];
    const byColumn = await this.db
      .select({ platformId: column, trackId: tracks.id })
      .from(tracks)
      .where(and(inArray(column, ids), ne(tracks.id, trackId)));
    const byAlias = await this.db
      .select({
        platformId: trackPlatformIds.platformId,
        trackId: trackPlatformIds.trackId,
      })
      .from(trackPlatformIds)
      .where(
        and(
          eq(trackPlatformIds.platform, platform),
          inArray(trackPlatformIds.platformId, ids),
          ne(trackPlatformIds.trackId, trackId),
        ),
      );

    for (const row of [...byColumn, ...byAlias]) {
      if (row.platformId && !owners.has(row.platformId)) {
        owners.set(row.platformId, row.trackId);
      }
    }
    return owners;
  }

  // Shares one upstream search between everyone asking for the same track and
  // platform, including requests that arrive while it is still running
  private cachedSearch(
    track: Track,
    platform: SearchablePlatform,
  ): Promise<ScoredCandidateResult[]> {
    const key = `${track.id}:${platform}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.results;

    this.cache.delete(key);
    this.evict(now);

    const results = this.resolverService
      .searchPlatform(
        SEARCH_ADAPTERS[platform],
        this.searchTarget(track),
        { priority: SEARCH_PRIORITY, timeout: SEARCH_TIMEOUT_MS, retries: 1 },
        FETCH_LIMIT,
      )
      .catch((err: unknown) => {
        // A failure must not be served to the next person
        if (this.cache.get(key)?.results === results) this.cache.delete(key);
        throw this.toHttpError(err, platform);
      });
    this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, results });
    return results;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  // What every result is scored against. Imported rows still waiting for
  // enrichment carry a placeholder duration, which would mark down every
  // correct match, so it is left out (as in storedRecordingInfo).
  private searchTarget(track: Track): TrackMetadata {
    const artists = (track.artists ?? []).filter(Boolean);
    return {
      id: track.id,
      type: "song",
      title: track.title,
      artist: artists[0],
      artists,
      album: track.album ?? undefined,
      durationMs:
        track.needsEnrichment || !track.durationMs ? undefined : track.durationMs,
      isrc: track.isrc ?? undefined,
    };
  }

  private toHttpError(err: unknown, platform: SearchablePlatform): Error {
    const name = PLATFORM_NAMES[platform];
    if (err instanceof ProviderRateLimitedError) {
      return new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `${name} is busy right now. Try again in ${err.retryAfterSeconds}s.`,
        error: "Service Unavailable",
        retryAfter: err.retryAfterSeconds,
      });
    }
    if (
      err instanceof ProviderQueueFullError ||
      err instanceof ProviderQueueTimeoutError
    ) {
      return new ServiceUnavailableException(
        `${name} is busy right now. Try again shortly.`,
      );
    }
    this.logger.warn(
      `${name} search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new BadGatewayException(`Couldn't search ${name} right now.`);
  }
}
