import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { fetchTrackById, fetchTrackLyrics } from "@/lib/api-client";
import { formatArtworkUrl } from "@/lib/artwork";

export interface TrackData {
  track: SanitizedTrack<TrackRecord>;
  lyrics: SyncedLyricsPayload | string | null;
}

// The cover the fullscreen player shows: the animated one when there is one
export function getFullscreenCover(track: SanitizedTrack<TrackRecord>) {
  const video = track.artwork?.squareVideoUrl || track.artwork?.tallVideoUrl;
  return {
    url: video || formatArtworkUrl(track.artwork, 1000) || "",
    isVideo: Boolean(video),
  };
}

export async function fetchTrackData(id: string): Promise<TrackData> {
  const [track, lyricsData] = await Promise.all([
    fetchTrackById(id),
    fetchTrackLyrics(id, "json").catch(() => null),
  ]);

  let lyrics: SyncedLyricsPayload | string | null = null;
  if (lyricsData) {
    if (
      typeof lyricsData === "object" &&
      lyricsData !== null &&
      "plain" in lyricsData
    ) {
      lyrics = (lyricsData as { plain: string }).plain;
    } else {
      lyrics = lyricsData as SyncedLyricsPayload;
    }
  }

  return { track, lyrics };
}

// Puts the cover in the HTTP cache so AMLL's own fetch of it is instant. Capped
// so a slow CDN can't hold up a song switch.
async function preloadCover(track: SanitizedTrack<TrackRecord>) {
  const cover = getFullscreenCover(track);
  if (!cover.url || cover.isVideo) return;
  await Promise.race([
    fetch(cover.url)
      .then((res) => res.blob())
      .catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

// Tracks the fullscreen player's previous/next buttons may switch to. Each
// entry is used once, and only while fresh, so it can't serve stale data.
const PREFETCH_TTL_MS = 5 * 60 * 1000;
const prefetched = new Map<string, { at: number; data: Promise<TrackData> }>();

export function prefetchTrackData(id: string) {
  const existing = prefetched.get(id);
  if (existing && Date.now() - existing.at < PREFETCH_TTL_MS) return;

  const data = fetchTrackData(id).then(async (result) => {
    await preloadCover(result.track);
    return result;
  });
  data.catch(() => {
    if (prefetched.get(id)?.data === data) prefetched.delete(id);
  });
  prefetched.set(id, { at: Date.now(), data });
}

// Uses the prefetched copy when there is one, otherwise fetches. With
// `withCover` the cover is cached too before resolving, for in-place switches.
export function loadTrackData(
  id: string,
  { withCover = false }: { withCover?: boolean } = {},
): Promise<TrackData> {
  const entry = prefetched.get(id);
  prefetched.delete(id);
  if (entry && Date.now() - entry.at < PREFETCH_TTL_MS) {
    return entry.data;
  }

  const data = fetchTrackData(id);
  if (!withCover) return data;
  return data.then(async (result) => {
    await preloadCover(result.track);
    return result;
  });
}
