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
  MusicAdapter,
  MusicParser,
  ResolveOptions,
  ResolverConfig,
  ResolveResult,
  ResolvedLink,
  TrackMetadata,
} from './types.js';
import { cleanSearchQuery, normalizeSongTitle, splitArtists } from './utils/query.js';

export class MusicResolver {
  private parsers = new Map<string, MusicParser>();
  private adapters = new Map<string, MusicAdapter>();

  constructor(config?: ResolverConfig) {
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

