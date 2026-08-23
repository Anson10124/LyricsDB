import {
  parseQrc as parseAmllQrc,
  parseYrc as parseAmllYrc,
  type LyricLine,
} from "@applemusic-like-lyrics/lyric";
import { isPlaceholderLyricText } from "./info-lines.js";
import { extractLyricContent } from "./qrc-decoder.js";
import {
  cleanEnclosingBrackets,
  extractBracketedTextSegments,
  hasOpeningBracket,
  hasClosingBracket,
} from "./background-vocals.js";

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

// Algorithmic Kana Phonetic Decoder (Unicode Mathematical Mapping)
export function getKanaPhoneme(char: string): { consonant: string; vowel: string } | null {
  const code = char.codePointAt(0);
  if (!code) return null;

  // Normalize Katakana to Hiragana (0x30A1 - 0x30F6 -> 0x3041 - 0x3096)
  let hCode = code;
  if (code >= 0x30a1 && code <= 0x30f6) {
    hCode = code - 0x60;
  }

  if (hCode < 0x3041 || hCode > 0x3096) return null;

  const vowels = ["a", "i", "u", "e", "o"];

  // Vowel row: あ(3042), い(3044), う(3046), え(3048), お(304A)
  if (hCode >= 0x3041 && hCode <= 0x304a) {
    const vIdx = Math.floor((hCode - 0x3041) / 2);
    return { consonant: "", vowel: vowels[vIdx] || "a" };
  }
  // Ka row: か(304B)..こ(3053), が(304C)..ご(3054)
  if (hCode >= 0x304b && hCode <= 0x3054) {
    const isVoiced = (hCode - 0x304b) % 2 === 1;
    const vIdx = Math.floor((hCode - 0x304b) / 2);
    return { consonant: isVoiced ? "g" : "k", vowel: vowels[vIdx] || "a" };
  }
  // Sa row: さ(3055)..そ(305D), ざ(3056)..ぞ(305E)
  if (hCode >= 0x3055 && hCode <= 0x305e) {
    const isVoiced = (hCode - 0x3055) % 2 === 1;
    const vIdx = Math.floor((hCode - 0x3055) / 2);
    const consonant = isVoiced ? (vIdx === 1 ? "j" : "z") : (vIdx === 1 ? "sh" : "s");
    return { consonant, vowel: vowels[vIdx] || "a" };
  }
  // Ta row: た(305F)..と(3068), だ(3060)..ど(3069)
  if (hCode >= 0x305f && hCode <= 0x3069) {
    const isVoiced = (hCode - 0x305f) % 2 === 1;
    const vIdx = Math.floor((hCode - 0x305f) / 2);
    let consonant = isVoiced ? "d" : "t";
    if (vIdx === 1) consonant = isVoiced ? "j" : "ch";
    if (vIdx === 2) consonant = isVoiced ? "z" : "ts";
    return { consonant, vowel: vowels[vIdx] || "a" };
  }
  // Na row: な(306A)..の(306E)
  if (hCode >= 0x306a && hCode <= 0x306e) {
    const vIdx = hCode - 0x306a;
    return { consonant: "n", vowel: vowels[vIdx] || "a" };
  }
  // Ha row: は(306F)..ほ(307B), ば(3070)..ぼ(307C), ぱ(3071)..ぽ(307D)
  if (hCode >= 0x306f && hCode <= 0x307d) {
    const offset = hCode - 0x306f;
    const vIdx = Math.floor(offset / 3);
    const mod = offset % 3;
    const consonant = mod === 0 ? "h" : mod === 1 ? "b" : "p";
    return { consonant, vowel: vowels[vIdx] || "a" };
  }
  // Ma row: ま(307E)..も(3082)
  if (hCode >= 0x307e && hCode <= 0x3082) {
    const vIdx = hCode - 0x307e;
    return { consonant: "m", vowel: vowels[vIdx] || "a" };
  }
  // Ya row: や(3084), ゆ(3086), よ(3088)
  if (hCode >= 0x3083 && hCode <= 0x3088) {
    const vIdx = Math.floor((hCode - 0x3083) / 2);
    return { consonant: "y", vowel: ["a", "u", "o"][vIdx] || "a" };
  }
  // Ra row: ら(3089)..ろ(308D)
  if (hCode >= 0x3089 && hCode <= 0x308d) {
    const vIdx = hCode - 0x3089;
    return { consonant: "r", vowel: vowels[vIdx] || "a" };
  }
  // Wa row: わ(308F), を(3092), ん(3093)
  if (hCode === 0x308f) return { consonant: "w", vowel: "a" };
  if (hCode === 0x3092) return { consonant: "w", vowel: "o" };
  if (hCode === 0x3093) return { consonant: "n", vowel: "" };

  return null;
}

// Algorithmic Hangul Phonetic Decoder (Unicode Mathematical Mapping)
export function getHangulPhoneme(char: string): { consonant: string; vowel: string } | null {
  const code = char.codePointAt(0);
  if (!code || code < 0xac00 || code > 0xd7af) return null;

  const HANGUL_INITIALS = [
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
  ];
  const HANGUL_MEDIALS = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
  ];

  const index = code - 0xac00;
  const initialIdx = Math.floor(index / (21 * 28));
  const medialIdx = Math.floor((index % (21 * 28)) / 28);

  return {
    consonant: HANGUL_INITIALS[initialIdx] || "",
    vowel: HANGUL_MEDIALS[medialIdx] || "",
  };
}

// Character Mora Capacity Estimation across CJK, Kana, Hangul, Latin
export function getCharacterMoraCapacity(char: string): { min: number; max: number; expected: number } {
  const code = char.codePointAt(0) || 0;

  // CJK Unified Ideographs (Kanji / Hanzi): 0x4E00 - 0x9FFF, 0x3400 - 0x4DBF
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
    return { min: 1, max: 3, expected: 2 };
  }

  // Hiragana (0x3040 - 0x309F) and Katakana (0x30A0 - 0x30FF)
  if (code >= 0x3040 && code <= 0x30ff) {
    if (/[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/u.test(char)) {
      return { min: 0, max: 1, expected: 0 };
    }
    return { min: 1, max: 1, expected: 1 };
  }

  // Hangul Syllables (0xAC00 - 0xD7AF)
  if (code >= 0xac00 && code <= 0xd7af) {
    return { min: 1, max: 2, expected: 1 };
  }

  // Latin letters & numbers
  if (/[a-zA-Z0-9]/u.test(char)) {
    return { min: 0, max: 1, expected: 0.5 };
  }

  // Punctuation, spaces, brackets, symbols
  return { min: 0, max: 0, expected: 0 };
}

// Evaluates phonetic agreement between a boundary character and a Romanized token
export function matchPhoneticAgreement(char: string, romajiToken: string): number {
  if (!char || !romajiToken) return 0;
  const cleanToken = romajiToken.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleanToken) return 0;

  // 1. Kana check
  const kana = getKanaPhoneme(char);
  if (kana) {
    let score = 0;
    if (kana.vowel && cleanToken.endsWith(kana.vowel)) {
      score += 0.6;
    }
    if (kana.consonant && cleanToken.startsWith(kana.consonant)) {
      score += 0.4;
    } else if (!kana.consonant && /^[aeiou]/.test(cleanToken)) {
      score += 0.4;
    }
    return score;
  }

  // 2. Hangul check
  const hangul = getHangulPhoneme(char);
  if (hangul) {
    let score = 0;
    if (hangul.vowel && cleanToken.includes(hangul.vowel)) {
      score += 0.6;
    }
    if (hangul.consonant && cleanToken.startsWith(hangul.consonant)) {
      score += 0.4;
    }
    return score;
  }

  // 3. Latin / English check
  const cleanChar = char.toLowerCase();
  if (cleanToken.startsWith(cleanChar)) {
    return 1.0;
  }

  return 0.5; // neutral for Kanji / other ideographs
}

// Aligns Romaji tokens to line boundaries using Dynamic Programming on Syllable Capacities and Phonetic Agreement
export function alignRomajiTokensToLineBoundaries(
  romajiTokens: string[],
  lineTexts: string[],
): string[][] {
  const K = lineTexts.length;
  if (K === 0) return [];
  if (K === 1) return [romajiTokens];
  if (romajiTokens.length === 0) return lineTexts.map(() => []);

  const lineCapacities = lineTexts.map((text) => {
    let min = 0;
    let max = 0;
    let expected = 0;
    for (const char of text) {
      const cap = getCharacterMoraCapacity(char);
      min += cap.min;
      max += cap.max;
      expected += cap.expected;
    }
    return {
      min: Math.max(1, min),
      max: Math.max(1, max),
      expected: Math.max(1, expected),
    };
  });

  const totalExpected = lineCapacities.reduce((sum, cap) => sum + cap.expected, 0);
  const M = romajiTokens.length;

  // DP table: dp[k][j] = min cost to align first k lines with first j tokens
  const dp: number[][] = Array.from({ length: K + 1 }, () =>
    new Array(M + 1).fill(Number.POSITIVE_INFINITY),
  );
  const choice: number[][] = Array.from({ length: K + 1 }, () =>
    new Array(M + 1).fill(-1),
  );

  dp[0]![0] = 0;

  for (let k = 1; k <= K; k++) {
    const curCap = lineCapacities[k - 1]!;
    const curText = lineTexts[k - 1]!.trim();
    const nextText = k < K ? lineTexts[k]!.trim() : "";

    for (let j = k; j <= M; j++) {
      for (let prev = k - 1; prev < j; prev++) {
        if (dp[k - 1]![prev] === Number.POSITIVE_INFINITY) continue;

        const tokensInLine = j - prev;
        let lineCost = 0;

        // Constraint boundaries
        if (tokensInLine < curCap.min) {
          lineCost += 2000 * Math.pow(curCap.min - tokensInLine, 2);
        } else if (tokensInLine > curCap.max) {
          lineCost += 2000 * Math.pow(tokensInLine - curCap.max, 2);
        }

        // Capacity deviation
        const expectedTokens = (M * curCap.expected) / totalExpected;
        lineCost += Math.pow(tokensInLine - expectedTokens, 2) * 10;

        // Phonetic boundary agreement reward
        if (k < K && curText.length > 0 && nextText.length > 0) {
          const lastChar = curText.slice(-1);
          const firstChar = nextText.slice(0, 1);
          const lastToken = romajiTokens[j - 1]!;
          const nextToken = romajiTokens[j]!;

          const agreement =
            matchPhoneticAgreement(lastChar, lastToken) +
            matchPhoneticAgreement(firstChar, nextToken);

          lineCost -= agreement * 150;
        }

        const totalCost = dp[k - 1]![prev]! + lineCost;
        if (totalCost < dp[k]![j]!) {
          dp[k]![j] = totalCost;
          choice[k]![j] = prev;
        }
      }
    }
  }

  // Backtrack optimal cuts
  const cuts: number[] = [M];
  let curTokenIdx = M;
  for (let k = K; k >= 1; k--) {
    const prev = choice[k]![curTokenIdx];
    if (prev === undefined || prev < 0) {
      // Fallback proportional cut if exact DP had no valid path
      const propIdx = Math.round((M * (k - 1)) / K);
      cuts.unshift(propIdx);
      curTokenIdx = propIdx;
    } else {
      cuts.unshift(prev);
      curTokenIdx = prev;
    }
  }

  const result: string[][] = [];
  for (let k = 0; k < K; k++) {
    const start = cuts[k]!;
    const end = cuts[k + 1]!;
    result.push(romajiTokens.slice(start, end));
  }

  return result;
}

export function splitTranslationText(
  text: string,
  targetCount: number,
): string[] {
  if (!text || targetCount <= 1) return [text];
  const trimmed = text.trim();

  // 1. Try splitting by whitespace runs (space or full-width space)
  const spaceParts = trimmed.split(/[\s\u3000]+/g).filter(Boolean);
  if (spaceParts.length === targetCount) {
    return spaceParts;
  }

  if (spaceParts.length > targetCount) {
    const result: string[] = [];
    const chunkSize = spaceParts.length / targetCount;
    for (let i = 0; i < targetCount; i++) {
      const start = Math.round(i * chunkSize);
      const end = Math.round((i + 1) * chunkSize);
      result.push(spaceParts.slice(start, end).join(" "));
    }
    return result;
  }

  // 2. Try splitting by common punctuation delimiters (，, 、, /, ;, ；)
  const puncParts = trimmed
    .split(/[，,、/；;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (puncParts.length === targetCount) {
    return puncParts;
  }
  if (puncParts.length > targetCount) {
    const result: string[] = [];
    const chunkSize = puncParts.length / targetCount;
    for (let i = 0; i < targetCount; i++) {
      const start = Math.round(i * chunkSize);
      const end = Math.round((i + 1) * chunkSize);
      result.push(puncParts.slice(start, end).join(" "));
    }
    return result;
  }

  return [trimmed];
}

// Multi-criterion Translation Alignment based on delimiters, line durations, and character lengths
export function alignTranslationToLines(
  translationText: string,
  targetLines: LyricLine[],
  referenceText?: string,
): string[] {
  const K = targetLines.length;
  if (K <= 1 || !translationText) return [translationText];

  const trimmed = translationText.trim();

  // 1. Try splitting by reference text substrings if reference text is provided
  if (referenceText) {
    const refClean = referenceText.trim();
    const refParts = refClean.split(/[\s\u3000，,、/；;]+/g).filter(Boolean);
    if (refParts.length === K) {
      const transParts = splitTranslationText(trimmed, K);
      if (transParts.length === K) {
        return transParts;
      }
    }
  }

  // 2. Extract delimiter-based partitions
  const delimiterRegex = /[\s\u3000，,、/；;]+/gu;
  const delimiters: Array<{ index: number; length: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = delimiterRegex.exec(trimmed)) !== null) {
    delimiters.push({ index: match.index, length: match[0].length });
  }

  if (delimiters.length === K - 1) {
    const result: string[] = [];
    let prevIdx = 0;
    for (const d of delimiters) {
      result.push(trimmed.slice(prevIdx, d.index).trim());
      prevIdx = d.index + d.length;
    }
    result.push(trimmed.slice(prevIdx).trim());
    return result;
  }

  return splitTranslationText(trimmed, K);
}

export function splitRomajiText(
  romaji: string,
  targetWeights: number[],
  targetTexts?: string[],
): string[] {
  if (!romaji || targetWeights.length <= 1) return [romaji];
  const tokens = romaji.trim().split(/\s+/g).filter(Boolean);
  if (tokens.length === 0) return [romaji];

  if (targetTexts && targetTexts.length === targetWeights.length) {
    const aligned = alignRomajiTokensToLineBoundaries(tokens, targetTexts);
    return aligned.map((toks) => toks.join(" "));
  }

  const totalWeight = targetWeights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [romaji];

  const result: string[] = [];
  let allocatedTokens = 0;

  for (let i = 0; i < targetWeights.length; i++) {
    if (i === targetWeights.length - 1) {
      result.push(tokens.slice(allocatedTokens).join(" "));
    } else {
      const weight = targetWeights[i]!;
      const tokenCount = Math.max(
        1,
        Math.round((tokens.length * weight) / totalWeight),
      );
      const take = Math.min(
        tokenCount,
        tokens.length - allocatedTokens - (targetWeights.length - 1 - i),
      );
      result.push(
        tokens.slice(allocatedTokens, allocatedTokens + take).join(" "),
      );
      allocatedTokens += take;
    }
  }

  return result;
}

export function distributeMultiLineTranslations(lines: LyricLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    const curLine = lines[i]!;
    if (!curLine.translatedLyric && !curLine.romanLyric) continue;

    // Count how many consecutive untranslated lines follow curLine before the next translated line
    let nextTransIdx = i + 1;
    while (
      nextTransIdx < lines.length &&
      !lines[nextTransIdx]!.translatedLyric &&
      !lines[nextTransIdx]!.romanLyric
    ) {
      nextTransIdx++;
    }

    const gapCount = nextTransIdx - (i + 1);
    if (gapCount <= 0) continue;

    // Check how many target lines could be covered (within 15s window)
    const candidateLines = [curLine];
    for (let k = i + 1; k < nextTransIdx; k++) {
      const nextLine = lines[k]!;
      if (nextLine.startTime - curLine.startTime < 15000) {
        candidateLines.push(nextLine);
      } else {
        break;
      }
    }

    if (candidateLines.length <= 1) continue;

    // 1. Distribute translatedLyric
    if (curLine.translatedLyric) {
      const transText = curLine.translatedLyric.trim();
      const parts = alignTranslationToLines(transText, candidateLines);

      if (parts.length > 1) {
        for (
          let idx = 0;
          idx < Math.min(parts.length, candidateLines.length);
          idx++
        ) {
          candidateLines[idx]!.translatedLyric = parts[idx]!;
        }
      }
    }

    // 2. Distribute romanLyric
    if (curLine.romanLyric) {
      const romajiText = curLine.romanLyric.trim();
      const targetTexts = candidateLines.map((l) =>
        l.words.map((w) => w.word).join("").trim(),
      );
      const targetLengths = targetTexts.map((t) => Math.max(1, t.length));
      const romajiParts = splitRomajiText(
        romajiText,
        targetLengths,
        targetTexts,
      );

      if (romajiParts.length > 1) {
        for (
          let idx = 0;
          idx < Math.min(romajiParts.length, candidateLines.length);
          idx++
        ) {
          candidateLines[idx]!.romanLyric = romajiParts[idx]!;
        }
      }
    }
  }
}

/**
 * Dynamic Programming Sequence Alignment Algorithm with Compound 1-to-N & N-to-1 Support
 */
function alignSequenceDP<
  T extends {
    startTime: number;
    text: string;
    originalText?: string;
    words?: Array<{ startTime: number; endTime: number; word: string }>;
  },
>(
  baseLines: LyricLine[],
  candidates: T[],
  mode: "translation" | "romaji",
  onMatch: (
    baseLine: LyricLine,
    candidate: T,
    baseIdx: number,
    allBaseLines: LyricLine[],
  ) => void,
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
  const choice: Array<Array<{ action: "match" | "skipBase" | "skipCand" | "compound"; span?: number }>> =
    Array.from({ length: N + 1 }, () => new Array(M + 1));

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
          choice[i + 1]![j] = { action: "skipBase" };
        }
      }

      // Option 2: Skip candidate j
      if (j < M) {
        const isVoc = candVocalize[j];
        const skipCandCost = isVoc ? 10 : 250;

        if (cur + skipCandCost < dp[i]![j + 1]!) {
          dp[i]![j + 1] = cur + skipCandCost;
          choice[i]![j + 1] = { action: "skipCand" };
        }
      }

      // Option 3: 1-to-1 Match base line i with candidate j
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
            matchCost = -400 + (diffMs / 1000) * 15;
          } else if (cand.originalText && sim < 0.2 && !isVocalize) {
            matchCost += 800;
          }

          if (baseLine.isBG) matchCost += 400;
          if (isVocalize && !isVocCand && cand.text.length > 3) {
            matchCost += 2500;
          }

          if (cur + matchCost < dp[i + 1]![j + 1]!) {
            dp[i + 1]![j + 1] = cur + matchCost;
            choice[i + 1]![j + 1] = { action: "match" };
          }
        }
      }

      // Option 4: Compound 1-to-N Match: candidate j spans consecutive lead lines i .. i+span-1 (span in [2, 3])
      if (j < M) {
        const cand = candidates[j]!;
        for (let span = 2; span <= 3 && i + span <= N; span++) {
          const groupLines = baseLines.slice(i, i + span);
          // Compound matching is strictly for multiple lead lines (not attached background lines)
          if (groupLines.some((l) => l.isBG)) continue;

          const firstLine = groupLines[0]!;
          const diffMs = Math.abs(firstLine.startTime - cand.startTime);
          const combinedText = lineTexts.slice(i, i + span).join(" ");

          let sim = 0;
          if (cand.originalText) {
            sim = wordSimilarity(combinedText, cand.originalText);
          }

          if (diffMs <= 6000 || sim >= 0.4) {
            let compoundCost = Math.pow(diffMs / 1000, 2) * 60;
            if (sim >= 0.5) {
              compoundCost = -500 + (diffMs / 1000) * 10;
            }

            if (cur + compoundCost < dp[i + span]![j + 1]!) {
              dp[i + span]![j + 1] = cur + compoundCost;
              choice[i + span]![j + 1] = { action: "compound", span };
            }
          }
        }
      }
    }
  }

  // Backtrack optimal alignment path
  let i = N;
  let j = M;
  const matchSteps: Array<{
    action: "match" | "compound";
    baseStartIdx: number;
    span: number;
    candIdx: number;
  }> = [];

  while (i > 0 || j > 0) {
    const c = choice[i]![j];
    if (!c) break;

    if (c.action === "match") {
      matchSteps.push({
        action: "match",
        baseStartIdx: i - 1,
        span: 1,
        candIdx: j - 1,
      });
      i--;
      j--;
    } else if (c.action === "compound") {
      const span = c.span || 2;
      matchSteps.push({
        action: "compound",
        baseStartIdx: i - span,
        span,
        candIdx: j - 1,
      });
      i -= span;
      j--;
    } else if (c.action === "skipBase") {
      i--;
    } else if (c.action === "skipCand") {
      j--;
    } else {
      break;
    }
  }

  matchSteps.reverse();

  for (const step of matchSteps) {
    const cand = candidates[step.candIdx]!;
    if (step.action === "match") {
      onMatch(baseLines[step.baseStartIdx]!, cand, step.baseStartIdx, baseLines);
    } else if (step.action === "compound") {
      const targetLines = baseLines.slice(
        step.baseStartIdx,
        step.baseStartIdx + step.span,
      );

      if (mode === "translation") {
        const transParts = alignTranslationToLines(
          cand.text,
          targetLines,
          cand.originalText,
        );
        for (let r = 0; r < Math.min(transParts.length, targetLines.length); r++) {
          if (!targetLines[r]!.translatedLyric) {
            targetLines[r]!.translatedLyric = transParts[r]!;
          }
        }
      } else if (mode === "romaji") {
        const targetTexts = targetLines.map((l) =>
          l.words.map((w) => w.word).join("").trim(),
        );
        const romaParts = splitRomajiText(
          cand.text,
          targetTexts.map((t) => t.length),
          targetTexts,
        );
        for (let r = 0; r < Math.min(romaParts.length, targetLines.length); r++) {
          if (!targetLines[r]!.romanLyric) {
            targetLines[r]!.romanLyric = romaParts[r]!;
          }
        }
      }
    }
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
      alignSequenceDP(
        result,
        transCandidates,
        "translation",
        (line, cand, baseIdx, allLines) => {
          if (!line.translatedLyric) {
            if (line.isBG) {
              line.translatedLyric = cleanEnclosingBrackets(cand.text);
            } else if (
              hasOpeningBracket(cand.text) ||
              hasClosingBracket(cand.text)
            ) {
              const split = extractBracketedTextSegments(cand.text);
              line.translatedLyric = split.leadText || cand.text;

              // Assign extracted bracketed background translation to attached background lines
              for (let k = 0; k < split.bgTexts.length; k++) {
                const targetBgLine = allLines[baseIdx + 1 + k];
                if (
                  targetBgLine &&
                  (targetBgLine.isBG || !targetBgLine.translatedLyric)
                ) {
                  targetBgLine.translatedLyric = split.bgTexts[k]!;
                }
              }
            } else {
              line.translatedLyric = cand.text;
            }
          }
        },
      );
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
      alignSequenceDP(
        result,
        romajiCandidates,
        "romaji",
        (line, cand, baseIdx, allLines) => {
          if (!line.romanLyric) {
            if (line.isBG) {
              line.romanLyric = cleanEnclosingBrackets(cand.text);
            } else if (
              hasOpeningBracket(cand.text) ||
              hasClosingBracket(cand.text)
            ) {
              const split = extractBracketedTextSegments(cand.text);
              line.romanLyric = split.leadText || cand.text;

              // Assign extracted bracketed background romaji to attached background lines
              for (let k = 0; k < split.bgTexts.length; k++) {
                const targetBgLine = allLines[baseIdx + 1 + k];
                if (
                  targetBgLine &&
                  (targetBgLine.isBG || !targetBgLine.romanLyric)
                ) {
                  targetBgLine.romanLyric = split.bgTexts[k]!;
                }
              }
            } else {
              line.romanLyric = cand.text;
            }

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
        },
      );
    }
  }

  // 3. Resolve 1-to-N line split discrepancy across providers
  distributeMultiLineTranslations(result);

  return result;
}
