import { parseTTML } from '@applemusic-like-lyrics/ttml';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';

// Parses Apple Music TTML lyrics using @applemusic-like-lyrics/ttml into line-grouped compact tuple format.
export function parseTtml(ttmlText: string): SyncedLyricsPayload {
  if (!ttmlText || typeof ttmlText !== 'string') {
    return [];
  }

  try {
    const parsed = parseTTML(ttmlText);
    return convertAmllLinesToCompact(parsed.lines);
  } catch {
    return [];
  }
}
