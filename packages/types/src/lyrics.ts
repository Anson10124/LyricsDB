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

export type SyncType = 'UNSYNCED' | 'LINE_SYNCED' | 'WORD_SYNCED';

export interface SyncedLyricsPayload {
  formatVersion: number;
  syncType: SyncType;
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
  youtubeId?: string | null;
  title: string;
  artistName: string;
  albumName?: string | null;
  durationMs: number;
  hasPlainLyrics: boolean;
  hasLineSynced: boolean;
  hasWordSynced: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: SyncedLyricsPayload | null;
  createdAt: string;
  updatedAt: string;
}
