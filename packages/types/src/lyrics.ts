// 1 = Main Lead
// 2 = Main Background
// 3 = Secondary Lead (Duet)
// 4 = Secondary Background (Duet Background)
export type VocalType = 1 | 2 | 3 | 4;

// Compact Word/Syllable Token: [type, startMs, lengthMs, text]
// e.g. [1, 358, 1336, "Lately "]
//
// Space at the back of text means complete word; no space means syllable within same word.
export type CompactLyricWord = [
  type: VocalType,
  startMs: number,
  lengthMs: number,
  text: string
];

// A line of lyrics containing one or more word tokens.
export type CompactLyricLine = CompactLyricWord[];

export type LyricsType = 'word' | 'line' | 'plain';

// Array of lines: CompactLyricLine[]
//
// [
//   [ [1, 358, 1336, "Lately "], [1, 1694, 487, "I've "] ], // Line 1
//   [ [1, 2181, 673, "Hello "], [1, 2800, 500, "world "] ]  // Line 2
// ]
export type SyncedLyricsPayload = CompactLyricLine[];

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
  lyricsProvider?: string | null;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}
