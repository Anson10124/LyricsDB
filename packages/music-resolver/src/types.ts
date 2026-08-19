export type MetadataType = 'song' | 'album' | 'playlist' | 'artist' | 'podcast' | 'show';

export interface TrackMetadata {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  description?: string;
  type: MetadataType;
  image?: string;
  audio?: string;
  durationMs?: number;
  isrc?: string;
}

export interface MatchCandidate {
  title: string;
  artist?: string;
  url: string;
  id?: string;
}

export interface ResolvedLink {
  platform: string;
  url: string;
  id?: string;
  isVerified?: boolean;
  notAvailable?: boolean;
  score?: number;
  raw?: Record<string, unknown>;
}

export interface ResolveResult {
  sourceUrl: string;
  sourcePlatform: string;
  sourceId: string;
  metadata: TrackMetadata;
  query: string;
  links: Record<string, ResolvedLink | null>;
}

export interface ResolveOptions {
  timeout?: number;
  retries?: number;
  customHeaders?: Record<string, string>;
}

export interface MusicAdapter {
  readonly id: string; // e.g. 'spotify', 'deezer', 'custom-service'
  readonly name: string;
  search(query: string, metadata: TrackMetadata, options?: ResolveOptions): Promise<ResolvedLink | null>;
}

export interface MusicParser {
  readonly id: string; // e.g. 'spotify', 'deezer', 'custom-service'
  readonly name: string;
  match(url: string): boolean;
  parse(url: string): { id: string; type?: MetadataType };
  fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata>;
  buildSearchQuery(metadata: TrackMetadata): string;
}

export interface ResolverConfig {
  spotify?: {
    apiUrl?: string;
    baseUrl?: string;
  };
  deezer?: {
    apiUrl?: string;
  };
}
