import type { MatchCandidate, MusicAdapter, ResolveOptions, ResolvedLink, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { findBestMatch } from '../utils/string-similarity.js';
import { generateSpotifyTotp } from '../utils/totp.js';

interface SpotifyTrackItem {
  uri: string;
  name: string;
  duration?: { totalMilliseconds?: number };
  albumOfTrack?: { name: string; uri?: string };
  artists?: { items: Array<{ profile: { name: string } }> };
}

interface SpotifyAlbumItem {
  uri: string;
  name: string;
  artists?: { items: Array<{ profile: { name: string } }> };
}

interface SpotifySearchResponse {
  data?: {
    searchV2?: {
      tracks?: { items: Array<{ track: SpotifyTrackItem }> };
      albums?: { items: SpotifyAlbumItem[] };
      artists?: { items: Array<{ data: { uri: string; profile: { name: string } } }> };
      playlists?: { items: Array<{ data: { uri: string; name: string } }> };
    };
  };
}

const SEARCH_DESKTOP_HASH = '75bbf6bfcfdf85b8fc828417bfad92b7cd66bf7f556d85670f4da8292373ebec';
const PLAYER_JS_REGEX = /"(https:\/\/[^" ]+\/(?:mobile-)?web-player\.[0-9a-f]+\.js)"/;
const SECRETS_REGEX = /\{\s*secret\s*:\s*["']([^"']+)["']\s*,\s*version\s*:\s*(\d+)\s*\}/g;

function uriToUrl(uri: string): { url: string; id: string } {
  const parts = uri.split(':');
  const type = parts[1] || 'track';
  const id = parts[2] || '';
  return { url: `https://open.spotify.com/${type}/${id}`, id };
}

export class SpotifyAdapter implements MusicAdapter {
  readonly id = 'spotify';
  readonly name = 'Spotify';

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private baseUrl: string;
  private apiUrl: string;

  constructor(options?: { baseUrl?: string; apiUrl?: string }) {
    this.baseUrl = options?.baseUrl || 'https://open.spotify.com';
    this.apiUrl = options?.apiUrl || 'https://api.spotify.com/v1';
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      const accessToken = await this.getAccessToken(options);

      // Helper to execute GraphQL searchDesktop
      const executeSearch = async (searchTerm: string) => {
        const variables = {
          searchTerm,
          offset: 0,
          limit: 15,
          numberOfTopResults: 15,
        };

        const extensions = {
          persistedQuery: { version: 1, sha256Hash: SEARCH_DESKTOP_HASH },
        };

        const url = new URL(`${this.apiUrl}/query`);
        url.searchParams.set('operationName', 'searchDesktop');
        url.searchParams.set('variables', JSON.stringify(variables));
        url.searchParams.set('extensions', JSON.stringify(extensions));

        return HttpClient.get<SpotifySearchResponse>(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'app-platform': 'WebPlayer',
          },
          timeout: options?.timeout,
          retries: options?.retries,
        });
      };

      let data: SpotifySearchResponse | null = null;

      // 1. Try ISRC query if available and resolving a song
      if (metadata.type === 'song' && metadata.isrc) {
        try {
          const isrcData = await executeSearch(`isrc:${metadata.isrc.trim()}`);
          if (isrcData?.data?.searchV2?.tracks?.items && isrcData.data.searchV2.tracks.items.length > 0) {
            data = isrcData;
          }
        } catch {
          // Fallback to regular search
        }
      }

      // 2. Regular keyword search if ISRC was not found or not available
      if (!data) {
        data = await executeSearch(query);
      }

      const searchV2 = data?.data?.searchV2;
      if (!searchV2) return null;

      const candidates: MatchCandidate[] = [];

      if (metadata.type === 'song' && searchV2.tracks?.items) {
        for (const item of searchV2.tracks.items) {
          const track = item.track;
          const { url: trackUrl, id } = uriToUrl(track.uri);
          const artists = track.artists?.items?.map((a) => a.profile.name).filter(Boolean) || [];
          candidates.push({
            title: track.name,
            artist: artists.join(', ') || undefined,
            artists: artists.length > 0 ? artists : undefined,
            album: track.albumOfTrack?.name,
            durationMs: track.duration?.totalMilliseconds,
            url: trackUrl,
            id,
          });
        }
      } else if (metadata.type === 'album' && searchV2.albums?.items) {
        for (const album of searchV2.albums.items) {
          const { url: albumUrl, id } = uriToUrl(album.uri);
          const artists = album.artists?.items?.map((a) => a.profile.name).filter(Boolean) || [];
          candidates.push({
            title: album.name,
            artist: artists.join(', ') || undefined,
            artists: artists.length > 0 ? artists : undefined,
            url: albumUrl,
            id,
          });
        }
      } else if (metadata.type === 'artist' && searchV2.artists?.items) {
        for (const item of searchV2.artists.items) {
          const { url: artistUrl, id } = uriToUrl(item.data.uri);
          candidates.push({
            title: item.data.profile.name,
            url: artistUrl,
            id,
          });
        }
      } else if (metadata.type === 'playlist' && searchV2.playlists?.items) {
        for (const item of searchV2.playlists.items) {
          const { url: playlistUrl, id } = uriToUrl(item.data.uri);
          candidates.push({
            title: item.data.name,
            url: playlistUrl,
            id,
          });
        }
      }

      if (candidates.length === 0) return null;

      const { bestMatch } = findBestMatch(candidates, metadata, this.id);
      return bestMatch;
    } catch {
      return null;
    }
  }

  private async getAccessToken(options?: ResolveOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.tokenExpiresAt > now + 60) {
      return this.cachedToken;
    }

    const { serverTime } = await HttpClient.get<{ serverTime: number }>(
      `${this.baseUrl}/api/server-time`,
      { timeout: options?.timeout }
    );

    const html = await HttpClient.get<string>(this.baseUrl, { timeout: options?.timeout });
    const jsMatch = html.match(PLAYER_JS_REGEX);
    if (!jsMatch || !jsMatch[1]) {
      throw new Error('Could not find Spotify player JS bundle URL');
    }

    const js = await HttpClient.get<string>(jsMatch[1], { timeout: options?.timeout });

    let latestVersion = 0;
    let latestSecret = '';
    let match;
    while ((match = SECRETS_REGEX.exec(js)) !== null) {
      const version = parseInt(match[2]!, 10);
      if (version > latestVersion) {
        latestVersion = version;
        latestSecret = match[1]!;
      }
    }
    SECRETS_REGEX.lastIndex = 0;

    if (!latestSecret) {
      throw new Error('Failed to extract Spotify TOTP secret');
    }

    const totp = generateSpotifyTotp(serverTime, latestSecret);

    const tokenUrl = new URL(`${this.baseUrl}/api/token`);
    tokenUrl.searchParams.set('reason', 'init');
    tokenUrl.searchParams.set('productType', 'web-player');
    tokenUrl.searchParams.set('totp', totp);
    tokenUrl.searchParams.set('totpVer', latestVersion.toString());
    tokenUrl.searchParams.set('ts', serverTime.toString());

    const tokenData = await HttpClient.get<{
      accessToken: string;
      accessTokenExpirationTimestampMs: number;
    }>(tokenUrl.toString(), {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/`,
        Origin: this.baseUrl,
      },
      timeout: options?.timeout,
    });

    this.cachedToken = tokenData.accessToken;
    this.tokenExpiresAt = Math.floor(tokenData.accessTokenExpirationTimestampMs / 1000);

    return this.cachedToken;
  }
}
