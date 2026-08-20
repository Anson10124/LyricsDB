import { ApiProperty } from '@nestjs/swagger';

export class SanitizedTrackDto {
  @ApiProperty({
    example: '791f8b9b-9593-46ce-9852-b1801d88a5d1',
    description: 'Unique database identifier (UUID v4)',
  })
  id!: string;

  @ApiProperty({
    example: 'USQX92504224',
    description: 'International Standard Recording Code (ISRC)',
    required: false,
    nullable: true,
  })
  isrc?: string | null;

  @ApiProperty({
    example: '4cOdK2wGLETKBW3PvgPWqT',
    description: 'Spotify track identifier',
    required: false,
    nullable: true,
  })
  spotifyId?: string | null;

  @ApiProperty({
    example: '1559523359',
    description: 'Apple Music song identifier',
    required: false,
    nullable: true,
  })
  appleMusicId?: string | null;

  @ApiProperty({
    example: '3537337561',
    description: 'Deezer track identifier',
    required: false,
    nullable: true,
  })
  deezerId?: string | null;

  @ApiProperty({
    example: '2755500197',
    description: 'NetEase Cloud Music song identifier',
    required: false,
    nullable: true,
  })
  neteaseId?: string | null;

  @ApiProperty({
    example: '000f1Vqw2ACkez',
    description: 'QQ Music song mid/identifier',
    required: false,
    nullable: true,
  })
  qqMusicId?: string | null;

  @ApiProperty({
    example: 'Never Gonna Give You Up',
    description: 'Track song title',
  })
  title!: string;

  @ApiProperty({
    example: ['Rick Astley'],
    description: 'List of primary and featured artist names',
    type: [String],
  })
  artists!: string[];

  @ApiProperty({
    example: 'Whenever You Need Somebody',
    description: 'Album or release name',
    required: false,
    nullable: true,
  })
  album?: string | null;

  @ApiProperty({
    example: 213573,
    description: 'Track duration in milliseconds',
  })
  durationMs!: number;

  @ApiProperty({
    example: 'https://i.scdn.co/image/ab67616d0000b2735755e164993798e0c9ef7d7a',
    description: 'Public URL to high-resolution album cover art',
    required: false,
    nullable: true,
  })
  artworkUrl?: string | null;

  @ApiProperty({
    example: 'word',
    enum: ['word', 'line', 'plain', null],
    description: 'Precision level of available synchronized lyrics',
    required: false,
    nullable: true,
  })
  lyricsType?: 'word' | 'line' | 'plain' | null;

  @ApiProperty({
    example: 'qqmusic',
    description: 'Upstream lyrics provider source (qqmusic, deezer, netease, musixmatch, lrclib)',
    required: false,
    nullable: true,
  })
  lyricsProvider?: string | null;

  @ApiProperty({
    example: true,
    description: 'Indicates whether track metadata and platform links have been manually verified',
  })
  isVerified!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether synchronized or plain text lyrics exist in the database for this track',
  })
  hasLyrics!: boolean;

  @ApiProperty({
    example: '2026-08-20T22:31:20.790Z',
    description: 'Timestamp when this track was first indexed into PostgreSQL',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-08-20T22:31:20.790Z',
    description: 'Timestamp when this track was last synchronized',
  })
  updatedAt!: string;
}
