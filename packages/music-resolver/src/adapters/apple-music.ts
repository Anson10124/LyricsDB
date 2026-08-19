import type {
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from '../types.js';
import { HttpClient } from '../utils/http.js';
import { findBestMatch } from '../utils/string-similarity.js';

interface ITunesSearchResultItem {
  wrapperType?: string;
  kind?: string;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  collectionCensoredName?: string;
  trackCensoredName?: string;
  trackId?: number;
  collectionId?: number;
  artistId?: number;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  artistViewUrl?: string;
  artistLinkUrl?: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesSearchResultItem[];
}

const ITUNES_SEARCH_ENTITIES: Record<string, string> = {
  song: 'song',
  album: 'album',
  artist: 'musicArtist',
  playlist: 'song',
};

function cleanAppleUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/[?&]uo=\d+/i, '');
}

export class AppleMusicAdapter implements MusicAdapter {
  readonly id = 'appleMusic';
  readonly name = 'Apple Music';

  private apiUrl: string;
  private country: string;

  constructor(options?: { apiUrl?: string; country?: string }) {
    this.apiUrl = options?.apiUrl || 'https://itunes.apple.com/search';
    this.country = options?.country || 'us';
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      const entity = ITUNES_SEARCH_ENTITIES[metadata.type] || 'song';
      const params = new URLSearchParams({
        term: query,
        media: 'music',
        entity,
        limit: '5',
        country: this.country,
      });

      const url = `${this.apiUrl}?${params.toString()}`;
      let response = await HttpClient.get<ITunesSearchResponse>(url, {
        timeout: options?.timeout,
        retries: options?.retries,
      });

      if (typeof response === 'string') {
        try {
          response = JSON.parse((response as string).trim());
        } catch {
          // invalid json
        }
      }

      if (!response || !response.results || response.results.length === 0) {
        return null;
      }

      const candidates: MatchCandidate[] = [];

      for (const item of response.results) {
        if (metadata.type === 'album') {
          const itemUrl = cleanAppleUrl(item.collectionViewUrl);
          const itemId = item.collectionId ? String(item.collectionId) : undefined;
          const itemTitle = item.collectionName || item.collectionCensoredName || '';
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              artist: item.artistName,
              url: itemUrl,
              id: itemId,
            });
          }
        } else if (metadata.type === 'artist') {
          const itemUrl = cleanAppleUrl(item.artistLinkUrl || item.artistViewUrl);
          const itemId = item.artistId ? String(item.artistId) : undefined;
          const itemTitle = item.artistName || '';
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              url: itemUrl,
              id: itemId,
            });
          }
        } else {
          // Default: song / track
          const itemUrl = cleanAppleUrl(item.trackViewUrl || item.collectionViewUrl);
          const itemId = item.trackId ? String(item.trackId) : item.collectionId ? String(item.collectionId) : undefined;
          const itemTitle = item.trackName || item.trackCensoredName || item.collectionName || '';
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              artist: item.artistName,
              url: itemUrl,
              id: itemId,
            });
          }
        }
      }

      if (candidates.length === 0) return null;

      const { bestMatch } = findBestMatch(candidates, query, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }
}
