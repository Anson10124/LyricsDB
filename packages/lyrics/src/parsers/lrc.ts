import { parseLrc as parseAmllLrc } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';
import { isPlaceholderLyricText } from '../utils/info-lines.js';

// Parses standard and enhanced LRC using @applemusic-like-lyrics/lyric into line-grouped compact tuple format.
export function parseLrc(lrcText: string): SyncedLyricsPayload {
  if (!lrcText || typeof lrcText !== 'string' || isPlaceholderLyricText(lrcText)) {
    return [];
  }

  try {
    const rawLines = parseAmllLrc(lrcText);
    return convertAmllLinesToCompact(rawLines);
  } catch {
    return [];
  }
}
