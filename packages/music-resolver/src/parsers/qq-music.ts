import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { cleanSearchQuery, normalizeSongTitle } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';

export const QQ_MUSIC_LINK_REGEX =
  /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(?:y\.qq\.com|qqmusic\.qq\.com|qqmusic\.com|i\.y\.qq\.com|c\.y\.qq\.com)(?:\/.*)?/i;

interface FcgPlaySingleSongResponse {
  code: number;
  data?: Array<{
    id: number;
    mid: string;
    name?: string;
    title?: string;
    interval?: number;
    singer?: Array<{ id: number; mid: string; name: string; title?: string }>;
    album?: { id: number; mid: string; name: string; title?: string };
  }>;
}

interface FcgAlbumInfoResponse {
  code: number;
  data?: {
    id?: number;
    mid?: string;
    name?: string;
    singername?: string;
    singermid?: string;
    total?: number;
  };
}

export class QQMusicParser implements MusicParser {
  readonly id = 'qqMusic';
  readonly name = 'QQ Music';

  match(url: string): boolean {
    return (
      QQ_MUSIC_LINK_REGEX.test(url) ||
      url.includes('y.qq.com') ||
      url.includes('qqmusic.qq.com') ||
      url.includes('i.y.qq.com') ||
      url.includes('c.y.qq.com')
    );
  }

  parse(url: string): { id: string; type?: MetadataType } {
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(url);
    } catch {
      try {
        parsedUrl = new URL(`https://${url}`);
      } catch {
        // Fallback
      }
    }

    if (parsedUrl) {
      // 1. Check query parameters (e.g. mobile share / play links)
      const songmid = parsedUrl.searchParams.get('songmid');
      if (songmid) return { id: songmid, type: 'song' };

      const songid = parsedUrl.searchParams.get('songid');
      if (songid) return { id: songid, type: 'song' };

      const albummid = parsedUrl.searchParams.get('albummid');
      if (albummid) return { id: albummid, type: 'album' };

      const albumid = parsedUrl.searchParams.get('albumid');
      if (albumid) return { id: albumid, type: 'album' };

      const disstid = parsedUrl.searchParams.get('disstid') || parsedUrl.searchParams.get('id');
      if (parsedUrl.pathname.includes('playlist') || parsedUrl.pathname.includes('playsquare')) {
        if (disstid) return { id: disstid, type: 'playlist' };
      }

      // 2. Check path pattern matches
      // Songs: /n/ryqq/songDetail/:id or /n/yqq/song/:id.html
      const songMatch = parsedUrl.pathname.match(/\/(?:songDetail|song)\/([a-zA-Z0-9]+)(?:\.html)?/i);
      if (songMatch && songMatch[1]) {
        return { id: songMatch[1], type: 'song' };
      }

      // Albums: /n/ryqq/albumDetail/:id or /n/yqq/album/:id.html
      const albumMatch = parsedUrl.pathname.match(/\/(?:albumDetail|album)\/([a-zA-Z0-9]+)(?:\.html)?/i);
      if (albumMatch && albumMatch[1]) {
        return { id: albumMatch[1], type: 'album' };
      }

      // Singers: /n/ryqq/singer/:id or /n/yqq/singer/:id.html
      const singerMatch = parsedUrl.pathname.match(/\/(?:singer|singerDetail)\/([a-zA-Z0-9]+)(?:\.html)?/i);
      if (singerMatch && singerMatch[1]) {
        return { id: singerMatch[1], type: 'artist' };
      }

      // Playlists: /n/ryqq/playlist/:id or /n/ryqq/playsquare/:id
      const playlistMatch = parsedUrl.pathname.match(/\/(?:playlist|playsquare)\/([a-zA-Z0-9]+)(?:\.html)?/i);
      if (playlistMatch && playlistMatch[1]) {
        return { id: playlistMatch[1], type: 'playlist' };
      }

      // If id is in the last path segment
      const lastSegment = parsedUrl.pathname.split('/').filter(Boolean).pop()?.replace(/\.html$/i, '');
      if (lastSegment && /^[a-zA-Z0-9]+$/.test(lastSegment)) {
        return { id: lastSegment, type: 'song' };
      }
    }

    return { id: '', type: 'song' };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const parsed = this.parse(url);
    const itemType = parsed.type || 'song';

    // 1. Fetch song detail
    if (itemType === 'song' && id) {
      try {
        const isNumeric = /^\d+$/.test(id);
        const queryParam = isNumeric ? `songid=${encodeURIComponent(id)}` : `songmid=${encodeURIComponent(id)}`;
        const endpoint = `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${queryParam}&format=json`;

        let res = await HttpClient.get<FcgPlaySingleSongResponse>(endpoint, {
          headers: {
            Referer: 'https://y.qq.com',
            ...options?.customHeaders,
          },
          timeout: options?.timeout,
          retries: options?.retries,
        });

        if (typeof res === 'string') {
          try {
            res = JSON.parse((res as string).trim()) as FcgPlaySingleSongResponse;
          } catch {
            // invalid json
          }
        }

        if (res?.code === 0 && res.data?.[0]) {
          const song = res.data[0];
          const rawTitle = song.name || song.title || '';
          const normalized = normalizeSongTitle(rawTitle);
          const singers: string[] = song.singer
            ? song.singer.map((s) => s.name || s.title || '').filter((name): name is string => Boolean(name))
            : [];
          const artist = singers.join(', ') || undefined;
          const album = song.album?.name || song.album?.title;
          const albumMid = song.album?.mid;
          const image = albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            : undefined;
          const durationMs = song.interval ? song.interval * 1000 : undefined;

          return {
            id: song.mid || id,
            title: rawTitle.trim(),
            cleanTitle: normalized.cleanTitle,
            artist,
            artists: singers.length > 0 ? singers : undefined,
            extraArtists: normalized.extraArtists,
            album,
            type: itemType,
            image,
            durationMs,
          };
        }
      } catch {
        // Fallback below
      }
    }

    // 2. Fetch album detail
    if (itemType === 'album' && id) {
      try {
        const isNumeric = /^\d+$/.test(id);
        const queryParam = isNumeric ? `albumid=${encodeURIComponent(id)}` : `albummid=${encodeURIComponent(id)}`;
        const endpoint = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?${queryParam}&format=json`;

        let res = await HttpClient.get<FcgAlbumInfoResponse>(endpoint, {
          headers: {
            Referer: 'https://y.qq.com',
            ...options?.customHeaders,
          },
          timeout: options?.timeout,
          retries: options?.retries,
        });

        if (typeof res === 'string') {
          try {
            res = JSON.parse((res as string).trim()) as FcgAlbumInfoResponse;
          } catch {
            // invalid json
          }
        }

        if (res?.code === 0 && res.data) {
          const album = res.data;
          const title = album.name || '';
          const artist = album.singername;
          const albumMid = album.mid || id;
          const image = albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            : undefined;

          return {
            id: albumMid,
            title: title.trim(),
            artist,
            type: itemType,
            image,
          };
        }
      } catch {
        // Fallback below
      }
    }

    // 3. Fallback to OpenGraph HTML Scraping
    try {
      const html = await HttpClient.get<string>(url, {
        headers: {
          Referer: 'https://y.qq.com',
          ...options?.customHeaders,
        },
        timeout: options?.timeout,
        retries: options?.retries,
      });

      const doc = getCheerioDoc(html);
      const rawTitle = metaTagContent(doc, 'og:title') || '';
      const description = metaTagContent(doc, 'og:description') || '';
      const image = metaTagContent(doc, 'og:image');

      if (rawTitle) {
        const cleaned = rawTitle.replace(/\s*-\s*QQ音乐.*$/i, '').trim();
        const normalized = normalizeSongTitle(cleaned);
        const artist = description.split(' - ')?.[1]?.trim();

        return {
          id: id || 'unknown',
          title: cleaned,
          cleanTitle: normalized.cleanTitle,
          artist,
          extraArtists: normalized.extraArtists,
          type: itemType,
          image,
        };
      }
    } catch {
      // Fallback
    }

    return {
      id: id || 'unknown',
      title: `QQ Music Item ${id}`,
      type: itemType,
    };
  }

  buildSearchQuery(metadata: TrackMetadata): string {
    const title = metadata.cleanTitle || normalizeSongTitle(metadata.title).cleanTitle;
    const artist = metadata.artist;
    const raw = artist ? `${title} ${artist}` : title;
    return cleanSearchQuery(raw);
  }
}

