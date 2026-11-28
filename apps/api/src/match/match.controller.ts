import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ClientIp } from "../common/decorators/client-ip.decorator";
import { ErrorResponseDto } from "../common/dto/error-response.dto";
import { MatchAudioDto } from "./dto/match-request.dto";
import { AudioMatchResponseDto } from "./dto/match-response.dto";
import { MatchService } from "./match.service";

// Enough to re-listen every ~25 s while following a song, with room for retries
export const MATCH_LIMIT_PER_MINUTE = 12;

@ApiTags("Lyrics")
@Controller(["api", ""])
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @ApiOperation({
    summary: "Identify a song from an audio fingerprint",
    description:
      "Recognises the song in a short audio clip and returns the track, where in it the clip started, and its synced lyrics. The clip is sent as a Shazam signature, a NetEase fingerprint (made by NetEase's afp.wasm), or both; the /listen page makes them in the browser, so no audio is uploaded. `provider` picks the service: auto (the default) asks Shazam first for a new song and NetEase first while following one (expectedTrackId set), falling back to the other when the first hears nothing, can't load the song, or is busy. When the uploads NetEase hears are covers of the original, the original recording is returned. Limited to 12 matches per minute per IP, separately from other endpoints; a match that finds a track not yet indexed also counts toward the uncached lyrics limit.",
  })
  @ApiBody({ type: MatchAudioDto })
  @ApiOkResponse({ type: AudioMatchResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Missing or malformed fingerprint or shazamSignature",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "No song matched the clip (a NetEase miss carries its noMatchReason)",
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: "More than 12 matches in a minute; Retry-After-medium gives the seconds to wait",
  })
  @ApiResponse({
    status: 502,
    type: ErrorResponseDto,
    description: "The song recognition service failed",
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: "Shazam or NetEase is cooling down after errors or rate limits; try again later",
  })
  // Its own budget: overriding the global "medium" throttler gives this route a
  // separate per-IP limit
  @Throttle({ medium: { limit: MATCH_LIMIT_PER_MINUTE, ttl: 60_000 } })
  @HttpCode(200)
  @Post("match")
  async match(@Body() body: MatchAudioDto, @ClientIp() clientIp: string) {
    return this.matchService.match(body, clientIp);
  }
}
