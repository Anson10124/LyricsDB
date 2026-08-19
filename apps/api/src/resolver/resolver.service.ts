import { Injectable, BadRequestException } from '@nestjs/common';
import { MusicResolver, type ResolveResult } from '@repo/music-resolver';

@Injectable()
export class ResolverService {
  private resolver = new MusicResolver();

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
    // Sample track
    const sampleUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    return this.resolveUrl(sampleUrl);
  }
}
