import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ResolverService } from './resolver.service';

class ResolveDto {
  url!: string;
  targetPlatforms?: string[];
}

@Controller('api/resolver')
export class ResolverController {
  constructor(private readonly resolverService: ResolverService) {}

  // GET /api/resolver?url=https://open.spotify.com/track/...
  @Get()
  async resolveByQuery(@Query('url') url: string) {
    return this.resolverService.resolveUrl(url);
  }

  // POST /api/resolver
  // Body: { "url": "https://...", "targetPlatforms": ["spotify", "deezer", "netease", "appleMusic", "qqMusic"] }
  @Post()
  async resolveByBody(@Body() dto: ResolveDto) {
    return this.resolverService.resolveUrl(dto.url, dto.targetPlatforms);
  }

  // GET /api/resolver/sample
  @Get('sample')
  async getSample() {
    return this.resolverService.resolveSample();
  }
}
