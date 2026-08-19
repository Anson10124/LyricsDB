import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';

export interface DeezerWordToken {
  start: number;
  end: number;
  word: string;
}

export interface DeezerWordByWordLine {
  start: number;
  end: number;
  words: DeezerWordToken[];
}

export interface DeezerSyncedLine {
  lrcTimestamp?: string;
  line: string;
  lineTranslated?: string | null;
  milliseconds: number;
  duration: number;
}

// Parses Deezer synchronizedWordByWordLines into line-grouped compact tuple format.
export function parseDeezerWordLyrics(
  lines: DeezerWordByWordLine[],
  metadata?: { title?: string; artist?: string }
): SyncedLyricsPayload {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  try {
    const rawLines: LyricLine[] = lines.map((line) => {
      const words: LyricWord[] = (line.words || []).map((w) => {
        let text = w.word || '';
        // Ensure trailing space to denote complete word token
        if (!text.endsWith(' ')) {
          text = text + ' ';
        }
        return {
          startTime: w.start,
          endTime: w.end,
          word: text,
        };
      });

      return {
        startTime: line.start,
        endTime: line.end,
        words,
        translatedLyric: '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
      };
    });

    return convertAmllLinesToCompact(rawLines, metadata);
  } catch {
    return [];
  }
}

// Parses Deezer synchronizedLines (line-by-line synced) into line-grouped compact tuple format.
export function parseDeezerSyncedLines(
  lines: DeezerSyncedLine[],
  metadata?: { title?: string; artist?: string }
): SyncedLyricsPayload {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  try {
    const rawLines: LyricLine[] = lines.map((line) => {
      const startTime = line.milliseconds;
      const endTime = line.milliseconds + (line.duration || 0);
      let text = line.line || '';
      if (!text.endsWith(' ')) {
        text = text + ' ';
      }

      return {
        startTime,
        endTime,
        words: [
          {
            startTime,
            endTime,
            word: text,
          },
        ],
        translatedLyric: line.lineTranslated || '',
        romanLyric: '',
        isBG: false,
        isDuet: false,
      };
    });

    return convertAmllLinesToCompact(rawLines, metadata);
  } catch {
    return [];
  }
}
