import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
  VocalType,
} from "@repo/types";

const OPENING_BRACKETS = ["(", "（", "[", "【"];
const CLOSING_BRACKETS = [")", "）", "]", "】"];

function hasOpeningBracket(text: string): boolean {
  return OPENING_BRACKETS.some((b) => text.includes(b));
}

function hasClosingBracket(text: string): boolean {
  return CLOSING_BRACKETS.some((b) => text.includes(b));
}

function stripBrackets(text: string): string {
  let res = text;
  for (const b of OPENING_BRACKETS) {
    res = res.replaceAll(b, "");
  }
  for (const b of CLOSING_BRACKETS) {
    res = res.replaceAll(b, "");
  }
  return res;
}

function isPureBracketToken(text: string): boolean {
  const trimmed = text.trim();
  return (
    OPENING_BRACKETS.includes(trimmed) || CLOSING_BRACKETS.includes(trimmed)
  );
}

function getBgVocalType(vocalType: VocalType): VocalType {
  if (vocalType === 3 || vocalType === 4) {
    return 4; // Secondary Background (Duet BG)
  }
  return 2; // Main Background
}

function ensureTrailingSpace(tokens: CompactLyricWord[]): void {
  if (tokens.length === 0) return;
  const last = tokens[tokens.length - 1]!;
  if (!last[3].endsWith(" ") && !last[3].endsWith("-")) {
    tokens[tokens.length - 1] = [last[0], last[1], last[2], last[3] + " "];
  }
}

function processSingleTokenLine(
  wordToken: CompactLyricWord,
  stringTokens: string[],
): CompactLyricLine[] {
  const [vocalType, startMs, lengthMs, text] = wordToken;
  const bgType = getBgVocalType(vocalType);

  // Regex to detect (background vocal) inside text
  const match = text.match(/([（([【])([^\r\n）)\]】]+)([）)\]】])/);
  if (!match || match.index === undefined) {
    return [[wordToken, ...stringTokens]];
  }

  const matchIdx = match.index;
  const matchLen = match[0].length;
  const beforeText = text.slice(0, matchIdx).trim();
  const bgText = match[2]?.trim() || "";
  const afterText = text.slice(matchIdx + matchLen).trim();

  // If the whole line is in brackets e.g. "(Run from the sun)"
  if (!beforeText && !afterText) {
    return [[[bgType, startMs, lengthMs, bgText + " "], ...stringTokens]];
  }

  const resultLines: CompactLyricLine[] = [];
  const totalChars = Math.max(1, beforeText.length + bgText.length + afterText.length);

  // Calculate approximate start and duration based on character proportions
  if (beforeText || afterText) {
    const leadTextCombined = (beforeText + (afterText ? " " + afterText : "")).trim() + " ";
    const leadDurationMs = Math.round(
      (lengthMs * (beforeText.length + afterText.length)) / totalChars,
    );
    resultLines.push([[vocalType, startMs, Math.max(1, leadDurationMs), leadTextCombined], ...stringTokens]);
  }

  if (bgText) {
    const bgStartMs = startMs + Math.round((lengthMs * beforeText.length) / totalChars);
    const bgDurationMs = Math.round((lengthMs * bgText.length) / totalChars);
    resultLines.push([[bgType, bgStartMs, Math.max(1, bgDurationMs), bgText + " "]]);
  }

  return resultLines;
}

export function extractBackgroundVocals(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  if (!Array.isArray(payload) || payload.length === 0) {
    return payload;
  }

  const outputLines: CompactLyricLine[] = [];

  for (const line of payload) {
    if (!Array.isArray(line) || line.length === 0) continue;

    const words = line.filter((w): w is CompactLyricWord => Array.isArray(w));
    const stringTokens = line.filter((w): w is string => typeof w === "string");

    if (words.length === 0) continue;

    // Check if line contains any brackets
    const fullText = words.map((w) => w[3] || "").join("");
    if (!hasOpeningBracket(fullText) && !hasClosingBracket(fullText)) {
      outputLines.push(line);
      continue;
    }

    // Special case: Single word token line with parenthesized background part
    if (words.length === 1 && words[0]) {
      const splitLines = processSingleTokenLine(words[0], stringTokens);
      for (const sl of splitLines) {
        outputLines.push(sl);
      }
      continue;
    }

    const baseVocalType = words[0]![0];
    const bgVocalType = getBgVocalType(baseVocalType);

    // If whole line text starts and ends with bracket and has no inner unmatched brackets
    const trimmedFull = fullText.trim();

    const isFullLineBracket =
      OPENING_BRACKETS.some((b) => trimmedFull.startsWith(b)) &&
      CLOSING_BRACKETS.some((b) => trimmedFull.endsWith(b)) &&
      !hasOpeningBracket(trimmedFull.slice(1, -1)) &&
      !hasClosingBracket(trimmedFull.slice(1, -1));

    if (isFullLineBracket) {
      const bgTokens: CompactLyricWord[] = [];
      for (const token of words) {
        if (isPureBracketToken(token[3])) continue;
        const clean = stripBrackets(token[3]);
        if (clean.trim().length > 0) {
          bgTokens.push([bgVocalType, token[1], token[2], clean]);
        }
      }
      if (bgTokens.length > 0) {
        ensureTrailingSpace(bgTokens);
        outputLines.push([...bgTokens, ...stringTokens]);
      }
      continue;
    }

    // Word-by-word token line with partial bracketed sections
    const leadTokens: CompactLyricWord[] = [];
    const bgSegments: CompactLyricWord[][] = [];
    let curBgTokens: CompactLyricWord[] = [];
    let insideBracket = false;
    let pendingPureBracketToken: CompactLyricWord | null = null;

    for (let i = 0; i < words.length; i++) {
      const token = words[i]!;
      const [, startMs, lengthMs, text] = token;

      const hasOpen = hasOpeningBracket(text);
      const hasClose = hasClosingBracket(text);

      if (isPureBracketToken(text)) {
        if (hasOpen) {
          insideBracket = true;
          pendingPureBracketToken = token;
        } else if (hasClose) {
          insideBracket = false;
          if (curBgTokens.length > 0) {
            // Extend last background token duration if pure closing bracket had time
            const lastBg = curBgTokens[curBgTokens.length - 1]!;
            curBgTokens[curBgTokens.length - 1] = [
              lastBg[0],
              lastBg[1],
              lastBg[2] + lengthMs,
              lastBg[3],
            ];
            ensureTrailingSpace(curBgTokens);
            bgSegments.push(curBgTokens);
            curBgTokens = [];
          }
        }
        continue;
      }

      if (hasOpen && hasClose) {
        // Token has both open and close brackets e.g. "(Yeah) "
        const clean = stripBrackets(text);
        if (clean.trim().length > 0) {
          const bgToken: CompactLyricWord = [
            bgVocalType,
            startMs,
            lengthMs,
            clean.endsWith(" ") ? clean : clean + " ",
          ];
          bgSegments.push([bgToken]);
        }
        continue;
      }

      if (hasOpen) {
        insideBracket = true;
        const clean = stripBrackets(text);
        const actualStartMs = pendingPureBracketToken
          ? pendingPureBracketToken[1]
          : startMs;
        const actualLengthMs = pendingPureBracketToken
          ? pendingPureBracketToken[2] + lengthMs
          : lengthMs;
        pendingPureBracketToken = null;

        if (clean.trim().length > 0) {
          curBgTokens.push([bgVocalType, actualStartMs, actualLengthMs, clean]);
        }
        continue;
      }

      if (hasClose) {
        insideBracket = false;
        const clean = stripBrackets(text);
        if (clean.trim().length > 0) {
          curBgTokens.push([bgVocalType, startMs, lengthMs, clean]);
        }
        if (curBgTokens.length > 0) {
          ensureTrailingSpace(curBgTokens);
          bgSegments.push(curBgTokens);
          curBgTokens = [];
        }
        continue;
      }

      if (insideBracket) {
        const clean = stripBrackets(text);
        if (clean.trim().length > 0) {
          curBgTokens.push([bgVocalType, startMs, lengthMs, clean]);
        }
      } else {
        leadTokens.push(token);
      }
    }

    if (curBgTokens.length > 0) {
      ensureTrailingSpace(curBgTokens);
      bgSegments.push(curBgTokens);
    }

    if (leadTokens.length > 0) {
      ensureTrailingSpace(leadTokens);
      outputLines.push([...leadTokens, ...stringTokens]);
    }

    for (const bgSeg of bgSegments) {
      if (bgSeg.length > 0) {
        outputLines.push(bgSeg);
      }
    }
  }

  // Sort lines by startMs
  outputLines.sort((a, b) => {
    const aStart = (a.find((item) => Array.isArray(item)) as CompactLyricWord | undefined)?.[1] ?? 0;
    const bStart = (b.find((item) => Array.isArray(item)) as CompactLyricWord | undefined)?.[1] ?? 0;
    return aStart - bStart;
  });

  return outputLines;
}
