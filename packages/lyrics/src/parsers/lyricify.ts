import {
  parseQrc,
  parseYrc,
  parseLys,
  parseLyl,
  parseLqe,
  parseLrc,
  type LyricLine,
} from "@applemusic-like-lyrics/lyric";
import type { LyricsType, SyncedLyricsPayload } from "@repo/types";
import type { LyricifyLyricsEntry } from "../fetchers/lyricify.js";
import { convertAmllLinesToCompact } from "../utils/converter.js";
import {
  alignTranslationsAndRomaji,
  parseTimestampedLines,
  isMetadataOrPlaceholder,
} from "../utils/translation-matcher.js";
import { isPlaceholderLyricText, stripInfoLines } from "../utils/info-lines.js";

type LyricifyFormat = "qrc" | "yrc" | "lys" | "lyl" | "lqe" | "lrc" | "plain";
export interface ParsedLyricifyLyrics {
  lyricsType: LyricsType;
  lyrics: SyncedLyricsPayload | string;
  format: LyricifyFormat;
  hasTranslation: boolean;
  hasRomaji: boolean;
}

export function detectLyricifyFormat(text: string): LyricifyFormat | null {
  if (
    /^\[Lyricify Quick Export\]|^\[lyrics:\s*format@Lyricify Syllable\]/im.test(
      text,
    )
  )
    return "lqe";
  if (/^\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/m.test(text)) return "yrc";
  if (/^\[\d+,\d+\].*\(\d+,\d+\)/m.test(text)) return "qrc";
  if (/^\[[0-8]\].*\(\d+,\d+\)/m.test(text)) return "lys";
  if (/^\[type:LyricifyLines\]/im.test(text)) return "lyl";
  if (/^\[\d+:\d+(?:\.\d+)?\]/m.test(text)) return "lrc";
  if (!/[[\]<>]/.test(text) && text.trim()) return "plain";
  return null;
}

/** Preserve source order when attaching index-based duet metadata to LRC. */
function parseOrderedLrc(text: string, durationMs?: number): LyricLine[] {
  const lines = text.split(/\r?\n/).flatMap((line) => parseLrc(line));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines
      .slice(i + 1)
      .find((other) => other.startTime > line.startTime);
    line.endTime =
      next?.startTime ??
      Math.max(line.startTime, durationMs ?? line.startTime + 4000);
    for (const word of line.words) word.endTime = line.endTime;
  }
  return lines;
}

function parseTimedLyrics(
  text: string,
  format: Exclude<LyricifyFormat, "plain">,
  durationMs?: number,
): LyricLine[] {
  const parsers = {
    qrc: parseQrc,
    yrc: parseYrc,
    lys: parseLys,
    lyl: parseLyl,
    lqe: parseLqe,
  };
  return format === "lrc"
    ? parseOrderedLrc(text, durationMs)
    : parsers[format](text);
}

export function parseLyricifyLyrics(
  entry: LyricifyLyricsEntry,
  metadata: { title?: string; artist?: string; durationMs?: number } = {},
): ParsedLyricifyLyrics | null {
  const text = entry.Verbatim?.trim() || entry.Text?.trim();
  if (!text || isPlaceholderLyricText(text, metadata)) return null;
  const format = detectLyricifyFormat(text);
  if (!format) return null;
  const titleLines = entry.TitleLines ?? 0;
  const endingLines = entry.EndingLines ?? 0;
  const offset = entry.Offset ?? 0;
  if (
    ![titleLines, endingLines, offset].every(Number.isSafeInteger) ||
    titleLines < 0 ||
    endingLines < 0
  )
    return null;
  if (format === "plain") {
    // Plain strings cannot represent vocal roles or timestamped translations.
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (
      entry.DuetProperties &&
      (!/^0+$/.test(entry.DuetProperties) ||
        entry.DuetProperties.length !== lines.length)
    )
      return null;
    if (titleLines + endingLines >= lines.length) return null;
    const payload: SyncedLyricsPayload = lines
      .slice(titleLines, lines.length - endingLines)
      .map((line, index) => [[1, index, 0, line]]);
    const lyrics = stripInfoLines(payload, metadata)
      .map((line) =>
        line
          .filter(Array.isArray)
          .map((word) => word[3])
          .join(""),
      )
      .join("\n");
    if (isPlaceholderLyricText(lyrics, metadata)) return null;
    return {
      format,
      lyricsType: "plain",
      lyrics,
      hasTranslation: false,
      hasRomaji: false,
    };
  }
  try {
    let lines = parseTimedLyrics(text, format, metadata.durationMs);
    const roles = entry.DuetProperties;
    if (roles && (!/^[012]+$/.test(roles) || roles.length !== lines.length))
      return null;
    if (!lines.length || titleLines + endingLines >= lines.length) return null;
    // Apply roles before slicing and conversion; credit lines count in the map.
    lines.forEach((line, index) => {
      if (roles?.[index] === "1") line.isDuet = false;
      else if (roles?.[index] === "2") line.isDuet = true;
    });
    lines = lines.slice(titleLines, lines.length - endingLines);
    if (
      lines.some(
        (line) =>
          !line.words.length ||
          line.words.some(
            (word) =>
              !Number.isFinite(word.startTime) ||
              !Number.isFinite(word.endTime) ||
              word.endTime < word.startTime,
          ),
      )
    )
      return null;
    for (const line of lines) {
      line.startTime += offset;
      line.endTime += offset;
      for (const word of line.words) {
        word.startTime += offset;
        word.endTime += offset;
      }
    }
    if (entry.Trans?.trim()) {
      const transFormat = detectLyricifyFormat(entry.Trans);
      if (transFormat && transFormat !== "plain") {
        const translationLines =
          transFormat === "lrc"
            ? parseTimestampedLines(entry.Trans, metadata)
            : parseTimedLyrics(entry.Trans, transFormat)
                .map((line) => ({
                  startTime: line.startTime,
                  text: line.words
                    .map((word) => word.word)
                    .join("")
                    .trim(),
                }))
                .filter(
                  (line) =>
                    !isMetadataOrPlaceholder(line.text) &&
                    !isPlaceholderLyricText(line.text, metadata),
                );
        // Apply the DTO offset numerically once, including timestamps before zero.
        lines = alignTranslationsAndRomaji(lines, {
          translationLines: translationLines.map((line) => ({
            ...line,
            startTime: line.startTime + offset,
          })),
          metadata,
        });
      }
    }
    const lyrics = convertAmllLinesToCompact(lines, metadata, true);
    if (!lyrics.length) return null;
    return {
      format,
      lyricsType: format === "lrc" || format === "lyl" ? "line" : "word",
      lyrics,
      hasTranslation: lyrics.some(
        (line) => line.filter((token) => typeof token === "string")[0],
      ),
      hasRomaji: lyrics.some(
        (line) => line.filter((token) => typeof token === "string")[1],
      ),
    };
  } catch {
    return null;
  }
}
