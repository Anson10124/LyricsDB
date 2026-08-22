import {
  parseQrc as parseAmllQrc,
  parseYrc as parseAmllYrc,
  type LyricLine,
} from "@applemusic-like-lyrics/lyric";
import { isPlaceholderLyricText } from "./info-lines.js";
import { extractLyricContent } from "./qrc-decoder.js";

export interface TimestampedLine {
  startTime: number;
  text: string;
  originalText?: string;
}

export interface RomajiLineMatch {
  startTime: number;
  text: string;
  originalText?: string;
  words?: Array<{ startTime: number; endTime: number; word: string }>;
}

export interface TranslationSourceOptions {
  translation?: string | null;
  romaji?: string | null;
  referenceLrc?: string | null;
  metadata?: { title?: string; artist?: string };
}

// Regex for vocalize tokens and non-lexical ad-libs (e.g. "Ohh", "Ah", "Oh-oh, oh-oh-oh", "La la la", "Yeah yeah")
const VOCALIZE_REGEX =
  /^[\s\p{P}]*(?:o+h+|a+h+|u+h+|o+o+h+|a+h+h+|ye+a+h+|la+|na+|da+|wo+o+|who+a+|ha+|hey+|m+m+|h+m+|e+h+)(?:[\s\p{P}]+(?:o+h+|a+h+|u+h+|o+o+h+|a+h+h+|ye+a+h+|la+|na+|da+|wo+o+|who+a+|ha+|hey+|m+m+|h+m+|e+h+))*[\s\p{P}]*$/iu;

export function isVocalizeText(text: string): boolean {
  if (!text) return true;
  const clean = text.trim();
  if (clean.length === 0) return true;
  return VOCALIZE_REGEX.test(clean);
}

function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordSimilarity(textA: string, textB: string): number {
  const normA = normalizeForComparison(textA);
  const normB = normalizeForComparison(textB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const wordsA = new Set(normA.split(" ").filter((w) => w.length > 1));
  const wordsB = new Set(normB.split(" ").filter((w) => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) {
    return normA === normB ? 1.0 : 0;
  }

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

export function parseLrcTimestamp(tag: string): number | null {
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

export function isMetadataOrPlaceholder(text: string): boolean {
  if (!text || !text.trim()) return true;
  const trimmed = text.trim();

  // LRC headers
  if (/^\[(ti|ar|al|by|offset|length|re|ve|tool):/i.test(trimmed)) {
    return true;
  }

  // Common credit and placeholder lines
  if (
    /^(作词|作曲|编曲|制作人|录音|混音|母带|和声|吉他|贝斯|鼓|键盘|弦乐|企划|统筹|监制|发行|出品|OP|SP|Lyricist|Composer|Arranger|Producer)\s*[:：]/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (
    trimmed.includes("纯音乐，请欣赏") ||
    trimmed.includes("没有填词") ||
    trimmed.includes("此歌词为无损音质") ||
    trimmed.includes("QQ音乐享有本翻译作品的著作权") ||
    trimmed.includes("未经著作权人书面许可") ||
    trimmed.startsWith("//")
  ) {
    return true;
  }

  return false;
}

export function parseTimestampedLines(
  rawText: string,
  metadata?: { title?: string; artist?: string },
  referenceRawText?: string,
): TimestampedLine[] {
  if (!rawText || typeof rawText !== "string") return [];

  const lines = rawText.split(/\r?\n/);
  const result: TimestampedLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timestampMatches = Array.from(
      trimmed.matchAll(/\[(\d{1,2}:\d{2}(?:\.\d{2,3})?)\]/g),
    );
    if (timestampMatches.length === 0) continue;

    const cleanText = trimmed
      .replace(/\[\d{1,2}:\d{2}(?:\.\d{2,3})?\]/g, "")
      .trim();

    if (
      !cleanText ||
      isMetadataOrPlaceholder(cleanText) ||
      isPlaceholderLyricText(cleanText, metadata)
    ) {
      continue;
    }

    for (const match of timestampMatches) {
      const parsedMs = parseLrcTimestamp(match[0]);
      if (parsedMs !== null) {
        result.push({
          startTime: parsedMs,
          text: cleanText,
        });
      }
    }
  }

  result.sort((a, b) => a.startTime - b.startTime);

  // If reference text is provided, pair each translation line with its corresponding original text line
  if (referenceRawText && typeof referenceRawText === "string") {
    const referenceLines = parseTimestampedLines(referenceRawText, metadata);
    if (referenceLines.length > 0) {
      for (const transLine of result) {
        const matchingRef = referenceLines.find(
          (ref) => Math.abs(ref.startTime - transLine.startTime) <= 400,
        );
        if (matchingRef) {
          transLine.originalText = matchingRef.text;
        }
      }
    }
  }

  return result;
}

export function parseRomajiSource(
  raw: string,
  metadata?: { title?: string; artist?: string },
  referenceRawText?: string,
): RomajiLineMatch[] {
  if (!raw || typeof raw !== "string") return [];

  const cleanQrc = extractLyricContent(raw);
  const textToTest = cleanQrc || raw;
  let matches: RomajiLineMatch[] = [];

  // 1. Check if it's QRC format with word timestamps
  if (textToTest.includes("(") && textToTest.includes(")")) {
    try {
      const amllLines = parseAmllQrc(textToTest);
      if (amllLines && amllLines.length > 0) {
        for (const line of amllLines) {
          const lineText = line.words.map((w) => w.word).join("").trim();
          if (
            !lineText ||
            isMetadataOrPlaceholder(lineText) ||
            isPlaceholderLyricText(lineText, metadata)
          ) {
            continue;
          }
          matches.push({
            startTime: line.startTime,
            text: lineText,
            words: line.words.map((w) => ({
              startTime: w.startTime,
              endTime: w.endTime,
              word: w.word,
            })),
          });
        }
      }
    } catch {
      // Fallback
    }
  }

  // 2. Check if it's YRC format
  if (matches.length === 0 && textToTest.startsWith("[") && textToTest.includes("](")) {
    try {
      const amllLines = parseAmllYrc(textToTest);
      if (amllLines && amllLines.length > 0) {
        for (const line of amllLines) {
          const lineText = line.words.map((w) => w.word).join("").trim();
          if (
            !lineText ||
            isMetadataOrPlaceholder(lineText) ||
            isPlaceholderLyricText(lineText, metadata)
          ) {
            continue;
          }
          matches.push({
            startTime: line.startTime,
            text: lineText,
            words: line.words.map((w) => ({
              startTime: w.startTime,
              endTime: w.endTime,
              word: w.word,
            })),
          });
        }
      }
    } catch {
      // Fallback
    }
  }

  // 3. Fallback to standard timestamped LRC
  if (matches.length === 0) {
    const lrcLines = parseTimestampedLines(textToTest, metadata);
    matches = lrcLines.map((l) => ({
      startTime: l.startTime,
      text: l.text,
    }));
  }

  matches.sort((a, b) => a.startTime - b.startTime);

  // If reference text is provided, attach original text
  if (referenceRawText && typeof referenceRawText === "string") {
    const referenceLines = parseTimestampedLines(referenceRawText, metadata);
    if (referenceLines.length > 0) {
      for (const romaLine of matches) {
        const matchingRef = referenceLines.find(
          (ref) => Math.abs(ref.startTime - romaLine.startTime) <= 400,
        );
        if (matchingRef) {
          romaLine.originalText = matchingRef.text;
        }
      }
    }
  }

  return matches;
}

/**
 * Dynamic Programming Sequence Alignment Algorithm
 * Aligns base lyrics with translation or romaji lines globally,
 * avoiding greedy misalignments, vocalize theft, and background ad-lib errors.
 */
function alignSequenceDP<
  T extends {
    startTime: number;
    text: string;
    originalText?: string;
  },
>(
  baseLines: LyricLine[],
  candidates: T[],
  onMatch: (baseLine: LyricLine, candidate: T) => void,
): void {
  const N = baseLines.length;
  const M = candidates.length;
  if (N === 0 || M === 0) return;

  const lineTexts = baseLines.map((l) =>
    l.words.map((w) => w.word).join("").trim(),
  );
  const lineVocalize = lineTexts.map((t) => isVocalizeText(t));
  const candVocalize = candidates.map((c) => isVocalizeText(c.text));

  // DP table: dp[i][j] = min cost to align base 0..i with candidates 0..j
  const dp: number[][] = Array.from({ length: N + 1 }, () =>
    new Array(M + 1).fill(Number.POSITIVE_INFINITY),
  );
  const choice: ("match" | "skipBase" | "skipCand")[][] = Array.from(
    { length: N + 1 },
    () => new Array(M + 1),
  );

  dp[0]![0] = 0;

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const cur = dp[i]![j]!;
      if (cur === Number.POSITIVE_INFINITY) continue;

      // Option 1: Skip base line i
      if (i < N) {
        const isVocalize = lineVocalize[i];
        const isBG = baseLines[i]!.isBG;
        const skipBaseCost = isVocalize || isBG ? 10 : 200;

        if (cur + skipBaseCost < dp[i + 1]![j]!) {
          dp[i + 1]![j] = cur + skipBaseCost;
          choice[i + 1]![j] = "skipBase";
        }
      }

      // Option 2: Skip candidate j
      if (j < M) {
        const isVoc = candVocalize[j];
        const skipCandCost = isVoc ? 10 : 250;

        if (cur + skipCandCost < dp[i]![j + 1]!) {
          dp[i]![j + 1] = cur + skipCandCost;
          choice[i]![j + 1] = "skipCand";
        }
      }

      // Option 3: Match base line i with candidate j
      if (i < N && j < M) {
        const baseLine = baseLines[i]!;
        const cand = candidates[j]!;
        const diffMs = Math.abs(baseLine.startTime - cand.startTime);
        const fullText = lineTexts[i]!;
        const isVocalize = lineVocalize[i];
        const isVocCand = candVocalize[j];

        let sim = 0;
        if (cand.originalText) {
          sim = wordSimilarity(fullText, cand.originalText);
        }

        // Allow match if within 6s OR if high text similarity
        if (diffMs <= 6000 || sim >= 0.5) {
          let matchCost = Math.pow(diffMs / 1000, 2) * 70;

          if (sim >= 0.6) {
            // Strong text match reward
            matchCost = -400 + (diffMs / 1000) * 15;
          } else if (cand.originalText && sim < 0.2 && !isVocalize) {
            // Mismatched text penalty
            matchCost += 800;
          }

          if (baseLine.isBG) matchCost += 400;
          if (isVocalize && !isVocCand && cand.text.length > 3) {
            matchCost += 2500;
          }

          if (cur + matchCost < dp[i + 1]![j + 1]!) {
            dp[i + 1]![j + 1] = cur + matchCost;
            choice[i + 1]![j + 1] = "match";
          }
        }
      }
    }
  }

  // Backtrack optimal alignment path
  let i = N;
  let j = M;
  const matches: Array<{ baseIdx: number; candIdx: number }> = [];

  while (i > 0 || j > 0) {
    const c = choice[i]![j];
    if (c === "match") {
      matches.push({ baseIdx: i - 1, candIdx: j - 1 });
      i--;
      j--;
    } else if (c === "skipBase") {
      i--;
    } else if (c === "skipCand") {
      j--;
    } else {
      break;
    }
  }

  matches.reverse();

  for (const m of matches) {
    onMatch(baseLines[m.baseIdx]!, candidates[m.candIdx]!);
  }
}

export function alignTranslationsAndRomaji(
  baseLines: LyricLine[],
  sources: TranslationSourceOptions,
): LyricLine[] {
  if (!baseLines || baseLines.length === 0) {
    return [];
  }

  const result: LyricLine[] = baseLines.map((line) => ({
    ...line,
    words: line.words.map((w) => ({ ...w })),
    translatedLyric: line.translatedLyric || "",
    romanLyric: line.romanLyric || "",
  }));

  // 1. Align Chinese Translation
  if (sources.translation && typeof sources.translation === "string") {
    const transCandidates = parseTimestampedLines(
      sources.translation,
      sources.metadata,
      sources.referenceLrc || undefined,
    );

    if (transCandidates.length > 0) {
      alignSequenceDP(result, transCandidates, (line, cand) => {
        if (!line.translatedLyric) {
          line.translatedLyric = cand.text;
        }
      });
    }
  }

  // 2. Align Romaji
  if (sources.romaji && typeof sources.romaji === "string") {
    const romajiCandidates = parseRomajiSource(
      sources.romaji,
      sources.metadata,
      sources.referenceLrc || undefined,
    );

    if (romajiCandidates.length > 0) {
      alignSequenceDP(result, romajiCandidates, (line, cand) => {
        if (!line.romanLyric) {
          line.romanLyric = cand.text;

          if (
            cand.words &&
            cand.words.length === line.words.length &&
            line.words.length > 0
          ) {
            for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
              const targetWord = line.words[wIdx]!;
              const romaWord = cand.words[wIdx]!;
              targetWord.romanWord = romaWord.word;
            }
          }
        }
      });
    }
  }

  return result;
}
