import type { SyncedLyricsPayload } from "./lyrics.js";
import type { SanitizedTrack, TrackRecord } from "./track.js";

// The song recognition services /api/match can ask
export type AudioMatchProvider = "shazam" | "netease";

// Which services a match may use: "auto" tries Shazam and NetEase in turn
export type AudioMatchMode = "auto" | AudioMatchProvider;

// One song NetEase's audio match heard in a clip
export interface AudioMatchCandidate {
  neteaseId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  // Where in this song the clip started
  offsetMs: number;
}

// The song Shazam heard in a clip
export interface ShazamMatchCandidate {
  shazamKey: string;
  title: string;
  artists: string[];
  album: string | null;
  isrc: string | null;
  appleMusicId: string | null;
  // Where in this song the clip started
  offsetMs: number;
}

// What POST /api/match returns
export interface AudioMatchResponse {
  track: SanitizedTrack<TrackRecord>;
  // Where in `track` the recorded clip started
  offsetMs: number;
  lyrics: SyncedLyricsPayload | null;
  // The service that recognised the clip
  provider: AudioMatchProvider;
  // Everything NetEase heard, best guess first (empty when Shazam answered)
  candidates: AudioMatchCandidate[];
  // The song Shazam heard, when Shazam answered
  shazam: ShazamMatchCandidate | null;
}
