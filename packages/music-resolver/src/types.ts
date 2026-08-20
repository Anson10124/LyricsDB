export type MetadataType = 'song' | 'album' | 'playlist' | 'artist' | 'podcast' | 'show';

export interface TrackMetadata {
  id: string;
  title: string;
  cleanTitle?: string;
  artist?: string;
  artists?: string[];
  extraArtists?: string[];
  album?: string;
  albumArtist?: string;
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
  artists?: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  aliases?: string[];
  url: string;
  id?: string;
  raw?: Record<string, unknown>;
}

export interface ScoreBreakdown {
  titleScore: number;
  artistScore: number;
  durationScore: number;
  bonusScore: number;
  penaltyScore: number;
  finalScore: number;
}

export interface ResolvedLink {
  platform: string;
  url: string;
  id?: string;
  isVerified?: boolean;
  notAvailable?: boolean;
  score?: number;
  matchReason?: 'isrc' | 'fuzzy' | 'direct';
  breakdown?: ScoreBreakdown;
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
  threshold?: number;
  minInclusionThreshold?: number;
  preferredCountry?: string;
  customHeaders?: Record<string, string>;
}

export interface MusicAdapter {
  readonly id: string; // e.g. 'spotify', 'deezer', 'netease', 'custom-service'
  readonly name: string;
  search(query: string, metadata: TrackMetadata, options?: ResolveOptions): Promise<ResolvedLink | null>;
}

export interface MusicParser {
  readonly id: string; // e.g. 'spotify', 'deezer', 'netease', 'custom-service'
  readonly name: string;
  match(url: string): boolean;
  parse(url: string): { id: string; type?: MetadataType };
  fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata>;
  buildSearchQuery(metadata: TrackMetadata): string;
}

export interface EnrichedMusixmatchMetadata {
  isrc?: string;
  spotifyId?: string;
  spotifyIds?: string[];
  appleMusicId?: string;
  appleMusicIds?: string[];
  musixmatchId?: string;
  title?: string;
  artist?: string;
  album?: string;
  raw?: Record<string, unknown>;
}

export interface ResolverConfig {
  spotify?: {
    apiUrl?: string;
    baseUrl?: string;
    getToken?: (options?: ResolveOptions, forceRefresh?: boolean) => Promise<string>;
  };
  musixmatch?: {
    apiUrl?: string;
    getToken?: (options?: ResolveOptions, forceRefresh?: boolean) => Promise<string>;
  };
  deezer?: {
    apiUrl?: string;
  };
  netease?: {
    apiUrl?: string;
  };
  appleMusic?: {
    apiUrl?: string;
    lookupUrl?: string;
    country?: string;
  };
  qqMusic?: {
    apiUrl?: string;
  };
}
