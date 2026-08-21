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
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Observable, Subject } from "rxjs";
import type {
  FormattedLyricsResult,
  GetOrSyncTrackOptions,
  ProgressLogEvent,
} from "@repo/types";
import { TracksService } from "./tracks.service";
import { SanitizedTrackDto } from "./dto/track-response.dto";
import { ErrorResponseDto } from "../common/dto/error-response.dto";

export class TrackQueryDto implements GetOrSyncTrackOptions {
  @ApiProperty({
    required: false,
    description: "Platform name (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  platform?: string;

  @ApiProperty({
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  id?: string;

  @ApiProperty({
    required: false,
    description: "Direct song/track URL from any supported service",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  url?: string;
}

const SUPPORTED_FORMATS = [
  "ttml",
  "lrc",
  "lrca2",
  "yrc",
  "qrc",
  "eslrc",
  "ass",
  "lyl",
  "lys",
  "lqe",
  "json",
] as const;

@ApiTags("Tracks")
@Controller(["api", ""])
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  // ==========================================
  // Real-time EventStream (SSE) Endpoint
  // ==========================================

  @ApiTags("Lyrics")
  @ApiOperation({
    summary: "Stream lyrics resolution progress via SSE",
    description:
      "Server-Sent Events endpoint streaming real-time extraction, platform matching, and timing progress.",
  })
  @ApiQuery({
    name: "platform",
    required: false,
    description:
      "Platform identifier (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  @ApiQuery({
    name: "id",
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "url",
    required: false,
    description: "Direct song/track URL from any streaming platform",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "format",
    required: false,
    enum: SUPPORTED_FORMATS,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @ApiQuery({
    name: "forceRefresh",
    required: false,
    type: Boolean,
    description: "Bypass cached database results and force live re-fetching",
    example: false,
  })
  @ApiResponse({
    status: 200,
    description:
      "Server-Sent Events stream emitting lifecycle events: init, cache_hit, cache_miss, resolving, platform_matched, lyrics_searching, lyrics_found, saving, done, error",
    content: {
      "text/event-stream": {
        schema: {
          type: "object",
          properties: {
            stage: {
              type: "string",
              enum: [
                "init",
                "cache_hit",
                "cache_miss",
                "resolving",
                "platform_matched",
                "lyrics_searching",
                "lyrics_found",
                "saving",
                "done",
                "error",
              ],
              example: "done",
            },
            data: {
              type: "object",
              example: {
                track: {
                  id: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
                  isrc: "GBARL8700014",
                  spotifyId: "4cOdK2wGLETKBW3PvgPWqT",
                  appleMusicId: "1559523359",
                  deezerId: "3537337561",
                  neteaseId: "2755500197",
                  qqMusicId: "000f1Vqw2ACkez",
                  title: "Never Gonna Give You Up",
                  artists: ["Rick Astley"],
                  album: "Whenever You Need Somebody",
                  durationMs: 213573,
                  artworkUrl:
                    "https://i.scdn.co/image/ab67616d0000b2735755e164993798e0c9ef7d7a",
                  lyricsType: "word",
                  lyricsProvider: "qqmusic",
                  isVerified: true,
                  hasLyrics: true,
                },
                lyrics: [
                  [
                    [1, 18500, 380, "Never "],
                    [1, 18900, 390, "gonna "],
                    [1, 19300, 480, "give "],
                    [1, 19800, 580, "you "],
                    [1, 20400, 1100, "up "],
                  ],
                ],
                format: "json",
                contentType: "application/json",
              },
            },
            timestamp: {
              type: "integer",
              example: 1787262680794,
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Missing required query parameters",
  })
  @Sse("lyrics/stream")
  streamLyrics(
    @Query("platform") platform?: string,
    @Query("id") id?: string,
    @Query("url") url?: string,
    @Query("format") format?: string,
    @Query("forceRefresh") forceRefresh?: string,
  ): Observable<MessageEvent> {
    return this.handleLyricsStream({ platform, id, url, format, forceRefresh });
  }

  @ApiOperation({
    summary: "Stream track resolution progress via SSE",
    description: "Alias for /api/lyrics/stream",
  })
  @ApiQuery({
    name: "platform",
    required: false,
    description:
      "Platform identifier (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  @ApiQuery({
    name: "id",
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "url",
    required: false,
    description: "Direct song/track URL",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "format",
    required: false,
    enum: SUPPORTED_FORMATS,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @ApiQuery({
    name: "forceRefresh",
    required: false,
    type: Boolean,
    description: "Bypass cached results and force live re-fetching",
    example: false,
  })
  @ApiResponse({
    status: 200,
    description: "Server-Sent Events stream emitting real-time progress events",
    content: {
      "text/event-stream": {
        schema: {
          type: "object",
          properties: {
            stage: { type: "string", example: "done" },
            data: { type: "object" },
            timestamp: { type: "integer", example: 1787262680794 },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @Sse("tracks/stream")
  streamTracks(
    @Query("platform") platform?: string,
    @Query("id") id?: string,
    @Query("url") url?: string,
    @Query("format") format?: string,
    @Query("forceRefresh") forceRefresh?: string,
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
    const shouldForceRefresh =
      query.forceRefresh === "true" || query.forceRefresh === "1";

    // Execute background resolution while streaming progress events
    this.tracksService
      .streamLyrics(
        {
          platform: query.platform,
          id: query.id,
          url: query.url,
          format: query.format || "json",
          forceRefresh: shouldForceRefresh,
        },
        (event: ProgressLogEvent) => {
          subject.next({
            data: event,
          });
        },
      )
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Unknown error during stream";
        subject.next({
          data: {
            stage: "error",
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

  @ApiOperation({
    summary: "Get or synchronize a track by platform, ID, or URL",
    description:
      "Looks up a track in the database cache (~2ms) or fetches, resolves cross-platform links, and caches metadata in PostgreSQL.",
  })
  @ApiQuery({
    name: "platform",
    required: false,
    description:
      "Platform identifier (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  @ApiQuery({
    name: "id",
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "url",
    required: false,
    description:
      "Direct song/track URL from Spotify, Apple Music, Deezer, NetEase, or QQ Music",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiOkResponse({
    type: SanitizedTrackDto,
    description:
      "Sanitized track metadata with cross-platform IDs and lyric availability flag",
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Missing url or platform + id parameters",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Track could not be resolved from upstream platforms",
  })
  @Get("tracks")
  async getTrack(
    @Query("platform") platform?: string,
    @Query("id") id?: string,
    @Query("url") url?: string,
  ) {
    const track = await this.tracksService.getOrSyncTrack({
      platform,
      id,
      url,
    });
    return this.tracksService.sanitizeTrack(track);
  }

  @ApiOperation({
    summary: "Lookup/sync a track via POST body",
    description:
      "Alternative JSON body endpoint to look up or synchronize track metadata.",
  })
  @ApiBody({ type: TrackQueryDto })
  @ApiOkResponse({
    type: SanitizedTrackDto,
    description: "Sanitized track metadata",
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @Post("tracks")
  async postTrack(@Body() dto: TrackQueryDto) {
    const track = await this.tracksService.getOrSyncTrack(dto);
    return this.tracksService.sanitizeTrack(track);
  }

  @ApiOperation({
    summary: "Search tracks by keyword",
    description:
      "Search indexed tracks in PostgreSQL database by title, artist, or album keyword.",
  })
  @ApiQuery({
    name: "q",
    required: true,
    description: "Search query keyword (song title, artist name, or album)",
    example: "Rick Astley Never Gonna Give You Up",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Maximum number of results to return (default: 20)",
    example: "20",
  })
  @ApiOkResponse({
    type: [SanitizedTrackDto],
    description: "Array of matching tracks ordered by relevance",
  })
  @Get("tracks/search")
  async search(@Query("q") q: string, @Query("limit") limit?: string) {
    return this.tracksService.search(q, limit ? parseInt(limit, 10) : 20);
  }

  @ApiOperation({
    summary: "Get track details by internal database ID",
    description:
      "Retrieves sanitized track metadata by its internal PostgreSQL UUID.",
  })
  @ApiParam({
    name: "id",
    description: "Track internal database UUID v4",
    example: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
  })
  @ApiOkResponse({
    type: SanitizedTrackDto,
    description: "Track details",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Track ID not found in database",
  })
  @Get("tracks/:id")
  async getById(@Param("id") id: string) {
    const track = await this.tracksService.findById(id);
    return this.tracksService.sanitizeTrack(track);
  }

  // ==========================================
  // Lyrics Endpoints
  // ==========================================

  @ApiTags("Lyrics")
  @ApiOperation({
    summary: "Get synchronized lyrics for a track ID",
    description:
      "Retrieves synchronized lyrics formatted into JSON, TTML, LRC, YRC, QRC, ASS, or other supported formats for an existing database track ID.",
  })
  @ApiParam({
    name: "id",
    description: "Track internal database UUID",
    example: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
  })
  @ApiQuery({
    name: "format",
    required: false,
    enum: SUPPORTED_FORMATS,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @ApiResponse({
    status: 200,
    description: "Formatted synchronized lyrics output in requested format",
    content: {
      "application/json": {
        schema: {
          type: "array",
          description:
            "Array of lines, each containing syllable/word token tuples [vocalType, startMs, lengthMs, text]",
          items: {
            type: "array",
            items: {
              type: "array",
              description:
                "Word token: [vocalType (1=Lead, 2=BG, 3=Duet Lead, 4=Duet BG), startMs, lengthMs, text]",
            },
          },
          example: [
            [
              [1, 18500, 380, "Never "],
              [1, 18900, 390, "gonna "],
              [1, 19300, 480, "give "],
              [1, 19800, 580, "you "],
              [1, 20400, 1100, "up "],
            ],
            [
              [1, 22400, 370, "Never "],
              [1, 22800, 380, "gonna "],
              [1, 23200, 490, "let "],
              [1, 23700, 570, "you "],
              [1, 24300, 980, "down "],
            ],
          ],
        },
      },
      "application/xml": {
        schema: { type: "string" },
        example:
          '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:18.500" end="00:00:21.500"><span begin="00:00:18.500" end="00:00:18.880">Never </span><span begin="00:00:18.900" end="00:00:19.290">gonna </span><span begin="00:00:19.300" end="00:00:19.780">give </span><span begin="00:00:19.800" end="00:00:20.380">you </span><span begin="00:00:20.400" end="00:00:21.500">up</span></p></div></body></tt>',
      },
      "text/plain": {
        schema: { type: "string" },
        example:
          "[00:18.50]Never gonna give you up\n[00:22.40]Never gonna let you down\n[00:26.10]Never gonna run around and desert you",
      },
    },
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Track not found or lyrics unavailable for this track",
  })
  @Get("tracks/:id/lyrics")
  async getLyricsById(
    @Param("id") trackId: string,
    @Query("format") format?: string,
    @Res() res?: Response,
  ) {
    const result = await this.tracksService.getLyrics({
      trackId,
      format,
    });
    return this.sendLyricsResponse(result, res);
  }

  @ApiTags("Lyrics")
  @ApiOperation({
    summary: "Get synchronized lyrics by platform ID or URL",
    description:
      "Fetches or synchronizes lyrics on-the-fly from upstream sources and converts them to the requested format.",
  })
  @ApiQuery({
    name: "platform",
    required: false,
    description:
      "Platform identifier (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  @ApiQuery({
    name: "id",
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "url",
    required: false,
    description: "Direct song/track URL",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiQuery({
    name: "format",
    required: false,
    enum: SUPPORTED_FORMATS,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @ApiResponse({
    status: 200,
    description: "Formatted synchronized lyrics payload",
    content: {
      "application/json": {
        schema: {
          type: "array",
          description:
            "Array of lines, each containing syllable/word token tuples [vocalType, startMs, lengthMs, text]",
          items: {
            type: "array",
            items: {
              type: "array",
            },
          },
          example: [
            [
              [1, 18500, 380, "Never "],
              [1, 18900, 390, "gonna "],
              [1, 19300, 480, "give "],
              [1, 19800, 580, "you "],
              [1, 20400, 1100, "up "],
            ],
            [
              [1, 22400, 370, "Never "],
              [1, 22800, 380, "gonna "],
              [1, 23200, 490, "let "],
              [1, 23700, 570, "you "],
              [1, 24300, 980, "down "],
            ],
          ],
        },
      },
      "application/xml": {
        schema: { type: "string" },
        example:
          '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:18.500" end="00:00:21.500"><span begin="00:00:18.500" end="00:00:18.880">Never </span><span begin="00:00:18.900" end="00:00:19.290">gonna </span><span begin="00:00:19.300" end="00:00:19.780">give </span><span begin="00:00:19.800" end="00:00:20.380">you </span><span begin="00:00:20.400" end="00:00:21.500">up</span></p></div></body></tt>',
      },
      "text/plain": {
        schema: { type: "string" },
        example:
          "[00:18.50]Never gonna give you up\n[00:22.40]Never gonna let you down\n[00:26.10]Never gonna run around and desert you",
      },
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Missing url or platform + id",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Lyrics not available for this track",
  })
  @Get("lyrics")
  async getLyrics(
    @Query("platform") platform?: string,
    @Query("id") id?: string,
    @Query("url") url?: string,
    @Query("format") format?: string,
    @Res() res?: Response,
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
      res.setHeader("Content-Type", result.contentType);
      return res.send(result.content);
    }
    return result.content;
  }
}
