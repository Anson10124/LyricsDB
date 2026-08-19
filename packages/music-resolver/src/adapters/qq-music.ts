import type {
  MatchCandidate,
  MusicAdapter,
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from '../types.js';
import { HttpClient } from '../utils/http.js';
import { findBestMatch } from '../utils/string-similarity.js';

export enum QQMusicSearchType {
  Song = 0,
  Album = 8,
  Singer = 9,
}

export interface QQMusicSinger {
  id?: number;
  mid?: string;
  name: string;
  name_hilight?: string;
}

export interface QQMusicSongItem {
  songid: number;
  songmid: string;
  songname: string;
  songname_hilight?: string;
  albumid?: number;
  albummid?: string;
  albumname?: string;
  albumname_hilight?: string;
  interval?: number; // seconds
  singer?: QQMusicSinger[];
}

export interface QQMusicAlbumItem {
  albumID: number;
  albumMID: string;
  albumName: string;
  albumName_hilight?: string;
  albumPic?: string;
  singerID?: number;
  singerMID?: string;
  singerName?: string;
  singerName_hilight?: string;
  singer_list?: Array<{ id: number; mid: string; name: string }>;
  song_count?: number;
}

export interface QQMusicSingerItem {
  singerID: number;
  singerMID: string;
  singerName: string;
  singerName_hilight?: string;
  singerPic?: string;
  songNum?: number;
  albumNum?: number;
}

export interface QQMusicSearchResponse {
  code: number;
  data?: {
    keyword?: string;
    song?: {
      curnum?: number;
      curpage?: number;
      totalnum?: number;
      list?: QQMusicSongItem[];
    };
    album?: {
      curnum?: number;
      curpage?: number;
      totalnum?: number;
      list?: QQMusicAlbumItem[];
    };
    singer?: {
      curnum?: number;
      curpage?: number;
      totalnum?: number;
      list?: QQMusicSingerItem[];
    };
  };
}

function stripHighlight(str?: string): string {
  if (!str) return '';
  return str.replace(/<\/?em>/g, '').trim();
}

export class QQMusicAdapter implements MusicAdapter {
  readonly id = 'qqMusic';
  readonly name = 'QQ Music';

  private apiUrl: string;

  constructor(options?: { apiUrl?: string }) {
    this.apiUrl =
      options?.apiUrl || 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
  }

  async search(
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      let searchType = QQMusicSearchType.Song;
      if (metadata.type === 'album') searchType = QQMusicSearchType.Album;
      else if (metadata.type === 'artist') searchType = QQMusicSearchType.Singer;

      const params = new URLSearchParams({
        p: '1',
        n: '30',
        w: query,
        format: 'json',
        t: String(searchType),
      });

      const url = `${this.apiUrl}?${params.toString()}`;
      let response = await HttpClient.get<QQMusicSearchResponse>(url, {
        headers: {
          Referer: 'https://y.qq.com',
          ...options?.customHeaders,
        },
        timeout: options?.timeout,
        retries: options?.retries,
      });

      if (typeof response === 'string') {
        const text = (response as string).trim();
        // Remove jsonp callback wrapper if present: callback(...) -> {...}
        const jsonMatch = text.match(/^callback\((.*)\)$/s) || text.match(/^[a-zA-Z0-9_]+\((.*)\)$/s);
        if (jsonMatch && jsonMatch[1]) {
          try {
            response = JSON.parse(jsonMatch[1]) as QQMusicSearchResponse;
          } catch {
            return null;
          }
        } else {
          try {
            response = JSON.parse(text) as QQMusicSearchResponse;
          } catch {
            return null;
          }
        }
      }

      if (response.code !== 0 || !response.data) {
        return null;
      }

      const candidates: MatchCandidate[] = [];

      if (searchType === QQMusicSearchType.Song && response.data.song?.list) {
        for (const song of response.data.song.list) {
          const title = song.songname || stripHighlight(song.songname_hilight);
          const artist = song.singer?.map((s) => s.name || stripHighlight(s.name_hilight)).join(', ');
          const songMid = song.songmid || String(song.songid);
          if (songMid) {
            candidates.push({
              title,
              artist,
              url: `https://y.qq.com/n/ryqq/songDetail/${songMid}`,
              id: songMid,
            });
          }
        }
      } else if (searchType === QQMusicSearchType.Album && response.data.album?.list) {
        for (const album of response.data.album.list) {
          const title = album.albumName || stripHighlight(album.albumName_hilight);
          const artist =
            album.singerName ||
            stripHighlight(album.singerName_hilight) ||
            album.singer_list?.map((s) => s.name).join(', ');
          const albumMid = album.albumMID || String(album.albumID);
          if (albumMid) {
            candidates.push({
              title,
              artist,
              url: `https://y.qq.com/n/ryqq/albumDetail/${albumMid}`,
              id: albumMid,
            });
          }
        }
      } else if (searchType === QQMusicSearchType.Singer && response.data.singer?.list) {
        for (const singer of response.data.singer.list) {
          const title = singer.singerName || stripHighlight(singer.singerName_hilight);
          const singerMid = singer.singerMID || String(singer.singerID);
          if (singerMid) {
            candidates.push({
              title,
              url: `https://y.qq.com/n/ryqq/singer/${singerMid}`,
              id: singerMid,
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
