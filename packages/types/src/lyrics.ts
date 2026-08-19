export interface WordSync {
  word: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface LyricLine {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  words?: WordSync[];
}

export type LyricsType = 'word' | 'line' | 'plain';

export interface SyncedLyricsPayload {
  formatVersion?: number;
  type: LyricsType;
  lines: LyricLine[];
}

export interface TrackMetadata {
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
  lyricsType?: LyricsType | null;
  lyrics?: SyncedLyricsPayload | string | null;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}
