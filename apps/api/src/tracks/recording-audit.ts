import type { PlatformIdKey } from "@repo/database";
import {
  isSameRecording,
  SAME_RECORDING_MAX_DURATION_DELTA_MS,
  type RecordingInfo,
} from "@repo/music-resolver";
import { PLATFORM_TRACK_FIELDS, type TrackIdField } from "./platform-ids.js";

// Decisions for scripts/audit-mixed-recordings.mts, which looks for tracks whose
// platform IDs (or lyrics) belong to a different version of the song. Kept free
// of network and database access so the rules can be unit-tested.

// A link that opens this ID in its platform's parser (ISRCs have none)
export function canonicalPlatformUrl(
  platform: PlatformIdKey,
  platformId: string,
): string | null {
  const id = encodeURIComponent(platformId);
  switch (platform) {
    case "spotify":
      return `https://open.spotify.com/track/${id}`;
    case "apple":
      return `https://music.apple.com/us/song/${id}`;
    case "deezer":
      return `https://www.deezer.com/track/${id}`;
    case "netease":
      return `https://music.163.com/song?id=${id}`;
    case "qq":
      // QQ stores both numeric song IDs and alphanumeric song MIDs
      return /^\d+$/.test(platformId)
        ? `https://i.y.qq.com/v8/playsong.html?songid=${id}`
        : `https://i.y.qq.com/v8/playsong.html?songmid=${id}`;
    case "isrc":
      return null;
  }
}

export interface AuditedId {
  platform: PlatformIdKey;
  platformId: string;
  // What the platform says this ID is; null when it couldn't be looked up
  info: RecordingInfo | null;
}

export interface AuditedTrack extends RecordingInfo {
  // Imported rows carry a placeholder duration, so only their title is compared
  needsEnrichment?: boolean;
}

export type AliasVerdict =
  // Every ID that could be looked up is the same recording as the row
  | { kind: "ok" }
  // The row and most IDs agree; the rest are another version and can be detached
  | {
      kind: "detach";
      detach: AuditedId[];
      keep: AuditedId[];
      // Kept, but worth a look: see differsOnlyByLabel
      doubtful: AuditedId[];
    }
  // The IDs disagree but it's unclear which side the row belongs to
  | { kind: "conflict"; reason: string; groups: AuditedId[][] };

// Only IDs with a known duration can be grouped: a title alone says nothing about
// a radio edit versus an album version
function isComparable(id: AuditedId): boolean {
  return (id.info?.durationMs ?? 0) > 0;
}

// isSameRecording without album names. Compilations and playlists-turned-albums
// ("Live In The Moment") look like live albums, and a cleanup that deletes links
// should only act on what the title and duration make certain
function sameRecording(a: RecordingInfo, b: RecordingInfo): boolean {
  return isSameRecording(
    { title: a.title, durationMs: a.durationMs },
    { title: b.title, durationMs: b.durationMs },
  );
}

// Sorts IDs into recordings. Each ID joins the first group whose first member it
// matches, so groups are anchored on a single entry rather than drifting
export function groupByRecording(ids: AuditedId[]): AuditedId[][] {
  const groups: AuditedId[][] = [];
  for (const id of ids) {
    if (!isComparable(id)) continue;
    const group = groups.find((g) => sameRecording(g[0]!.info!, id.info!));
    if (group) group.push(id);
    else groups.push([id]);
  }
  return groups;
}

// Decides which of a track's IDs belong to another recording. IDs are compared
// with each other as well as with the row, because older merges may have
// overwritten the row's own title and duration with another version's.
export function judgeTrackIds(
  track: AuditedTrack,
  ids: AuditedId[],
): AliasVerdict {
  const groups = groupByRecording(ids);
  if (groups.length <= 1) {
    // A single group can still disagree with the row itself
    const only = groups[0];
    if (only && !sameRecording(rowInfo(track), only[0]!.info!)) {
      return {
        kind: "conflict",
        reason: "every ID disagrees with the stored row",
        groups,
      };
    }
    return { kind: "ok" };
  }

  const sorted = [...groups].sort((a, b) => b.length - a.length);
  const largest = sorted[0]!;
  if (largest.length === sorted[1]!.length) {
    return { kind: "conflict", reason: "no group has a majority", groups };
  }

  if (!sameRecording(rowInfo(track), largest[0]!.info!)) {
    return {
      kind: "conflict",
      reason: "the stored row matches a minority of its IDs",
      groups,
    };
  }

  // IDs that couldn't be grouped stay: missing data is never a reason to detach
  const anchor = largest[0]!.info!;
  const minority = sorted.slice(1).flat();
  const doubtful = minority.filter((id) => differsOnlyByLabel(id.info!, anchor));
  const detach = minority.filter((id) => !doubtful.includes(id));
  if (detach.length === 0) {
    return {
      kind: "conflict",
      reason: "some IDs differ only by their version label",
      groups,
    };
  }
  const detachKeys = new Set(detach.map(idKey));
  const keep = ids.filter((id) => !detachKeys.has(idKey(id)));
  return { kind: "detach", detach, keep, doubtful };
}

// Same length as the majority, so the IDs differ only by their version labels.
// Labels alone are too unreliable to delete links on:
// - instrumental, off-vocal and karaoke versions share the vocal version's timing,
//   and AMLL links them on purpose so they show the lyrics karaoke-style
// - labels the tag parser misses ("Error instrumental", "Wolves MOTi Remix",
//   "Chinese Harmonic Accompaniment") make the row itself look like the odd one
// - some platforms label wrongly (QQ calls Rick Astley's 7" single a "remix")
// These are kept and reported. A different length is clear-cut: the lyrics timing
// can't fit both.
function differsOnlyByLabel(id: RecordingInfo, anchor: RecordingInfo): boolean {
  const delta = Math.abs((id.durationMs ?? 0) - (anchor.durationMs ?? 0));
  return delta <= SAME_RECORDING_MAX_DURATION_DELTA_MS;
}

function rowInfo(track: AuditedTrack): RecordingInfo {
  return {
    title: track.title,
    durationMs: track.needsEnrichment ? null : track.durationMs,
  };
}

export function idKey(id: { platform: string; platformId: string }): string {
  return `${id.platform}:${id.platformId}`;
}

// Which of a track's primary IDs each lyrics provider is looked up by. When one
// of these is detached, the stored lyrics were likely fetched for the other
// version. Providers that search by title and duration (LRCLIB) aren't listed.
const LYRICS_SOURCE_PLATFORMS: Record<string, PlatformIdKey[]> = {
  netease: ["netease"],
  "netease-yrc": ["netease"],
  qqmusic: ["qq"],
  deezer: ["deezer"],
  musixmatch: ["spotify", "isrc", "apple"],
  lyricify: ["spotify", "isrc"],
  "lrc-red": ["isrc"],
};

export function lyricsSourcePlatforms(
  provider: string | null | undefined,
): PlatformIdKey[] {
  if (!provider) return [];
  return LYRICS_SOURCE_PLATFORMS[provider.toLowerCase()] ?? [];
}

export type PrimaryIds = Partial<Record<TrackIdField, string | null>>;

export interface ColumnChange {
  field: TrackIdField;
  from: string;
  // Another kept ID from the same platform, or null to clear the column
  to: string | null;
}

// For each detached ID that sits in one of the row's primary ID columns, picks a
// replacement from the IDs that stay (or clears the column)
export function planColumnChanges(
  primary: PrimaryIds,
  detach: AuditedId[],
  keep: AuditedId[],
): ColumnChange[] {
  const changes: ColumnChange[] = [];
  for (const id of detach) {
    const field = PLATFORM_TRACK_FIELDS[id.platform];
    if (primary[field] !== id.platformId) continue;
    const replacement = keep.find(
      (k) => k.platform === id.platform && k.info != null,
    );
    changes.push({
      field,
      from: id.platformId,
      to: replacement?.platformId ?? null,
    });
  }
  return changes;
}

// Whether the detached IDs include the one the stored lyrics were fetched by
export function lyricsCameFromDetachedId(
  provider: string | null | undefined,
  columnChanges: ColumnChange[],
): boolean {
  const platforms = lyricsSourcePlatforms(provider);
  return columnChanges.some((change) =>
    platforms.some((p) => PLATFORM_TRACK_FIELDS[p] === change.field),
  );
}
