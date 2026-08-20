import { decodeQrcHex, extractLyricContent } from '../utils/qrc-decoder.js';

export interface QQMusicLyricsQueryParams {
  qqMusicId?: string;
  title?: string;
  artist?: string;
  artists?: string[];
  durationMs?: number;
}

export interface QQMusicLyricsResponse {
  qrc?: string;
  romaQrc?: string;
  lrc?: string;
  tlyric?: string;
}

export async function resolveQQNumericSongId(
  qqMusicId: string,
  options?: { timeout?: number }
): Promise<string | null> {
  const trimmed = qqMusicId.trim();
  if (!trimmed) return null;

  // Already numeric song ID
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // If alphanumeric songmid (e.g. 0039MnYb0qxYtV), resolve numeric ID directly by ID
  try {
    const payload = {
      songinfo: {
        method: 'get_song_detail_yqq',
        param: { song_mid: trimmed },
        module: 'music.pf_song_detail_svr',
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch(
      `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(payload))}`,
      {
        headers: {
          Referer: 'https://y.qq.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (res.ok) {
      const json = (await res.json()) as {
        songinfo?: {
          data?: {
            track_info?: {
              id?: number;
            };
          };
        };
      };

      const id = json.songinfo?.data?.track_info?.id;
      if (id) {
        return String(id);
      }
    }

    // Direct single-song ID lookup fallback
    const singleRes = await fetch(
      `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encodeURIComponent(trimmed)}&format=json`,
      {
        headers: { Referer: 'https://y.qq.com' },
      }
    );

    if (singleRes.ok) {
      const singleJson = (await singleRes.json()) as {
        data?: Array<{ id?: number }>;
      };
      if (singleJson.data?.[0]?.id) {
        return String(singleJson.data[0].id);
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchQQMusicLyrics(
  params: QQMusicLyricsQueryParams | string,
  options?: { timeout?: number }
): Promise<QQMusicLyricsResponse | null> {
  try {
    const rawId = typeof params === 'string' ? params : params.qqMusicId;
    if (!rawId?.trim()) return null;

    const numericSongId = await resolveQQNumericSongId(rawId, options);
    if (!numericSongId) return null;

    const downloadParams = new URLSearchParams({
      version: '15',
      miniversion: '82',
      lrctype: '4',
      musicid: numericSongId,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch(
      `https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg?${downloadParams.toString()}`,
      {
        headers: {
          Referer: 'https://y.qq.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const rawXml = (await res.text()).replace(/<!--|-->/g, '');

    const response: QQMusicLyricsResponse = {};

    // 1. Extract and Decrypt Original QRC Lyric (<content>)
    const contentMatch = rawXml.match(/<content[^>]*>(?:<!\[CDATA\[)?([0-9a-fA-F]+)(?:\]\]>)?<\/content>/is);
    if (contentMatch && contentMatch[1]) {
      const decodedXml = decodeQrcHex(contentMatch[1]);
      if (decodedXml) {
        const rawContent = extractLyricContent(decodedXml);
        if (rawContent) {
          // Check if it's QRC with word sync or standard LRC
          if (rawContent.includes('(') && rawContent.includes(')')) {
            response.qrc = rawContent;
          } else {
            response.lrc = rawContent;
          }
        }
      }
    }

    // 2. Extract and Decrypt Romanized QRC Lyric (<contentroma>)
    const romaMatch = rawXml.match(/<contentroma[^>]*>(?:<!\[CDATA\[)?([0-9a-fA-F]+)(?:\]\]>)?<\/contentroma>/is);
    if (romaMatch && romaMatch[1]) {
      const decodedRoma = decodeQrcHex(romaMatch[1]);
      if (decodedRoma) {
        response.romaQrc = extractLyricContent(decodedRoma);
      }
    }

    // 3. Extract Translated Lyric (<contentts>)
    const tsMatch = rawXml.match(/<contentts[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/contentts>/i);
    if (tsMatch && tsMatch[1] && tsMatch[1].trim()) {
      response.tlyric = tsMatch[1].trim();
    }

    if (!response.qrc && !response.lrc && !response.romaQrc && !response.tlyric) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

export async function fetchQQMusicFullLrc(
  songmidOrId: string,
  options?: { timeout?: number }
): Promise<string | null> {
  const trimmed = songmidOrId?.trim();
  if (!trimmed) return null;

  try {
    const isNumeric = /^\d+$/.test(trimmed);
    const paramKey = isNumeric ? 'musicid' : 'songmid';
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${paramKey}=${encodeURIComponent(trimmed)}&format=json&nobase64=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch(url, {
      headers: {
        Referer: 'https://y.qq.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = (await res.json()) as { lyric?: string };
    if (json.lyric && json.lyric.trim()) {
      return json.lyric.trim();
    }
    return null;
  } catch {
    return null;
  }
}

