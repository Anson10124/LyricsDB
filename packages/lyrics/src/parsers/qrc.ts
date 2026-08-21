import { parseQrc as parseAmllQrc } from "@applemusic-like-lyrics/lyric";
import type { SyncedLyricsPayload } from "@repo/types";
import { convertAmllLinesToCompact } from "../utils/converter.js";
import { extractLyricContent } from "../utils/qrc-decoder.js";
import { isPlaceholderLyricText } from "../utils/info-lines.js";

// Parses QQ Music QRC into line-grouped compact tuple format.
export function parseQrc(
  qrcText: string,
  metadata?: { title?: string; artist?: string },
): SyncedLyricsPayload {
  if (
    !qrcText ||
    typeof qrcText !== "string" ||
    isPlaceholderLyricText(qrcText, metadata)
  ) {
    return [];
  }

  try {
    const cleanText = extractLyricContent(qrcText);
    if (!cleanText || isPlaceholderLyricText(cleanText, metadata)) {
      return [];
    }
    const rawLines = parseAmllQrc(cleanText);
    return convertAmllLinesToCompact(rawLines, metadata);
  } catch {
    return [];
  }
}
