import type { MatchCandidate, MusicAdapter, ResolveOptions, ResolvedLink, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { findBestMatch } from '../utils/string-similarity.js';

interface DeezerSearchResponse {
  total: number;
  data: Array<{
    id: number;
    title?: string;
    name?: string;
    link: string;
    artist?: { name: string };
  }>;
}

const DEEZER_SEARCH_TYPES: Record<string, string> = {
  song: 'track',
  album: 'album',
  playlist: 'playlist',
  artist: 'artist',
};

export class DeezerAdapter implements MusicAdapter {
  readonly id = 'deezer';
  readonly name = 'Deezer';

  private apiUrl: string;

  constructor(options?: { apiUrl?: string }) {
    this.apiUrl = options?.apiUrl || 'https://api.deezer.com/search';
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      const searchType = DEEZER_SEARCH_TYPES[metadata.type] || 'track';
      const params = new URLSearchParams({
        q: query,
        limit: '5',
      });

      const url = `${this.apiUrl}/${searchType}?${params.toString()}`;
      const response = await HttpClient.get<DeezerSearchResponse>(url, {
        timeout: options?.timeout,
        retries: options?.retries,
      });

      if (!response || !response.data || response.data.length === 0) {
        return null;
      }

      const candidates: MatchCandidate[] = response.data.map((item) => ({
        title: item.title || item.name || '',
        artist: item.artist?.name,
        url: item.link,
        id: String(item.id),
      }));

      const { bestMatch } = findBestMatch(candidates, query, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }
}
