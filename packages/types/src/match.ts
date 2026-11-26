import type { SyncedLyricsPayload } from "./lyrics.js";
import type { SanitizedTrack, TrackRecord } from "./track.js";

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

// What POST /api/match returns
export interface AudioMatchResponse {
  track: SanitizedTrack<TrackRecord>;
  // Where in `track` the recorded clip started
  offsetMs: number;
  lyrics: SyncedLyricsPayload | null;
  // Everything NetEase heard, best guess first
  candidates: AudioMatchCandidate[];
}
