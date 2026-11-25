import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
  VocalType,
} from "@repo/types";

// Pure helpers behind the lyrics editor. The web app uses them to edit a track's
// compact payload, and the API uses the same validation on what it receives.
// Kept free of fetchers and Node APIs so the browser bundle can import them.

export interface EditableWord {
  start: number;
  length: number;
  text: string;
}

export interface EditableLine {
  words: EditableWord[];
  // Background vocals (vocal type 2 / 4)
  bg: boolean;
  // Second singer (vocal type 3 / 4)
  duet: boolean;
  translation: string;
  romaji: string;
}

export type AnnotationField = "translation" | "romaji";

export const EDIT_LIMITS = {
  maxLines: 2000,
  maxWordsPerLine: 500,
  maxWordTextLength: 500,
  maxAnnotationLength: 1000,
  // Two hours; no real track is longer
  maxTimeMs: 7_200_000,
} as const;

function vocalTypeOf(bg: boolean, duet: boolean): VocalType {
  if (duet) return bg ? 4 : 3;
  return bg ? 2 : 1;
}

export function toEditableLines(payload: SyncedLyricsPayload): EditableLine[] {
  const lines: EditableLine[] = [];
  for (const line of payload) {
    if (!Array.isArray(line)) continue;
    const words = line.filter((item): item is CompactLyricWord =>
      Array.isArray(item),
    );
    if (words.length === 0) continue;
    const strings = line.filter(
      (item): item is string => typeof item === "string",
    );
    const type = words[0]![0];
    lines.push({
      // Some providers store fractional milliseconds; saved edits must be whole
      words: words.map((w) => ({
        start: Math.max(0, Math.round(Number(w[1]) || 0)),
        length: Math.max(0, Math.round(Number(w[2]) || 0)),
        text: typeof w[3] === "string" ? w[3] : String(w[3] ?? ""),
      })),
      bg: type === 2 || type === 4,
      duet: type === 3 || type === 4,
      translation: strings[0] ?? "",
      romaji: strings[1] ?? "",
    });
  }
  return lines;
}

export function fromEditableLines(lines: EditableLine[]): SyncedLyricsPayload {
  return lines.map((line) => {
    const type = vocalTypeOf(line.bg, line.duet);
    const out: CompactLyricLine = line.words.map(
      (w): CompactLyricWord => [type, w.start, w.length, w.text],
    );
    // Romaji sits after the translation, so it needs an empty translation slot
    if (line.translation || line.romaji) out.push(line.translation);
    if (line.romaji) out.push(line.romaji);
    return out;
  });
}

export function lineText(line: EditableLine): string {
  return line.words
    .map((w) => w.text)
    .join("")
    .trim();
}

export function lineStart(line: EditableLine): number {
  return line.words[0]?.start ?? 0;
}

export function lineEnd(line: EditableLine): number {
  const last = line.words[line.words.length - 1];
  return last ? last.start + last.length : 0;
}

// Moves the whole line (every word keeps its timing relative to the line)
export function setLineStart(line: EditableLine, startMs: number): EditableLine {
  const delta = Math.max(0, Math.round(startMs)) - lineStart(line);
  if (delta === 0) return line;
  return {
    ...line,
    words: line.words.map((w) => ({ ...w, start: Math.max(0, w.start + delta) })),
  };
}

// Shifts every line by offsetMs, never before 0
export function shiftLines(
  lines: EditableLine[],
  offsetMs: number,
): EditableLine[] {
  const delta = Math.round(offsetMs);
  if (!delta) return lines;
  return lines.map((line) => ({
    ...line,
    words: line.words.map((w) => ({ ...w, start: Math.max(0, w.start + delta) })),
  }));
}

// Chinese, Japanese kana and ideographs are timed per character, not per word
const PER_CHARACTER_RANGES: Array<[number, number]> = [
  [0x3040, 0x30ff], // hiragana, katakana
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
];

function isPerCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return PER_CHARACTER_RANGES.some(([from, to]) => code >= from && code <= to);
}

// Splits text into word tokens, each keeping its trailing space. CJK characters
// become one token each; other runs (e.g. "OK") stay together.
export function tokenizeLyricText(text: string): string[] {
  const tokens: string[] = [];
  for (const chunk of text.trim().match(/\S+\s*/g) ?? []) {
    const word = chunk.trimEnd();
    const space = chunk.length > word.length ? " " : "";
    const parts: string[] = [];
    for (const char of word) {
      const last = parts[parts.length - 1];
      if (isPerCharacter(char) || last === undefined || isPerCharacter(last)) {
        parts.push(char);
      } else {
        parts[parts.length - 1] = last + char;
      }
    }
    parts.forEach((part, i) =>
      tokens.push(i === parts.length - 1 ? part + space : part),
    );
  }
  return tokens;
}

// Groups syllable tokens into words: a word ends at a token with a trailing space
function groupWords(words: EditableWord[]): EditableWord[][] {
  const groups: EditableWord[][] = [];
  let current: EditableWord[] = [];
  for (const word of words) {
    current.push(word);
    if (/\s$/.test(word.text)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Splits [start, end] across tokens in proportion to their length
function spreadTokens(tokens: string[], start: number, end: number): EditableWord[] {
  const weights = tokens.map((t) => Math.max(1, t.trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, end - start);
  let cursor = start;
  let used = 0;
  return tokens.map((text, i) => {
    used += weights[i]!;
    const next =
      i === tokens.length - 1 ? end : start + Math.round((span * used) / total);
    const word = { start: cursor, length: Math.max(0, next - cursor), text };
    cursor = next;
    return word;
  });
}

/**
 * Replaces a line's text, keeping as much timing as possible:
 * - a line timed as one token stays one token (always, with `lineSynced`);
 * - with the same number of words, unchanged words keep their (syllable)
 *   timing and a changed word takes over its old word's time span;
 * - a per-character line (CJK) with the same number of characters keeps them;
 * - otherwise the line's time span is split across the new words by length.
 */
export function setLineText(
  line: EditableLine,
  text: string,
  { lineSynced = false }: { lineSynced?: boolean } = {},
): EditableLine {
  const trimmed = text.trim();
  if (!trimmed || trimmed === lineText(line)) return line;

  const start = lineStart(line);
  const end = Math.max(lineEnd(line), start);
  const lastSpace = /\s$/.test(line.words[line.words.length - 1]?.text ?? "")
    ? " "
    : "";

  if (line.words.length === 1) {
    const only = line.words[0]!;
    if (lineSynced || /\s/.test(only.text.trim()) || !/\s/.test(trimmed)) {
      return { ...line, words: [{ ...only, text: trimmed + lastSpace }] };
    }
  }

  const tokens = tokenizeLyricText(trimmed);
  const last = tokens.length - 1;
  tokens[last] = tokens[last]!.trimEnd() + lastSpace;

  const groups = groupWords(line.words);
  if (groups.length > 1 && tokens.length === groups.length) {
    const words = groups.flatMap((group, i) => {
      const token = tokens[i]!;
      if (group.map((w) => w.text).join("").trim() === token.trim()) {
        return group;
      }
      const first = group[0]!;
      const lastWord = group[group.length - 1]!;
      return [
        {
          start: first.start,
          length: Math.max(0, lastWord.start + lastWord.length - first.start),
          text: token,
        },
      ];
    });
    return { ...line, words };
  }

  // Per-character lines have no spaces, so the whole line is one "word" group
  if (groups.length === 1 && tokens.length === line.words.length) {
    return {
      ...line,
      words: line.words.map((w, i) => ({ ...w, text: tokens[i]! })),
    };
  }

  return { ...line, words: spreadTokens(tokens, start, end) };
}

// Moves one translation (or romaji) to another line. The ones in between shift
// by one, so a drift that starts at some line is fixed with a single move.
export function moveAnnotation(
  lines: EditableLine[],
  field: AnnotationField,
  from: number,
  to: number,
): EditableLine[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= lines.length ||
    to >= lines.length
  ) {
    return lines;
  }
  const values = lines.map((line) => line[field]);
  const [moved] = values.splice(from, 1);
  values.splice(to, 0, moved ?? "");
  return lines.map((line, i) => ({ ...line, [field]: values[i] ?? "" }));
}

export function editedLyricFlags(payload: SyncedLyricsPayload): {
  hasTranslation: boolean;
  hasRomaji: boolean;
} {
  let hasTranslation = false;
  let hasRomaji = false;
  for (const line of payload) {
    const strings = line.filter((item): item is string => typeof item === "string");
    if (strings[0]) hasTranslation = true;
    if (strings[1]) hasRomaji = true;
  }
  return { hasTranslation, hasRomaji };
}

// The end of the last word, in milliseconds
export function payloadEndMs(payload: SyncedLyricsPayload): number {
  let end = 0;
  for (const line of payload) {
    for (const item of line) {
      if (Array.isArray(item)) end = Math.max(end, item[1] + item[2]);
    }
  }
  return end;
}

function isTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= EDIT_LIMITS.maxTimeMs
  );
}

/**
 * Checks an edited payload's shape and size. Returns a message describing the
 * first problem, or null when it is valid.
 */
export function validateEditedLyrics(payload: unknown): string | null {
  if (!Array.isArray(payload)) return "Lyrics must be a list of lines.";
  if (payload.length === 0) {
    return "Lyrics can't be empty. Keep at least one line.";
  }
  if (payload.length > EDIT_LIMITS.maxLines) {
    return `Lyrics can have at most ${EDIT_LIMITS.maxLines} lines.`;
  }

  let hasText = false;
  for (let i = 0; i < payload.length; i++) {
    const line: unknown = payload[i];
    const where = `Line ${i + 1}`;
    if (!Array.isArray(line)) return `${where} is not a list.`;

    let words = 0;
    let strings = 0;
    for (const item of line as unknown[]) {
      if (Array.isArray(item)) {
        if (strings > 0) return `${where}: words must come before the translation.`;
        const [type, start, length, text] = item as unknown[];
        if (item.length !== 4 || ![1, 2, 3, 4].includes(type as number)) {
          return `${where} has an invalid word.`;
        }
        if (!isTime(start) || !isTime(length)) {
          return `${where} has an invalid time.`;
        }
        if (typeof text !== "string" || text.length > EDIT_LIMITS.maxWordTextLength) {
          return `${where} has invalid text.`;
        }
        if (text.trim()) hasText = true;
        words++;
      } else if (typeof item === "string") {
        if (item.length > EDIT_LIMITS.maxAnnotationLength) {
          return `${where}: translation or romaji is too long.`;
        }
        strings++;
      } else {
        return `${where} has an invalid entry.`;
      }
    }

    if (words === 0) return `${where} has no words.`;
    if (words > EDIT_LIMITS.maxWordsPerLine) return `${where} has too many words.`;
    if (strings > 2) return `${where} has more than a translation and romaji.`;
  }

  if (!hasText) return "Lyrics can't be empty.";
  return null;
}
