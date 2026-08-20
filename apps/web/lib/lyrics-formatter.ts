import { TTMLGenerator } from "@applemusic-like-lyrics/ttml";
import {
  stringifyLrc,
  stringifyYrc,
  stringifyQrc,
  stringifyAss,
  type LyricLine,
  type LyricWord,
} from "@applemusic-like-lyrics/lyric";
import type { CompactLyricWord, SyncedLyricsPayload } from "@repo/types";

export type LyricsViewFormat = "synced" | "ttml" | "lrc" | "yrc" | "qrc" | "ass" | "json";

export function convertCompactToAmllLines(payload: SyncedLyricsPayload): LyricLine[] {
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

export function formatLyricsOnClient(
  payload: SyncedLyricsPayload | null | undefined,
  format: LyricsViewFormat,
  metadata: { title?: string; artist?: string; album?: string } = {}
): string {
  if (!payload || !Array.isArray(payload) || payload.length === 0) {
    return "";
  }

  const amllLines = convertCompactToAmllLines(payload);

  try {
    switch (format) {
      case "ttml": {
        const generator = new TTMLGenerator({
          domImplementation: typeof document !== "undefined" ? document.implementation : undefined,
          xmlSerializer: typeof XMLSerializer !== "undefined" ? new XMLSerializer() : undefined,
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
        return generator.generate({
          lines: ttmlLines as unknown as Parameters<typeof generator.generate>[0]["lines"],
          metadata: {
            title: metadata.title ? [metadata.title] : undefined,
            artist: metadata.artist ? [metadata.artist] : undefined,
            album: metadata.album ? [metadata.album] : undefined,
          },
        });
      }
      case "lrc":
        return stringifyLrc(amllLines);
      case "yrc":
        return stringifyYrc(amllLines);
      case "qrc":
        return stringifyQrc(amllLines);
      case "ass":
        return stringifyAss(amllLines);
      case "json":
        return JSON.stringify(payload, null, 2);
      default:
        return stringifyLrc(amllLines);
    }
  } catch (err) {
    console.error("Error formatting lyrics:", err);
    return JSON.stringify(payload, null, 2);
  }
}
