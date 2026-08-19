import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { cleanSearchQuery } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';

export const DEEZER_LINK_REGEX =
  /^https:\/\/www\.deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/(\d+)/;

const DEEZER_TYPE_MAP: Record<string, MetadataType> = {
  'music.song': 'song',
  'music.album': 'album',
  'music.playlist': 'playlist',
  'music.musician': 'artist',
};

export class DeezerParser implements MusicParser {
  readonly id = 'deezer';
  readonly name = 'Deezer';

  match(url: string): boolean {
    return DEEZER_LINK_REGEX.test(url) || url.includes('deezer.com');
  }

  parse(url: string): { id: string; type?: MetadataType } {
    const match = url.match(DEEZER_LINK_REGEX);
    const id = match?.[2] || url.split('/').pop()?.split('?')[0] || '';
    const rawType = match?.[1];
    let type: MetadataType | undefined;
    if (rawType === 'track') type = 'song';
    else if (rawType === 'album') type = 'album';
    else if (rawType === 'playlist') type = 'playlist';
    else if (rawType === 'artist') type = 'artist';
    else if (rawType === 'episode') type = 'podcast';
    else if (rawType === 'show') type = 'show';

    return { id, type };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const html = await HttpClient.get<string>(url, {
      timeout: options?.timeout,
      retries: options?.retries,
    });

    const doc = getCheerioDoc(html);
    const title = metaTagContent(doc, 'og:title') || '';
    const description = metaTagContent(doc, 'og:description') || '';
    const image = metaTagContent(doc, 'og:image');
    const audio = metaTagContent(doc, 'og:audio');
    const ogType = metaTagContent(doc, 'og:type') || '';

    const type: MetadataType = DEEZER_TYPE_MAP[ogType] || 'song';
    const artist = description.match(/^([^ -]+(?: [^ -]+)*)/)?.[1]?.trim();

    return {
      id,
      title: title.trim(),
      artist,
      description,
      type,
      image,
      audio,
    };
  }

  buildSearchQuery(metadata: TrackMetadata): string {
    let query = metadata.title;
    if (metadata.artist) {
      query = `${query} ${metadata.artist}`;
    }
    if (metadata.type === 'playlist') {
      query = `${query} playlist`;
    }
    return cleanSearchQuery(query);
  }
}
