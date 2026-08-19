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
  // Tier 1: Word-by-Word (QQ Music QRC -> NetEase YRC)
  // Tier 2: Line-by-Line (QQ Music LRC -> NetEase LRC -> LRCLIB Synced LRC)
  // Tier 3: Plain text (LRCLIB Plain)
  async resolveLyrics(context: ResolveLyricsContext): Promise<ResolvedLyricsResult | null> {
    const artist = context.artist || context.artists?.[0];

    let qqLineCandidate: ResolvedLyricsResult | null = null;
    let neteaseLineCandidate: ResolvedLyricsResult | null = null;

    // Step 1: Try QQ Music for Word-by-Word (QRC), or stash Line-by-Line (LRC) candidate
    if (context.qqMusicId || context.title) {
      try {
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
            qqLineCandidate = {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'qq-lrc',
              provider: 'qqmusic',
            };
          }
        }
      } catch {
        // Fallthrough to NetEase
      }
    }

    // Step 2: Try NetEase Cloud Music / 163 for Word-by-Word (YRC), or stash Line-by-Line (LRC) candidate
    if (context.neteaseId || context.title) {
      try {
        const neteaseData = await fetchNeteaseLyrics({
          neteaseId: context.neteaseId,
          title: context.title,
          artist,
          artists: context.artists,
          durationMs: context.durationMs,
        });

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

        // Stash NetEase standard LRC candidate
        if (neteaseData?.lrc?.lyric) {
          const parsed = parseLrc(neteaseData.lrc.lyric);
          if (parsed.length > 0) {
            neteaseLineCandidate = {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'netease-lrc',
              provider: 'netease',
            };
          }
        }
      } catch {
        // Fallthrough
      }
    }

    // Step 3: If no Word-by-Word lyrics were found, fall back to Line-by-Line synced lyrics
    if (qqLineCandidate) {
      return qqLineCandidate;
    }

    if (neteaseLineCandidate) {
      return neteaseLineCandidate;
    }

    // Step 4: Fallback to LRCLIB (Line-by-Line Synced & Plain)
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
