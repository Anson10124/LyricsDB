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
        tracksGet: 'GET /api/tracks?platform={spotify|apple|deezer|netease|qq}&id={id} (or ?url={link})',
        tracksSearch: 'GET /api/tracks/search?q={search_term}',
        trackById: 'GET /api/tracks/{uuid}',
        resolveTest: 'GET /api/resolve?url={streaming_link}',
        sampleTest: 'GET /api/sample',
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
