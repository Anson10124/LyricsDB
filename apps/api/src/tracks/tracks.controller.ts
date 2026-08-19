import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TracksService } from './tracks.service';

class TrackQueryDto {
  platform?: string;
  id?: string;
  url?: string;
}

@Controller('api/tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  // Primary Unified Endpoint (Read-Through Cache):
  // GET /api/tracks?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT
  // GET /api/tracks?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
  //
  // Flow:
  // 1. Checks PostgreSQL database (Instant ~2ms if already indexed).
  // 2. If missing, resolves across all streaming services, saves to PostgreSQL, and returns unified track.
  @Get()
  async getTrack(
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string
  ) {
    return this.tracksService.getOrSyncTrack({ platform, id, url });
  }

  // POST /api/tracks
  // JSON Body alternative: { "platform": "spotify", "id": "..." } or { "url": "..." }
  @Post()
  async postTrack(@Body() dto: TrackQueryDto) {
    return this.tracksService.getOrSyncTrack(dto);
  }

  // GET /api/tracks/search?q=Rick+Astley
  // Search already indexed tracks in the database by title/artist
  @Get('search')
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.tracksService.search(q, limit ? parseInt(limit, 10) : 20);
  }

  // GET /api/tracks/:id
  // Lookup by internal database UUID
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.tracksService.findById(id);
  }
}
