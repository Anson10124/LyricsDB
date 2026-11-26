import type { LyricsType, SyncedLyricsPayload } from "./lyrics.js";

export interface ArtworkMetadata {
  url?: string;
  templateUrl?: string;
  width?: number;
  height?: number;
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
  textColor3?: string;
  textColor4?: string;
  hasP3?: boolean;
  squareVideoUrl?: string;
  tallVideoUrl?: string;
  squareHlsUrl?: string;
  tallHlsUrl?: string;
  previewFrameUrl?: string;
}

export type AnimatedArtworkPayload = ArtworkMetadata;

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
  artwork?: ArtworkMetadata | null;
  lyricsType?: LyricsType | null;
  lyrics?: SyncedLyricsPayload | string | null;
  lyricsStoragePath?: string | null;
  lyricsProvider?: string | null;
  hasTranslation?: boolean;
  hasRomaji?: boolean;
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
  hasTranslation?: boolean;
  hasRomaji?: boolean;
};

// Platforms the editor can search for a missing ID (names as in track_platform_ids)
export const SEARCHABLE_PLATFORMS = [
  "spotify",
  "apple",
  "deezer",
  "netease",
  "qq",
] as const;

export type SearchablePlatform = (typeof SEARCHABLE_PLATFORMS)[number];

// One catalog entry a platform search found, scored against the stored track
export interface PlatformSearchResult {
  id: string;
  url: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  artworkUrl?: string;
  // 0-1 similarity to the stored track
  score: number;
  // High enough to be the same recording without a second look
  confident: boolean;
  // Set when the ID already belongs to another track, so it can't be used here
  takenByTrackId?: string;
}

export interface PlatformSearchResponse {
  platform: SearchablePlatform;
  // Best match first
  results: PlatformSearchResult[];
}
