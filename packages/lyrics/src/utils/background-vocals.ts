import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
  VocalType,
} from "@repo/types";

export const OPENING_BRACKETS = ["(", "（", "[", "【"];
export const CLOSING_BRACKETS = [")", "）", "]", "】"];

export function hasOpeningBracket(text: string): boolean {
  return OPENING_BRACKETS.some((b) => text.includes(b));
}

export function hasClosingBracket(text: string): boolean {
  return CLOSING_BRACKETS.some((b) => text.includes(b));
}

export function stripBrackets(text: string): string {
  let res = text;
  for (const b of OPENING_BRACKETS) {
    res = res.replaceAll(b, "");
  }
  for (const b of CLOSING_BRACKETS) {
    res = res.replaceAll(b, "");
  }
  return res;
}

export function cleanEnclosingBrackets(text: string): string {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  const startsWithBracket = OPENING_BRACKETS.some((b) => trimmed.startsWith(b));
  const endsWithBracket = CLOSING_BRACKETS.some((b) => trimmed.endsWith(b));

  if (startsWithBracket && endsWithBracket) {
    return stripBrackets(trimmed).trim();
  }
  return trimmed;
}

export interface ExtractedBracketText {
  leadText: string;
  bgTexts: string[];
}

export function extractBracketedTextSegments(
  text: string,
): ExtractedBracketText {
  if (!text || typeof text !== "string") {
    return { leadText: "", bgTexts: [] };
  }

  const bracketRegex = /([（([【])([^\r\n）)\]】]+)([）)\]】])/g;
  const bgTexts: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = bracketRegex.exec(text)) !== null) {
    const inside = match[2]?.trim();
    if (inside) {
      bgTexts.push(inside);
    }
  }

  const leadText = text.replace(bracketRegex, "").replace(/\s+/g, " ").trim();

  return { leadText, bgTexts };
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

function attachStringTokens(
  words: CompactLyricWord[],
  translation?: string,
  romaji?: string,
): CompactLyricLine {
  const trans = (translation ?? "").trim();
  const roma = (romaji ?? "").trim();

  if (trans || roma) {
    return [...words, trans, roma];
  }
  return [...words];
}

function processSingleTokenLine(
  wordToken: CompactLyricWord,
  stringTokens: string[],
): CompactLyricLine[] {
  const [vocalType, startMs, lengthMs, text] = wordToken;
  const bgType = getBgVocalType(vocalType);

  const translation = stringTokens[0] || "";
  const romaji = stringTokens[1] || "";
  const splitTrans = extractBracketedTextSegments(translation);
  const splitRoma = extractBracketedTextSegments(romaji);

  // Regex to detect (background vocal) inside text
  const match = text.match(/([（([【])([^\r\n）)\]】]+)([）)\]】])/);
  if (!match || match.index === undefined) {
    return [attachStringTokens([wordToken], translation, romaji)];
  }

  const matchIdx = match.index;
  const matchLen = match[0].length;
  const beforeText = text.slice(0, matchIdx).trim();
  const bgText = match[2]?.trim() || "";
  const afterText = text.slice(matchIdx + matchLen).trim();

  // If the whole line is in brackets e.g. "(Run from the sun)"
  if (!beforeText && !afterText) {
    const bgTrans =
      splitTrans.bgTexts[0] || cleanEnclosingBrackets(translation);
    const bgRoma = splitRoma.bgTexts[0] || cleanEnclosingBrackets(romaji);
    return [
      attachStringTokens(
        [[bgType, startMs, lengthMs, bgText + " "]],
        bgTrans,
        bgRoma,
      ),
    ];
  }

  const resultLines: CompactLyricLine[] = [];
  const totalChars = Math.max(
    1,
    beforeText.length + bgText.length + afterText.length,
  );

  // Calculate approximate start and duration based on character proportions
  if (beforeText || afterText) {
    const leadTextCombined =
      (beforeText + (afterText ? " " + afterText : "")).trim() + " ";
    const leadDurationMs = Math.round(
      (lengthMs * (beforeText.length + afterText.length)) / totalChars,
    );
    const leadTrans =
      splitTrans.leadText ||
      (splitTrans.bgTexts.length === 0 ? translation : "");
    const leadRoma =
      splitRoma.leadText || (splitRoma.bgTexts.length === 0 ? romaji : "");

    resultLines.push(
      attachStringTokens(
        [
          [
            vocalType,
            startMs,
            Math.max(1, leadDurationMs),
            leadTextCombined,
          ],
        ],
        leadTrans,
        leadRoma,
      ),
    );
  }

  if (bgText) {
    const bgStartMs =
      startMs + Math.round((lengthMs * beforeText.length) / totalChars);
    const bgDurationMs = Math.round((lengthMs * bgText.length) / totalChars);
    const bgTrans = splitTrans.bgTexts[0] || "";
    const bgRoma = splitRoma.bgTexts[0] || "";

    resultLines.push(
      attachStringTokens(
        [[bgType, bgStartMs, Math.max(1, bgDurationMs), bgText + " "]],
        bgTrans,
        bgRoma,
      ),
    );
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

    const translation = stringTokens[0] || "";
    const romaji = stringTokens[1] || "";

    // Check if line contains any brackets in words or translations
    const fullText = words.map((w) => w[3] || "").join("");
    const hasWordBrackets =
      hasOpeningBracket(fullText) || hasClosingBracket(fullText);

    if (!hasWordBrackets) {
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
        const cleanTrans = cleanEnclosingBrackets(translation);
        const cleanRoma = cleanEnclosingBrackets(romaji);
        outputLines.push(
          attachStringTokens(bgTokens, cleanTrans, cleanRoma),
        );
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
          curBgTokens.push([
            bgVocalType,
            actualStartMs,
            actualLengthMs,
            clean,
          ]);
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

    const splitTrans = extractBracketedTextSegments(translation);
    const splitRoma = extractBracketedTextSegments(romaji);

    if (leadTokens.length > 0) {
      ensureTrailingSpace(leadTokens);
      const leadTrans =
        splitTrans.leadText ||
        (bgSegments.length === 0 ? translation : "");
      const leadRoma =
        splitRoma.leadText || (bgSegments.length === 0 ? romaji : "");
      outputLines.push(
        attachStringTokens(leadTokens, leadTrans, leadRoma),
      );
    }

    for (let k = 0; k < bgSegments.length; k++) {
      const bgSeg = bgSegments[k]!;
      if (bgSeg.length > 0) {
        const bgTrans =
          splitTrans.bgTexts[k] ||
          (leadTokens.length === 0 && k === 0
            ? cleanEnclosingBrackets(translation)
            : "");
        const bgRoma =
          splitRoma.bgTexts[k] ||
          (leadTokens.length === 0 && k === 0
            ? cleanEnclosingBrackets(romaji)
            : "");
        outputLines.push(attachStringTokens(bgSeg, bgTrans, bgRoma));
      }
    }
  }

  // Sort lines by startMs
  outputLines.sort((a, b) => {
    const aStart = (
      a.find((item) => Array.isArray(item)) as
        | CompactLyricWord
        | undefined
    )?.[1] ?? 0;
    const bStart = (
      b.find((item) => Array.isArray(item)) as
        | CompactLyricWord
        | undefined
    )?.[1] ?? 0;
    return aStart - bStart;
  });

  // Post-processing pass: Clean bracketed translations and forward background translations
  for (let i = 0; i < outputLines.length; i++) {
    const line = outputLines[i]!;
    const words = line.filter((w): w is CompactLyricWord => Array.isArray(w));
    const stringTokens = line.filter((w): w is string => typeof w === "string");
    if (words.length === 0 || stringTokens.length === 0) continue;

    const trans = stringTokens[0] || "";
    const roma = stringTokens[1] || "";
    const isBg = words[0]![0] === 2 || words[0]![0] === 4;

    if (isBg) {
      const cleanTrans = cleanEnclosingBrackets(trans);
      const cleanRoma = cleanEnclosingBrackets(roma);
      outputLines[i] = attachStringTokens(words, cleanTrans, cleanRoma);
    } else if (
      hasOpeningBracket(trans) ||
      hasClosingBracket(trans) ||
      hasOpeningBracket(roma) ||
      hasClosingBracket(roma)
    ) {
      const splitTrans = extractBracketedTextSegments(trans);
      const splitRoma = extractBracketedTextSegments(roma);

      const cleanLeadTrans =
        splitTrans.leadText || (splitTrans.bgTexts.length === 0 ? trans : "");
      const cleanLeadRoma =
        splitRoma.leadText || (splitRoma.bgTexts.length === 0 ? roma : "");

      outputLines[i] = attachStringTokens(
        words,
        cleanLeadTrans,
        cleanLeadRoma,
      );

      // If next line exists and doesn't have translation, forward background translation
      if (i + 1 < outputLines.length && splitTrans.bgTexts.length > 0) {
        const nextLine = outputLines[i + 1]!;
        const nextWords = nextLine.filter((w): w is CompactLyricWord =>
          Array.isArray(w),
        );
        const nextStringTokens = nextLine.filter(
          (w): w is string => typeof w === "string",
        );

        if (
          nextWords.length > 0 &&
          (!nextStringTokens[0] || nextStringTokens[0].trim() === "")
        ) {
          const nextTrans = splitTrans.bgTexts[0]!;
          const nextRoma =
            splitRoma.bgTexts[0] || nextStringTokens[1] || "";
          outputLines[i + 1] = attachStringTokens(
            nextWords,
            nextTrans,
            nextRoma,
          );
        }
      }
    }
  }

  return outputLines;
}
