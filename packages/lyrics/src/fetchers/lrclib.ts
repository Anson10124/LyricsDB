export interface LrclibLyricsResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

export interface LrclibQueryParams {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
}

export async function fetchLrclibLyrics(
  params: LrclibQueryParams,
  options?: { timeout?: number }
): Promise<LrclibLyricsResponse | null> {
  try {
    const url = new URL('https://lrclib.net/api/get');
    if (params.isrc) {
      url.searchParams.set('isrc', params.isrc);
    }
    url.searchParams.set('track_name', params.title);
    if (params.artist) {
      url.searchParams.set('artist_name', params.artist);
    }
    if (params.album) {
      url.searchParams.set('album_name', params.album);
    }
    if (params.durationMs) {
      url.searchParams.set('duration', Math.round(params.durationMs / 1000).toString());
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'LyricsDB/1.0 (https://github.com/lyricsdb)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    return (await res.json()) as LrclibLyricsResponse;
  } catch {
    return null;
  }
}
