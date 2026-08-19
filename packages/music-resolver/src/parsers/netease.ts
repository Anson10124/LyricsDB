import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { weapiEncrypt } from '../utils/netease-crypto.js';
import { cleanSearchQuery } from '../utils/query.js';

export const NETEASE_LINK_REGEX =
  /(?:https?:\/\/)?(?:music\.163\.com|163cn\.tv)\/(?:#\/)?(song|album|artist|playlist)(?:\?id=|\/)(\d+)/;

export class NeteaseParser implements MusicParser {
  readonly id = 'netease';
  readonly name = 'NetEase Cloud Music';

  match(url: string): boolean {
    return NETEASE_LINK_REGEX.test(url) || url.includes('163.com') || url.includes('163cn.tv');
  }

  parse(url: string): { id: string; type?: MetadataType } {
    const match = url.match(NETEASE_LINK_REGEX);
    const rawType = match?.[1];
    const id = match?.[2] || '';

    let type: MetadataType = 'song';
    if (rawType === 'album') type = 'album';
    else if (rawType === 'artist') type = 'artist';
    else if (rawType === 'playlist') type = 'playlist';

    return { id, type };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const parsed = this.parse(url);
    const itemType = parsed.type || 'song';

    // Fetch track detail via song/detail endpoint
    try {
      const payload = {
        c: JSON.stringify([{ id }]),
        ids: `[${id}]`,
        csrf_token: '',
      };
      const encrypted = weapiEncrypt(payload);
      const body = new URLSearchParams({
        params: encrypted.params,
        encSecKey: encrypted.encSecKey,
      });

      const res = await HttpClient.post<{
        code: number;
        songs?: Array<{
          id: number;
          name: string;
          ar?: Array<{ name: string }>;
          al?: { name: string; picUrl?: string };
          dt?: number;
        }>;
      }>('https://music.163.com/weapi/v3/song/detail', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://music.163.com',
          Cookie:
            'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=3.1.17.204416; channel=netease;',
          ...options?.customHeaders,
        },
        timeout: options?.timeout,
        retries: options?.retries,
      });

      if (res.code === 200 && res.songs?.[0]) {
        const song = res.songs[0];
        return {
          id,
          title: song.name,
          artist: song.ar?.map((a) => a.name).join(', '),
          album: song.al?.name,
          type: itemType,
          image: song.al?.picUrl,
          durationMs: song.dt,
        };
      }
    } catch {
      // Fallback
    }

    return {
      id,
      title: `NetEase Track ${id}`,
      type: itemType,
    };
  }

  buildSearchQuery(metadata: TrackMetadata): string {
    const title = metadata.title;
    const artist = metadata.artist;
    const raw = artist ? `${title} ${artist}` : title;
    return cleanSearchQuery(raw);
  }
}
