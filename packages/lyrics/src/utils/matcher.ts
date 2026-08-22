import type {
  CompactLyricWord,
  SyncedLyricsPayload,
} from "@repo/types";

import {
  applyCasing,
  fixExplicitText,
  isMaskedToken,
  matchProfanityByShape,
} from "./explicit.js";

export interface NormalizedWord {
  raw: string;
  clean: string;
  lower: string;
  isMasked: boolean;
  startMs?: number;
  lengthMs?: number;
}

export interface NormalizedLine {
  rawText: string;
  cleanText: string;
  lowerText: string;
  startMs?: number;
  endMs?: number;
  words: NormalizedWord[];
}

export interface ReferenceDocument {
  lines: NormalizedLine[];
  allWords: Array<NormalizedWord & { lineIndex: number }>;
}

export function decomposeToken(tokenText: string): {
  leadingPunct: string;
  coreWord: string;
  trailingPunct: string;
  trailingSpace: string;
} {
  if (!tokenText) {
    return {
      leadingPunct: "",
      coreWord: "",
      trailingPunct: "",
      trailingSpace: "",
    };
  }

  let text = tokenText;
  let trailingSpace = "";
  if (text.endsWith(" ")) {
    trailingSpace = " ";
    text = text.slice(0, -1);
  }

  // Extract leading non-alphanumeric / quotes / brackets (excluding * and #)
  const leadingMatch = text.match(/^["'([{<«“‘—-]+/);
  const leadingPunct = leadingMatch ? leadingMatch[0] : "";

  text = text.slice(leadingPunct.length);

  // Extract trailing punctuation / quotes / brackets
  const trailingMatch = text.match(/[!?,.:;)"\]}>»”’—-]+$/);
  const trailingPunct = trailingMatch ? trailingMatch[0] : "";
  const coreWord = text.slice(0, text.length - trailingPunct.length);

  return {
    leadingPunct,
    coreWord: coreWord || text,
    trailingPunct,
    trailingSpace,
  };
}

export function cleanWord(word: string): string {
  if (!word) return "";
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}*]/gu, "")
    .trim();
}

function parseLrcTimestamp(tag: string): number | null {
  const match = tag.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1] || "0", 10);
  const seconds = Number.parseInt(match[2] || "0", 10);
  let ms = 0;
  if (match[3]) {
    ms =
      match[3].length === 2
        ? Number.parseInt(match[3], 10) * 10
        : Number.parseInt(match[3], 10);
  }
  return minutes * 60000 + seconds * 1000 + ms;
}

export function extractReferenceDocument(
  reference: SyncedLyricsPayload | string | null | undefined,
): ReferenceDocument | null {
  if (!reference) return null;

  const lines: NormalizedLine[] = [];
  const allWords: Array<NormalizedWord & { lineIndex: number }> = [];

  if (Array.isArray(reference)) {
    // SyncedLyricsPayload
    for (let lIdx = 0; lIdx < reference.length; lIdx++) {
      const compactLine = reference[lIdx];
      if (!Array.isArray(compactLine) || compactLine.length === 0) continue;

      let startMs: number | undefined;
      let endMs: number | undefined;
      const lineWords: NormalizedWord[] = [];
      let fullLineText = "";

      for (const wordToken of compactLine) {
        if (!wordToken || typeof wordToken[3] !== "string") continue;
        const [, tokenStartMs, tokenLenMs, rawWordText] = wordToken;

        if (startMs === undefined) startMs = tokenStartMs;
        endMs = Math.max(endMs || 0, tokenStartMs + (tokenLenMs || 0));

        fullLineText += rawWordText;
        const { coreWord } = decomposeToken(rawWordText);
        if (!coreWord) continue;

        const nw: NormalizedWord = {
          raw: coreWord,
          clean: cleanWord(coreWord),
          lower: coreWord.toLowerCase(),
          isMasked: isMaskedToken(coreWord),
          startMs: tokenStartMs,
          lengthMs: tokenLenMs,
        };
        lineWords.push(nw);
        allWords.push({ ...nw, lineIndex: lIdx });
      }

      if (lineWords.length > 0) {
        lines.push({
          rawText: fullLineText.trim(),
          cleanText: cleanWord(fullLineText),
          lowerText: fullLineText.toLowerCase().trim(),
          startMs,
          endMs,
          words: lineWords,
        });
      }
    }
  } else if (typeof reference === "string") {
    const rawLines = reference.split(/\r?\n/);

    for (let lIdx = 0; lIdx < rawLines.length; lIdx++) {
      const rawLine = rawLines[lIdx]?.trim();
      if (!rawLine) continue;

      let lineText = rawLine;
      let startMs: number | undefined;

      // Check for leading LRC timestamp e.g. [00:00.931]
      const lrcMatch = lineText.match(/^\[\d{1,2}:\d{2}(?:\.\d{2,3})?\]/);
      if (lrcMatch && lrcMatch[0]) {
        const parsedMs = parseLrcTimestamp(lrcMatch[0]);
        if (parsedMs !== null) {
          startMs = parsedMs;
        }
        lineText = lineText.replace(/^\[\d{1,2}:\d{2}(?:\.\d{2,3})?\]\s*/, "");
      }

      // Strip any inline word timestamp tags e.g. <00:00.00> or (0,0)
      lineText = lineText
        .replace(/<\d+:\d+(?:\.\d+)?>/g, "")
        .replace(/\(\d+,\s*\d+(?:,\s*\d+)?\)/g, "")
        .trim();

      if (!lineText || lineText.startsWith("[ti:") || lineText.startsWith("[ar:")) {
        continue;
      }

      const rawWords = lineText.split(/\s+/).filter(Boolean);
      const lineWords: NormalizedWord[] = [];

      for (const rw of rawWords) {
        const { coreWord } = decomposeToken(rw);
        if (!coreWord) continue;
        const nw: NormalizedWord = {
          raw: coreWord,
          clean: cleanWord(coreWord),
          lower: coreWord.toLowerCase(),
          isMasked: isMaskedToken(coreWord),
        };
        lineWords.push(nw);
        allWords.push({ ...nw, lineIndex: lines.length });
      }

      if (lineWords.length > 0) {
        lines.push({
          rawText: lineText,
          cleanText: cleanWord(lineText),
          lowerText: lineText.toLowerCase(),
          startMs,
          words: lineWords,
        });
      }
    }
  }

  if (lines.length === 0 && allWords.length === 0) {
    return null;
  }

  return { lines, allWords };
}

// Checks if an unmasked candidate word is compatible with a masked token
export function isWordCompatibleWithMask(
  maskedWord: string,
  candidateWord: string,
): boolean {
  if (!maskedWord || !candidateWord || isMaskedToken(candidateWord)) {
    return false;
  }

  const cleanMask = cleanWord(maskedWord);
  const cleanCand = cleanWord(candidateWord);
  if (!cleanCand) return false;

  // Pure mask wildcard (e.g. *****, ****, ***, ####)
  if (/^[*#@$%!_-]+$/.test(cleanMask)) {
    return true;
  }

  // Starts with letters (e.g. b**** -> bitch, f*** -> fuck, sh*t -> shit)
  if (/^[a-zA-Z]/.test(cleanMask)) {
    const firstLetter = cleanMask[0]!.toLowerCase();
    if (cleanCand[0]!.toLowerCase() !== firstLetter) {
      return false;
    }
  }

  // Ends with letters (e.g. b***h -> bitch, f***ing -> fucking)
  if (/[a-zA-Z]$/.test(cleanMask)) {
    const lastLetter = cleanMask[cleanMask.length - 1]!.toLowerCase();
    if (cleanCand[cleanCand.length - 1]!.toLowerCase() !== lastLetter) {
      return false;
    }
  }

  return true;
}

// Word sequence alignment between target line words and reference line words
export function alignWordsInLine(
  targetWords: NormalizedWord[],
  refWords: NormalizedWord[],
): Map<number, NormalizedWord> {
  const alignment = new Map<number, NormalizedWord>();
  if (targetWords.length === 0 || refWords.length === 0) {
    return alignment;
  }

  let refIdx = 0;
  for (let tIdx = 0; tIdx < targetWords.length; tIdx++) {
    const tWord = targetWords[tIdx]!;

    if (!tWord.isMasked) {
      // Find matching unmasked word in reference starting from refIdx
      let foundRefIdx = -1;
      for (let r = refIdx; r < Math.min(refWords.length, refIdx + 5); r++) {
        const rWord = refWords[r]!;
        if (!rWord.isMasked && tWord.clean === rWord.clean) {
          foundRefIdx = r;
          break;
        }
      }

      if (foundRefIdx !== -1) {
        alignment.set(tIdx, refWords[foundRefIdx]!);
        refIdx = foundRefIdx + 1;
      }
    } else {
      // Target word is masked. Look at surrounding anchors or direct positional mapping
      if (refIdx < refWords.length) {
        const candidateRefWord = refWords[refIdx]!;
        if (
          !candidateRefWord.isMasked &&
          isWordCompatibleWithMask(tWord.raw, candidateRefWord.raw)
        ) {
          alignment.set(tIdx, candidateRefWord);
          refIdx++;
        }
      }
    }
  }

  // Second pass: for any remaining unaligned masked target words, check linear position
  for (let tIdx = 0; tIdx < targetWords.length; tIdx++) {
    const tWord = targetWords[tIdx]!;
    if (tWord.isMasked && !alignment.has(tIdx)) {
      if (targetWords.length === refWords.length) {
        const candidateRefWord = refWords[tIdx]!;
        if (
          !candidateRefWord.isMasked &&
          isWordCompatibleWithMask(tWord.raw, candidateRefWord.raw)
        ) {
          alignment.set(tIdx, candidateRefWord);
        }
      }
    }
  }

  return alignment;
}

// Strategy 1: Line-level alignment with reference lines
export function findUnmaskedWordFromLine(
  targetLine: NormalizedLine,
  targetWordIdx: number,
  refDoc: ReferenceDocument,
): string | null {
  const targetWord = targetLine.words[targetWordIdx];
  if (!targetWord || !targetWord.isMasked) return null;

  let bestLine: NormalizedLine | null = null;
  let bestScore = -1;

  for (const refLine of refDoc.lines) {
    let score = 0;

    // Timing bonus if both have timestamps
    if (
      targetLine.startMs !== undefined &&
      refLine.startMs !== undefined
    ) {
      const deltaMs = Math.abs(targetLine.startMs - refLine.startMs);
      if (deltaMs <= 3000) {
        score += 0.4 * (1 - deltaMs / 3000);
      }
    }

    // Word token overlap of unmasked words
    const unmaskedTarget = targetLine.words.filter((w) => !w.isMasked);
    if (unmaskedTarget.length > 0) {
      let matchedCount = 0;
      for (const ut of unmaskedTarget) {
        if (refLine.words.some((rw) => !rw.isMasked && rw.clean === ut.clean)) {
          matchedCount++;
        }
      }
      const overlap = matchedCount / unmaskedTarget.length;
      score += 0.6 * overlap;
    } else {
      if (targetLine.startMs !== undefined && refLine.startMs !== undefined) {
        score += 0.5;
      }
    }

    if (score > bestScore && score >= 0.45) {
      bestScore = score;
      bestLine = refLine;
    }
  }

  if (bestLine) {
    const wordAlignment = alignWordsInLine(targetLine.words, bestLine.words);
    const alignedWord = wordAlignment.get(targetWordIdx);
    if (
      alignedWord &&
      !alignedWord.isMasked &&
      isWordCompatibleWithMask(targetWord.raw, alignedWord.raw)
    ) {
      return alignedWord.raw;
    }
  }

  return null;
}

// Strategy 2: Context-window phrase search in allWords across line breaks
export function findUnmaskedWordFromPhrase(
  prevWords: NormalizedWord[],
  nextWords: NormalizedWord[],
  targetMaskedWord: NormalizedWord,
  refDoc: ReferenceDocument,
): string | null {
  const cleanPrev = prevWords.map((w) => w.clean).filter(Boolean);
  const cleanNext = nextWords.map((w) => w.clean).filter(Boolean);

  if (cleanPrev.length === 0 && cleanNext.length === 0) {
    return null;
  }

  for (let i = 0; i < refDoc.allWords.length; i++) {
    const curRefWord = refDoc.allWords[i]!;
    if (curRefWord.isMasked) continue;
    if (!isWordCompatibleWithMask(targetMaskedWord.raw, curRefWord.raw)) continue;

    let prevMatch = true;
    if (cleanPrev.length > 0) {
      if (i < cleanPrev.length) {
        prevMatch = false;
      } else {
        for (let p = 0; p < cleanPrev.length; p++) {
          const expected = cleanPrev[cleanPrev.length - 1 - p]!;
          const actual = refDoc.allWords[i - 1 - p]?.clean;
          if (expected !== actual) {
            prevMatch = false;
            break;
          }
        }
      }
    }

    let nextMatch = true;
    if (cleanNext.length > 0) {
      if (i + 1 + cleanNext.length > refDoc.allWords.length) {
        nextMatch = false;
      } else {
        for (let n = 0; n < cleanNext.length; n++) {
          const expected = cleanNext[n]!;
          const actual = refDoc.allWords[i + 1 + n]?.clean;
          if (expected !== actual) {
            nextMatch = false;
            break;
          }
        }
      }
    }

    if (prevMatch && nextMatch) {
      return curRefWord.raw;
    }
  }

  return null;
}

// Unmasks a single token using all reference documents and fallback heuristics
export function resolveUnmaskedWord(
  targetLine: NormalizedLine,
  targetWordIdx: number,
  prevWords: NormalizedWord[],
  nextWords: NormalizedWord[],
  references: ReferenceDocument[],
): string | null {
  const targetWord = targetLine.words[targetWordIdx];
  if (!targetWord || !targetWord.isMasked) return null;

  // 1. Try Line Alignment across references
  for (const refDoc of references) {
    const word = findUnmaskedWordFromLine(targetLine, targetWordIdx, refDoc);
    if (word) return word;
  }

  // 2. Try Context Window Phrase Search across references
  for (const refDoc of references) {
    const word = findUnmaskedWordFromPhrase(
      prevWords,
      nextWords,
      targetWord,
      refDoc,
    );
    if (word) return word;
  }

  // 3. Heuristic / Shape Dictionary Match
  const shapeMatch = matchProfanityByShape(targetWord.raw);
  if (shapeMatch) {
    return shapeMatch;
  }

  // 4. Regex / Contextual Phrase replacement fallback
  const fixed = fixExplicitText(targetWord.raw);
  if (fixed !== targetWord.raw && !isMaskedToken(fixed)) {
    return fixed;
  }

  return null;
}

export function alignAndUnmaskLyrics(
  target: SyncedLyricsPayload | string,
  references: Array<SyncedLyricsPayload | string | null | undefined>,
): { lyrics: SyncedLyricsPayload | string; unmaskedCount: number } {
  if (!target) {
    return { lyrics: target, unmaskedCount: 0 };
  }

  const validReferences: ReferenceDocument[] = [];
  for (const ref of references) {
    const doc = extractReferenceDocument(ref);
    if (doc) validReferences.push(doc);
  }

  let unmaskedCount = 0;

  if (Array.isArray(target)) {
    const targetPayload = target as SyncedLyricsPayload;
    const normalizedTargetLines: NormalizedLine[] = [];

    // Pre-normalize target lines
    for (const line of targetPayload) {
      if (!Array.isArray(line)) continue;
      const lineWords: NormalizedWord[] = [];
      let fullText = "";
      let startMs: number | undefined;
      let endMs: number | undefined;

      for (const wToken of line) {
        if (!wToken || typeof wToken[3] !== "string") continue;
        const [, tokenStartMs, tokenLenMs, rawText] = wToken;
        if (startMs === undefined) startMs = tokenStartMs;
        endMs = Math.max(endMs || 0, tokenStartMs + (tokenLenMs || 0));
        fullText += rawText;

        const { coreWord } = decomposeToken(rawText);
        lineWords.push({
          raw: coreWord,
          clean: cleanWord(coreWord),
          lower: coreWord.toLowerCase(),
          isMasked: isMaskedToken(coreWord),
          startMs: tokenStartMs,
          lengthMs: tokenLenMs,
        });
      }

      normalizedTargetLines.push({
        rawText: fullText.trim(),
        cleanText: cleanWord(fullText),
        lowerText: fullLineTextCase(fullText),
        startMs,
        endMs,
        words: lineWords,
      });
    }

    // Build unmasked payload
    const unmaskedPayload: SyncedLyricsPayload = [];

    for (let lIdx = 0; lIdx < targetPayload.length; lIdx++) {
      const line = targetPayload[lIdx];
      const normLine = normalizedTargetLines[lIdx];
      if (!line || !Array.isArray(line) || !normLine) {
        if (line) unmaskedPayload.push(line);
        continue;
      }

      const newLine: CompactLyricWord[] = [];

      for (let wIdx = 0; wIdx < line.length; wIdx++) {
        const token = line[wIdx]!;
        const [vocalType, startMs, lengthMs, text] = token;

        if (!isMaskedToken(text)) {
          newLine.push(token);
          continue;
        }

        const { leadingPunct, coreWord, trailingPunct, trailingSpace } =
          decomposeToken(text);

        // Gather up to 3 preceding and 3 following unmasked words
        const prevWords: NormalizedWord[] = [];
        for (let p = Math.max(0, wIdx - 3); p < wIdx; p++) {
          if (normLine.words[p]) prevWords.push(normLine.words[p]!);
        }

        const nextWords: NormalizedWord[] = [];
        for (let n = wIdx + 1; n < Math.min(normLine.words.length, wIdx + 4); n++) {
          if (normLine.words[n]) nextWords.push(normLine.words[n]!);
        }

        const unmaskedWord = resolveUnmaskedWord(
          normLine,
          wIdx,
          prevWords,
          nextWords,
          validReferences,
        );

        if (unmaskedWord) {
          const casedWord = applyCasing(
            coreWord,
            unmaskedWord,
            normLine.rawText,
          );
          let finalTrailingSpace = trailingSpace;
          if (
            !finalTrailingSpace &&
            !coreWord.endsWith("-") &&
            !unmaskedWord.endsWith("-")
          ) {
            finalTrailingSpace = " ";
          }
          const newText =
            leadingPunct + casedWord + trailingPunct + finalTrailingSpace;
          newLine.push([vocalType, startMs, lengthMs, newText]);
          unmaskedCount++;
        } else {
          // Fallback to explicit text fix
          let fallbackText = fixExplicitText(text);
          if (
            !fallbackText.endsWith(" ") &&
            !fallbackText.endsWith("-")
          ) {
            fallbackText = fallbackText + " ";
          }
          if (fallbackText !== text) {
            newLine.push([vocalType, startMs, lengthMs, fallbackText]);
            unmaskedCount++;
          } else {
            newLine.push(token);
          }
        }
      }

      unmaskedPayload.push(newLine);
    }

    return { lyrics: unmaskedPayload, unmaskedCount };
  }

  if (typeof target === "string") {
    const rawTargetLines = target.split(/\r?\n/);
    const normalizedTargetLines: NormalizedLine[] = [];

    for (const rawLine of rawTargetLines) {
      const lineWords: NormalizedWord[] = [];
      const tokens = rawLine.split(/\s+/).filter(Boolean);

      for (const t of tokens) {
        const { coreWord } = decomposeToken(t);
        lineWords.push({
          raw: coreWord,
          clean: cleanWord(coreWord),
          lower: coreWord.toLowerCase(),
          isMasked: isMaskedToken(coreWord),
        });
      }

      normalizedTargetLines.push({
        rawText: rawLine.trim(),
        cleanText: cleanWord(rawLine),
        lowerText: fullLineTextCase(rawLine),
        words: lineWords,
      });
    }

    const unmaskedLines: string[] = [];

    for (let lIdx = 0; lIdx < rawTargetLines.length; lIdx++) {
      const lineStr = rawTargetLines[lIdx]!;
      const normLine = normalizedTargetLines[lIdx]!;

      if (!isMaskedToken(lineStr)) {
        unmaskedLines.push(lineStr);
        continue;
      }

      const tokens = lineStr.split(/(\s+)/);
      const newTokens: string[] = [];
      let wordIdx = 0;

      for (const t of tokens) {
        if (!t.trim() || !isMaskedToken(t)) {
          newTokens.push(t);
          if (t.trim()) wordIdx++;
          continue;
        }

        const { leadingPunct, coreWord, trailingPunct, trailingSpace } =
          decomposeToken(t);

        // Gather surrounding words
        const prevWords: NormalizedWord[] = [];
        for (let p = Math.max(0, wordIdx - 3); p < wordIdx; p++) {
          if (normLine.words[p]) prevWords.push(normLine.words[p]!);
        }

        const nextWords: NormalizedWord[] = [];
        for (let n = wordIdx + 1; n < Math.min(normLine.words.length, wordIdx + 4); n++) {
          if (normLine.words[n]) nextWords.push(normLine.words[n]!);
        }

        const resolved = resolveUnmaskedWord(
          normLine,
          wordIdx,
          prevWords,
          nextWords,
          validReferences,
        );

        if (resolved) {
          const cased = applyCasing(coreWord, resolved, normLine.rawText);
          newTokens.push(leadingPunct + cased + trailingPunct + trailingSpace);
          unmaskedCount++;
        } else {
          const fallback = fixExplicitText(t);
          newTokens.push(fallback);
          if (fallback !== t) unmaskedCount++;
        }

        wordIdx++;
      }

      unmaskedLines.push(newTokens.join(""));
    }

    return { lyrics: unmaskedLines.join("\n"), unmaskedCount };
  }

  return { lyrics: target, unmaskedCount: 0 };
}

function fullLineTextCase(str: string): string {
  return str.toLowerCase().trim();
}
