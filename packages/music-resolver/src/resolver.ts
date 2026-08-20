import { AppleMusicAdapter } from './adapters/apple-music.js';
import { DeezerAdapter } from './adapters/deezer.js';
import { NeteaseAdapter } from './adapters/netease.js';
import { QQMusicAdapter } from './adapters/qq-music.js';
import { SpotifyAdapter } from './adapters/spotify.js';
import { AppleMusicParser } from './parsers/apple-music.js';
import { DeezerParser } from './parsers/deezer.js';
import { NeteaseParser } from './parsers/netease.js';
import { QQMusicParser } from './parsers/qq-music.js';
import { SpotifyParser } from './parsers/spotify.js';
import type {
  EnrichedMusixmatchMetadata,
  MusicAdapter,
  MusicParser,
  ResolveOptions,
  ResolverConfig,
  ResolveResult,
  ResolvedLink,
  TrackMetadata,
} from './types.js';
import { matchTrackWithMusixmatch } from './utils/musixmatch-matcher.js';
import { cleanSearchQuery, normalizeSongTitle, splitArtists } from './utils/query.js';

export class MusicResolver {
  private parsers = new Map<string, MusicParser>();
  private adapters = new Map<string, MusicAdapter>();
  private musixmatchConfig?: ResolverConfig['musixmatch'];

  constructor(config?: ResolverConfig) {
    this.musixmatchConfig = config?.musixmatch;

    // Register built-in default parsers
    this.registerParser(
      new AppleMusicParser({
        lookupUrl: config?.appleMusic?.lookupUrl,
        country: config?.appleMusic?.country,
      })
    );
    this.registerParser(new SpotifyParser());
    this.registerParser(new DeezerParser());
    this.registerParser(new NeteaseParser());
    this.registerParser(new QQMusicParser());

    // Register built-in default adapters
    this.registerAdapter(
      new AppleMusicAdapter({
        apiUrl: config?.appleMusic?.apiUrl,
        country: config?.appleMusic?.country,
      })
    );
    this.registerAdapter(
      new SpotifyAdapter({
        apiUrl: config?.spotify?.apiUrl,
        baseUrl: config?.spotify?.baseUrl,
        getToken: config?.spotify?.getToken,
      })
    );
    this.registerAdapter(
      new DeezerAdapter({
        apiUrl: config?.deezer?.apiUrl,
      })
    );
    this.registerAdapter(
      new NeteaseAdapter({
        apiUrl: config?.netease?.apiUrl,
      })
    );
    this.registerAdapter(
      new QQMusicAdapter({
        apiUrl: config?.qqMusic?.apiUrl,
      })
    );
  }

  // Register a custom parser (e.g. for a custom streaming endpoint)
  registerParser(parser: MusicParser): this {
    this.parsers.set(parser.id, parser);
    return this;
  }

  // Register a custom adapter (e.g. for a custom streaming endpoint)
  registerAdapter(adapter: MusicAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  unregisterParser(id: string): boolean {
    return this.parsers.delete(id);
  }

  unregisterAdapter(id: string): boolean {
    return this.adapters.delete(id);
  }

  getAdapter(id: string): MusicAdapter | undefined {
    return this.adapters.get(id);
  }

  getParserForUrl(url: string): MusicParser | undefined {
    for (const parser of this.parsers.values()) {
      if (parser.match(url)) {
        return parser;
      }
    }
    return undefined;
  }

  // Normalizes title and splits artist strings if not already done
  private normalizeMetadata(metadata: TrackMetadata): TrackMetadata {
    if (!metadata.cleanTitle || !metadata.extraArtists) {
      const normalized = normalizeSongTitle(metadata.title);
      metadata.cleanTitle = metadata.cleanTitle || normalized.cleanTitle;
      metadata.extraArtists = metadata.extraArtists || normalized.extraArtists;
    }
    if (!metadata.artists && metadata.artist) {
      metadata.artists = splitArtists(metadata.artist);
    }
    return metadata;
  }

  // Queries Musixmatch to cross-reference platform IDs and fill in missing fields (ISRC, Spotify, Apple)
  private async enrichMetadata(
    metadata: TrackMetadata,
    sourcePlatform: string,
    sourceId: string,
    options?: ResolveOptions
  ): Promise<EnrichedMusixmatchMetadata | null> {
    try {
      const params: Parameters<typeof matchTrackWithMusixmatch>[0] = {};

      const normSource = sourcePlatform.toLowerCase();
      if (normSource === 'spotify') {
        params.spotifyId = sourceId;
      } else if (normSource === 'applemusic' || normSource === 'apple') {
        params.appleMusicId = sourceId;
      } else if (metadata.isrc) {
        params.isrc = metadata.isrc;
      } else {
        params.title = metadata.cleanTitle || metadata.title;
        params.artist = metadata.artist || metadata.artists?.[0];
        params.durationMs = metadata.durationMs;
      }

      const enriched = await matchTrackWithMusixmatch(params, {
        ...options,
        apiUrl: this.musixmatchConfig?.apiUrl,
        getToken: this.musixmatchConfig?.getToken,
      });

      if (enriched) {
        // Fill missing ISRC in metadata
        if (!metadata.isrc && enriched.isrc) {
          metadata.isrc = enriched.isrc;
        }
      }

      return enriched;
    } catch {
      return null;
    }
  }

  // Executes primary search and falls back to cleanTitle + primary artist if unverified
  private async queryAdapterWithFallback(
    adapter: MusicAdapter,
    query: string,
    metadata: TrackMetadata,
    options?: ResolveOptions
  ): Promise<ResolvedLink | null> {
    try {
      let result = await adapter.search(query, metadata, options);

      // If primary search yielded no verified match, try fallback with raw title + primary artist
      if ((!result || !result.isVerified) && metadata.cleanTitle && metadata.cleanTitle !== metadata.title) {
        const fallbackQuery = cleanSearchQuery(
          metadata.artist ? `${metadata.cleanTitle} ${metadata.artist}` : metadata.cleanTitle
        );
        if (fallbackQuery !== query) {
          const fallbackResult = await adapter.search(fallbackQuery, metadata, options);
          if (fallbackResult && (fallbackResult.score || 0) > (result?.score || 0)) {
            result = fallbackResult;
          }
        }
      }

      return result;
    } catch {
      return null;
    }
  }

  // Resolves a streaming service link across all (or selected) registered platforms.
  async resolve(
    url: string,
    targetPlatforms?: string[],
    options?: ResolveOptions
  ): Promise<ResolveResult> {
    const parser = this.getParserForUrl(url);
    if (!parser) {
      throw new Error(`No parser found for URL: ${url}`);
    }

    const parsedInfo = parser.parse(url);
    const sourceId = parsedInfo.id;
    const resolveOpts: ResolveOptions = {
      ...options,
      preferredCountry: options?.preferredCountry || (parsedInfo as { storefront?: string }).storefront,
    };

    const rawMetadata = await parser.fetchMetadata(sourceId, url, resolveOpts);
    const metadata = this.normalizeMetadata(rawMetadata);

    // Cross-platform metadata enrichment via Musixmatch
    const enriched = await this.enrichMetadata(metadata, parser.id, sourceId, resolveOpts);

    const query = parser.buildSearchQuery(metadata);
    const platformKeys = targetPlatforms ?? Array.from(this.adapters.keys());
    const links: Record<string, ResolvedLink | null> = {};

    // For the source platform itself, set the direct link as verified
    links[parser.id] = {
      platform: parser.id,
      url,
      id: sourceId,
      isVerified: true,
      score: 1,
      matchReason: 'direct',
    };

    // Query all other requested adapters concurrently
    const adapterPromises = platformKeys
      .filter((platformId) => platformId !== parser.id && this.adapters.has(platformId))
      .map(async (platformId) => {
        const adapter = this.adapters.get(platformId)!;
        links[platformId] = await this.queryAdapterWithFallback(adapter, query, metadata, resolveOpts);
      });

    await Promise.all(adapterPromises);

    // Fill in platform links from Musixmatch cross-platform mapping if adapter search yielded unverified result
    if (enriched) {
      if (
        (!links['spotify'] || !links['spotify'].isVerified) &&
        enriched.spotifyId &&
        this.adapters.has('spotify') &&
        parser.id !== 'spotify'
      ) {
        links['spotify'] = {
          platform: 'spotify',
          url: `https://open.spotify.com/track/${enriched.spotifyId}`,
          id: enriched.spotifyId,
          isVerified: true,
          score: 0.95,
          matchReason: 'isrc',
        };
      }

      const appleKey = links['appleMusic'] ? 'appleMusic' : 'applemusic';
      if (
        (!links[appleKey] || !links[appleKey]?.isVerified) &&
        enriched.appleMusicId &&
        this.adapters.has('appleMusic') &&
        parser.id !== 'appleMusic' &&
        parser.id !== 'applemusic'
      ) {
        links['appleMusic'] = {
          platform: 'appleMusic',
          url: `https://music.apple.com/song/${enriched.appleMusicId}`,
          id: enriched.appleMusicId,
          isVerified: true,
          score: 0.95,
          matchReason: 'isrc',
        };
      }
    }

    return {
      sourceUrl: url,
      sourcePlatform: parser.id,
      sourceId,
      metadata,
      query,
      links,
    };
  }

  // Search across all platforms with a raw query and metadata object
  async searchAcross(
    query: string,
    metadata: TrackMetadata,
    targetPlatforms?: string[],
    options?: ResolveOptions
  ): Promise<Record<string, ResolvedLink | null>> {
    const normalizedMeta = this.normalizeMetadata(metadata);

    // Enrich metadata if ISRC missing
    await this.enrichMetadata(normalizedMeta, '', '', options);

    const platformKeys = targetPlatforms ?? Array.from(this.adapters.keys());
    const links: Record<string, ResolvedLink | null> = {};

    const adapterPromises = platformKeys
      .filter((platformId) => this.adapters.has(platformId))
      .map(async (platformId) => {
        const adapter = this.adapters.get(platformId)!;
        links[platformId] = await this.queryAdapterWithFallback(adapter, query, normalizedMeta, options);
      });

    await Promise.all(adapterPromises);
    return links;
  }
}

