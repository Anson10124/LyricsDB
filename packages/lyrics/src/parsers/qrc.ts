import { parseQrc as parseAmllQrc } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricsPayload } from '@repo/types';
import { convertAmllLinesToCompact } from '../utils/converter.js';

const XML_CONTENT_REGEX = /<Lyric_1[^>]*LyricContent="([^"]*)"/s;

function normalizeQrcText(input: string): string {
  if (!input) return '';
  const match = input.match(XML_CONTENT_REGEX);
  if (match && match[1] !== undefined) {
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r');
  }
  return input;
}

// Parses QQ Music QRC into line-grouped compact tuple format.
export function parseQrc(qrcText: string): SyncedLyricsPayload {
  if (!qrcText || typeof qrcText !== 'string') {
    return [];
  }

  try {
    const cleanText = normalizeQrcText(qrcText);
    const rawLines = parseAmllQrc(cleanText);
    return convertAmllLinesToCompact(rawLines);
  } catch {
    return [];
  }
}
