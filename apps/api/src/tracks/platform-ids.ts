import type { NewTrack, PlatformIdKey, Track } from "@repo/database";

// Shared with the resolver, which runs the same check on its own matches
export {
  isSameRecording,
  SAME_RECORDING_MAX_DURATION_DELTA_MS,
  type RecordingInfo,
} from "@repo/music-resolver";

export interface VerifiedPlatformIds {
  spotifyId?: string;
  deezerId?: string;
  neteaseId?: string;
  appleMusicId?: string;
  qqMusicId?: string;
}

export interface PlatformIdRef {
  platform: PlatformIdKey;
  platformId: string;
}

export type TrackIdField = keyof VerifiedPlatformIds | "isrc";

// Track field holding each platform's primary ID, in the order IDs are collected
export const PLATFORM_TRACK_FIELDS: Record<PlatformIdKey, TrackIdField> = {
  spotify: "spotifyId",
  apple: "appleMusicId",
  deezer: "deezerId",
  netease: "neteaseId",
  qq: "qqMusicId",
  isrc: "isrc",
};

const TRACK_ID_FIELDS = Object.entries(PLATFORM_TRACK_FIELDS) as Array<
  [PlatformIdKey, TrackIdField]
>;

type TrackIds = Partial<Record<TrackIdField, string | null>>;

// Matches the track_platform_ids.platform_id column length
const MAX_PLATFORM_ID_LENGTH = 64;

export function platformIdKey(ref: PlatformIdRef): string {
  return `${ref.platform}:${ref.platformId}`;
}

// Every usable ID for a track: the resolver's high-confidence matches, the ISRC,
// and whatever the stored row already holds. Deduplicated, in a stable order.
export function collectPlatformIds(
  validIds: VerifiedPlatformIds,
  isrc?: string | null,
  track?: TrackIds | null,
): PlatformIdRef[] {
  const sources: TrackIds[] = [{ ...validIds, isrc }, track ?? {}];

  const seen = new Set<string>();
  const refs: PlatformIdRef[] = [];
  for (const source of sources) {
    for (const [platform, field] of TRACK_ID_FIELDS) {
      const platformId = source[field]?.trim();
      if (!platformId || platformId.length > MAX_PLATFORM_ID_LENGTH) continue;
      const ref = { platform, platformId };
      if (seen.has(platformIdKey(ref))) continue;
      seen.add(platformIdKey(ref));
      refs.push(ref);
    }
  }
  return refs;
}

export interface TrackMatch {
  track: Track;
  // How many of the looked-up IDs point at this track
  matchedIds: number;
  // Whether it owns the ID the request was made with
  ownsSource: boolean;
}

// Deterministic choice when a resolve's IDs point at more than one stored track:
// the track owning the requested ID, then a verified one, then the one most IDs
// agree on, then the oldest.
export function pickTrackMatch(matches: TrackMatch[]): Track | null {
  const ranked = [...matches].sort(
    (a, b) =>
      Number(b.ownsSource) - Number(a.ownsSource) ||
      Number(b.track.isVerified) - Number(a.track.isVerified) ||
      b.matchedIds - a.matchedIds ||
      new Date(a.track.createdAt).getTime() -
        new Date(b.track.createdAt).getTime(),
  );
  return ranked[0]?.track ?? null;
}

export type TrackDetails = Pick<
  NewTrack,
  "title" | "artists" | "album" | "durationMs" | "artwork"
>;

// A stored row keeps the title, artists, album, duration and artwork it was first
// saved with, so resolving it from another release doesn't flip what it shows.
// Imported rows still waiting for platform metadata take the fresh values.
export function keepStoredDetails(
  existing: Track | null | undefined,
  fresh: TrackDetails,
): TrackDetails {
  const kept = existing && !existing.needsEnrichment ? existing : null;
  return {
    title: kept?.title || fresh.title,
    artists: kept?.artists?.length ? kept.artists : fresh.artists,
    album: kept ? (kept.album ?? fresh.album) : fresh.album,
    durationMs: kept?.durationMs || fresh.durationMs || 0,
    artwork: kept?.artwork || fresh.artwork || existing?.artwork || null,
  };
}

type LyricsFields = Pick<NewTrack, "lyrics" | "lyricsStoragePath">;

export function hasStoredLyrics(track: LyricsFields): boolean {
  const { lyrics, lyricsStoragePath } = track;
  if (lyricsStoragePath?.trim()) return true;
  if (Array.isArray(lyrics)) return lyrics.length > 0;
  if (typeof lyrics === "string") return lyrics.trim().length > 0;
  return Boolean(lyrics);
}

// Folds a save into a stored row of the same recording, as when two requests
// insert one new track at once. The row keeps its details and IDs (fresh IDs only
// fill its empty columns), and the lyrics move as one bundle: the row's own if it
// has any, otherwise the fresh ones. Mixing the fields could pair one source's
// lyrics with another's type or storage path.
export function mergeIntoStoredTrack(existing: Track, fresh: NewTrack): NewTrack {
  const lyricsFrom =
    hasStoredLyrics(existing) || !hasStoredLyrics(fresh) ? existing : fresh;

  const merged: NewTrack = {
    ...fresh,
    id: existing.id,
    ...keepStoredDetails(existing, fresh),
    lyrics: lyricsFrom.lyrics ?? null,
    lyricsType: lyricsFrom.lyricsType ?? null,
    lyricsProvider: lyricsFrom.lyricsProvider ?? null,
    lyricsStoragePath: lyricsFrom.lyricsStoragePath ?? null,
    hasTranslation: lyricsFrom.hasTranslation ?? false,
    hasRomaji: lyricsFrom.hasRomaji ?? false,
    isVerified: existing.isVerified || Boolean(fresh.isVerified),
    needsEnrichment: existing.needsEnrichment && Boolean(fresh.needsEnrichment),
  };
  for (const [, field] of TRACK_ID_FIELDS) {
    merged[field] = existing[field] || fresh[field] || null;
  }
  return merged;
}
