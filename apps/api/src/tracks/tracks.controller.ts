import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { FormattedLyricsResult, GetOrSyncTrackOptions } from '@repo/types';
import { TracksService } from './tracks.service';

export class TrackQueryDto implements GetOrSyncTrackOptions {
  platform?: string;
  id?: string;
  url?: string;
}

@Controller('api')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  // ==========================================
  // Tracks Endpoints
  // ==========================================

  // GET /api/tracks?platform=spotify&id=... (or ?url=...)
  @Get('tracks')
  async getTrack(
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string
  ) {
    const track = await this.tracksService.getOrSyncTrack({ platform, id, url });
    return this.tracksService.sanitizeTrack(track);
  }

  // POST /api/tracks
  @Post('tracks')
  async postTrack(@Body() dto: TrackQueryDto) {
    const track = await this.tracksService.getOrSyncTrack(dto);
    return this.tracksService.sanitizeTrack(track);
  }

  // GET /api/tracks/search?q=Rick+Astley&limit=20
  @Get('tracks/search')
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.tracksService.search(q, limit ? parseInt(limit, 10) : 20);
  }

  // GET /api/tracks/:id
  @Get('tracks/:id')
  async getById(@Param('id') id: string) {
    const track = await this.tracksService.findById(id);
    return this.tracksService.sanitizeTrack(track);
  }

  // ==========================================
  // Lyrics Endpoints
  // ==========================================

  // GET /api/tracks/:id/lyrics?format=ttml
  @Get('tracks/:id/lyrics')
  async getLyricsById(
    @Param('id') trackId: string,
    @Query('format') format?: string,
    @Res() res?: Response
  ) {
    const result = await this.tracksService.getLyrics({
      trackId,
      format,
    });
    return this.sendLyricsResponse(result, res);
  }

  // GET /api/lyrics?platform=spotify&id=...&format=ttml (or ?url=...&format=...)
  @Get('lyrics')
  async getLyrics(
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string,
    @Query('format') format?: string,
    @Res() res?: Response
  ) {
    const result = await this.tracksService.getLyrics({
      platform,
      id,
      url,
      format,
    });
    return this.sendLyricsResponse(result, res);
  }

  private sendLyricsResponse(result: FormattedLyricsResult, res?: Response) {
    if (res) {
      res.setHeader('Content-Type', result.contentType);
      return res.send(result.content);
    }
    return result.content;
  }
}
