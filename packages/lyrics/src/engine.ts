import type { FormattedLyricsResult, LyricsType, SyncedLyricsPayload } from '@repo/types';
import { fetchDeezerLyrics } from './fetchers/deezer.js';
import { fetchLrclibLyrics } from './fetchers/lrclib.js';
import { fetchMusixmatchLyrics } from './fetchers/musixmatch.js';
import { fetchNeteaseLyrics } from './fetchers/netease.js';
import { fetchQQMusicLyrics } from './fetchers/qq-music.js';
import { parseDeezerSyncedLines, parseDeezerWordLyrics } from './parsers/deezer.js';
import { parseLrc } from './parsers/lrc.js';
import { parseMusixmatchRichSync, parseMusixmatchSubtitles } from './parsers/musixmatch.js';
import { parseQrc } from './parsers/qrc.js';
import { parseYrc } from './parsers/yrc.js';
import { formatLyricsPayload } from './utils/converter.js';
import { isPlaceholderLyricText } from './utils/info-lines.js';

export interface ResolveLyricsContext {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  deezerId?: string;
  neteaseId?: string;
  qqMusicId?: string;
  appleMusicId?: string;
  spotifyId?: string;
  musixmatchId?: string;
}

export interface ResolvedLyricsResult {
  lyricsType: LyricsType;
  lyrics: SyncedLyricsPayload | string;
  source: string;
  provider: string;
}

export class LyricsEngine {
  // Automatically resolves lyrics following priority order:
  // Tier 1: Word-by-Word (QQ Music QRC -> Deezer Word-by-Word -> NetEase YRC -> Musixmatch RichSync)
  // Tier 2: Line-by-Line (QQ Music LRC -> Deezer Synced LRC -> NetEase LRC -> Musixmatch Subtitles -> LRCLIB Synced LRC)
  // Tier 3: Plain text (Deezer Plain -> Musixmatch Plain -> LRCLIB Plain)
  async resolveLyrics(context: ResolveLyricsContext): Promise<ResolvedLyricsResult | null> {
    const artist = context.artist || context.artists?.[0];
    const metadata = { title: context.title, artist };

    let qqLineCandidate: ResolvedLyricsResult | null = null;
    let deezerLineCandidate: ResolvedLyricsResult | null = null;
    let neteaseLineCandidate: ResolvedLyricsResult | null = null;
    let musixmatchLineCandidate: ResolvedLyricsResult | null = null;
    let deezerPlainCandidate: ResolvedLyricsResult | null = null;
    let musixmatchPlainCandidate: ResolvedLyricsResult | null = null;

    // Step 1: Try QQ Music for Word-by-Word (QRC), or stash Line-by-Line (LRC) candidate
    if (context.qqMusicId) {
      try {
        const qqData = await fetchQQMusicLyrics({
          qqMusicId: context.qqMusicId,
        });

        if (qqData?.qrc) {
          const parsed = parseQrc(qqData.qrc, metadata);
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
          const parsed = parseLrc(qqData.lrc, metadata);
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
        // Fallthrough to Deezer
      }
    }

    // Step 2: Try Deezer for Word-by-Word, or stash Line-by-Line / Plain text candidates
    if (context.deezerId) {
      try {
        const deezerData = await fetchDeezerLyrics({
          deezerId: context.deezerId,
        });

        if (deezerData?.synchronizedWordByWordLines && deezerData.synchronizedWordByWordLines.length > 0) {
          const parsed = parseDeezerWordLyrics(deezerData.synchronizedWordByWordLines, metadata);
          if (parsed.length > 0) {
            return {
              lyricsType: 'word',
              lyrics: parsed,
              source: 'deezer-word',
              provider: 'deezer',
            };
          }
        }

        if (deezerData?.synchronizedLines && deezerData.synchronizedLines.length > 0) {
          const parsed = parseDeezerSyncedLines(deezerData.synchronizedLines, metadata);
          if (parsed.length > 0) {
            deezerLineCandidate = {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'deezer-synced',
              provider: 'deezer',
            };
          }
        }

        if (deezerData?.text && !isPlaceholderLyricText(deezerData.text, metadata)) {
          deezerPlainCandidate = {
            lyricsType: 'plain',
            lyrics: deezerData.text,
            source: 'deezer-plain',
            provider: 'deezer',
          };
        }
      } catch {
        // Fallthrough to NetEase
      }
    }

    // Step 3: Try NetEase Cloud Music for Word-by-Word (YRC), or stash Line-by-Line (LRC) candidate
    if (context.neteaseId) {
      try {
        const neteaseData = await fetchNeteaseLyrics({
          neteaseId: context.neteaseId,
          title: context.title,
          artist,
        });

        if (neteaseData?.yrc?.lyric) {
          const parsed = parseYrc(neteaseData.yrc.lyric, metadata);
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
          const parsed = parseLrc(neteaseData.lrc.lyric, metadata);
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

    // Step 4: Try Musixmatch (using Spotify ID, ISRC, Apple Music ID, or Title/Artist)
    if (
      context.spotifyId ||
      context.isrc ||
      context.appleMusicId ||
      context.musixmatchId ||
      context.title
    ) {
      try {
        const mxmData = await fetchMusixmatchLyrics({
          spotifyId: context.spotifyId,
          isrc: context.isrc,
          appleMusicId: context.appleMusicId,
          musixmatchId: context.musixmatchId,
          title: context.title,
          artist,
          artists: context.artists,
          durationMs: context.durationMs,
        });

        if (mxmData?.richsync) {
          const parsed = parseMusixmatchRichSync(mxmData.richsync, metadata);
          if (parsed.length > 0) {
            return {
              lyricsType: 'word',
              lyrics: parsed,
              source: 'musixmatch-richsync',
              provider: 'musixmatch',
            };
          }
        }

        if (mxmData?.subtitles) {
          const parsed = parseMusixmatchSubtitles(mxmData.subtitles, metadata);
          if (parsed.length > 0) {
            musixmatchLineCandidate = {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'musixmatch-subtitles',
              provider: 'musixmatch',
            };
          }
        }

        if (
          mxmData?.plainLyrics &&
          !mxmData.track?.instrumental &&
          !isPlaceholderLyricText(mxmData.plainLyrics, metadata)
        ) {
          musixmatchPlainCandidate = {
            lyricsType: 'plain',
            lyrics: mxmData.plainLyrics,
            source: 'musixmatch-plain',
            provider: 'musixmatch',
          };
        }
      } catch {
        // Fallthrough
      }
    }

    // Step 5: If no Word-by-Word lyrics were found, fall back to Line-by-Line synced lyrics
    if (qqLineCandidate) {
      return qqLineCandidate;
    }

    if (deezerLineCandidate) {
      return deezerLineCandidate;
    }

    if (neteaseLineCandidate) {
      return neteaseLineCandidate;
    }

    if (musixmatchLineCandidate) {
      return musixmatchLineCandidate;
    }

    // Step 6: Fallback to LRCLIB (Line-by-Line Synced & Plain)
    if (context.title) {
      try {
        const lrclibData = await fetchLrclibLyrics({
          title: context.title,
          artist,
          album: context.album,
          durationMs: context.durationMs,
          isrc: context.isrc,
        });

        if (lrclibData?.syncedLyrics) {
          const parsed = parseLrc(lrclibData.syncedLyrics, metadata);
          if (parsed.length > 0) {
            return {
              lyricsType: 'line',
              lyrics: parsed,
              source: 'lrclib',
              provider: 'lrclib',
            };
          }
        }

        if (
          lrclibData?.plainLyrics &&
          !lrclibData.instrumental &&
          !isPlaceholderLyricText(lrclibData.plainLyrics, metadata)
        ) {
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
    }

    // Step 7: Fallback to Deezer Plain or Musixmatch Plain text if LRCLIB had nothing
    if (deezerPlainCandidate) {
      return deezerPlainCandidate;
    }

    if (musixmatchPlainCandidate) {
      return musixmatchPlainCandidate;
    }

    return null;
  }

  formatLyrics(
    lyrics: SyncedLyricsPayload | string | Record<string, unknown> | null | undefined,
    format: string = 'json'
  ): FormattedLyricsResult {
    return formatLyricsPayload(lyrics, format);
  }
}

export const defaultLyricsEngine = new LyricsEngine();
