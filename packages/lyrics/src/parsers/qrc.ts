import { parseQrc as parseAmllQrc } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';

// Parses QQ Music QRC using @applemusic-like-lyrics/lyric into line-grouped compact tuple format.
export function parseQrc(qrcText: string): SyncedLyricsPayload {
  if (!qrcText || typeof qrcText !== 'string') {
    return [];
  }

  try {
    const rawLines = parseAmllQrc(qrcText);
    return convertAmllLinesToCompact(rawLines);
  } catch {
    return [];
  }
}
