import {
  BadGatewayException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseClient, ilike, type Track, tracks } from "@repo/database";
import {
  AUDIO_MATCH_EXPECTED_TOLERANCE_MS,
  cleanSearchQuery,
  DeezerAdapter,
  groupAudioMatches,
  isCoverUpload,
  isSameRecording,
  matchAudioFingerprint,
  ProviderQueueFullError,
  ProviderQueueTimeoutError,
  ProviderRateLimitedError,
  type AudioMatchGroup,
  type AudioMatchResult,
  type ResolvedLink,
} from "@repo/music-resolver";
import type { AudioMatchResponse, SyncedLyricsPayload } from "@repo/types";

import { DATABASE_CONNECTION } from "../database/database.constants";
import { storedRecordingInfo } from "../tracks/platform-ids";
import { TracksService } from "../tracks/tracks.service";
import type { MatchAudioDto } from "./dto/match-request.dto";

// The outside services a match talks to, swappable in tests
export interface MatchSources {
  matchAudio(fingerprint: string, durationSec: number): Promise<AudioMatchResult>;
  // A Deezer catalog entry for the song, to find the original release
  searchDeezer(title: string, durationMs: number | null): Promise<ResolvedLink | null>;
}

export const MATCH_SOURCES = "MATCH_SOURCES";

export const defaultMatchSources: MatchSources = {
  matchAudio: (fingerprint, durationSec) => matchAudioFingerprint(fingerprint, durationSec),
  searchDeezer: (title, durationMs) =>
    new DeezerAdapter().search(
      title,
      { id: "match", title, durationMs: durationMs ?? undefined, type: "song" },
      { timeout: 8000, retries: 1 },
    ),
};

export const DEFAULT_CLIP_SECONDS = 3;

// Platform IDs a track can carry; the original release is usually on all of them,
// while covers and fan uploads are often on NetEase alone
const CATALOG_FIELDS = [
  "isrc",
  "spotifyId",
  "appleMusicId",
  "deezerId",
  "neteaseId",
  "qqMusicId",
] as const satisfies ReadonlyArray<keyof Track>;

function catalogPresence(track: Track): number {
  return CATALOG_FIELDS.filter((field) => Boolean(track[field])).length;
}

// A title reduced to its letters and digits, in any script
function titleKey(title: string): string {
  return cleanSearchQuery(title).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly tracksService: TracksService,
    @Inject(MATCH_SOURCES) private readonly sources: MatchSources,
  ) {}

  async match(dto: MatchAudioDto, clientIp: string): Promise<AudioMatchResponse> {
    let heard: AudioMatchResult;
    try {
      heard = await this.sources.matchAudio(
        dto.fingerprint,
        dto.duration ?? DEFAULT_CLIP_SECONDS,
      );
    } catch (err) {
      throw this.toHttpError(err);
    }

    const groups = groupAudioMatches(heard.candidates, {
      expectedOffsetMs: dto.expectedOffsetMs,
    });
    const best = groups[0];
    if (!best) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: "No song matched this clip.",
        error: "Not Found",
        noMatchReason: heard.noMatchReason,
      });
    }

    const track = await this.trackFor(best, dto, clientIp);
    return {
      track: this.tracksService.sanitizeTrack(track),
      offsetMs: best.offsetMs,
      lyrics: await this.lyricsFor(track, clientIp),
      candidates: groups.flatMap((g) => g.entries),
    };
  }

  private async trackFor(
    group: AudioMatchGroup,
    dto: MatchAudioDto,
    clientIp: string,
  ): Promise<Track> {
    // Still on the song the listener is following: no need to look it up again
    if (
      dto.expectedTrackId &&
      dto.expectedOffsetMs !== undefined &&
      Math.abs(group.offsetMs - dto.expectedOffsetMs) <= AUDIO_MATCH_EXPECTED_TOLERANCE_MS
    ) {
      const expected = await this.tracksService.findById(dto.expectedTrackId, clientIp);
      if (this.isSameSong(expected, group)) return expected;
    }
    return this.resolveGroup(group, clientIp);
  }

  // The best track for a recording NetEase heard. The uploads it names are often
  // covers that share the original's audio, so look for the original first:
  // 1. an indexed copy with an ISRC (an official release)
  // 2. Deezer's entry for the song, synced like any other track
  // 3. any indexed copy of the recording, best catalogued first
  // 4. NetEase's own uploads, plain ones before covers
  // At most one track is fetched live per request.
  private async resolveGroup(group: AudioMatchGroup, clientIp: string): Promise<Track> {
    const indexed = await this.indexedCopies(group);
    const official = indexed.find((t) => t.isrc);
    if (official) return official;

    let liveUsed = false;
    const fromDeezer = await this.originalFromDeezer(group, clientIp);
    if (fromDeezer !== undefined) {
      liveUsed = fromDeezer.live;
      if (fromDeezer.track && this.hasLyrics(fromDeezer.track)) return fromDeezer.track;
    }

    if (indexed[0]) return indexed[0];

    let fallback: Track | undefined = fromDeezer?.track ?? undefined;
    for (const entry of group.entries) {
      const stored = await this.tracksService.findByPlatformId("netease", entry.neteaseId);
      if (stored && this.hasLyrics(stored)) return stored;
      fallback ??= stored ?? undefined;
      if (!stored && !liveUsed && !isCoverUpload(entry)) {
        liveUsed = true;
        const synced = await this.tracksService.getOrSyncTrack(
          { platform: "netease", id: entry.neteaseId },
          clientIp,
        );
        if (this.hasLyrics(synced)) return synced;
        fallback ??= synced;
      }
    }

    // Only covers were heard and none is indexed yet
    if (!fallback && !liveUsed) {
      fallback = await this.tracksService.getOrSyncTrack(
        { platform: "netease", id: group.entries[0]!.neteaseId },
        clientIp,
      );
    }
    if (fallback) return fallback;
    throw new NotFoundException(`Heard "${group.cleanTitle}" but couldn't load it.`);
  }

  // Indexed tracks with lyrics that are this recording (same name, same length,
  // no cover or version tags), best catalogued first
  private async indexedCopies(group: AudioMatchGroup): Promise<Track[]> {
    const pattern = group.cleanTitle.trim().replace(/[%_\\]/g, "\\$&");
    if (!pattern) return [];
    const rows = await this.db
      .select()
      .from(tracks)
      .where(ilike(tracks.title, `%${pattern}%`))
      .limit(50);
    const durationGap = (t: Track) =>
      group.durationMs && t.durationMs ? Math.abs(t.durationMs - group.durationMs) : 0;
    return rows
      .filter((t) => this.hasLyrics(t) && this.isSameSong(t, group))
      .sort((a, b) => catalogPresence(b) - catalogPresence(a) || durationGap(a) - durationGap(b));
  }

  // undefined when Deezer has nothing usable; otherwise the track (if it could
  // be loaded) and whether loading it spent this request's live fetch
  private async originalFromDeezer(
    group: AudioMatchGroup,
    clientIp: string,
  ): Promise<{ track: Track | null; live: boolean } | undefined> {
    let link: ResolvedLink | null;
    try {
      link = await this.sources.searchDeezer(group.cleanTitle, group.durationMs);
    } catch (err) {
      this.logger.debug(`Deezer search for a match failed: ${String(err)}`);
      return undefined;
    }
    if (!link?.id || !link.isVerified || link.notAvailable) return undefined;
    if (
      link.matched &&
      !isSameRecording(
        { title: link.matched.title, album: link.matched.album, durationMs: link.matched.durationMs },
        { title: group.cleanTitle, durationMs: group.durationMs },
      )
    ) {
      return undefined;
    }

    const stored = await this.tracksService.findByPlatformId("deezer", link.id);
    if (stored) return { track: stored, live: false };
    const synced = await this.tracksService.getOrSyncTrack(
      { platform: "deezer", id: link.id },
      clientIp,
    );
    return { track: this.isSameSong(synced, group) ? synced : null, live: true };
  }

  private isSameSong(track: Track, group: AudioMatchGroup): boolean {
    return (
      titleKey(track.title) === titleKey(group.cleanTitle) &&
      isSameRecording(storedRecordingInfo(track), {
        title: group.cleanTitle,
        durationMs: group.durationMs,
      })
    );
  }

  private hasLyrics(track: Track): boolean {
    return this.tracksService.sanitizeTrack(track).hasLyrics;
  }

  private async lyricsFor(track: Track, clientIp: string): Promise<SyncedLyricsPayload | null> {
    if (!this.hasLyrics(track)) return null;
    try {
      const result = await this.tracksService.getLyrics(
        { trackId: track.id, format: "json" },
        clientIp,
      );
      return Array.isArray(result.content) ? (result.content as SyncedLyricsPayload) : null;
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  private toHttpError(err: unknown): Error {
    if (err instanceof ProviderRateLimitedError) {
      return new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `NetEase is busy right now. Try again in ${err.retryAfterSeconds}s.`,
        error: "Service Unavailable",
        retryAfter: err.retryAfterSeconds,
      });
    }
    if (err instanceof ProviderQueueFullError || err instanceof ProviderQueueTimeoutError) {
      return new ServiceUnavailableException("NetEase is busy right now. Try again shortly.");
    }
    this.logger.warn(
      `NetEase audio match failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new BadGatewayException("Couldn't reach NetEase's song recognition right now.");
  }
}
