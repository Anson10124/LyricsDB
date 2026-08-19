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


async function searchQQMusicSongId(
  title: string,
  artist?: string,
  options?: { timeout?: number }
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      SONGNAME: title,
      SINGERNAME: artist || '',
      TYPE: '2',
      RANGE_MIN: '1',
      RANGE_MAX: '10',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_search_pc_lrc.fcg?${params.toString()}`,
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
    const text = await res.text();

    const idMatch = text.match(/<songinfo\s+id="(\d+)"/i);
    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }

    // Fallback to client_search_cp if pc_lrc didn't find results
    const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(
      artist ? `${title} ${artist}` : title
    )}&format=json&t=0`;

    const searchRes = await fetch(searchUrl, {
      headers: { Referer: 'https://y.qq.com' },
    });
    if (searchRes.ok) {
      const searchRaw = await searchRes.text();
      const cleanJson = searchRaw.replace(/^callback\(|\)$/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      const songList = parsed?.data?.song?.list;
      if (Array.isArray(songList) && songList.length > 0 && songList[0]?.songid) {
        return String(songList[0].songid);
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchQQMusicLyrics(
  params: QQMusicLyricsQueryParams,
  options?: { timeout?: number }
): Promise<QQMusicLyricsResponse | null> {
  try {
    let numericSongId = params.qqMusicId?.trim();

    // If ID is missing or non-numeric (e.g. songmid string), search for the numeric song ID
    if (!numericSongId || !/^\d+$/.test(numericSongId)) {
      if (!params.title) return null;
      const artist = params.artist || params.artists?.[0];
      const foundId = await searchQQMusicSongId(params.title, artist, options);
      if (!foundId) return null;
      numericSongId = foundId;
    }

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
