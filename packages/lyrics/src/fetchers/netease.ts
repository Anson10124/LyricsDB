import { weapiEncrypt } from '@repo/music-resolver';
import { isPlaceholderLyricText } from '../utils/info-lines.js';

export interface NeteaseLyricsQueryParams {
  neteaseId?: string;
  title?: string;
  artist?: string;
  artists?: string[];
  durationMs?: number;
}

export interface NeteaseLyricsResponse {
  code: number;
  nolyric?: boolean;
  uncollected?: boolean;
  pureMusic?: boolean;
  needDesc?: boolean;
  yrc?: { lyric?: string; version?: number };
  lrc?: { lyric?: string; version?: number };
  tlyric?: { lyric?: string; version?: number };
  romalrc?: { lyric?: string; version?: number };
}

export async function fetchNeteaseLyrics(
  idOrParams: string | NeteaseLyricsQueryParams,
  options?: { timeout?: number }
): Promise<NeteaseLyricsResponse | null> {
  try {
    let id: string | undefined;

    if (typeof idOrParams === 'string') {
      id = idOrParams.trim();
    } else {
      id = idOrParams.neteaseId?.trim();
    }

    if (!id) return null;

    const payload = {
      id: String(id),
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0,
      csrf_token: '',
    };

    const encrypted = weapiEncrypt(payload);
    const body = new URLSearchParams({
      params: encrypted.params,
      encSecKey: encrypted.encSecKey,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch('https://music.163.com/weapi/song/lyric/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://music.163.com',
        Cookie:
          'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=3.1.17.204416; channel=netease;',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = (await res.json()) as NeteaseLyricsResponse;
    if (json.code !== 200) return null;

    if (json.nolyric || json.uncollected || json.pureMusic) {
      return null;
    }

    if (json.yrc?.lyric && isPlaceholderLyricText(json.yrc.lyric)) {
      json.yrc = undefined;
    }

    if (json.lrc?.lyric && isPlaceholderLyricText(json.lrc.lyric)) {
      json.lrc = undefined;
    }

    if (json.tlyric?.lyric && isPlaceholderLyricText(json.tlyric.lyric)) {
      json.tlyric = undefined;
    }

    if (json.romalrc?.lyric && isPlaceholderLyricText(json.romalrc.lyric)) {
      json.romalrc = undefined;
    }

    if (!json.yrc?.lyric && !json.lrc?.lyric) {
      return null;
    }

    return json;
  } catch {
    return null;
  }
}

