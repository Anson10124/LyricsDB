// 1 = Main Lead
// 2 = Main Background
// 3 = Secondary Lead (Duet)
// 4 = Secondary Background (Duet Background)
export type VocalType = 1 | 2 | 3 | 4;

// Compact Word/Syllable Token: [type, startMs, lengthMs, text]
// e.g. [1, 18500, 380, "君"]
// e.g. [1, 18500, 380, "Never "]
//
// Space at the back of text means complete word; no space means syllable within same word.
export type CompactLyricWord = [
  type: VocalType,
  startMs: number,
  lengthMs: number,
  text: string,
];

// A line of lyrics containing word tokens, followed optionally by line translation and line romaji strings.
// e.g. [ [1, 1772, 216, "I "], [1, 1988, 430, "couldn't "], "我已经等不及你来清理橱柜", "" ]
export type CompactLyricLine = (CompactLyricWord | string)[];

export type LyricsType = "word" | "line" | "plain";

// Array of lines: CompactLyricLine[]
export type SyncedLyricsPayload = CompactLyricLine[];

export const SUPPORTED_LYRIC_FORMATS = [
  "ttml",
  "lrc",
  "lrca2",
  "yrc",
  "qrc",
  "eslrc",
  "ass",
  "lyl",
  "lys",
  "lqe",
  "json",
] as const;

export type SupportedLyricFormat = (typeof SUPPORTED_LYRIC_FORMATS)[number];

export function isSupportedLyricFormat(
  format: string,
): format is SupportedLyricFormat {
  return SUPPORTED_LYRIC_FORMATS.includes(
    format.toLowerCase().trim() as SupportedLyricFormat,
  );
}

export interface FormattedLyricsResult {
  content: string | SyncedLyricsPayload | Record<string, unknown>;
  contentType: string;
}

