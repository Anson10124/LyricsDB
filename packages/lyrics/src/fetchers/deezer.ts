import { getDeezerJwt, refreshDeezerJwt, type DatabaseClient } from '@repo/database';
import type { DeezerSyncedLine, DeezerWordByWordLine } from '../parsers/deezer.js';

export interface DeezerLyricsQueryParams {
  deezerId?: string;
  title?: string;
  artist?: string;
  artists?: string[];
  durationMs?: number;
}

export interface DeezerLyricsResponse {
  id?: string;
  text?: string;
  synchronizedWordByWordLines?: DeezerWordByWordLine[];
  synchronizedLines?: DeezerSyncedLine[];
  licence?: string;
  copyright?: string;
  writers?: string;
}

export interface DeezerFetchOptions {
  timeout?: number;
  dbClient?: DatabaseClient;
}

const GET_LYRICS_QUERY = `query GetLyrics($trackId: String!) {
  track(trackId: $trackId) {
    id
    lyrics {
      id
      text
      ...SynchronizedWordByWordLines
      ...SynchronizedLines
      licence
      copyright
      writers
      __typename
    }
    __typename
  }
}

fragment SynchronizedWordByWordLines on Lyrics {
  id
  synchronizedWordByWordLines {
    start
    end
    words {
      start
      end
      word
      __typename
    }
    __typename
  }
  __typename
}

fragment SynchronizedLines on Lyrics {
  id
  synchronizedLines {
    lrcTimestamp
    line
    lineTranslated
    milliseconds
    duration
    __typename
  }
  __typename
}`;

export async function fetchDeezerLyrics(
  idOrParams: string | DeezerLyricsQueryParams,
  options?: DeezerFetchOptions
): Promise<DeezerLyricsResponse | null> {
  const deezerId = typeof idOrParams === 'string' ? idOrParams.trim() : idOrParams.deezerId?.trim();
  if (!deezerId) return null;

  try {
    let token = await getDeezerJwt(options?.dbClient, { timeout: options?.timeout });
    let res = await executeDeezerLyricsQuery(deezerId, token, options?.timeout);

    // If 401 Unauthorized, refresh JWT and retry once
    if (res.status === 401) {
      token = await refreshDeezerJwt(options?.dbClient, { timeout: options?.timeout });
      res = await executeDeezerLyricsQuery(deezerId, token, options?.timeout);
    }

    if (!res.ok) return null;

    const data = (await res.json()) as {
      data?: {
        track?: {
          id?: string;
          lyrics?: DeezerLyricsResponse;
        };
      };
    };

    const lyrics = data.data?.track?.lyrics;
    if (!lyrics) return null;

    return lyrics;
  } catch {
    return null;
  }
}

async function executeDeezerLyricsQuery(
  trackId: string,
  token: string,
  timeout = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch('https://pipe.deezer.com/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        operationName: 'GetLyrics',
        variables: { trackId },
        query: GET_LYRICS_QUERY,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
