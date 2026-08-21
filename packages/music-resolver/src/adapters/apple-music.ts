import type {
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from "../types.js";
import { HttpClient } from "../utils/http.js";
import { findBestMatch } from "../utils/string-similarity.js";

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
  trackTimeMillis?: number;
  isrc?: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesSearchResultItem[];
}

const ITUNES_SEARCH_ENTITIES: Record<string, string> = {
  song: "song",
  album: "album",
  artist: "musicArtist",
  playlist: "song",
};

function cleanAppleUrl(url?: string): string {
  if (!url) return "";
  return url.replace(/[?&]uo=\d+/i, "");
}

export class AppleMusicAdapter implements MusicAdapter {
  readonly id = "appleMusic";
  readonly name = "Apple Music";

  private apiUrl: string;
  private country: string;

  constructor(options?: { apiUrl?: string; country?: string }) {
    this.apiUrl = options?.apiUrl || "https://itunes.apple.com/search";
    this.country = options?.country || "us";
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<ResolvedLink | null> {
    try {
      const searchCountry = options?.preferredCountry || this.country;
      const entity = ITUNES_SEARCH_ENTITIES[metadata.type] || "song";

      const executeSearch = async (term: string) => {
        const params = new URLSearchParams({
          term,
          media: "music",
          entity,
          limit: "15",
          country: searchCountry,
        });

        const url = `${this.apiUrl}?${params.toString()}`;
        let res = await HttpClient.get<ITunesSearchResponse>(url, {
          timeout: options?.timeout,
          retries: options?.retries,
        });

        if (typeof res === "string") {
          try {
            res = JSON.parse((res as string).trim());
          } catch {
            // invalid json
          }
        }
        return res;
      };

      let response: ITunesSearchResponse | null = null;

      // 1. Try ISRC lookup if available
      if (metadata.type === "song" && metadata.isrc) {
        try {
          const isrcRes = await executeSearch(metadata.isrc.trim());
          if (isrcRes && isrcRes.results && isrcRes.results.length > 0) {
            response = isrcRes;
          }
        } catch {
          // Fallback to keyword search
        }
      }

      // 2. Regular keyword search if ISRC was not found
      if (!response || !response.results || response.results.length === 0) {
        response = await executeSearch(query);
      }

      if (!response || !response.results || response.results.length === 0) {
        return null;
      }

      const candidates: MatchCandidate[] = [];

      for (const item of response.results) {
        if (metadata.type === "album") {
          const itemUrl = cleanAppleUrl(item.collectionViewUrl);
          const itemId = item.collectionId
            ? String(item.collectionId)
            : undefined;
          const itemTitle =
            item.collectionName || item.collectionCensoredName || "";
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              artist: item.artistName,
              album: item.collectionName,
              url: itemUrl,
              id: itemId,
            });
          }
        } else if (metadata.type === "artist") {
          const itemUrl = cleanAppleUrl(
            item.artistLinkUrl || item.artistViewUrl,
          );
          const itemId = item.artistId ? String(item.artistId) : undefined;
          const itemTitle = item.artistName || "";
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              url: itemUrl,
              id: itemId,
            });
          }
        } else {
          // Default: song / track
          const itemUrl = cleanAppleUrl(
            item.trackViewUrl || item.collectionViewUrl,
          );
          const itemId = item.trackId
            ? String(item.trackId)
            : item.collectionId
              ? String(item.collectionId)
              : undefined;
          const itemTitle =
            item.trackName ||
            item.trackCensoredName ||
            item.collectionName ||
            "";
          if (itemUrl) {
            candidates.push({
              title: itemTitle,
              artist: item.artistName,
              album: item.collectionName,
              durationMs: item.trackTimeMillis,
              isrc: item.isrc,
              url: itemUrl,
              id: itemId,
              raw: { album: item.collectionName, isrc: item.isrc },
            });
          }
        }
      }

      if (candidates.length === 0) return null;

      const { bestMatch } = findBestMatch(candidates, metadata, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }
}
