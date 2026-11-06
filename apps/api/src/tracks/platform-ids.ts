import type { PlatformIdKey, Track } from "@repo/database";
import { getVersionTags, sameVersionTags } from "@repo/music-resolver";

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

// Two catalog entries of one recording can differ by a few seconds of silence;
// radio edits, extended mixes and live takes differ by far more
export const SAME_RECORDING_MAX_DURATION_DELTA_MS = 7000;

export interface RecordingInfo {
  title?: string | null;
  album?: string | null;
  durationMs?: number | null;
}

// Whether two entries are plausibly the same recording: durations agree (when both
// are known) and both carry the same version tags (live, acoustic, remix, ...).
// A similar title alone is not enough, since every version shares it.
export function isSameRecording(a: RecordingInfo, b: RecordingInfo): boolean {
  const aMs = a.durationMs ?? 0;
  const bMs = b.durationMs ?? 0;
  if (aMs > 0 && bMs > 0 && Math.abs(aMs - bMs) > SAME_RECORDING_MAX_DURATION_DELTA_MS) {
    return false;
  }
  return sameVersionTags(
    getVersionTags(a.title, a.album),
    getVersionTags(b.title, b.album),
  );
}
