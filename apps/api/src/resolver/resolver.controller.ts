import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ResolverService } from './resolver.service';
import { ResolveResultDto } from './dto/resolver-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

export class ResolveDto {
  @ApiProperty({
    description: 'Source song URL from any supported streaming platform',
    example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  })
  url!: string;

  @ApiProperty({
    required: false,
    description: 'Optional list of target platforms to restrict resolution',
    type: [String],
    example: ['spotify', 'deezer', 'netease', 'apple', 'qq'],
  })
  targetPlatforms?: string[];
}

@ApiTags('Resolver')
@Controller(['api/resolver', 'resolver'])
export class ResolverController {
  constructor(private readonly resolverService: ResolverService) {}

  // GET /api/resolver?url=https://open.spotify.com/track/...
  @ApiOperation({
    summary: 'Resolve track metadata and links by URL query',
    description: 'Resolves canonical song metadata (title, artist, album, ISRC, duration, artwork) and discovers matching URLs across Spotify, Apple Music, Deezer, NetEase, and QQ Music.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    description: 'Source song URL from Spotify, Apple Music, Deezer, NetEase, or QQ Music',
    example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: 'Canonical song metadata and verified platform links',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid streaming URL parameter',
  })
  @Get()
  async resolveByQuery(@Query('url') url: string) {
    return this.resolverService.resolveUrl(url);
  }

  // POST /api/resolver
  // Body: { "url": "https://...", "targetPlatforms": ["spotify", "deezer", "netease", "appleMusic", "qqMusic"] }
  @ApiOperation({
    summary: 'Resolve track metadata and links via JSON body',
    description: 'Alternative JSON body endpoint to resolve canonical metadata and discover cross-platform streaming links.',
  })
  @ApiBody({ type: ResolveDto })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: 'Resolved metadata and matched platform links',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid request body or unsupported URL',
  })
  @Post()
  async resolveByBody(@Body() dto: ResolveDto) {
    return this.resolverService.resolveUrl(dto.url, dto.targetPlatforms);
  }

  // GET /api/resolver/sample
  @ApiOperation({
    summary: 'Get a sample cross-platform resolution result',
    description: 'Returns pre-resolved sample metadata and links for Rick Astley - Never Gonna Give You Up.',
  })
  @ApiOkResponse({
    type: ResolveResultDto,
    description: 'Sample resolution result',
  })
  @Get('sample')
  async getSample() {
    return this.resolverService.resolveSample();
  }
}

