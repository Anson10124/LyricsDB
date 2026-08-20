import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';
import { isPlaceholderLyricText } from '../utils/info-lines.js';
import { parseLrc } from './lrc.js';

export interface MusixmatchRichSyncWord {
  c: string; // Text / syllable content
  o: number; // Offset in seconds relative to line start (ts)
}

export interface MusixmatchRichSyncLine {
  ts: number; // Start time in seconds
  te: number; // End time in seconds
  l: MusixmatchRichSyncWord[]; // Word/syllable tokens
  x?: string; // Full line text
}

// Parses Musixmatch RichSync payload into line-grouped compact tuple format.
export function parseMusixmatchRichSync(
  rawRichSync: string | MusixmatchRichSyncLine[],
  metadata?: { title?: string; artist?: string }
): SyncedLyricsPayload {
  if (!rawRichSync) return [];

  let lines: MusixmatchRichSyncLine[];
  if (typeof rawRichSync === 'string') {
    if (isPlaceholderLyricText(rawRichSync, metadata)) return [];
    try {
      lines = JSON.parse(rawRichSync) as MusixmatchRichSyncLine[];
    } catch {
      return [];
    }
  } else {
    lines = rawRichSync;
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  try {
    const rawLines: LyricLine[] = [];

    for (const line of lines) {
      if (!line || !Array.isArray(line.l) || line.l.length === 0) continue;

      const lineStartMs = Math.round((line.ts || 0) * 1000);
      const lineEndMs = Math.round((line.te || line.ts || 0) * 1000);

      // Step 1: Merge isolated space tokens into preceding word token
      const mergedTokens: MusixmatchRichSyncWord[] = [];
      for (const w of line.l) {
        if (!w || typeof w.c !== 'string') continue;
        if (w.c === ' ') {
          if (mergedTokens.length > 0) {
            mergedTokens[mergedTokens.length - 1]!.c += ' ';
          }
        } else {
          mergedTokens.push({ c: w.c, o: w.o ?? 0 });
        }
      }

      if (mergedTokens.length === 0) continue;

      // Step 2: Build LyricWord elements with start and end timestamps
      const words: LyricWord[] = [];
      for (let i = 0; i < mergedTokens.length; i++) {
        const token = mergedTokens[i]!;
        const wordStartMs = lineStartMs + Math.round(token.o * 1000);

        let wordEndMs: number;
        if (i + 1 < mergedTokens.length) {
          wordEndMs = lineStartMs + Math.round(mergedTokens[i + 1]!.o * 1000);
        } else {
          wordEndMs = Math.max(wordStartMs, lineEndMs);
        }

        let text = token.c;
        const isLastInLine = i === mergedTokens.length - 1;
        if (isLastInLine && !text.endsWith(' ')) {
          text = text + ' ';
        }

        words.push({
          startTime: wordStartMs,
          endTime: Math.max(wordStartMs, wordEndMs),
          word: text,
        });
      }

      if (words.length > 0) {
        rawLines.push({
          startTime: lineStartMs,
          endTime: lineEndMs,
          words,
          translatedLyric: '',
          romanLyric: '',
          isBG: false,
          isDuet: false,
        });
      }
    }

    return convertAmllLinesToCompact(rawLines, metadata);
  } catch {
    return [];
  }
}

// Parses Musixmatch Subtitles (standard LRC) into line-grouped compact tuple format.
export function parseMusixmatchSubtitles(
  rawSubtitles: string,
  metadata?: { title?: string; artist?: string }
): SyncedLyricsPayload {
  return parseLrc(rawSubtitles, metadata);
}
