import type { LyricsType, SyncedLyricsPayload } from "./lyrics.js";

export interface AnimatedArtworkPayload {
  squareVideoUrl?: string;
  tallVideoUrl?: string;
  squareHlsUrl?: string;
  tallHlsUrl?: string;
  previewFrameUrl?: string;
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
}

export interface TrackRecord {
  id: string;
  isrc?: string | null;
  spotifyId?: string | null;
  appleMusicId?: string | null;
  deezerId?: string | null;
  neteaseId?: string | null;
  qqMusicId?: string | null;
  title: string;
  artists: string[];
  album?: string | null;
  durationMs: number;
  artworkUrl?: string | null;
  animatedArtwork?: AnimatedArtworkPayload | null;
  lyricsType?: LyricsType | null;
  lyrics?: SyncedLyricsPayload | string | null;
  lyricsStoragePath?: string | null;
  lyricsProvider?: string | null;
  isVerified: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface GetOrSyncTrackOptions {
  platform?: string;
  id?: string;
  url?: string;
}

export interface GetLyricsOptions extends GetOrSyncTrackOptions {
  trackId?: string;
  format?: string;
}

export type SanitizedTrack<T extends { lyrics?: unknown }> = Omit<
  T,
  "lyrics"
> & {
  hasLyrics: boolean;
};
