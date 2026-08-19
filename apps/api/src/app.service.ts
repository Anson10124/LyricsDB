import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      service: 'LyricsDB API',
      version: '0.0.1',
      status: 'operational',
      endpoints: {
        health: 'GET /health',
        resolveQuery: 'GET /api/resolve?url={streaming_link}',
        resolveBody: 'POST /api/resolve (Body: { url: "..." })',
        sample: 'GET /api/sample (Resolves sample Rick Astley track across Spotify, Apple Music, Deezer, NetEase, QQ Music)',
      },
    };
  }

  getHealth(): { status: string; message: string; timestamp: string } {
    return {
      status: 'ok',
      message: 'LyricsDB API is running',
      timestamp: new Date().toISOString(),
    };
  }
}
