import type { AudioMatchCandidate } from "@repo/types";
import {
  cleanSearchQuery,
  getVersionTags,
  SAME_RECORDING_MAX_DURATION_DELTA_MS,
} from "./query.js";

// NetEase often hears one recording in several uploads (the original, AI
// covers, re-lyriced versions) that share its audio and so its timing. Those
// agree on where the clip falls within a couple of frames.
export const AUDIO_MATCH_OFFSET_TOLERANCE_MS = 1500;
// How close a group must be to where the listener expected to be in the song
// to win over a larger group (a repeated chorus can match another repeat)
export const AUDIO_MATCH_EXPECTED_TOLERANCE_MS = 3000;

export interface AudioMatchGroup {
  // Uploads of one recording; plain uploads before covers, then NetEase's order
  entries: AudioMatchCandidate[];
  // Median of the entries
  offsetMs: number;
  durationMs: number | null;
  // The song's name without cover or version markers, for finding the original
  cleanTitle: string;
}

export interface GroupAudioMatchesOptions {
  // Where the listener expects the clip to be, when already following a song
  expectedOffsetMs?: number;
}

// Brackets that say the upload is not the original: version tags, "AI", 翻唱
function isMarker(text: string): boolean {
  return getVersionTags(`x (${text})`).length > 0 || /\bAI\b|翻唱|翻自/i.test(text);
}

const BRACKETED = /[([]([^)\]]*)[)\]]/g;

export function isCoverUpload(candidate: AudioMatchCandidate): boolean {
  if (getVersionTags(candidate.title, candidate.album).length > 0) return true;
  const title = cleanSearchQuery(candidate.title);
  return [...title.matchAll(BRACKETED)].some((m) => isMarker(m[1] ?? ""));
}

export function stripCoverMarkers(title: string): string {
  return cleanSearchQuery(title)
    .replace(BRACKETED, (whole, inner: string) => (isMarker(inner) ? " " : whole))
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function fitsGroup(candidate: AudioMatchCandidate, group: AudioMatchCandidate[]): boolean {
  const first = group[0]!;
  if (Math.abs(candidate.offsetMs - first.offsetMs) > AUDIO_MATCH_OFFSET_TOLERANCE_MS) {
    return false;
  }
  if (candidate.durationMs && first.durationMs) {
    return (
      Math.abs(candidate.durationMs - first.durationMs) <= SAME_RECORDING_MAX_DURATION_DELTA_MS
    );
  }
  return true;
}

// Groups NetEase's candidates by recording. The best guess comes first: the
// group near the expected position if given, otherwise the largest group,
// ties going to the one NetEase listed first.
export function groupAudioMatches(
  candidates: AudioMatchCandidate[],
  options: GroupAudioMatchesOptions = {},
): AudioMatchGroup[] {
  const buckets: AudioMatchCandidate[][] = [];
  for (const candidate of candidates) {
    const bucket = buckets.find((b) => fitsGroup(candidate, b));
    if (bucket) bucket.push(candidate);
    else buckets.push([candidate]);
  }

  const groups = buckets.map((bucket, index) => {
    const entries = [
      ...bucket.filter((c) => !isCoverUpload(c)),
      ...bucket.filter((c) => isCoverUpload(c)),
    ];
    return {
      index,
      group: {
        entries,
        offsetMs: median(bucket.map((c) => c.offsetMs))!,
        durationMs: median(bucket.flatMap((c) => (c.durationMs ? [c.durationMs] : []))),
        cleanTitle: stripCoverMarkers(entries[0]!.title),
      } satisfies AudioMatchGroup,
    };
  });

  const expected = options.expectedOffsetMs;
  const nearExpected = (g: AudioMatchGroup) =>
    expected !== undefined &&
    Math.abs(g.offsetMs - expected) <= AUDIO_MATCH_EXPECTED_TOLERANCE_MS;

  return groups
    .sort(
      (a, b) =>
        Number(nearExpected(b.group)) - Number(nearExpected(a.group)) ||
        b.group.entries.length - a.group.entries.length ||
        a.index - b.index,
    )
    .map(({ group }) => group);
}
