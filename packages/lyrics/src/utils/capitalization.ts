import type { CompactLyricLine, CompactLyricWord, SyncedLyricsPayload } from '@repo/types';

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

function isLower(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

function toSentenceCase(text: string): string {
  if (!text || text.length === 0) return text;

  let firstLetterSeen = false;
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (/[a-zA-Z]/.test(ch)) {
      if (!firstLetterSeen) {
        chars[i] = ch.toUpperCase();
        firstLetterSeen = true;
      } else {
        chars[i] = ch.toLowerCase();
      }
    }
  }

  // Preserve standalone 'I' capitalization (e.g. "i'm" -> "I'm")
  let result = chars.join('');
  result = result
    .replace(/\bi\b/g, 'I')
    .replace(/\bi'm\b/gi, "I'm")
    .replace(/\bi'll\b/gi, "I'll")
    .replace(/\bi've\b/gi, "I've")
    .replace(/\bi'd\b/gi, "I'd");

  return result;
}

export function normalizeCapitalization(payload: SyncedLyricsPayload): SyncedLyricsPayload {
  if (!Array.isArray(payload) || payload.length === 0) return payload;

  let lowerCount = 0;
  let upperCount = 0;
  let totalLetterLines = 0;

  for (const line of payload) {
    if (!Array.isArray(line)) continue;
    const text = line.map((w) => w[3] || '').join('');
    let lineUpper = 0;
    let lineLower = 0;

    for (const ch of text) {
      if (isUpper(ch)) lineUpper++;
      else if (isLower(ch)) lineLower++;
    }

    if (lineUpper > 0 || lineLower > 0) {
      totalLetterLines++;
      if (lineUpper > 0 && lineLower === 0) upperCount++;
      if (lineLower > 0 && lineUpper === 0) lowerCount++;
    }
  }

  if (totalLetterLines === 0) return payload;

  const upperRatio = upperCount / totalLetterLines;
  const lowerRatio = lowerCount / totalLetterLines;

  // Only normalize if >= 80% of letter lines are uniformly ALL-UPPERCASE or ALL-lowercase
  if (upperRatio < 0.8 && lowerRatio < 0.8) {
    return payload;
  }

  return payload.map((line: CompactLyricLine) => {
    if (!Array.isArray(line) || line.length === 0) return line;

    const fullLineText = line.map((w) => w[3] || '').join('');
    const sentenceCasedText = toSentenceCase(fullLineText);

    // Map new sentence-cased characters back to original word tokens
    let charPos = 0;
    return line.map((wordToken: CompactLyricWord) => {
      const [type, startMs, lengthMs, oldText] = wordToken;
      const len = oldText.length;

      if (len === 0 || charPos + len > sentenceCasedText.length) {
        return wordToken;
      }

      const newText = sentenceCasedText.substring(charPos, charPos + len);
      charPos += len;

      return [type, startMs, lengthMs, newText] as CompactLyricWord;
    });
  });
}
