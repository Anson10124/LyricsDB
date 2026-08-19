import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { cleanSearchQuery, normalizeSongTitle } from '../utils/query.js';

export abstract class BaseMusicParser implements MusicParser {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract match(url: string): boolean;
  abstract parse(url: string): { id: string; type?: MetadataType };
  abstract fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata>;

  buildSearchQuery(metadata: TrackMetadata): string {
    const title = metadata.cleanTitle || normalizeSongTitle(metadata.title).cleanTitle;
    const artist = metadata.artist;
    const raw = artist ? `${title} ${artist}` : title;
    return cleanSearchQuery(raw);
  }
}
