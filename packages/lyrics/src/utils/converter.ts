import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type { CompactLyricLine, CompactLyricWord, SyncedLyricsPayload, VocalType } from '@repo/types';

// Converts AMLL LyricLine array to our compact line-grouped format:
// [
//   [ [1, startMs, lengthMs, "word "], ... ], // Line 1
//   [ [1, startMs, lengthMs, "word "], ... ]  // Line 2
// ]
export function convertAmllLinesToCompact(rawLines: LyricLine[]): SyncedLyricsPayload {
  if (!rawLines || !Array.isArray(rawLines)) {
    return [];
  }

  const lines: CompactLyricLine[] = [];

  for (const rawLine of rawLines) {
    // Vocal role resolution:
    // 1: Main Lead, 2: Main Background, 3: Secondary Lead, 4: Secondary Background
    let vocalType: VocalType = 1;
    if (rawLine.isDuet && rawLine.isBG) {
      vocalType = 4;
    } else if (rawLine.isDuet) {
      vocalType = 3;
    } else if (rawLine.isBG) {
      vocalType = 2;
    }

    if (rawLine.words && rawLine.words.length > 0) {
      const lineWords: CompactLyricWord[] = [];

      for (let i = 0; i < rawLine.words.length; i++) {
        const w = rawLine.words[i]!;
        const lengthMs = Math.max(0, w.endTime - w.startTime);
        let text = w.word;

        // Ensure trailing space on final word of the line if missing
        const isLastInLine = i === rawLine.words.length - 1;
        if (isLastInLine && !text.endsWith(' ')) {
          text = text + ' ';
        }

        lineWords.push([vocalType, w.startTime, lengthMs, text]);
      }

      if (lineWords.length > 0) {
        lines.push(lineWords);
      }
    }
  }

  return lines;
}
