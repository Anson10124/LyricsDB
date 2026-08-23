import { TTMLParser, toAmllLyrics } from "@applemusic-like-lyrics/ttml";
import { DOMParser } from "@xmldom/xmldom";
import type { SyncedLyricsPayload } from "@repo/types";
import { convertAmllLinesToCompact } from "../utils/converter.js";

// Parses Apple Music TTML lyrics into line-grouped compact tuple format.
export function parseTtml(
  ttmlText: string,
  metadata?: { title?: string; artist?: string },
): SyncedLyricsPayload {
  if (!ttmlText || typeof ttmlText !== "string") {
    return [];
  }

  try {
    const domParser =
      typeof globalThis.DOMParser !== "undefined"
        ? new globalThis.DOMParser()
        : (new DOMParser() as unknown as globalThis.DOMParser);

    const ttmlResult = TTMLParser.parse(ttmlText, {
      domParser: domParser as NonNullable<
        ConstructorParameters<typeof TTMLParser>[0]
      >["domParser"],
    });
    const parsed = toAmllLyrics(ttmlResult);
    return convertAmllLinesToCompact(parsed.lines, metadata);
  } catch (err) {
    return [];
  }
}

