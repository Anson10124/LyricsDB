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
  artworkUrl100?: string;
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

// The search API returns 100px covers; the same path serves any size
function largerArtwork(url?: string): string | undefined {
  return url?.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, "/400x400bb.$2") || undefined;
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
      let response: ITunesSearchResponse | null = null;

      // 1. Try ISRC lookup if available
      if (metadata.type === "song" && metadata.isrc) {
        try {
          const isrcRes = await this.fetchResults(metadata.isrc.trim(), metadata, options);
          if (isrcRes && isrcRes.results && isrcRes.results.length > 0) {
            response = isrcRes;
          }
        } catch {
          // Fallback to keyword search
        }
      }

      // 2. Regular keyword search if ISRC was not found
      if (!response || !response.results || response.results.length === 0) {
        response = await this.fetchResults(query, metadata, options);
      }

      if (!response || !response.results || response.results.length === 0) {
        return null;
      }

      const candidates = this.toCandidates(response.results, metadata);
      if (candidates.length === 0) return null;

      const { bestMatch } = findBestMatch(candidates, metadata, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }

  async searchCandidates(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<MatchCandidate[]> {
    const candidates: MatchCandidate[] = [];
    if (metadata.type === "song" && metadata.isrc) {
      try {
        const isrcRes = await this.fetchResults(metadata.isrc.trim(), metadata, options);
        candidates.push(...this.toCandidates(isrcRes?.results ?? [], metadata));
      } catch {
        // The keyword search below still runs
      }
    }
    const response = await this.fetchResults(query, metadata, options);
    if (!response || !Array.isArray(response.results)) {
      throw new Error("Apple Music returned an unreadable search response");
    }
    candidates.push(...this.toCandidates(response.results, metadata));
    return candidates;
  }

  private async fetchResults(
    term: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<ITunesSearchResponse | null> {
    const params = new URLSearchParams({
      term,
      media: "music",
      entity: ITUNES_SEARCH_ENTITIES[metadata.type] || "song",
      limit: "15",
      country: options?.preferredCountry || this.country,
    });

    const url = `${this.apiUrl}?${params.toString()}`;
    let res = await HttpClient.get<ITunesSearchResponse>(url, {
      timeout: options?.timeout,
      retries: options?.retries,
      priority: options?.priority,
    });

    if (typeof res === "string") {
      try {
        res = JSON.parse((res as string).trim());
      } catch {
        // invalid json
      }
    }
    return res;
  }

  private toCandidates(
    results: ITunesSearchResultItem[],
    metadata: TrackMetadata,
  ): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];

    for (const item of results) {
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
            artworkUrl: largerArtwork(item.artworkUrl100),
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
            artworkUrl: largerArtwork(item.artworkUrl100),
            raw: { album: item.collectionName, isrc: item.isrc },
          });
        }
      }
    }

    return candidates;
  }
}
