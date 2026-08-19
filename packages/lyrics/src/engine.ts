import type { LyricsType, SyncedLyricsPayload } from '@repo/types';
import { fetchLrclibLyrics } from './fetchers/lrclib.js';
import { fetchNeteaseLyrics } from './fetchers/netease.js';
import { fetchQQMusicLyrics } from './fetchers/qq-music.js';
import { parseLrc } from './parsers/lrc.js';
import { parseQrc } from './parsers/qrc.js';
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
  // Automatically resolves lyrics following priority order:
  // 1. QQ Music (qq) - Word-by-Word (QRC) -> Line-by-Line (LRC)
  // 2. NetEase Cloud Music (163) - Word-by-Word (YRC) -> Line-by-Line (LRC)
  // 3. LRCLIB (lrc) - Line-by-Line (LRC) -> Plain text
  async resolveLyrics(context: ResolveLyricsContext): Promise<ResolvedLyricsResult | null> {
    const artist = context.artist || context.artists?.[0];

    // Priority 1: QQ Music (QRC Word-by-Word -> LRC Line-by-Line)
    try {
      if (context.qqMusicId || context.title) {
        const qqData = await fetchQQMusicLyrics({
          qqMusicId: context.qqMusicId,
          title: context.title,
          artist,
          artists: context.artists,
          durationMs: context.durationMs,
        });

        if (qqData?.qrc) {
          const parsed = parseQrc(qqData.qrc);
          if (parsed.length > 0) {
            return {
              lyricsType: 'word',
              lyrics: parsed,
              source: 'qq-qrc',
              provider: 'qqmusic',
            };
          }
        }

        if (qqData?.lrc) {
          const parsed = parseLrc(qqData.lrc);
          if (parsed.length > 0) {
            return {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'qq-lrc',
              provider: 'qqmusic',
            };
          }
        }
      }
    } catch {
      // Fallthrough to NetEase
    }

    // Priority 2: NetEase Cloud Music / 163 (YRC Word-by-Word -> LRC Line-by-Line)
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

        // NetEase standard LRC fallback
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
        // Fallthrough to LRCLIB
      }
    }

    // Priority 3: LRCLIB (Line-by-Line Synced & Plain)
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
