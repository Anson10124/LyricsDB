import { ApiProperty } from '@nestjs/swagger';

export class ResolverTrackMetadataDto {
  @ApiProperty({
    example: '4cOdK2wGLETKBW3PvgPWqT',
    description: 'Source platform resource ID',
  })
  id!: string;

  @ApiProperty({
    example: 'Never Gonna Give You Up',
    description: 'Canonical song title',
  })
  title!: string;

  @ApiProperty({
    example: 'Never Gonna Give You Up',
    description: 'Cleaned song title without parenthetical suffixes',
    required: false,
  })
  cleanTitle?: string;

  @ApiProperty({
    example: 'Rick Astley',
    description: 'Primary artist name',
    required: false,
  })
  artist?: string;

  @ApiProperty({
    example: ['Rick Astley'],
    description: 'List of all performing artists',
    type: [String],
    required: false,
  })
  artists?: string[];

  @ApiProperty({
    example: 'Whenever You Need Somebody',
    description: 'Album or EP title',
    required: false,
  })
  album?: string;

  @ApiProperty({
    example: 'song',
    enum: ['song', 'album', 'playlist', 'artist', 'podcast', 'show'],
    description: 'Resolved media resource type',
  })
  type!: string;

  @ApiProperty({
    example: 'https://i.scdn.co/image/ab67616d0000b2735755e164993798e0c9ef7d7a',
    description: 'Public URL to album artwork image',
    required: false,
  })
  image?: string;

  @ApiProperty({
    example: 213573,
    description: 'Track duration in milliseconds',
    required: false,
  })
  durationMs?: number;

  @ApiProperty({
    example: 'GBARL8700014',
    description: 'International Standard Recording Code (ISRC)',
    required: false,
  })
  isrc?: string;
}

export class ResolvedLinkDto {
  @ApiProperty({
    example: 'appleMusic',
    description: 'Streaming service platform key',
  })
  platform!: string;

  @ApiProperty({
    example: 'https://music.apple.com/us/album/never-gonna-give-you-up/1559523357?i=1559523359',
    description: 'Direct public web URL to the track',
  })
  url!: string;

  @ApiProperty({
    example: '1559523359',
    description: 'Platform-specific track identifier',
    required: false,
  })
  id?: string;

  @ApiProperty({
    example: true,
    description: 'Whether the match is confirmed by strict criteria (e.g. verified ISRC match)',
    required: false,
  })
  isVerified?: boolean;

  @ApiProperty({
    example: 0.98,
    description: 'Fuzzy confidence match score between 0.0 and 1.0',
    required: false,
  })
  score?: number;

  @ApiProperty({
    example: 'isrc',
    enum: ['isrc', 'fuzzy', 'direct'],
    description: 'Matching strategy that identified this cross-platform link',
    required: false,
  })
  matchReason?: 'isrc' | 'fuzzy' | 'direct';
}

export class ResolveResultDto {
  @ApiProperty({
    example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    description: 'Original input streaming URL',
  })
  sourceUrl!: string;

  @ApiProperty({
    example: 'spotify',
    description: 'Platform of the source URL',
  })
  sourcePlatform!: string;

  @ApiProperty({
    example: '4cOdK2wGLETKBW3PvgPWqT',
    description: 'Resource ID extracted from the source URL',
  })
  sourceId!: string;

  @ApiProperty({
    type: () => ResolverTrackMetadataDto,
    description: 'Canonical track metadata extracted from the source platform',
  })
  metadata!: ResolverTrackMetadataDto;

  @ApiProperty({
    example: 'Rick Astley Never Gonna Give You Up',
    description: 'Normalized query string used for cross-platform matching',
  })
  query!: string;

  @ApiProperty({
    description: 'Cross-platform links matched by the resolver engine',
    example: {
      spotify: {
        platform: 'spotify',
        url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        id: '4cOdK2wGLETKBW3PvgPWqT',
        isVerified: true,
        score: 1,
        matchReason: 'direct',
      },
      appleMusic: {
        platform: 'appleMusic',
        url: 'https://music.apple.com/us/album/never-gonna-give-you-up/1559523357?i=1559523359',
        id: '1559523359',
        isVerified: true,
        score: 0.98,
        matchReason: 'isrc',
      },
      deezer: {
        platform: 'deezer',
        url: 'https://www.deezer.com/track/3537337561',
        id: '3537337561',
        isVerified: true,
        score: 0.95,
        matchReason: 'isrc',
      },
      netease: {
        platform: 'netease',
        url: 'https://music.163.com/#/song?id=2755500197',
        id: '2755500197',
        isVerified: true,
        score: 0.92,
        matchReason: 'fuzzy',
      },
      qqMusic: {
        platform: 'qqMusic',
        url: 'https://y.qq.com/n/ryqq/songDetail/000f1Vqw2ACkez',
        id: '000f1Vqw2ACkez',
        isVerified: true,
        score: 0.94,
        matchReason: 'fuzzy',
      },
    },
  })
  links!: Record<string, ResolvedLinkDto | null>;
}
