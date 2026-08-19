import type { MetadataType, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { cleanSearchQuery, normalizeSongTitle } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';
import { BaseMusicParser } from './base.js';

export const DEEZER_LINK_REGEX =
  /^https:\/\/www\.deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/(\d+)/;

const DEEZER_TYPE_MAP: Record<string, MetadataType> = {
  'music.song': 'song',
  'music.album': 'album',
  'music.playlist': 'playlist',
  'music.musician': 'artist',
};

interface DeezerApiTrack {
  id: number;
  title: string;
  title_short?: string;
  isrc?: string;
  duration?: number;
  artist?: { id: number; name: string };
  contributors?: Array<{ id: number; name: string; role?: string }>;
  album?: { id: number; title: string; cover_big?: string; cover_xl?: string };
  preview?: string;
  error?: { type: string; message: string; code: number };
}

interface DeezerApiAlbum {
  id: number;
  title: string;
  artist?: { name: string };
  cover_big?: string;
  cover_xl?: string;
  error?: { type: string; message: string; code: number };
}

interface DeezerApiArtist {
  id: number;
  name: string;
  picture_big?: string;
  picture_xl?: string;
  error?: { type: string; message: string; code: number };
}

interface DeezerApiPlaylist {
  id: number;
  title: string;
  picture_big?: string;
  creator?: { name: string };
  error?: { type: string; message: string; code: number };
}

export class DeezerParser extends BaseMusicParser {
  readonly id = 'deezer';
  readonly name = 'Deezer';

  match(url: string): boolean {
    return DEEZER_LINK_REGEX.test(url) || url.includes('deezer.com');
  }

  parse(url: string): { id: string; type?: MetadataType } {
    const match = url.match(DEEZER_LINK_REGEX);
    const id = match?.[2] || url.split('/').pop()?.split('?')[0] || '';
    const rawType = match?.[1];
    let type: MetadataType | undefined;
    if (rawType === 'track') type = 'song';
    else if (rawType === 'album') type = 'album';
    else if (rawType === 'playlist') type = 'playlist';
    else if (rawType === 'artist') type = 'artist';
    else if (rawType === 'episode') type = 'podcast';
    else if (rawType === 'show') type = 'show';

    return { id, type };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const parsed = this.parse(url);
    const itemType = parsed.type || 'song';

    // 1. Try official Deezer Public API
    if (/^\d+$/.test(id)) {
      try {
        const apiPath = itemType === 'song' ? 'track' : itemType;
        const apiUrl = `https://api.deezer.com/${apiPath}/${id}`;
        
        if (itemType === 'song') {
          const track = await HttpClient.get<DeezerApiTrack>(apiUrl, {
            timeout: options?.timeout,
            retries: options?.retries,
          });

          if (track && track.id && !track.error) {
            const rawTitle = track.title || track.title_short || '';
            const normalized = normalizeSongTitle(rawTitle);
            const artists: string[] = [];
            if (track.contributors && track.contributors.length > 0) {
              artists.push(...track.contributors.map((c) => c.name));
            } else if (track.artist?.name) {
              artists.push(track.artist.name);
            }

            return {
              id: String(track.id),
              title: rawTitle,
              cleanTitle: normalized.cleanTitle,
              artist: track.artist?.name || artists[0],
              artists: artists.length > 0 ? artists : undefined,
              extraArtists: normalized.extraArtists,
              album: track.album?.title,
              type: 'song',
              image: track.album?.cover_xl || track.album?.cover_big,
              audio: track.preview,
              durationMs: track.duration ? track.duration * 1000 : undefined,
              isrc: track.isrc,
            };
          }
        } else if (itemType === 'album') {
          const album = await HttpClient.get<DeezerApiAlbum>(apiUrl, {
            timeout: options?.timeout,
            retries: options?.retries,
          });

          if (album && album.id && !album.error) {
            return {
              id: String(album.id),
              title: album.title,
              artist: album.artist?.name,
              type: 'album',
              image: album.cover_xl || album.cover_big,
            };
          }
        } else if (itemType === 'artist') {
          const artist = await HttpClient.get<DeezerApiArtist>(apiUrl, {
            timeout: options?.timeout,
            retries: options?.retries,
          });

          if (artist && artist.id && !artist.error) {
            return {
              id: String(artist.id),
              title: artist.name,
              type: 'artist',
              image: artist.picture_xl || artist.picture_big,
            };
          }
        } else if (itemType === 'playlist') {
          const playlist = await HttpClient.get<DeezerApiPlaylist>(apiUrl, {
            timeout: options?.timeout,
            retries: options?.retries,
          });

          if (playlist && playlist.id && !playlist.error) {
            return {
              id: String(playlist.id),
              title: playlist.title,
              artist: playlist.creator?.name,
              type: 'playlist',
              image: playlist.picture_big,
            };
          }
        }
      } catch {
        // Fallback to HTML OpenGraph scraping below
      }
    }

    // 2. Fallback to HTML OpenGraph scraping
    const html = await HttpClient.get<string>(url, {
      timeout: options?.timeout,
      retries: options?.retries,
    });

    const doc = getCheerioDoc(html);
    const title = metaTagContent(doc, 'og:title') || '';
    const description = metaTagContent(doc, 'og:description') || '';
    const image = metaTagContent(doc, 'og:image');
    const audio = metaTagContent(doc, 'og:audio');
    const ogType = metaTagContent(doc, 'og:type') || '';

    const type: MetadataType = DEEZER_TYPE_MAP[ogType] || itemType;
    const artist = description.match(/^([^ -]+(?: [^ -]+)*)/)?.[1]?.trim();
    const normalized = normalizeSongTitle(title);

    return {
      id,
      title: title.trim(),
      cleanTitle: normalized.cleanTitle,
      artist,
      extraArtists: normalized.extraArtists,
      description,
      type,
      image,
      audio,
    };
  }

  override buildSearchQuery(metadata: TrackMetadata): string {
    const baseQuery = super.buildSearchQuery(metadata);
    return metadata.type === 'playlist' ? `${baseQuery} playlist` : baseQuery;
  }
}

