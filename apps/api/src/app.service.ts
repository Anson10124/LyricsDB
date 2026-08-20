import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      service: 'LyricsDB API',
      version: '0.0.1',
      status: 'operational',
      endpoints: {
        system: {
          server: 'GET /',
          health: 'GET /health',
        },
        tracks: {
          getOrSync: 'GET /api/tracks?platform={spotify|apple|deezer|netease|qq}&id={id} (or ?url={link})',
          search: 'GET /api/tracks/search?q={search_term}&limit={limit}',
          getById: 'GET /api/tracks/{id}',
        },
        lyrics: {
          getByTrackId: 'GET /api/tracks/{id}/lyrics?format={json|ttml|lrc|...}',
          getOrSyncLyrics: 'GET /api/lyrics?platform={platform}&id={id}&format={format} (or ?url={link}&format={format})',
        },
        resolver: {
          resolve: 'GET /api/resolver?url={streaming_link}',
          sample: 'GET /api/resolver/sample',
        },
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
