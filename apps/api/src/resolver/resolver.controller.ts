import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ResolverService } from "./resolver.service";
import { ResolveResultDto } from "./dto/resolver-response.dto";
import { ErrorResponseDto } from "../common/dto/error-response.dto";
import { ResolveDto, ResolveQueryDto } from "./dto/resolver-query.dto";
import { ClientIp } from "../common/decorators/client-ip.decorator";

export { ResolveDto };

@ApiTags("Resolver")
@Controller(["api/resolver", "resolver"])
export class ResolverController {
  constructor(private readonly resolverService: ResolverService) {}

  // GET /api/resolver?url=https://open.spotify.com/track/...
  @ApiOperation({
    summary: "Resolve track metadata and links by URL query",
    description:
      "Resolves canonical song metadata (title, artist, album, ISRC, duration, artwork) and discovers matching URLs across Spotify, Apple Music, Deezer, NetEase, and QQ Music (6 RPM/IP).",
  })
  @ApiQuery({
    name: "url",
    required: true,
    description:
      "Source song URL from Spotify, Apple Music, Deezer, NetEase, or QQ Music",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: "Canonical song metadata and verified platform links",
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Missing or invalid streaming URL parameter",
  })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get()
  async resolveByQuery(
    @Query() query: ResolveQueryDto,
    @ClientIp() clientIp: string,
  ) {
    return this.resolverService.resolveUrl(
      query.url,
      undefined,
      undefined,
      clientIp,
    );
  }

  // POST /api/resolver
  // Body: { "url": "https://...", "targetPlatforms": ["spotify", "deezer", "netease", "appleMusic", "qqMusic"] }
  @ApiOperation({
    summary: "Resolve track metadata and links via JSON body",
    description:
      "Alternative JSON body endpoint to resolve canonical metadata and discover cross-platform streaming links (6 RPM/IP).",
  })
  @ApiBody({ type: ResolveDto })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: "Resolved metadata and matched platform links",
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: "Invalid request body or unsupported URL",
  })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post()
  async resolveByBody(
    @Body() dto: ResolveDto,
    @ClientIp() clientIp: string,
  ) {
    return this.resolverService.resolveUrl(
      dto.url,
      dto.targetPlatforms,
      undefined,
      clientIp,
    );
  }

  // GET /api/resolver/sample
  @ApiOperation({
    summary: "Get a sample cross-platform resolution result",
    description:
      "Returns pre-resolved sample metadata and links for Rick Astley - Never Gonna Give You Up.",
  })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: "Sample resolution result",
  })
  @Get("sample")
  async getSample() {
    return this.resolverService.resolveSample();
  }
}
