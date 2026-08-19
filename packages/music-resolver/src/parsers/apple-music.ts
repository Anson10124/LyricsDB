import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { cleanSearchQuery } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';

export const APPLE_MUSIC_LINK_REGEX =
  /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:music|itunes|geo|embed)\.apple\.com\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?(album|song|artist|playlist|station|music-video|curator|post)\/(?:([^/?#]+)\/)?(?:id)?([0-9a-zA-Z._-]+)(?:[?#].*)?$/i;

const APPLE_MUSIC_TYPE_MAP: Record<string, MetadataType> = {
  'music.song': 'song',
  'music.album': 'album',
  'music.playlist': 'playlist',
  'music.musician': 'artist',
  'music.episode': 'podcast',
};

interface ITunesLookupResponse {
  resultCount: number;
  results: Array<{
    wrapperType?: string;
    kind?: string;
    collectionType?: string;
    artistName?: string;
    collectionName?: string;
    trackName?: string;
    collectionCensoredName?: string;
    trackCensoredName?: string;
    trackId?: number;
    collectionId?: number;
    artistId?: number;
    artworkUrl100?: string;
    previewUrl?: string;
    trackTimeMillis?: number;
    isrc?: string;
  }>;
}

export class AppleMusicParser implements MusicParser {
  readonly id = 'appleMusic';
  readonly name = 'Apple Music';

  private lookupUrl: string;
  private defaultCountry: string;

  constructor(options?: { lookupUrl?: string; country?: string }) {
    this.lookupUrl = options?.lookupUrl || 'https://itunes.apple.com/lookup';
    this.defaultCountry = options?.country || 'us';
  }

  match(url: string): boolean {
    return (
      APPLE_MUSIC_LINK_REGEX.test(url) ||
      url.includes('music.apple.com') ||
      url.includes('itunes.apple.com')
    );
  }

  parse(url: string): { id: string; type?: MetadataType; storefront?: string } {
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(url);
    } catch {
      try {
        parsedUrl = new URL(`https://${url}`);
      } catch {
        // fallback
      }
    }

    // Check query params for song track ID in album URLs: ?i=123456
    const trackParam = parsedUrl?.searchParams.get('i') || parsedUrl?.searchParams.get('track');

    const match = url.match(APPLE_MUSIC_LINK_REGEX);
    const storefront = match?.[1] || undefined;
    const rawType = match?.[2]?.toLowerCase();
    const matchedId = match?.[4] || '';

    let type: MetadataType = 'song';
    let id = matchedId;

    if (rawType === 'album') {
      if (trackParam) {
        type = 'song';
        id = trackParam;
      } else {
        type = 'album';
      }
    } else if (rawType === 'song' || rawType === 'music-video') {
      type = 'song';
      if (trackParam) id = trackParam;
    } else if (rawType === 'artist' || rawType === 'curator') {
      type = 'artist';
    } else if (rawType === 'playlist') {
      type = 'playlist';
    } else if (rawType === 'station' || rawType === 'post') {
      type = 'show';
    }

    // Strip leading 'id' if present in numeric IDs
    id = id.replace(/^id/i, '');

    return { id, type, storefront };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const { type: parsedType, storefront } = this.parse(url);
    const itemType = parsedType || 'song';
    const country = storefront || this.defaultCountry;

    // 1. Try iTunes Lookup API if the ID is numeric (iTunes store IDs are numeric)
    if (/^\d+$/.test(id)) {
      try {
        const lookupApiUrl = `${this.lookupUrl}?id=${encodeURIComponent(id)}&country=${encodeURIComponent(country)}`;
        let res = await HttpClient.get<ITunesLookupResponse>(lookupApiUrl, {
          timeout: options?.timeout,
          retries: options?.retries,
        });

        if (typeof res === 'string') {
          try {
            res = JSON.parse((res as string).trim());
          } catch {
            // invalid json
          }
        }

        if (res && res.resultCount > 0 && res.results[0]) {
          const item = res.results[0];
          const isTrack = item.wrapperType === 'track' || item.kind === 'song';
          const isAlbum = item.wrapperType === 'collection' || item.collectionType === 'Album';

          const title = (
            isTrack
              ? item.trackName || item.trackCensoredName
              : isAlbum
                ? item.collectionName || item.collectionCensoredName
                : item.artistName
          ) || '';

          const artist = item.artistName;
          const album = isTrack ? item.collectionName : undefined;
          const image = item.artworkUrl100
            ? item.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.')
            : undefined;
          const audio = item.previewUrl;
          const durationMs = item.trackTimeMillis;
          const isrc = item.isrc;

          return {
            id,
            title: title.trim(),
            artist,
            album,
            type: itemType,
            image,
            audio,
            durationMs,
            isrc,
          };
        }
      } catch {
        // Fallback to HTML OpenGraph scraping below
      }
    }

    // 2. Fallback to OpenGraph HTML Scraping (e.g. for playlists like pl.xxx or when lookup fails)
    try {
      const html = await HttpClient.get<string>(url, {
        timeout: options?.timeout,
        retries: options?.retries,
      });

      const doc = getCheerioDoc(html);
      const rawTitle = metaTagContent(doc, 'og:title') || '';
      const description = metaTagContent(doc, 'og:description') || '';
      const image = metaTagContent(doc, 'og:image');
      const audio = metaTagContent(doc, 'og:audio');
      const ogType = metaTagContent(doc, 'og:type') || '';

      const detectedType: MetadataType = APPLE_MUSIC_TYPE_MAP[ogType] || itemType;

      let title = rawTitle;
      let artist: string | undefined;

      // Clean Apple Music title suffix: e.g. "Song Title by Artist on Apple Music"
      const byMatch = rawTitle.match(/^(.*?)\s+by\s+(.*?)(?:\s+on\s+Apple\s+Music)?$/i);
      if (byMatch && byMatch[1] && byMatch[2]) {
        title = byMatch[1].trim();
        artist = byMatch[2].replace(/\s+on\s+Apple\s+Music$/i, '').trim();
      } else {
        title = rawTitle
          .replace(/\s+on\s+Apple\s+Music$/i, '')
          .replace(/\s*\|\s*Apple\s+Music$/i, '')
          .trim();
      }

      return {
        id,
        title: title || `Apple Music Item ${id}`,
        artist,
        description,
        type: detectedType,
        image,
        audio,
      };
    } catch {
      // Final fallback
      return {
        id,
        title: `Apple Music Item ${id}`,
        type: itemType,
      };
    }
  }

  buildSearchQuery(metadata: TrackMetadata): string {
    const title = metadata.title;
    const artist = metadata.artist;
    const raw = artist ? `${title} ${artist}` : title;
    return cleanSearchQuery(raw);
  }
}
