import { parseYrc as parseAmllYrc } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';
import { isPlaceholderLyricText } from '../utils/info-lines.js';

// Parses NetEase YRC using @applemusic-like-lyrics/lyric into line-grouped compact tuple format.
export function parseYrc(
  yrcText: string,
  metadata?: { title?: string; artist?: string }
): SyncedLyricsPayload {
  if (!yrcText || typeof yrcText !== 'string' || isPlaceholderLyricText(yrcText, metadata)) {
    return [];
  }

  try {
    const rawLines = parseAmllYrc(yrcText);
    return convertAmllLinesToCompact(rawLines, metadata);
  } catch {
    return [];
  }
}
