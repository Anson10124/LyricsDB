import type {
  DeezerSearchResponse,
  DeezerTrackLookupResponse,
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from "@repo/types";
import { HttpClient } from "../utils/http.js";
import { findBestMatch } from "../utils/string-similarity.js";


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
          const isrcRes = await this.lookupIsrc(metadata.isrc, options);
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
      const candidates = await this.keywordCandidates(query, metadata, options);
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
        const item = await this.lookupIsrc(metadata.isrc, options);
        if (item && item.id && item.link && !item.error) {
          candidates.push(this.toCandidate(item));
        }
      } catch {
        // The keyword search below still runs
      }
    }
    candidates.push(...(await this.keywordCandidates(query, metadata, options)));
    return candidates;
  }

  private lookupIsrc(
    isrc: string,
    options?: ResolveOptions,
  ): Promise<DeezerTrackLookupResponse> {
    const isrcUrl = `${this.apiUrl}/track/isrc:${encodeURIComponent(isrc.trim())}`;
    return HttpClient.get<DeezerTrackLookupResponse>(isrcUrl, {
      timeout: options?.timeout,
      retries: options?.retries,
      priority: options?.priority,
    });
  }

  private async keywordCandidates(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<MatchCandidate[]> {
    const searchType = DEEZER_SEARCH_TYPES[metadata.type] || "track";
    const params = new URLSearchParams({
      q: query,
      limit: "15",
    });

    const url = `${this.apiUrl}/search/${searchType}?${params.toString()}`;
    const response = await HttpClient.get<DeezerSearchResponse>(url, {
      timeout: options?.timeout,
      retries: options?.retries,
      priority: options?.priority,
    });

    return (response?.data ?? []).map((item) => this.toCandidate(item));
  }

  private toCandidate(
    item: DeezerTrackLookupResponse | DeezerSearchResponse["data"][number],
  ): MatchCandidate {
    const named = item as { title?: string; title_short?: string; name?: string };
    return {
      title: named.title || named.title_short || named.name || "",
      artist: item.artist?.name,
      album: item.album?.title,
      durationMs: item.duration ? item.duration * 1000 : undefined,
      isrc: item.isrc,
      url: item.link ?? "",
      id: String(item.id),
      artworkUrl: item.album?.cover_medium || item.album?.cover_big || undefined,
      raw: { album: item.album?.title, isrc: item.isrc },
    };
  }
}
