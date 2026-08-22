import {
  convertCompactToAmllLines,
  formatLyricsPayload,
  formatXml,
} from "@repo/lyrics/converter";
import type { SyncedLyricsPayload } from "@repo/types";

export { convertCompactToAmllLines, formatXml };

export type LyricsViewFormat =
  | "synced"
  | "ttml"
  | "lrc"
  | "eslrc"
  | "yrc"
  | "qrc"
  | "ass"
  | "json"
  | "metadata";

export function formatLyricsOnClient(
  payload: SyncedLyricsPayload | null | undefined,
  format: LyricsViewFormat,
  metadata: { title?: string; artist?: string; album?: string } = {},
): string {
  if (!payload || !Array.isArray(payload) || payload.length === 0) {
    return "";
  }

  if (format === "synced") {
    return "";
  }

  try {
    const result = formatLyricsPayload(payload, format, metadata);
    if (typeof result.content === "string") {
      return result.content;
    }
    return JSON.stringify(result.content, null, 2);
  } catch (err) {
    console.error("Error formatting lyrics:", err);
    return JSON.stringify(payload, null, 2);
  }
}
