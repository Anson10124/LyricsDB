import type { CompactLyricWord, SyncedLyricsPayload } from "@repo/types";

// Detects Hanzi and Kana split characters (Korean Hangul is excluded to keep blocks together)
function isZhJaSplitChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  // Hanzi (CJK Unified Ideographs)
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  // Kana (Hiragana & Katakana)
  if (code >= 0x3040 && code <= 0x309f) return true;
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  if (code >= 0x31f0 && code <= 0x31ff) return true;
  return false;
}

const TRAILING_PUNCTUATION = new Set([
  ",",
  ".",
  "?",
  "!",
  '"',
  ":",
  ";",
  "”",
  "’",
  "…",
]);

export function standardizeSyllables(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  if (!Array.isArray(payload)) return payload;

  const resultLines: SyncedLyricsPayload = [];

  for (const line of payload) {
    if (!Array.isArray(line) || line.length === 0) {
      resultLines.push(line);
      continue;
    }

    const words = line.filter((w): w is CompactLyricWord => Array.isArray(w));
    const stringTokens = line.filter((w): w is string => typeof w === "string");

    if (words.length === 0) {
      resultLines.push(line);
      continue;
    }

    // Step 1: Remove empty tokens & merge orphan spaces and punctuation into previous token
    const cleanedLine: CompactLyricWord[] = [];

    for (let i = 0; i < words.length; i++) {
      const token = words[i]!;
      const text = token[3] ?? "";

      // Skip empty tokens
      if (text.length === 0) {
        continue;
      }

      // If lone space token, append space to previous token
      if (text === " ") {
        if (cleanedLine.length > 0) {
          const prev = cleanedLine[cleanedLine.length - 1]!;
          cleanedLine[cleanedLine.length - 1] = [
            prev[0],
            prev[1],
            prev[2] + token[2],
            prev[3] + " ",
          ];
        }
        continue;
      }

      // If standalone trailing punctuation, merge into previous token
      if (
        cleanedLine.length > 0 &&
        text.length <= 2 &&
        TRAILING_PUNCTUATION.has(text.trim()[0] || "")
      ) {
        const prev = cleanedLine[cleanedLine.length - 1]!;
        cleanedLine[cleanedLine.length - 1] = [
          prev[0],
          prev[1],
          prev[2] + token[2],
          prev[3] + text,
        ];
        continue;
      }

      cleanedLine.push(token);
    }

    // Step 2: Split multi-character CJK tokens with weighted duration allocation
    const splitLine: CompactLyricWord[] = [];

    for (const token of cleanedLine) {
      const [vocalType, startMs, lengthMs, text] = token;

      // Count CJK split chars in text
      let cjkCount = 0;
      for (const ch of text) {
        if (isZhJaSplitChar(ch)) cjkCount++;
      }

      // If token contains 2 or more CJK characters, split into individual character tokens
      if (cjkCount >= 2 && lengthMs > 0) {
        const chars = Array.from(text);
        const totalDuration = lengthMs;
        let allocatedMs = 0;
        let curStartMs = startMs;

        for (let idx = 0; idx < chars.length; idx++) {
          const ch = chars[idx]!;
          let durMs: number;

          if (idx === chars.length - 1) {
            durMs = totalDuration - allocatedMs;
          } else {
            durMs = Math.max(1, Math.round(totalDuration / chars.length));
            const minRemaining = chars.length - 1 - idx;
            if (allocatedMs + durMs > totalDuration - minRemaining) {
              durMs = totalDuration - allocatedMs - minRemaining;
            }
          }

          let tokenText = ch;
          // Add trailing space on final char if original token had space
          if (idx === chars.length - 1 && text.endsWith(" ")) {
            tokenText += " ";
          }

          splitLine.push([vocalType, curStartMs, durMs, tokenText]);
          allocatedMs += durMs;
          curStartMs += durMs;
        }
      } else {
        splitLine.push(token);
      }
    }

    resultLines.push([...splitLine, ...stringTokens]);
  }

  return resultLines;
}
