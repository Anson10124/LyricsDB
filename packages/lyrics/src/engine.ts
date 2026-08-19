import type { LyricsType, SyncedLyricsPayload } from '@repo/types';
import { fetchLrclibLyrics } from './fetchers/lrclib.js';
import { fetchNeteaseLyrics } from './fetchers/netease.js';
import { parseLrc } from './parsers/lrc.js';
import { parseYrc } from './parsers/yrc.js';
import { formatLyricsPayload } from './utils/converter.js';

export interface ResolveLyricsContext {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  neteaseId?: string;
  qqMusicId?: string;
  appleMusicId?: string;
  spotifyId?: string;
}

export interface ResolvedLyricsResult {
  lyricsType: LyricsType;
  lyrics: SyncedLyricsPayload | string;
  source: string;
  provider: string;
}

export class LyricsEngine {
  // Automatically resolves the highest-quality lyrics available:
  // 1. Word-by-Word (YRC/TTML/QRC) -> Compact tuple array
  // 2. Line-by-Line Synced (LRC) -> Compact tuple array
  // 3. Plain text -> string
  async resolveLyrics(context: ResolveLyricsContext): Promise<ResolvedLyricsResult | null> {
    const artist = context.artist || context.artists?.[0];

    // Priority 1: NetEase Cloud Music (Word-by-Word YRC)
    if (context.neteaseId) {
      try {
        const neteaseData = await fetchNeteaseLyrics(context.neteaseId);
        if (neteaseData?.yrc?.lyric) {
          const parsed = parseYrc(neteaseData.yrc.lyric);
          if (parsed.length > 0) {
            return {
              lyricsType: 'word',
              lyrics: parsed,
              source: 'netease-yrc',
              provider: 'netease',
            };
          }
        }

        // If NetEase has standard LRC
        if (neteaseData?.lrc?.lyric) {
          const parsed = parseLrc(neteaseData.lrc.lyric);
          if (parsed.length > 0) {
            return {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'netease-lrc',
              provider: 'netease',
            };
          }
        }
      } catch {
        // Fallthrough to next provider
      }
    }

    // Priority 2: LRCLIB (Line-by-Line Synced & Plain)
    try {
      const lrclibData = await fetchLrclibLyrics({
        title: context.title,
        artist,
        album: context.album,
        durationMs: context.durationMs,
        isrc: context.isrc,
      });

      if (lrclibData?.syncedLyrics) {
        const parsed = parseLrc(lrclibData.syncedLyrics);
        if (parsed.length > 0) {
          return {
            lyricsType: 'line',
            lyrics: parsed,
            source: 'lrclib',
            provider: 'lrclib',
          };
        }
      }

      if (lrclibData?.plainLyrics) {
        return {
          lyricsType: 'plain',
          lyrics: lrclibData.plainLyrics,
          source: 'lrclib-plain',
          provider: 'lrclib',
        };
      }
    } catch {
      // Fallthrough
    }

    return null;
  }

  formatLyrics(lyrics: any, format: string) {
    return formatLyricsPayload(lyrics, format);
  }
}

export const defaultLyricsEngine = new LyricsEngine();
