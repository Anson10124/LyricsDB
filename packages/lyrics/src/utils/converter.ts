import {
  stringifyAss,
  stringifyEslrc,
  stringifyLqe,
  stringifyLrc,
  stringifyLrcA2,
  stringifyLyl,
  stringifyLys,
  stringifyQrc,
  stringifyYrc,
  type LyricLine,
  type LyricWord,
} from "@applemusic-like-lyrics/lyric";
import { TTMLGenerator } from "@applemusic-like-lyrics/ttml";
import type {
  CompactLyricLine,
  CompactLyricWord,
  FormattedLyricsResult,
  SupportedLyricFormat,
  SyncedLyricsPayload,
  VocalType,
} from "@repo/types";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";

import { stripInfoLines } from "./info-lines.js";
import { fixExplicitLyrics } from "./explicit.js";
import { standardizeSyllables } from "./syllable-sanitizer.js";
import { normalizeCapitalization } from "./capitalization.js";
import { alignAndUnmaskLyrics } from "./matcher.js";

export function optimizeLyricsPayload(
  payload: SyncedLyricsPayload,
  metadata?: { title?: string; artist?: string },
  references?: Array<SyncedLyricsPayload | string | null | undefined>,
): SyncedLyricsPayload {
  let result = payload;
  result = stripInfoLines(result, metadata);
  if (references && references.length > 0) {
    const unmasked = alignAndUnmaskLyrics(result, references);
    result = unmasked.lyrics as SyncedLyricsPayload;
  }
  result = fixExplicitLyrics(result);
  result = standardizeSyllables(result);
  result = normalizeCapitalization(result);
  return result;
}

// Converts AMLL LyricLine array to our compact line-grouped format:
// [
//   [ [1, startMs, lengthMs, "word "], ... ], // Line 1
//   [ [1, startMs, lengthMs, "word "], ... ]  // Line 2
// ]
export function convertAmllLinesToCompact(
  rawLines: LyricLine[],
  metadata?: { title?: string; artist?: string },
): SyncedLyricsPayload {
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
        if (isLastInLine && !text.endsWith(" ")) {
          text = text + " ";
        }

        lineWords.push([vocalType, w.startTime, lengthMs, text]);
      }

      if (lineWords.length > 0) {
        lines.push(lineWords);
      }
    }
  }

  return optimizeLyricsPayload(lines, metadata);
}

// Converts our compact tuple payload back to AMLL LyricLine array
export function convertCompactToAmllLines(
  payload: SyncedLyricsPayload,
): LyricLine[] {
  if (!payload || !Array.isArray(payload)) {
    return [];
  }

  const amllLines: LyricLine[] = [];

  for (const line of payload) {
    if (!Array.isArray(line) || line.length === 0) continue;

    const firstWord = line[0];
    if (!firstWord) continue;

    const vocalType = firstWord[0];
    const isBG = vocalType === 2 || vocalType === 4;
    const isDuet = vocalType === 3 || vocalType === 4;

    const words: LyricWord[] = line.map((w: CompactLyricWord) => {
      const startTime = w[1];
      const endTime = w[1] + w[2];
      const word = w[3];
      return {
        startTime,
        endTime,
        word,
      };
    });

    const lineStartTime = words[0]?.startTime ?? 0;
    const lineEndTime = words[words.length - 1]?.endTime ?? lineStartTime;

    amllLines.push({
      words,
      startTime: lineStartTime,
      endTime: lineEndTime,
      translatedLyric: "",
      romanLyric: "",
      isBG,
      isDuet,
    });
  }

  return amllLines;
}

export function formatXml(xml: string, indent = "  "): string {
  if (!xml || typeof xml !== "string") return "";

  const cleanXml = xml
    .replace(/>\s*</g, "><")
    .replace(/\r\n|\r/g, "\n")
    .trim();

  let formatted = "";
  let pad = 0;

  const tokens = cleanXml.match(/(<[^>]+>|[^<]+)/g) || [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.trim();
    if (!token) continue;

    if (
      token.startsWith("<") &&
      !token.startsWith("</") &&
      !token.endsWith("/>") &&
      !token.startsWith("<?") &&
      !token.startsWith("<!--")
    ) {
      const match = token.match(/^<([a-zA-Z0-9_:-]+)/);
      const tagName = match ? match[1] : null;

      if (tagName && i + 2 < tokens.length) {
        const nextToken = tokens[i + 1]!;
        const nextNextToken = tokens[i + 2]!.trim();

        if (!nextToken.startsWith("<") && nextNextToken === `</${tagName}>`) {
          formatted += `${indent.repeat(pad)}${token}${nextToken}${nextNextToken}\n`;
          i += 2;
          continue;
        }
      }
    }

    if (
      token.startsWith("<?") ||
      token.startsWith("<!") ||
      token.startsWith("<!--")
    ) {
      formatted += `${indent.repeat(pad)}${token}\n`;
    } else if (token.startsWith("</")) {
      pad = Math.max(0, pad - 1);
      formatted += `${indent.repeat(pad)}${token}\n`;
    } else if (
      token.startsWith("<") &&
      (token.endsWith("/>") || token.endsWith("/ >"))
    ) {
      formatted += `${indent.repeat(pad)}${token}\n`;
    } else if (token.startsWith("<")) {
      formatted += `${indent.repeat(pad)}${token}\n`;
      pad += 1;
    } else {
      formatted += `${indent.repeat(pad)}${token}\n`;
    }
  }

  return formatted.trim();
}

export type { SupportedLyricFormat, FormattedLyricsResult } from "@repo/types";

export function formatLyricsPayload(
  lyrics:
    | SyncedLyricsPayload
    | string
    | Record<string, unknown>
    | null
    | undefined,
  format: string = "json",
): FormattedLyricsResult {
  const normFormat = format
    .toLowerCase()
    .trim()
    .replace(/^\./, "") as SupportedLyricFormat;

  if (!lyrics) {
    return { content: "", contentType: "text/plain" };
  }

  // If plain text string
  if (typeof lyrics === "string") {
    if (normFormat === "json") {
      return { content: { plain: lyrics }, contentType: "application/json" };
    }
    if (normFormat === "ttml" || lyrics.trim().startsWith("<")) {
      return {
        content: formatXml(lyrics),
        contentType: "application/xml; charset=utf-8",
      };
    }
    return { content: lyrics, contentType: "text/plain; charset=utf-8" };
  }

  // If not structured array, fallback
  if (!Array.isArray(lyrics)) {
    if (normFormat === "json") {
      return { content: lyrics, contentType: "application/json" };
    }
    return { content: JSON.stringify(lyrics), contentType: "application/json" };
  }

  if (normFormat === "json") {
    return { content: lyrics, contentType: "application/json" };
  }

  const amllLines = convertCompactToAmllLines(lyrics as SyncedLyricsPayload);

  let formatted = "";
  let contentType = "text/plain; charset=utf-8";

  switch (normFormat) {
    case "ttml":
      {
        const generator = new TTMLGenerator({
          domImplementation: new DOMImplementation(),
          xmlSerializer: new XMLSerializer(),
        });
        const ttmlLines = amllLines.map((line) => ({
          ...line,
          text: line.words.map((w) => w.word).join(""),
          words: line.words.map((w) => ({
            text: w.word,
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        }));
        const rawXml = generator.generate({
          lines: ttmlLines as unknown as Parameters<
            typeof generator.generate
          >[0]["lines"],
          metadata: {},
        });
        formatted = formatXml(rawXml);
        contentType = "application/xml; charset=utf-8";
      }
      break;
    case "lrc":
      formatted = stringifyLrc(amllLines);
      break;
    case "lrca2":
      formatted = stringifyLrcA2(amllLines);
      break;
    case "yrc":
      formatted = stringifyYrc(amllLines);
      break;
    case "qrc":
      formatted = stringifyQrc(amllLines);
      break;
    case "eslrc":
      formatted = stringifyEslrc(amllLines);
      break;
    case "ass":
      formatted = stringifyAss(amllLines);
      break;
    case "lyl":
      formatted = stringifyLyl(amllLines);
      break;
    case "lys":
      formatted = stringifyLys(amllLines);
      break;
    case "lqe":
      formatted = stringifyLqe(amllLines);
      break;
    default:
      formatted = stringifyLrc(amllLines);
      break;
  }

  return { content: formatted, contentType };
}
