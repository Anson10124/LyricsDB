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
import { TTMLGenerator, toTTMLResult } from "@applemusic-like-lyrics/ttml";
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
import { extractBackgroundVocals } from "./background-vocals.js";
import { standardizeSyllables } from "./syllable-sanitizer.js";
import { normalizeCapitalization } from "./capitalization.js";
import { alignAndUnmaskLyrics } from "./matcher.js";
import {
  optimizeTiming,
  type OptimizeTimingOptions,
} from "./timing-optimizer.js";

export {
  optimizeTiming,
  cleanUnintentionalOverlaps,
  convertExcessiveBackgroundLines,
  tryAdvanceStartTime,
  type OptimizeTimingOptions,
} from "./timing-optimizer.js";

export function optimizeLyricsPayload(
  payload: SyncedLyricsPayload,
  metadata?: { title?: string; artist?: string },
  references?: Array<SyncedLyricsPayload | string | null | undefined>,
  timingOptions?: OptimizeTimingOptions,
  preserveAuthoredStructure = false,
): SyncedLyricsPayload {
  let result = payload;
  result = stripInfoLines(result, metadata);
  if (references && references.length > 0) {
    const unmasked = alignAndUnmaskLyrics(result, references);
    result = unmasked.lyrics as SyncedLyricsPayload;
  }
  result = fixExplicitLyrics(result);
  if (preserveAuthoredStructure) return result;
  result = extractBackgroundVocals(result);
  result = standardizeSyllables(result);
  result = normalizeCapitalization(result);
  result = optimizeTiming(result, timingOptions);
  return result;
}

// Converts AMLL LyricLine array to our compact line-grouped format:
// [
//   [ [1, startMs, lengthMs, "word "], ..., "translation", "romaji" ], // Line 1
//   [ [1, startMs, lengthMs, "word "], ..., "", "" ]  // Line 2
// ]
export function convertAmllLinesToCompact(
  rawLines: LyricLine[],
  metadata?: { title?: string; artist?: string },
  preserveAuthoredStructure = false,
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
      const lineTranslation = rawLine.translatedLyric || "";
      const lineRomaji = rawLine.romanLyric || "";

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
        if (lineTranslation || lineRomaji) {
          lines.push([...lineWords, lineTranslation, lineRomaji]);
        } else {
          lines.push(lineWords);
        }
      }
    }
  }

  return optimizeLyricsPayload(
    lines,
    metadata,
    undefined,
    undefined,
    preserveAuthoredStructure,
  );
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

    const wordsOnly = line.filter((item): item is CompactLyricWord =>
      Array.isArray(item),
    );
    const stringTokens = line.filter(
      (item): item is string => typeof item === "string",
    );

    if (wordsOnly.length === 0) continue;

    const firstWord = wordsOnly[0]!;
    const vocalType = firstWord[0];
    const isBG = vocalType === 2 || vocalType === 4;
    const isDuet = vocalType === 3 || vocalType === 4;

    const lineTranslation = stringTokens[0] || "";
    const lineRomaji = stringTokens[1] || "";

    const words: LyricWord[] = wordsOnly.map((w: CompactLyricWord) => {
      const startTime = w[1];
      const endTime = w[1] + (w[2] || 0);
      const word = w[3] || "";

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
      translatedLyric: lineTranslation,
      romanLyric: lineRomaji,
      isBG,
      isDuet,
    });
  }

  // A main line's window covers its attached background line, the same way a
  // TTML <p> spans its x-bg span. Word timings are left as they are.
  for (let i = 0; i < amllLines.length - 1; i++) {
    const line = amllLines[i]!;
    const next = amllLines[i + 1]!;
    if (line.isBG || !next.isBG) continue;
    line.startTime = Math.min(line.startTime, next.startTime);
    line.endTime = Math.max(line.endTime, next.endTime);
  }

  return amllLines;
}

interface TtmlParagraph {
  line: LyricLine;
  bg?: LyricLine;
}

// Mirrors toTTMLResult: a background line nests inside the preceding main
// line's <p> unless that one already has a background, in which case it gets
// its own <p>. AMLL numbers itunes:key per <p>, so paragraph i is L{i + 1}.
function groupTtmlParagraphs(lines: LyricLine[]): TtmlParagraph[] {
  const paragraphs: TtmlParagraph[] = [];
  let currentMain: TtmlParagraph | undefined;

  for (const line of lines) {
    if (line.isBG && currentMain && !currentMain.bg) {
      currentMain.bg = line;
    } else if (line.isBG) {
      paragraphs.push({ line });
    } else {
      currentMain = { line };
      paragraphs.push(currentMain);
    }
  }

  return paragraphs;
}

const TTM_NS = "http://www.w3.org/ns/ttml#metadata";
const TTS_NS = "http://www.w3.org/ns/ttml#styling";

function getTtmRole(el: Element): string | null {
  return el.getAttribute("ttm:role") || el.getAttributeNS(TTM_NS, "role");
}

// Moves the space between word spans into the spans themselves, so the word
// boundaries survive formatXml collapsing whitespace between tags.
function applyWordSpacing(container: Element, words: LyricWord[]): Element[] {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 && (node.textContent || "").trim() === "") {
      container.removeChild(node);
    }
  }

  const childSpans = Array.from(container.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && node.nodeName === "span",
  );
  const wordSpans = childSpans.filter((span) => {
    const role = getTtmRole(span);
    return role !== "x-translation" && role !== "x-roman" && role !== "x-bg";
  });

  for (let wIdx = 0; wIdx < wordSpans.length; wIdx++) {
    const span = wordSpans[wIdx]!;
    const origWord = words[wIdx];
    if (!origWord) continue;

    const rawWord = origWord.word || "";
    const hasTrailingSpace = rawWord.endsWith(" ");
    const isLastLyricWord = wIdx === wordSpans.length - 1;

    const rubyBase = span.getElementsByTagName("span")[0];
    const targetEl =
      rubyBase &&
      (rubyBase.getAttribute("tts:ruby") === "base" ||
        rubyBase.getAttributeNS(TTS_NS, "ruby") === "base")
        ? rubyBase
        : span;

    const currentText = (targetEl.textContent || "").trimEnd();

    if (hasTrailingSpace && !isLastLyricWord) {
      targetEl.textContent = currentText + " ";
    } else {
      targetEl.textContent = currentText;
    }
  }

  return childSpans;
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
  metadata: { title?: string; artist?: string; album?: string } = {},
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
    case "ttml": {
      const domImplementation =
        typeof document !== "undefined"
          ? document.implementation
          : new DOMImplementation();
      const xmlSerializer =
        typeof (globalThis as { XMLSerializer?: new () => unknown })
          .XMLSerializer !== "undefined"
          ? new (globalThis as unknown as { XMLSerializer: new () => unknown })
              .XMLSerializer()
          : new XMLSerializer();

      const generator = new TTMLGenerator({
        domImplementation,
        xmlSerializer: xmlSerializer as NonNullable<
          ConstructorParameters<typeof TTMLGenerator>[0]
        >["xmlSerializer"],
      });

      const amllMeta: [string, string[]][] = [];
      if (metadata.title) amllMeta.push(["title", [metadata.title]]);
      if (metadata.artist) amllMeta.push(["artist", [metadata.artist]]);
      if (metadata.album) amllMeta.push(["album", [metadata.album]]);

      const ttmlResult = toTTMLResult(
        amllLines as unknown as Parameters<typeof toTTMLResult>[0],
        amllMeta,
        {
          translationLanguage: "zh-Hans",
          romanizationLanguage: "ja-Latn",
        },
      );

      generator.generate(ttmlResult);
      const doc = (generator as unknown as { doc?: Document }).doc;

      if (doc) {
        const paragraphs = new Map<string, TtmlParagraph>(
          groupTtmlParagraphs(amllLines).map((paragraph, idx) => [
            `L${idx + 1}`,
            paragraph,
          ]),
        );

        for (const p of Array.from(doc.getElementsByTagName("p"))) {
          const paragraph = paragraphs.get(p.getAttribute("itunes:key") || "");
          if (!paragraph) continue;
          const { line, bg } = paragraph;

          // A background line that couldn't nest into a main line is its own <p>
          if (line.isBG) p.setAttributeNS(TTM_NS, "ttm:role", "x-bg");
          if (line.isDuet) p.setAttributeNS(TTM_NS, "ttm:agent", "v2");

          const childSpans = applyWordSpacing(p, line.words);
          const bgSpan = childSpans.find((span) => getTtmRole(span) === "x-bg");
          if (bg && bgSpan) applyWordSpacing(bgSpan, bg.words);
        }
      }

      const serializer = xmlSerializer as {
        serializeToString: (doc: unknown) => string;
      };

      let rawXml = serializer.serializeToString(
        doc ||
          (generator as unknown as { doc: Document }).doc ||
          generator.generate(ttmlResult),
      );

      if (amllLines.some((l) => l.isDuet)) {
        if (!rawXml.includes('xml:id="v2"')) {
          rawXml = rawXml.replace(
            '<ttm:agent type="person" xml:id="v1"/>',
            '<ttm:agent type="person" xml:id="v1"/>\n      <ttm:agent type="person" xml:id="v2"/>',
          );
        }
      }

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
