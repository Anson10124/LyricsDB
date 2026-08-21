import type {
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from "../types.js";
import { HttpClient } from "../utils/http.js";
import { findBestMatch } from "../utils/string-similarity.js";

interface DeezerSearchResponse {
  total: number;
  data: Array<{
    id: number;
    title?: string;
    title_short?: string;
    name?: string;
    link: string;
    duration?: number; // seconds
    artist?: { name: string };
    album?: { title: string };
    isrc?: string;
  }>;
}

interface DeezerTrackLookupResponse {
  id?: number;
  title?: string;
  link?: string;
  duration?: number;
  isrc?: string;
  artist?: { name: string };
  album?: { title: string };
  error?: { type: string; message: string; code: number };
}

const DEEZER_SEARCH_TYPES: Record<string, string> = {
  song: "track",
  album: "album",
  playlist: "playlist",
  artist: "artist",
};

export class DeezerAdapter implements MusicAdapter {
  readonly id = "deezer";
  readonly name = "Deezer";

  private apiUrl: string;

  constructor(options?: { apiUrl?: string }) {
    this.apiUrl = options?.apiUrl || "https://api.deezer.com";
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<ResolvedLink | null> {
    try {
      // 1. Direct ISRC Match (if ISRC is available and resolving a song)
      if (metadata.type === "song" && metadata.isrc) {
        try {
          const isrcUrl = `${this.apiUrl}/track/isrc:${encodeURIComponent(metadata.isrc.trim())}`;
          const isrcRes = await HttpClient.get<DeezerTrackLookupResponse>(
            isrcUrl,
            {
              timeout: options?.timeout,
              retries: options?.retries,
            },
          );

          if (isrcRes && isrcRes.id && isrcRes.link && !isrcRes.error) {
            return {
              platform: this.id,
              url: isrcRes.link,
              id: String(isrcRes.id),
              isVerified: true,
              score: 1.0,
              matchReason: "isrc",
              raw: { album: isrcRes.album?.title, isrc: isrcRes.isrc },
            };
          }
        } catch {
          // Fall back to keyword search
        }
      }

      // 2. Keyword Search across Deezer catalog
      const searchType = DEEZER_SEARCH_TYPES[metadata.type] || "track";
      const params = new URLSearchParams({
        q: query,
        limit: "15",
      });

      const url = `${this.apiUrl}/search/${searchType}?${params.toString()}`;
      const response = await HttpClient.get<DeezerSearchResponse>(url, {
        timeout: options?.timeout,
        retries: options?.retries,
      });

      if (!response || !response.data || response.data.length === 0) {
        return null;
      }

      const candidates: MatchCandidate[] = response.data.map((item) => ({
        title: item.title || item.title_short || item.name || "",
        artist: item.artist?.name,
        album: item.album?.title,
        durationMs: item.duration ? item.duration * 1000 : undefined,
        isrc: item.isrc,
        url: item.link,
        id: String(item.id),
        raw: { album: item.album?.title, isrc: item.isrc },
      }));

      const { bestMatch } = findBestMatch(candidates, metadata, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }
}
