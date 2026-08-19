import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TracksService } from './tracks.service';

class TrackQueryDto {
  platform?: string;
  id?: string;
  url?: string;
}

@Controller('api')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  // GET /api/tracks
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

  // GET /api/tracks/search?q=Rick+Astley
  @Get('tracks/search')
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.tracksService.search(q, limit ? parseInt(limit, 10) : 20);
  }

  // GET /api/lyrics?platform=spotify&id=...&format=ttml
  // GET /api/lyrics?trackId=...&format=ttml
  @Get('lyrics')
  async getLyrics(
    @Query('trackId') trackId?: string,
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string,
    @Query('format') format?: string,
    @Res() res?: Response
  ) {
    const result = await this.tracksService.getLyrics({
      trackId,
      platform,
      id,
      url,
      format,
    });

    if (res) {
      res.setHeader('Content-Type', result.contentType);
      return res.send(result.content);
    }
    return result.content;
  }

  // GET /api/tracks/:id/lyrics?format=ttml
  // GET /api/lyrics/:id?format=lrc
  @Get(['tracks/:id/lyrics', 'lyrics/:id'])
  async getLyricsById(
    @Param('id') trackId: string,
    @Query('format') format?: string,
    @Res() res?: Response
  ) {
    const result = await this.tracksService.getLyrics({
      trackId,
      format,
    });

    if (res) {
      res.setHeader('Content-Type', result.contentType);
      return res.send(result.content);
    }
    return result.content;
  }

  // GET /api/tracks/:id
  @Get('tracks/:id')
  async getById(@Param('id') id: string) {
    const track = await this.tracksService.findById(id);
    return this.tracksService.sanitizeTrack(track);
  }
}
