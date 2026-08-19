import type { MatchCandidate, MusicAdapter, ResolveOptions, ResolvedLink, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { weapiEncrypt } from '../utils/netease-crypto.js';
import { findBestMatch } from '../utils/string-similarity.js';

export enum NeteaseSearchType {
  Song = 1,
  Album = 10,
  Artist = 100,
  Playlist = 1000,
  User = 1002,
  Mv = 1004,
  Lyric = 1006,
  Radio = 1009,
  Video = 1014,
}

export interface NeteaseSongItem {
  id: number;
  name: string;
  ar?: Array<{ id: number; name: string }>;
  al?: { id: number; name: string; picUrl?: string };
  dt?: number; // duration in ms
}

export interface NeteaseCloudSearchResponse {
  code: number;
  result?: {
    songs?: NeteaseSongItem[];
    songCount?: number;
    albums?: Array<{ id: number; name: string; artist?: { name: string }; picUrl?: string }>;
    artists?: Array<{ id: number; name: string; picUrl?: string }>;
    playlists?: Array<{ id: number; name: string; coverImgUrl?: string }>;
  };
}

export class NeteaseAdapter implements MusicAdapter {
  readonly id = 'netease';
  readonly name = 'NetEase Cloud Music';

  private apiUrl: string;

  constructor(options?: { apiUrl?: string }) {
    this.apiUrl = options?.apiUrl || 'https://music.163.com/weapi/cloudsearch/pc';
  }

  // Direct CloudSearch API call
  async cloudSearch(
    keywords: string,
    options?: {
      type?: NeteaseSearchType;
      limit?: number;
      offset?: number;
    },
    httpOptions?: ResolveOptions
  ): Promise<NeteaseCloudSearchResponse> {
    const payload = {
      s: keywords,
      type: options?.type || NeteaseSearchType.Song,
      limit: options?.limit || 10,
      offset: options?.offset || 0,
      total: true,
      csrf_token: '',
    };

    const encrypted = weapiEncrypt(payload);
    const body = new URLSearchParams({
      params: encrypted.params,
      encSecKey: encrypted.encSecKey,
    });

    return HttpClient.post<NeteaseCloudSearchResponse>(this.apiUrl, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://music.163.com',
        Cookie:
          'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=3.1.17.204416; channel=netease;',
        ...httpOptions?.customHeaders,
      },
      timeout: httpOptions?.timeout,
      retries: httpOptions?.retries,
    });
  }

  // Resolves links using fuzzy matching
  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      let searchType = NeteaseSearchType.Song;
      if (metadata.type === 'album') searchType = NeteaseSearchType.Album;
      else if (metadata.type === 'artist') searchType = NeteaseSearchType.Artist;
      else if (metadata.type === 'playlist') searchType = NeteaseSearchType.Playlist;

      const response = await this.cloudSearch(query, { type: searchType, limit: 10 }, options);

      if (response.code !== 200 || !response.result) {
        return null;
      }

      const candidates: MatchCandidate[] = [];

      if (searchType === NeteaseSearchType.Song && response.result.songs) {
        for (const song of response.result.songs) {
          candidates.push({
            title: song.name,
            artist: song.ar?.map((a) => a.name).join(', '),
            url: `https://music.163.com/#/song?id=${song.id}`,
            id: String(song.id),
          });
        }
      } else if (searchType === NeteaseSearchType.Album && response.result.albums) {
        for (const album of response.result.albums) {
          candidates.push({
            title: album.name,
            artist: album.artist?.name,
            url: `https://music.163.com/#/album?id=${album.id}`,
            id: String(album.id),
          });
        }
      } else if (searchType === NeteaseSearchType.Artist && response.result.artists) {
        for (const artist of response.result.artists) {
          candidates.push({
            title: artist.name,
            url: `https://music.163.com/#/artist?id=${artist.id}`,
            id: String(artist.id),
          });
        }
      } else if (searchType === NeteaseSearchType.Playlist && response.result.playlists) {
        for (const playlist of response.result.playlists) {
          candidates.push({
            title: playlist.name,
            url: `https://music.163.com/#/playlist?id=${playlist.id}`,
            id: String(playlist.id),
          });
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
