import type {
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from "../types.js";
import { HttpClient } from "../utils/http.js";
import { findBestMatch } from "../utils/string-similarity.js";
import {
  DEFAULT_SPOTIFY_SECRET,
  DEFAULT_SPOTIFY_VERSION,
  requestSpotifyTokenWithSecret,
  scrapeSpotifySecrets,
} from "../utils/totp.js";

interface SpotifyArtistProfile {
  name: string;
}

interface SpotifyArtistItem {
  uri?: string;
  profile?: SpotifyArtistProfile;
  name?: string;
}

interface SpotifyCoverArt {
  sources?: Array<{ url?: string; width?: number | null }>;
}

interface SpotifyTrackItem {
  uri: string;
  id?: string;
  name: string;
  duration?: { totalMilliseconds?: number };
  album?: { name: string; uri?: string; id?: string; coverArt?: SpotifyCoverArt };
  albumOfTrack?: { name?: string; coverArt?: SpotifyCoverArt };
  artists?: { items: SpotifyArtistItem[] };
}

interface SpotifyAlbumItem {
  uri: string;
  id?: string;
  name: string;
  artists?: { items: SpotifyArtistItem[] };
}

interface SpotifyArtistData {
  uri: string;
  id?: string;
  profile?: { name: string };
  name?: string;
}

interface SpotifyPlaylistItem {
  uri: string;
  id?: string;
  name: string;
  owner?: { name: string };
}

interface SpotifyTopResultItem {
  uri: string;
  id?: string;
  name: string;
  artists?: { items: SpotifyArtistItem[] };
  album?: { name: string; coverArt?: SpotifyCoverArt };
  albumOfTrack?: { name?: string; coverArt?: SpotifyCoverArt };
  duration?: { totalMilliseconds?: number };
  profile?: { name: string };
}

interface SpotifySearchResponse {
  data?: {
    search?: {
      tracks?: { items: Array<{ track: SpotifyTrackItem }> };
      albums?: { items: SpotifyAlbumItem[] };
      artists?: { items: SpotifyArtistData[] };
      playlists?: { items: SpotifyPlaylistItem[] };
      topResults?: { items: SpotifyTopResultItem[] };
    };
    searchV2?: {
      tracks?: { items: Array<{ track: SpotifyTrackItem }> };
      albums?: { items: SpotifyAlbumItem[] };
      artists?: { items: Array<{ data: SpotifyArtistData }> };
      playlists?: { items: Array<{ data: SpotifyPlaylistItem }> };
    };
  };
}

const SEARCH_DESKTOP_HASH =
  "75bbf6bfcfdf85b8fc828417bfad92b7cd66bf7f556d85670f4da8292373ebec";

function uriToUrl(uri: string): { url: string; id: string } {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const urlObj = new URL(uri);
    const parts = urlObj.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1] || "";
    return { url: uri, id };
  }
  const parts = uri.split(":");
  const type = parts[1] || "track";
  const id = parts[2] || "";
  return { url: `https://open.spotify.com/${type}/${id}`, id };
}

function extractArtistNames(artists?: {
  items: SpotifyArtistItem[];
}): string[] {
  if (!artists?.items) return [];
  return artists.items
    .map((a) => a.profile?.name || a.name || "")
    .filter((n): n is string => Boolean(n.trim()));
}

// The cover closest to 300px wide, from whichever album field the response filled
function coverUrl(item: {
  album?: { coverArt?: SpotifyCoverArt };
  albumOfTrack?: { coverArt?: SpotifyCoverArt };
}): string | undefined {
  const sources = (
    item.albumOfTrack?.coverArt?.sources ?? item.album?.coverArt?.sources ?? []
  ).filter((source): source is { url: string; width?: number | null } =>
    Boolean(source.url),
  );
  if (sources.length === 0) return undefined;
  const distance = (width?: number | null) => Math.abs((width ?? 300) - 300);
  return sources.reduce((best, source) =>
    distance(source.width) < distance(best.width) ? source : best,
  ).url;
}

export interface SpotifyAdapterOptions {
  baseUrl?: string;
  apiUrl?: string;
  getToken?: (
    options?: ResolveOptions,
    forceRefresh?: boolean,
  ) => Promise<string>;
}

export class SpotifyAdapter implements MusicAdapter {
  readonly id = "spotify";
  readonly name = "Spotify";

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private inFlightTokenPromise: Promise<string> | null = null;

  private cachedSecret: string = DEFAULT_SPOTIFY_SECRET;
  private cachedVersion: number = DEFAULT_SPOTIFY_VERSION;

  private baseUrl: string;
  private apiUrl: string;
  private customTokenProvider?: (
    options?: ResolveOptions,
    forceRefresh?: boolean,
  ) => Promise<string>;

  constructor(options?: SpotifyAdapterOptions) {
    this.baseUrl = options?.baseUrl || "https://open.spotify.com";
    this.apiUrl =
      options?.apiUrl || "https://api-partner.spotify.com/pathfinder/v1/query";
    this.customTokenProvider = options?.getToken;
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions,
  ): Promise<ResolvedLink | null> {
    try {
      let data: SpotifySearchResponse | null = null;

      // 1. Try ISRC search if available for song type
      if (metadata.type === "song" && metadata.isrc) {
        try {
          const isrcData = await this.runSearch(
            `isrc:${metadata.isrc.trim()}`,
            options,
          );
          const isrcTracks =
            isrcData?.data?.search?.tracks?.items ||
            isrcData?.data?.searchV2?.tracks?.items;
          if (isrcTracks && isrcTracks.length > 0) {
            data = isrcData;
          }
        } catch {
          // Fallback to keyword query
        }
      }

      // 2. Regular keyword search if ISRC was not found
      if (!data) {
        data = await this.runSearch(query, options);
      }

      const candidates = this.toCandidates(data, metadata);
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
        const isrcData = await this.runSearch(
          `isrc:${metadata.isrc.trim()}`,
          options,
        );
        candidates.push(...this.toCandidates(isrcData, metadata));
      } catch {
        // The keyword search below still runs
      }
    }
    const data = await this.runSearch(query, options);
    if (!data?.data?.search && !data?.data?.searchV2) {
      throw new Error("Spotify returned an unreadable search response");
    }
    candidates.push(...this.toCandidates(data, metadata));
    return candidates;
  }

  // One search request, retried once with a fresh token if it fails
  private async runSearch(
    searchTerm: string,
    options?: ResolveOptions,
  ): Promise<SpotifySearchResponse | null> {
    const executeQuery = (token: string) => {
      const variables = {
        searchTerm,
        offset: 0,
        limit: 15,
        numberOfTopResults: 15,
      };

      const extensions = {
        persistedQuery: { version: 1, sha256Hash: SEARCH_DESKTOP_HASH },
      };

      const url = new URL(this.apiUrl);
      url.searchParams.set("operationName", "searchDesktop");
      url.searchParams.set("variables", JSON.stringify(variables));
      url.searchParams.set("extensions", JSON.stringify(extensions));

      return HttpClient.get<SpotifySearchResponse>(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          "app-platform": "WebPlayer",
        },
        timeout: options?.timeout ?? 10000,
        retries: options?.retries ?? 1,
        priority: options?.priority,
      });
    };

    try {
      return await executeQuery(await this.getAccessToken(options));
    } catch {
      // Invalidate cached token and retry once with fresh token
      this.cachedToken = null;
      this.tokenExpiresAt = 0;
      return await executeQuery(await this.getAccessToken(options, true));
    }
  }

  private toCandidates(
    data: SpotifySearchResponse | null,
    metadata: TrackMetadata,
  ): MatchCandidate[] {
    const search = data?.data?.search || data?.data?.searchV2;
    if (!search) return [];

    const candidates: MatchCandidate[] = [];
    const seenIds = new Set<string>();

    if (metadata.type === "song") {
      const trackItems = search.tracks?.items || [];
      for (const item of trackItems) {
        const track = item.track || item;
        if (!track?.uri) continue;
        const { url: trackUrl, id } = uriToUrl(track.uri);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const artists = extractArtistNames(track.artists);
        candidates.push({
          title: track.name,
          artist: artists.join(", ") || undefined,
          artists: artists.length > 0 ? artists : undefined,
          album: track.album?.name,
          durationMs: track.duration?.totalMilliseconds,
          url: trackUrl,
          id,
          artworkUrl: coverUrl(track),
          raw: { album: track.album?.name },
        });
      }

      // Also check topResults for tracks
      if (data?.data?.search?.topResults?.items) {
        for (const item of data.data.search.topResults.items) {
          if (!item.uri || !item.uri.includes(":track:")) continue;
          const { url: trackUrl, id } = uriToUrl(item.uri);
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          const artists = extractArtistNames(item.artists);
          candidates.push({
            title: item.name,
            artist: artists.join(", ") || undefined,
            artists: artists.length > 0 ? artists : undefined,
            album: item.album?.name,
            durationMs: item.duration?.totalMilliseconds,
            url: trackUrl,
            id,
            artworkUrl: coverUrl(item),
            raw: { album: item.album?.name },
          });
        }
      }
    } else if (metadata.type === "album") {
      const albumItems = search.albums?.items || [];
      for (const album of albumItems) {
        if (!album?.uri) continue;
        const { url: albumUrl, id } = uriToUrl(album.uri);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const artists = extractArtistNames(album.artists);
        candidates.push({
          title: album.name,
          artist: artists.join(", ") || undefined,
          artists: artists.length > 0 ? artists : undefined,
          url: albumUrl,
          id,
        });
      }
    } else if (metadata.type === "artist") {
      const artistItems = search.artists?.items || [];
      for (const item of artistItems) {
        const raw =
          "data" in item
            ? (item.data as SpotifyArtistData)
            : (item as SpotifyArtistData);
        if (!raw?.uri) continue;
        const { url: artistUrl, id } = uriToUrl(raw.uri);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const name = raw.profile?.name || raw.name || "";
        candidates.push({
          title: name,
          url: artistUrl,
          id,
        });
      }
    } else if (metadata.type === "playlist") {
      const playlistItems = search.playlists?.items || [];
      for (const item of playlistItems) {
        const raw =
          "data" in item
            ? (item.data as SpotifyPlaylistItem)
            : (item as SpotifyPlaylistItem);
        if (!raw?.uri) continue;
        const { url: playlistUrl, id } = uriToUrl(raw.uri);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        candidates.push({
          title: raw.name,
          url: playlistUrl,
          id,
        });
      }
    }

    return candidates;
  }

  async getAccessToken(
    options?: ResolveOptions,
    forceRefresh = false,
  ): Promise<string> {
    if (this.customTokenProvider) {
      return this.customTokenProvider(options, forceRefresh);
    }

    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt > now + 60) {
      return this.cachedToken;
    }

    if (this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }

    this.inFlightTokenPromise = this.fetchFreshToken(options).finally(() => {
      this.inFlightTokenPromise = null;
    });

    return this.inFlightTokenPromise;
  }

  private async fetchFreshToken(options?: ResolveOptions): Promise<string> {
    const timeout = options?.timeout ?? 8000;

    // Stage 1: Try fast-path with cached secret & version
    try {
      const result = await requestSpotifyTokenWithSecret(
        this.baseUrl,
        this.cachedSecret,
        this.cachedVersion,
        timeout,
      );
      if (result?.accessToken) {
        this.cachedToken = result.accessToken;
        this.tokenExpiresAt = result.expiresAt;
        return result.accessToken;
      }
    } catch {
      // Fallback to Stage 2
    }

    // Stage 2: Scrape web-player JS bundle to extract latest secret and version
    const { secret, version } = await scrapeSpotifySecrets(
      this.baseUrl,
      timeout,
    );
    this.cachedSecret = secret;
    this.cachedVersion = version;

    const result = await requestSpotifyTokenWithSecret(
      this.baseUrl,
      secret,
      version,
      timeout,
    );
    if (!result?.accessToken) {
      throw new Error("Failed to obtain Spotify anonymous token");
    }

    this.cachedToken = result.accessToken;
    this.tokenExpiresAt = result.expiresAt;
    return result.accessToken;
  }
}
