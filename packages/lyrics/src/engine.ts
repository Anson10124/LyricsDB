import type { FormattedLyricsResult, LyricsType, SyncedLyricsPayload, VocalType } from '@repo/types';
import { fetchDeezerLyrics, type DeezerLyricsResponse } from './fetchers/deezer.js';
import { fetchLrclibLyrics } from './fetchers/lrclib.js';
import { fetchMusixmatchLyrics, type MusixmatchLyricsResponse } from './fetchers/musixmatch.js';
import { fetchNeteaseLyrics, type NeteaseLyricsResponse } from './fetchers/netease.js';
import { fetchQQMusicFullLrc, fetchQQMusicLyrics, type QQMusicLyricsResponse } from './fetchers/qq-music.js';
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
  onProgress?: (event: {
    stage: 'lyrics_searching' | 'lyrics_found';
    provider: string;
    lyricsType?: LyricsType;
    status?: 'searching' | 'found' | 'miss' | 'fallback';
  }) => void;
}

export interface ResolvedLyricsResult {
  lyricsType: LyricsType;
  lyrics: SyncedLyricsPayload | string;
  source: string;
  provider: string;
}

export interface CandidateEvaluation {
  candidate: ResolvedLyricsResult;
  isComplete: boolean;
  score: number;
  vocalTypes: Set<VocalType>;
  lineCount: number;
  wordCount: number;
  spanMs: number;
  coverageRatio: number;
}

export function evaluateLyricsCandidate(
  candidate: ResolvedLyricsResult,
  expectedDurationMs?: number
): CandidateEvaluation {
  let isComplete = false;
  let lineCount = 0;
  let wordCount = 0;
  let spanMs = 0;
  let coverageRatio = 0;
  const vocalTypes = new Set<VocalType>();

  if (Array.isArray(candidate.lyrics)) {
    const payload = candidate.lyrics as SyncedLyricsPayload;
    lineCount = payload.filter((l) => Array.isArray(l) && l.length > 0).length;

    let minStartMs = Number.POSITIVE_INFINITY;
    let maxEndMs = 0;

    for (const line of payload) {
      if (!Array.isArray(line)) continue;
      for (const wordToken of line) {
        if (!wordToken) continue;
        const [vocalType, startMs, lengthMs] = wordToken;
        if (vocalType) vocalTypes.add(vocalType);
        wordCount++;
        if (startMs < minStartMs) minStartMs = startMs;
        const endMs = startMs + (lengthMs || 0);
        if (endMs > maxEndMs) maxEndMs = endMs;
      }
    }

    if (minStartMs === Number.POSITIVE_INFINITY) minStartMs = 0;
    spanMs = Math.max(0, maxEndMs - minStartMs);

    if (expectedDurationMs && expectedDurationMs >= 60000) {
      coverageRatio = maxEndMs / expectedDurationMs;
      // Complete if covers >= 55% of track duration and span >= 40s (or track is under 90s) and lineCount >= 4
      isComplete =
        coverageRatio >= 0.55 &&
        (spanMs >= 40000 || expectedDurationMs < 90000) &&
        lineCount >= 4;
    } else {
      // Without durationMs, check minimum line count and span
      isComplete = lineCount >= 4 && spanMs >= 20000;
    }
  } else if (typeof candidate.lyrics === 'string') {
    const lines = candidate.lyrics
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !l.includes('This Lyrics is NOT for Commercial use'));
    lineCount = lines.length;
    wordCount = lines.reduce((acc, l) => acc + l.split(/\s+/).length, 0);
    isComplete = lineCount >= 4;
  }

  // Calculate detail score:
  // Base score by timing precision:
  // Word-by-word: 1000
  // Line-by-line: 500
  // Plain text: 100
  let score = 0;
  if (candidate.lyricsType === 'word') score += 1000;
  else if (candidate.lyricsType === 'line') score += 500;
  else score += 100;

  // Vocal types detail scoring:
  // VocalType 1: Main Lead (standard baseline)
  // VocalType 2: Main Background (+80)
  // VocalType 3: Secondary Lead / Duet (+120)
  // VocalType 4: Secondary Background / Duet BG (+150)
  if (vocalTypes.has(2)) score += 80;
  if (vocalTypes.has(3)) score += 120;
  if (vocalTypes.has(4)) score += 150;
  if (vocalTypes.size >= 2) score += (vocalTypes.size - 1) * 40;

  // Coverage bonus (up to 200 pts):
  if (coverageRatio > 0) {
    score += Math.min(200, Math.round(coverageRatio * 200));
  }

  // Word token density bonus (up to 100 pts):
  score += Math.min(100, Math.round(wordCount / 5));

  // If candidate is incomplete/truncated, penalize heavily
  if (!isComplete) {
    score -= 2000;
  }

  return {
    candidate,
    isComplete,
    score,
    vocalTypes,
    lineCount,
    wordCount,
    spanMs,
    coverageRatio,
  };
}

export class LyricsEngine {
  // Resolves lyrics using a Tiered Concurrent Strategy to minimize latency and prevent rate limits:
  // Tier 1: Word-by-Word Sources (QQ Music QRC, Deezer Word-by-Word, NetEase YRC, Musixmatch RichSync)
  //         -> If valid complete result found, returns immediately (Tiers 2 & 3 skipped).
  // Tier 2: Line-by-Line / LRC Sources (QQ Music Full LRC, NetEase LRC, Deezer Synced, Musixmatch Subtitles, LRCLIB)
  //         -> If valid complete result found, returns immediately (Tier 3 skipped).
  // Tier 3: Plain text Sources (Deezer Plain, Musixmatch Plain, LRCLIB Plain)
  async resolveLyrics(context: ResolveLyricsContext): Promise<ResolvedLyricsResult | null> {
    const artist = context.artist || context.artists?.[0];
    const metadata = { title: context.title, artist };

    // Shared response caches across tiers to avoid duplicate network fetches
    let qqLyricsPromise: Promise<QQMusicLyricsResponse | null> | null = null;
    let deezerLyricsPromise: Promise<DeezerLyricsResponse | null> | null = null;
    let neteaseLyricsPromise: Promise<NeteaseLyricsResponse | null> | null = null;
    let musixmatchLyricsPromise: Promise<MusixmatchLyricsResponse | null> | null = null;

    const getQQLyrics = () => {
      if (!qqLyricsPromise && context.qqMusicId) {
        qqLyricsPromise = fetchQQMusicLyrics({ qqMusicId: context.qqMusicId });
      }
      return qqLyricsPromise;
    };

    const getDeezerLyrics = () => {
      if (!deezerLyricsPromise && context.deezerId) {
        deezerLyricsPromise = fetchDeezerLyrics({ deezerId: context.deezerId });
      }
      return deezerLyricsPromise;
    };

    const getNeteaseLyrics = () => {
      if (!neteaseLyricsPromise && context.neteaseId) {
        neteaseLyricsPromise = fetchNeteaseLyrics({
          neteaseId: context.neteaseId,
          title: context.title,
          artist,
        });
      }
      return neteaseLyricsPromise;
    };

    const getMusixmatchLyrics = () => {
      if (
        !musixmatchLyricsPromise &&
        (context.spotifyId ||
          context.isrc ||
          context.appleMusicId ||
          context.musixmatchId ||
          context.title)
      ) {
        musixmatchLyricsPromise = fetchMusixmatchLyrics({
          spotifyId: context.spotifyId,
          isrc: context.isrc,
          appleMusicId: context.appleMusicId,
          musixmatchId: context.musixmatchId,
          title: context.title,
          artist,
          artists: context.artists,
          durationMs: context.durationMs,
        });
      }
      return musixmatchLyricsPromise;
    };

    // ==========================================
    // TIER 1: Word-by-Word Sources (Parallel)
    // ==========================================
    const tier1Tasks: Promise<ResolvedLyricsResult | null>[] = [];

    // 1. QQ Music QRC
    if (context.qqMusicId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'qqmusic',
        lyricsType: 'word',
        status: 'searching',
      });
      tier1Tasks.push(
        (async () => {
          try {
            const res = await getQQLyrics();
            if (res?.qrc) {
              const parsed = parseQrc(res.qrc, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'word',
                  lyrics: parsed,
                  source: 'qq-qrc',
                  provider: 'qqmusic',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 2. Deezer Word-by-Word
    if (context.deezerId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'deezer',
        lyricsType: 'word',
        status: 'searching',
      });
      tier1Tasks.push(
        (async () => {
          try {
            const res = await getDeezerLyrics();
            if (res?.synchronizedWordByWordLines && res.synchronizedWordByWordLines.length > 0) {
              const parsed = parseDeezerWordLyrics(res.synchronizedWordByWordLines, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'word',
                  lyrics: parsed,
                  source: 'deezer-word',
                  provider: 'deezer',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 3. NetEase YRC
    if (context.neteaseId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'netease',
        lyricsType: 'word',
        status: 'searching',
      });
      tier1Tasks.push(
        (async () => {
          try {
            const res = await getNeteaseLyrics();
            if (res?.yrc?.lyric) {
              const parsed = parseYrc(res.yrc.lyric, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'word',
                  lyrics: parsed,
                  source: 'netease-yrc',
                  provider: 'netease',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 4. Musixmatch RichSync
    if (
      context.spotifyId ||
      context.isrc ||
      context.appleMusicId ||
      context.musixmatchId ||
      context.title
    ) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'musixmatch',
        lyricsType: 'word',
        status: 'searching',
      });
      tier1Tasks.push(
        (async () => {
          try {
            const res = await getMusixmatchLyrics();
            if (res?.richsync) {
              const parsed = parseMusixmatchRichSync(res.richsync, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'word',
                  lyrics: parsed,
                  source: 'musixmatch-richsync',
                  provider: 'musixmatch',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    if (tier1Tasks.length > 0) {
      const tier1Results = await Promise.allSettled(tier1Tasks);
      const tier1Candidates: CandidateEvaluation[] = [];

      for (const r of tier1Results) {
        if (r.status === 'fulfilled' && r.value) {
          const evalResult = evaluateLyricsCandidate(r.value, context.durationMs);
          tier1Candidates.push(evalResult);
        }
      }

      const completeTier1 = tier1Candidates.filter((c) => c.isComplete);
      if (completeTier1.length > 0) {
        completeTier1.sort((a, b) => b.score - a.score);
        const best = completeTier1[0]!.candidate;
        context.onProgress?.({
          stage: 'lyrics_found',
          provider: best.provider,
          lyricsType: best.lyricsType,
          status: 'found',
        });
        return best;
      }
    }

    // ==========================================
    // TIER 2: Line-by-Line / LRC Sources (Parallel)
    // ==========================================
    const tier2Tasks: Promise<ResolvedLyricsResult | null>[] = [];

    // 1. QQ Music Full LRC (Checked via cached response or fcg_query_lyric_new.fcg)
    if (context.qqMusicId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'qqmusic',
        lyricsType: 'line',
        status: 'searching',
      });
      tier2Tasks.push(
        (async () => {
          try {
            const cachedRes = await getQQLyrics();
            if (cachedRes?.lrc) {
              const parsed = parseLrc(cachedRes.lrc, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'qq-lrc',
                  provider: 'qqmusic',
                };
              }
            }
            const fullLrc = await fetchQQMusicFullLrc(context.qqMusicId!);
            if (fullLrc) {
              const parsed = parseLrc(fullLrc, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'qq-full-lrc',
                  provider: 'qqmusic',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 2. Deezer Synced Lines
    if (context.deezerId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'deezer',
        lyricsType: 'line',
        status: 'searching',
      });
      tier2Tasks.push(
        (async () => {
          try {
            const res = await getDeezerLyrics();
            if (res?.synchronizedLines && res.synchronizedLines.length > 0) {
              const parsed = parseDeezerSyncedLines(res.synchronizedLines, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'deezer-synced',
                  provider: 'deezer',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 3. NetEase LRC
    if (context.neteaseId) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'netease',
        lyricsType: 'line',
        status: 'searching',
      });
      tier2Tasks.push(
        (async () => {
          try {
            const res = await getNeteaseLyrics();
            if (res?.lrc?.lyric) {
              const parsed = parseLrc(res.lrc.lyric, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'netease-lrc',
                  provider: 'netease',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 4. Musixmatch Subtitles
    if (
      context.spotifyId ||
      context.isrc ||
      context.appleMusicId ||
      context.musixmatchId ||
      context.title
    ) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'musixmatch',
        lyricsType: 'line',
        status: 'searching',
      });
      tier2Tasks.push(
        (async () => {
          try {
            const res = await getMusixmatchLyrics();
            if (res?.subtitles) {
              const parsed = parseMusixmatchSubtitles(res.subtitles, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'musixmatch-subtitles',
                  provider: 'musixmatch',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    // 5. LRCLIB Synced LRC
    if (context.title) {
      context.onProgress?.({
        stage: 'lyrics_searching',
        provider: 'lrclib',
        lyricsType: 'line',
        status: 'searching',
      });
      tier2Tasks.push(
        (async () => {
          try {
            const res = await fetchLrclibLyrics({
              title: context.title,
              artist,
              album: context.album,
              durationMs: context.durationMs,
              isrc: context.isrc,
            });
            if (res?.syncedLyrics) {
              const parsed = parseLrc(res.syncedLyrics, metadata);
              if (parsed.length > 0) {
                return {
                  lyricsType: 'line',
                  lyrics: parsed,
                  source: 'lrclib',
                  provider: 'lrclib',
                };
              }
            }
          } catch {}
          return null;
        })()
      );
    }

    if (tier2Tasks.length > 0) {
      const tier2Results = await Promise.allSettled(tier2Tasks);
      const tier2Candidates: CandidateEvaluation[] = [];

      for (const r of tier2Results) {
        if (r.status === 'fulfilled' && r.value) {
          const evalResult = evaluateLyricsCandidate(r.value, context.durationMs);
          tier2Candidates.push(evalResult);
        }
      }

      const completeTier2 = tier2Candidates.filter((c) => c.isComplete);
      if (completeTier2.length > 0) {
        completeTier2.sort((a, b) => b.score - a.score);
        const best = completeTier2[0]!.candidate;
        context.onProgress?.({
          stage: 'lyrics_found',
          provider: best.provider,
          lyricsType: best.lyricsType,
          status: 'found',
        });
        return best;
      }
    }

    // ==========================================
    // TIER 3: Plain Text Sources (Parallel)
    // ==========================================
    const tier3Tasks: Promise<ResolvedLyricsResult | null>[] = [];

    // 1. Deezer Plain
    if (context.deezerId) {
      tier3Tasks.push(
        (async () => {
          try {
            const res = await getDeezerLyrics();
            if (res?.text && !isPlaceholderLyricText(res.text, metadata)) {
              return {
                lyricsType: 'plain',
                lyrics: res.text,
                source: 'deezer-plain',
                provider: 'deezer',
              };
            }
          } catch {}
          return null;
        })()
      );
    }

    // 2. Musixmatch Plain
    if (
      context.spotifyId ||
      context.isrc ||
      context.appleMusicId ||
      context.musixmatchId ||
      context.title
    ) {
      tier3Tasks.push(
        (async () => {
          try {
            const res = await getMusixmatchLyrics();
            if (
              res?.plainLyrics &&
              !res.track?.instrumental &&
              !isPlaceholderLyricText(res.plainLyrics, metadata)
            ) {
              return {
                lyricsType: 'plain',
                lyrics: res.plainLyrics,
                source: 'musixmatch-plain',
                provider: 'musixmatch',
              };
            }
          } catch {}
          return null;
        })()
      );
    }

    // 3. LRCLIB Plain
    if (context.title) {
      tier3Tasks.push(
        (async () => {
          try {
            const res = await fetchLrclibLyrics({
              title: context.title,
              artist,
              album: context.album,
              durationMs: context.durationMs,
              isrc: context.isrc,
            });
            if (
              res?.plainLyrics &&
              !res.instrumental &&
              !isPlaceholderLyricText(res.plainLyrics, metadata)
            ) {
              return {
                lyricsType: 'plain',
                lyrics: res.plainLyrics,
                source: 'lrclib-plain',
                provider: 'lrclib',
              };
            }
          } catch {}
          return null;
        })()
      );
    }

    if (tier3Tasks.length > 0) {
      const tier3Results = await Promise.allSettled(tier3Tasks);
      const tier3Candidates: CandidateEvaluation[] = [];

      for (const r of tier3Results) {
        if (r.status === 'fulfilled' && r.value) {
          const evalResult = evaluateLyricsCandidate(r.value, context.durationMs);
          tier3Candidates.push(evalResult);
        }
      }

      if (tier3Candidates.length > 0) {
        tier3Candidates.sort((a, b) => b.score - a.score);
        const best = tier3Candidates[0]!.candidate;
        context.onProgress?.({
          stage: 'lyrics_found',
          provider: best.provider,
          lyricsType: best.lyricsType,
          status: 'found',
        });
        return best;
      }
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

