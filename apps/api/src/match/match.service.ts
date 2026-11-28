import {
  BadGatewayException,
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { decodeShazamSignature, SHAZAM_SAMPLE_RATE } from "@repo/audio-fingerprint";
import { DatabaseClient, ilike, type Track, tracks } from "@repo/database";
import {
  AUDIO_MATCH_EXPECTED_TOLERANCE_MS,
  AUDIO_MATCH_OFFSET_TOLERANCE_MS,
  cleanSearchQuery,
  DeezerAdapter,
  groupAudioMatches,
  isCoverUpload,
  isSameRecording,
  matchAudioFingerprint,
  matchShazamSignature,
  ProviderQueueFullError,
  ProviderQueueTimeoutError,
  ProviderRateLimitedError,
  type AudioMatchGroup,
  type AudioMatchResult,
  type ResolvedLink,
  type ShazamMatch,
  type ShazamMatchResult,
} from "@repo/music-resolver";
import type {
  AudioMatchProvider,
  AudioMatchResponse,
  SyncedLyricsPayload,
} from "@repo/types";

import { DATABASE_CONNECTION } from "../database/database.constants";
import { storedRecordingInfo } from "../tracks/platform-ids";
import { TracksService } from "../tracks/tracks.service";
import type { MatchAudioDto } from "./dto/match-request.dto";

// The outside services a match talks to, swappable in tests
export interface MatchSources {
  // NetEase's audio match
  matchAudio(fingerprint: string, durationSec: number): Promise<AudioMatchResult>;
  matchShazam(signatureUri: string, sampleMs: number): Promise<ShazamMatchResult>;
  // A Deezer catalog entry for the song, to find the original release
  searchDeezer(title: string, durationMs: number | null): Promise<ResolvedLink | null>;
}

export const MATCH_SOURCES = "MATCH_SOURCES";

export const defaultMatchSources: MatchSources = {
  matchAudio: (fingerprint, durationSec) => matchAudioFingerprint(fingerprint, durationSec),
  matchShazam: (signatureUri, sampleMs) => matchShazamSignature(signatureUri, sampleMs),
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

// The recording a track is checked against: what a provider heard
type HeardRecording = Pick<AudioMatchGroup, "cleanTitle" | "durationMs">;

const PROVIDER_NAMES: Record<AudioMatchProvider, string> = {
  shazam: "Shazam",
  netease: "NetEase",
};

// A provider's answer that lets the next provider try: nothing heard, the
// heard song couldn't be loaded, or the provider is busy or failing
function canFallBack(err: unknown): boolean {
  return (
    err instanceof NotFoundException ||
    err instanceof ServiceUnavailableException ||
    err instanceof BadGatewayException
  );
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
    const order = this.providerOrder(dto);
    if (order.length === 0) {
      throw new BadRequestException(
        dto.provider === "shazam"
          ? "Shazam needs a shazamSignature."
          : dto.provider === "netease"
            ? "NetEase needs a fingerprint."
            : "Send a fingerprint, a shazamSignature, or both.",
      );
    }

    let lastError: unknown;
    for (const provider of order) {
      try {
        return provider === "shazam"
          ? await this.matchShazam(dto, clientIp)
          : await this.matchNetease(dto, clientIp);
      } catch (err) {
        if (!canFallBack(err)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  // Which providers to ask, in order. Auto asks Shazam first for a new song,
  // since it names the original recording; while following a song NetEase
  // goes first, as Shazam only allows a few requests a minute per server.
  // A provider whose input wasn't sent is skipped.
  private providerOrder(dto: MatchAudioDto): AudioMatchProvider[] {
    const mode = dto.provider ?? "auto";
    const order: AudioMatchProvider[] =
      mode !== "auto"
        ? [mode]
        : dto.expectedTrackId
          ? ["netease", "shazam"]
          : ["shazam", "netease"];
    return order.filter((p) =>
      p === "shazam" ? Boolean(dto.shazamSignature) : Boolean(dto.fingerprint),
    );
  }

  private async matchNetease(dto: MatchAudioDto, clientIp: string): Promise<AudioMatchResponse> {
    let heard: AudioMatchResult;
    try {
      heard = await this.sources.matchAudio(
        dto.fingerprint!,
        dto.duration ?? DEFAULT_CLIP_SECONDS,
      );
    } catch (err) {
      throw this.toHttpError(err, "netease");
    }

    const groups = groupAudioMatches(heard.candidates, {
      expectedOffsetMs: dto.expectedOffsetMs,
    });
    if (groups.length === 0) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: "No song matched this clip.",
        error: "Not Found",
        noMatchReason: heard.noMatchReason,
      });
    }

    const lookups = new Map<string, Promise<Track[]>>();
    const best = await this.pickGroup(groups, dto, lookups);
    const track = await this.trackFor(best, dto, clientIp, lookups);
    return {
      track: this.tracksService.sanitizeTrack(track),
      offsetMs: best.offsetMs,
      lyrics: await this.lyricsFor(track, clientIp),
      provider: "netease",
      candidates: [best, ...groups.filter((g) => g !== best)].flatMap((g) => g.entries),
      shazam: null,
    };
  }

  private async matchShazam(dto: MatchAudioDto, clientIp: string): Promise<AudioMatchResponse> {
    const signature = dto.shazamSignature!;
    const sampleMs = this.signatureSampleMs(signature);
    let heard: ShazamMatchResult;
    try {
      heard = await this.sources.matchShazam(signature, sampleMs);
    } catch (err) {
      throw this.toHttpError(err, "shazam");
    }
    const match = heard.match;
    if (!match) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: "No song matched this clip.",
        error: "Not Found",
      });
    }

    const track = await this.shazamTrack(match, dto, clientIp);
    return {
      track: this.tracksService.sanitizeTrack(track),
      offsetMs: match.offsetMs,
      lyrics: await this.lyricsFor(track, clientIp),
      provider: "shazam",
      candidates: [],
      shazam: {
        shazamKey: match.shazamKey,
        title: match.title,
        artists: match.artist ? [match.artist] : [],
        album: match.album,
        isrc: match.isrc,
        appleMusicId: match.appleMusicId,
        offsetMs: match.offsetMs,
      },
    };
  }

  // Checks the signature is well formed before this server sends it on, and
  // takes the clip length from it rather than trusting the client
  private signatureSampleMs(uri: string): number {
    const base64 = uri.slice(uri.indexOf(",") + 1);
    try {
      const { sampleCount } = decodeShazamSignature(Buffer.from(base64, "base64"));
      const sampleMs = Math.round((sampleCount / SHAZAM_SAMPLE_RATE) * 1000);
      if (sampleMs < 1000 || sampleMs > 12_000) throw new Error("the clip must be 1-12 s");
      return sampleMs;
    } catch (err) {
      throw new BadRequestException(
        `shazamSignature is not a valid signature: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // The track for the recording Shazam named. Shazam gives the release's ISRC
  // and Apple Music ID, so there are no covers to work around:
  // 1. the followed track, if it's this song
  // 2. an indexed track with the ISRC or Apple Music ID
  // 3. Apple Music's entry, synced live
  // 4. Deezer's entry for the song
  // At most one track is fetched live per request.
  private async shazamTrack(
    match: ShazamMatch,
    dto: MatchAudioDto,
    clientIp: string,
  ): Promise<Track> {
    const heard: HeardRecording = { cleanTitle: cleanSearchQuery(match.title), durationMs: null };

    if (dto.expectedTrackId) {
      const expected = await this.tracksService
        .findById(dto.expectedTrackId, clientIp)
        .catch((err: unknown) => {
          if (err instanceof NotFoundException) return null;
          throw err;
        });
      if (expected && this.isShazamSong(expected, match, heard, dto)) return expected;
    }

    let fallback: Track | undefined;
    for (const [platform, id] of [
      ["isrc", match.isrc],
      ["apple", match.appleMusicId],
    ] as const) {
      if (!id) continue;
      const stored = await this.tracksService.findByPlatformId(platform, id);
      if (stored && this.hasLyrics(stored)) return stored;
      fallback ??= stored ?? undefined;
    }

    let liveUsed = false;
    if (!fallback && match.appleMusicId) {
      liveUsed = true;
      try {
        const synced = await this.tracksService.getOrSyncTrack(
          { platform: "apple", id: match.appleMusicId },
          clientIp,
        );
        if (this.hasLyrics(synced)) return synced;
        fallback = synced;
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
        this.logger.debug(`Apple Music entry ${match.appleMusicId} from Shazam couldn't be loaded`);
      }
    }

    if (!liveUsed) {
      const fromDeezer = await this.originalFromDeezer(heard, clientIp);
      if (fromDeezer?.track && this.hasLyrics(fromDeezer.track)) return fromDeezer.track;
      fallback ??= fromDeezer?.track ?? undefined;
    }

    if (fallback) return fallback;
    throw new NotFoundException(`Heard "${match.title}" but couldn't load it.`);
  }

  // Whether the followed track is the song Shazam heard: the same release, or
  // the same title heard where the listener expected to be
  private isShazamSong(
    track: Track,
    match: ShazamMatch,
    heard: HeardRecording,
    dto: MatchAudioDto,
  ): boolean {
    if (match.isrc && track.isrc === match.isrc) return true;
    if (match.appleMusicId && track.appleMusicId === match.appleMusicId) return true;
    return (
      dto.expectedOffsetMs !== undefined &&
      Math.abs(match.offsetMs - dto.expectedOffsetMs) <= AUDIO_MATCH_EXPECTED_TOLERANCE_MS &&
      this.isSameSong(track, heard)
    );
  }

  // Where every edit of a song shares the same audio (an intro, say), NetEase
  // hears several recordings at the same position and the clip can't tell them
  // apart. Then the recording whose indexed copy is the most widely catalogued
  // wins: usually the original release rather than an extended upload or remix.
  private async pickGroup(
    groups: AudioMatchGroup[],
    dto: MatchAudioDto,
    lookups: Map<string, Promise<Track[]>>,
  ): Promise<AudioMatchGroup> {
    const first = groups[0]!;
    if (groups.length === 1 || this.isFollowedPosition(first, dto)) return first;

    const contenders = groups.filter(
      (g) => Math.abs(g.offsetMs - first.offsetMs) <= AUDIO_MATCH_OFFSET_TOLERANCE_MS,
    );
    if (contenders.length === 1) return first;

    let best = first;
    let bestScore = -1;
    for (const group of contenders) {
      const [copy] = await this.indexedCopies(group, lookups);
      const score = copy ? catalogPresence(copy) + (copy.isrc ? 1 : 0) : 0;
      if (score > bestScore) {
        best = group;
        bestScore = score;
      }
    }
    return best;
  }

  private isFollowedPosition(group: AudioMatchGroup, dto: MatchAudioDto): boolean {
    return (
      dto.expectedTrackId !== undefined &&
      dto.expectedOffsetMs !== undefined &&
      Math.abs(group.offsetMs - dto.expectedOffsetMs) <= AUDIO_MATCH_EXPECTED_TOLERANCE_MS
    );
  }

  private async trackFor(
    group: AudioMatchGroup,
    dto: MatchAudioDto,
    clientIp: string,
    lookups: Map<string, Promise<Track[]>>,
  ): Promise<Track> {
    // Still on the song the listener is following: no need to look it up again
    if (this.isFollowedPosition(group, dto)) {
      const expected = await this.tracksService.findById(dto.expectedTrackId!, clientIp);
      if (this.isSameSong(expected, group)) return expected;
    }
    return this.resolveGroup(group, clientIp, lookups);
  }

  // The best track for a recording NetEase heard. The uploads it names are often
  // covers that share the original's audio, so look for the original first:
  // 1. an indexed copy with an ISRC (an official release)
  // 2. Deezer's entry for the song, synced like any other track
  // 3. any indexed copy of the recording, best catalogued first
  // 4. NetEase's own uploads, plain ones before covers
  // At most one track is fetched live per request.
  private async resolveGroup(
    group: AudioMatchGroup,
    clientIp: string,
    lookups: Map<string, Promise<Track[]>>,
  ): Promise<Track> {
    const indexed = await this.indexedCopies(group, lookups);
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
  // no cover or version tags), best catalogued first. Groups of one song share
  // a title, so the search runs once per title per request.
  private async indexedCopies(
    group: AudioMatchGroup,
    lookups: Map<string, Promise<Track[]>>,
  ): Promise<Track[]> {
    const pattern = group.cleanTitle.trim().replace(/[%_\\]/g, "\\$&");
    if (!pattern) return [];
    let search = lookups.get(pattern);
    if (!search) {
      // Promise.resolve runs the query builder once; awaiting it again would re-run it
      search = Promise.resolve(
        this.db
          .select()
          .from(tracks)
          .where(ilike(tracks.title, `%${pattern}%`))
          .limit(50),
      );
      lookups.set(pattern, search);
    }
    const rows = await search;
    const durationGap = (t: Track) =>
      group.durationMs && t.durationMs ? Math.abs(t.durationMs - group.durationMs) : 0;
    return rows
      .filter((t) => this.hasLyrics(t) && this.isSameSong(t, group))
      .sort((a, b) => catalogPresence(b) - catalogPresence(a) || durationGap(a) - durationGap(b));
  }

  // undefined when Deezer has nothing usable; otherwise the track (if it could
  // be loaded) and whether loading it spent this request's live fetch
  private async originalFromDeezer(
    group: HeardRecording,
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

  private isSameSong(track: Track, group: HeardRecording): boolean {
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

  private toHttpError(err: unknown, provider: AudioMatchProvider): Error {
    const name = PROVIDER_NAMES[provider];
    if (err instanceof ProviderRateLimitedError) {
      return new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `${name} is busy right now. Try again in ${err.retryAfterSeconds}s.`,
        error: "Service Unavailable",
        retryAfter: err.retryAfterSeconds,
      });
    }
    if (err instanceof ProviderQueueFullError || err instanceof ProviderQueueTimeoutError) {
      return new ServiceUnavailableException(`${name} is busy right now. Try again shortly.`);
    }
    this.logger.warn(
      `${name} audio match failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new BadGatewayException(`Couldn't reach ${name}'s song recognition right now.`);
  }
}
