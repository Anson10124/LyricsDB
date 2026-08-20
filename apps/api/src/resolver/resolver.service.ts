import { Injectable, BadRequestException, Inject, Optional } from '@nestjs/common';
import { MusicResolver, type ResolveResult } from '@repo/music-resolver';
import {
  getMusixmatchToken,
  getSpotifyToken,
  refreshMusixmatchToken,
  refreshSpotifyToken,
  type DatabaseClient,
} from '@repo/database';
import { DATABASE_CONNECTION } from '../database/database.constants';

@Injectable()
export class ResolverService {
  private resolver: MusicResolver;

  constructor(@Optional() @Inject(DATABASE_CONNECTION) private readonly db?: DatabaseClient) {
    this.resolver = new MusicResolver({
      spotify: {
        getToken: async (options, forceRefresh) => {
          if (forceRefresh) {
            return refreshSpotifyToken(this.db, { timeout: options?.timeout });
          }
          return getSpotifyToken(this.db, { timeout: options?.timeout });
        },
      },
      musixmatch: {
        getToken: async (options, forceRefresh) => {
          if (forceRefresh) {
            return refreshMusixmatchToken(this.db, { timeout: options?.timeout });
          }
          return getMusixmatchToken(this.db, { timeout: options?.timeout });
        },
      },
    });
  }

  async resolveUrl(url: string, targetPlatforms?: string[]): Promise<ResolveResult> {
    if (!url || typeof url !== 'string') {
      throw new BadRequestException('Query parameter "url" is required.');
    }

    try {
      const result = await this.resolver.resolve(url.trim(), targetPlatforms);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve streaming link';
      throw new BadRequestException(message);
    }
  }

  async resolveSample(): Promise<ResolveResult> {
    // Sample track: "Never Gonna Give You Up"
    const sampleUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    return this.resolveUrl(sampleUrl);
  }
}
