import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, Subject } from 'rxjs';
import type {
  FormattedLyricsResult,
  GetOrSyncTrackOptions,
  ProgressLogEvent,
} from '@repo/types';
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
  // Real-time EventStream (SSE) Endpoint
  // ==========================================

  // GET /api/lyrics/stream?platform=spotify&id=...&format=ttml (or ?url=...)
  @Sse('lyrics/stream')
  streamLyrics(
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string,
    @Query('format') format?: string,
    @Query('forceRefresh') forceRefresh?: string
  ): Observable<MessageEvent> {
    return this.handleLyricsStream({ platform, id, url, format, forceRefresh });
  }

  // GET /api/tracks/stream?platform=spotify&id=...&format=ttml (or ?url=...)
  @Sse('tracks/stream')
  streamTracks(
    @Query('platform') platform?: string,
    @Query('id') id?: string,
    @Query('url') url?: string,
    @Query('format') format?: string,
    @Query('forceRefresh') forceRefresh?: string
  ): Observable<MessageEvent> {
    return this.handleLyricsStream({ platform, id, url, format, forceRefresh });
  }

  private handleLyricsStream(query: {
    platform?: string;
    id?: string;
    url?: string;
    format?: string;
    forceRefresh?: string;
  }): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const shouldForceRefresh = query.forceRefresh === 'true' || query.forceRefresh === '1';

    // Execute background resolution while streaming progress events
    this.tracksService
      .streamLyrics(
        {
          platform: query.platform,
          id: query.id,
          url: query.url,
          format: query.format || 'json',
          forceRefresh: shouldForceRefresh,
        },
        (event: ProgressLogEvent) => {
          subject.next({
            data: event,
          });
        }
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Unknown error during stream';
        subject.next({
          data: {
            stage: 'error',
            data: { error: message },
            timestamp: Date.now(),
          },
        });
      })
      .finally(() => {
        // Complete the SSE stream once done
        subject.complete();
      });

    return subject.asObservable();
  }

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
