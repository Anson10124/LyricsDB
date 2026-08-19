import { parseQrc as parseAmllQrc } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';
import { extractLyricContent } from '../utils/qrc-decoder.js';

// Parses QQ Music QRC into line-grouped compact tuple format.
export function parseQrc(qrcText: string): SyncedLyricsPayload {
  if (!qrcText || typeof qrcText !== 'string') {
    return [];
  }

  try {
    const cleanText = extractLyricContent(qrcText);
    const rawLines = parseAmllQrc(cleanText);
    return convertAmllLinesToCompact(rawLines);
  } catch {
    return [];
  }
}

