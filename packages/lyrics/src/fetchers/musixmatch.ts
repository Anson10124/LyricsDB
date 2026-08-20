import { getMusixmatchToken, refreshMusixmatchToken, type DatabaseClient } from '@repo/database';
import { isPlaceholderLyricText } from '../utils/info-lines.js';

export interface MusixmatchLyricsQueryParams {
  spotifyId?: string;
  isrc?: string;
  appleMusicId?: string;
  musixmatchId?: string;
  title?: string;
  artist?: string;
  artists?: string[];
  durationMs?: number;
}

export interface MusixmatchTrackInfo {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  hasRichsync?: number;
  hasSubtitles?: number;
  hasLyrics?: number;
  instrumental?: number;
}

export interface MusixmatchLyricsResponse {
  richsync?: string;
  subtitles?: string;
  plainLyrics?: string;
  track?: MusixmatchTrackInfo;
}

export interface MusixmatchFetchOptions {
  timeout?: number;
  dbClient?: DatabaseClient;
}

function generateRandomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function fetchMusixmatchLyrics(
  paramsOrQuery: string | MusixmatchLyricsQueryParams,
  options?: MusixmatchFetchOptions
): Promise<MusixmatchLyricsResponse | null> {
  const params: MusixmatchLyricsQueryParams =
    typeof paramsOrQuery === 'string' ? { title: paramsOrQuery } : paramsOrQuery;

  const spotifyId = params.spotifyId?.trim();
  const isrc = params.isrc?.trim();
  const appleMusicId = params.appleMusicId?.trim();
  const musixmatchId = params.musixmatchId?.trim();
  const title = params.title?.trim();
  const artist = params.artist?.trim() || params.artists?.[0]?.trim();
  const durationMs = params.durationMs;

  // Must have at least one exact platform ID or title
  if (!spotifyId && !isrc && !appleMusicId && !musixmatchId && !title) {
    return null;
  }

  try {
    let token = await getMusixmatchToken(options?.dbClient, { timeout: options?.timeout });
    let res = await executeMusixmatchMacroQuery(params, token, options?.timeout);

    // If 401 Unauthorized or captcha hint, refresh token and retry once
    if (res?.message?.header?.status_code === 401) {
      token = await refreshMusixmatchToken(options?.dbClient, { timeout: options?.timeout });
      res = await executeMusixmatchMacroQuery(params, token, options?.timeout);
    }

    if (!res || res.message?.header?.status_code !== 200) {
      return null;
    }

    const macroCalls = res.message?.body?.macro_calls;
    if (!macroCalls) return null;

    const response: MusixmatchLyricsResponse = {};

    // 1. Extract Track Metadata
    const matcherTrack = macroCalls['matcher.track.get']?.message?.body?.track;
    if (matcherTrack) {
      response.track = {
        trackId: matcherTrack.track_id,
        trackName: matcherTrack.track_name,
        artistName: matcherTrack.artist_name,
        albumName: matcherTrack.album_name,
        hasRichsync: matcherTrack.has_richsync,
        hasSubtitles: matcherTrack.has_subtitles,
        hasLyrics: matcherTrack.has_lyrics,
        instrumental: matcherTrack.instrumental,
      };
    }

    const metadata = { title: title || response.track?.trackName, artist: artist || response.track?.artistName };

    // 2. Extract Word-by-Word (RichSync) Lyrics
    const richsyncCall = macroCalls['track.richsync.get'];
    if (richsyncCall?.message?.header?.status_code === 200) {
      const richsyncBody = richsyncCall.message?.body?.richsync?.richsync_body;
      if (richsyncBody && !isPlaceholderLyricText(richsyncBody, metadata)) {
        response.richsync = richsyncBody;
      }
    }

    // 3. Extract Line-by-Line (Subtitles LRC) Lyrics
    const subtitlesCall = macroCalls['track.subtitles.get'];
    if (subtitlesCall?.message?.header?.status_code === 200) {
      const subtitleList = subtitlesCall.message?.body?.subtitle_list;
      const subtitleBody = subtitleList?.[0]?.subtitle?.subtitle_body;
      if (subtitleBody && !isPlaceholderLyricText(subtitleBody, metadata)) {
        response.subtitles = subtitleBody;
      }
    }

    // 4. Extract Plain Lyrics
    const lyricsCall = macroCalls['track.lyrics.get'];
    if (lyricsCall?.message?.header?.status_code === 200) {
      const lyricsBody = lyricsCall.message?.body?.lyrics?.lyrics_body;
      if (lyricsBody && !isPlaceholderLyricText(lyricsBody, metadata)) {
        response.plainLyrics = lyricsBody;
      }
    }

    if (!response.richsync && !response.subtitles && !response.plainLyrics) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

interface MusixmatchMacroApiResponse {
  message?: {
    header?: {
      status_code?: number;
      hint?: string;
    };
    body?: {
      macro_calls?: {
        'matcher.track.get'?: {
          message?: {
            header?: { status_code?: number };
            body?: {
              track?: {
                track_id?: number;
                track_name?: string;
                artist_name?: string;
                album_name?: string;
                has_richsync?: number;
                has_subtitles?: number;
                has_lyrics?: number;
                instrumental?: number;
              };
            };
          };
        };
        'track.richsync.get'?: {
          message?: {
            header?: { status_code?: number };
            body?: {
              richsync?: {
                richsync_body?: string;
              };
            };
          };
        };
        'track.subtitles.get'?: {
          message?: {
            header?: { status_code?: number };
            body?: {
              subtitle_list?: Array<{
                subtitle?: {
                  subtitle_body?: string;
                };
              }>;
            };
          };
        };
        'track.lyrics.get'?: {
          message?: {
            header?: { status_code?: number };
            body?: {
              lyrics?: {
                lyrics_body?: string;
              };
            };
          };
        };
      };
    };
  };
}

async function executeMusixmatchMacroQuery(
  params: MusixmatchLyricsQueryParams,
  token: string,
  timeout = 8000
): Promise<MusixmatchMacroApiResponse | null> {
  const url = new URL('https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get');
  url.searchParams.set('namespace', 'lyrics_richsynched');
  url.searchParams.set('optional_calls', 'track.richsync');
  url.searchParams.set('subtitle_format', 'lrc');
  url.searchParams.set('f_subtitle_length_max_deviation', '40');
  url.searchParams.set('usertoken', token);
  url.searchParams.set('app_id', 'web-desktop-app-v1.0');
  url.searchParams.set('format', 'json');
  url.searchParams.set('t', generateRandomId());

  // Priority 1: Exact Spotify ID
  if (params.spotifyId?.trim()) {
    url.searchParams.set('track_spotify_id', params.spotifyId.trim());
  }
  // Priority 2: Exact ISRC
  else if (params.isrc?.trim()) {
    url.searchParams.set('track_isrc', params.isrc.trim());
  }
  // Priority 3: Exact Apple Music / iTunes ID
  else if (params.appleMusicId?.trim()) {
    url.searchParams.set('track_itunes_id', params.appleMusicId.trim());
  }
  // Priority 4: Musixmatch ID
  else if (params.musixmatchId?.trim()) {
    url.searchParams.set('track_id', params.musixmatchId.trim());
  }
  // Priority 5: Fallback text search
  else if (params.title?.trim()) {
    url.searchParams.set('q_track', params.title.trim());
    const artist = params.artist?.trim() || params.artists?.[0]?.trim();
    if (artist) {
      url.searchParams.set('q_artist', artist);
    }
    if (params.durationMs && params.durationMs > 0) {
      const durSec = Math.round(params.durationMs / 1000);
      url.searchParams.set('q_duration', String(durSec));
      url.searchParams.set('f_subtitle_length', String(durSec));
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        authority: 'apic-desktop.musixmatch.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok && res.status !== 401) {
      return null;
    }

    return (await res.json()) as MusixmatchMacroApiResponse;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}
