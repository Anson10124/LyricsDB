import type { EnrichedMusixmatchMetadata, ResolveOptions } from '../types.js';
import { HttpClient } from './http.js';

export interface MusixmatchMatchParams {
  spotifyId?: string;
  appleMusicId?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  durationMs?: number;
}

export interface MusixmatchMatcherOptions extends ResolveOptions {
  apiUrl?: string;
  getToken?: (options?: ResolveOptions, forceRefresh?: boolean) => Promise<string>;
}

function generateRandomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function fetchAnonymousTokenFallback(timeout = 8000): Promise<string> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const t = generateRandomId();
    const url = `https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&t=${t}`;

    try {
      const res = await HttpClient.get<{
        message?: {
          header?: { status_code?: number; hint?: string };
          body?: { user_token?: string };
        };
      }>(url, {
        headers: {
          authority: 'apic-desktop.musixmatch.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        },
        timeout,
      });

      const token = res?.message?.body?.user_token;
      if (token && token !== 'Upgrade. Paid script.') {
        return token;
      }
    } catch {
      // Retry
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error('Failed to acquire Musixmatch token in matcher');
}

interface MusixmatchTrackResponse {
  message?: {
    header?: {
      status_code?: number;
      hint?: string;
    };
    body?: {
      track?: {
        track_id?: number;
        track_name?: string;
        artist_name?: string;
        album_name?: string;
        track_isrc?: string;
        commontrack_isrcs?: string[][];
        track_spotify_id?: string;
        commontrack_spotify_ids?: string[];
        commontrack_itunes_ids?: number[];
        commontrack_id?: number;
        instrumental?: number;
      };
    };
  };
}

export async function matchTrackWithMusixmatch(
  params: MusixmatchMatchParams,
  options?: MusixmatchMatcherOptions
): Promise<EnrichedMusixmatchMetadata | null> {
  const spotifyId = params.spotifyId?.trim();
  const appleMusicId = params.appleMusicId?.trim();
  const isrc = params.isrc?.trim();
  const title = params.title?.trim();
  const artist = params.artist?.trim();

  // Need at least one identifier or title
  if (!spotifyId && !appleMusicId && !isrc && !title) {
    return null;
  }

  const baseUrl = options?.apiUrl || 'https://apic-desktop.musixmatch.com/ws/1.1/matcher.track.get';

  const executeMatcherCall = async (token: string): Promise<MusixmatchTrackResponse | null> => {
    const url = new URL(baseUrl);
    url.searchParams.set('app_id', 'web-desktop-app-v1.0');
    url.searchParams.set('format', 'json');
    url.searchParams.set('usertoken', token);
    url.searchParams.set('t', generateRandomId());

    if (spotifyId) {
      url.searchParams.set('track_spotify_id', spotifyId);
    } else if (appleMusicId) {
      url.searchParams.set('track_itunes_id', appleMusicId);
    } else if (isrc) {
      url.searchParams.set('track_isrc', isrc);
    } else if (title) {
      url.searchParams.set('q_track', title);
      if (artist) {
        url.searchParams.set('q_artist', artist);
      }
      if (params.durationMs && params.durationMs > 0) {
        url.searchParams.set('q_duration', String(Math.round(params.durationMs / 1000)));
      }
    }

    try {
      return await HttpClient.get<MusixmatchTrackResponse>(url.toString(), {
        headers: {
          authority: 'apic-desktop.musixmatch.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        },
        timeout: options?.timeout ?? 8000,
        retries: 0,
      });
    } catch {
      return null;
    }
  };

  try {
    let token = options?.getToken
      ? await options.getToken(options)
      : await fetchAnonymousTokenFallback(options?.timeout);

    let res = await executeMatcherCall(token);

    // If 401, refresh token and retry once
    if (res?.message?.header?.status_code === 401) {
      token = options?.getToken
        ? await options.getToken(options, true)
        : await fetchAnonymousTokenFallback(options?.timeout);
      res = await executeMatcherCall(token);
    }

    if (!res || res.message?.header?.status_code !== 200) {
      return null;
    }

    const tr = res.message?.body?.track;
    if (!tr) return null;

    const extractedIsrc =
      tr.track_isrc?.trim() ||
      (Array.isArray(tr.commontrack_isrcs) && tr.commontrack_isrcs[0]?.[0]?.trim()) ||
      undefined;

    const extractedSpotifyId =
      tr.track_spotify_id?.trim() ||
      (Array.isArray(tr.commontrack_spotify_ids) && tr.commontrack_spotify_ids[0]?.trim()) ||
      undefined;

    const extractedAppleId =
      Array.isArray(tr.commontrack_itunes_ids) && tr.commontrack_itunes_ids[0]
        ? String(tr.commontrack_itunes_ids[0])
        : undefined;

    return {
      isrc: extractedIsrc,
      spotifyId: extractedSpotifyId,
      spotifyIds: tr.commontrack_spotify_ids?.filter(Boolean),
      appleMusicId: extractedAppleId,
      appleMusicIds: tr.commontrack_itunes_ids?.map((id) => String(id)).filter(Boolean),
      musixmatchId: tr.track_id ? String(tr.track_id) : undefined,
      title: tr.track_name,
      artist: tr.artist_name,
      album: tr.album_name,
      raw: tr as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
