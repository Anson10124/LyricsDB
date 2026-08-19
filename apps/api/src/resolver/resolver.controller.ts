import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ResolverService } from './resolver.service';

class ResolveDto {
  url!: string;
  targetPlatforms?: string[];
}

@Controller('api')
export class ResolverController {
  constructor(private readonly resolverService: ResolverService) {}

  // GET /api/resolve?url=https://open.spotify.com/track/...
  @Get('resolve')
  async resolveByQuery(@Query('url') url: string) {
    return this.resolverService.resolveUrl(url);
  }

  // POST /api/resolve
  // Body: { "url": "https://...", "targetPlatforms": ["spotify", "deezer", "netease"] }
  @Post('resolve')
  async resolveByBody(@Body() dto: ResolveDto) {
    return this.resolverService.resolveUrl(dto.url, dto.targetPlatforms);
  }

  // GET /api/sample
  @Get('sample')
  async getSample() {
    return this.resolverService.resolveSample();
  }
}
