import { ApiProperty } from "@nestjs/swagger";
import type {
  LibraryDailyStats,
  LibraryPlatform,
  LibraryPlatformStats,
  LibraryProviderStats,
  LibraryRecentTrack,
  LibraryStats,
  LibraryStatsTotals,
} from "@repo/types";

export class LibraryStatsTotalsDto implements LibraryStatsTotals {
  @ApiProperty({ description: "Total cached tracks", example: 1520 })
  tracks!: number;

  @ApiProperty({ description: "Tracks with any lyrics", example: 1384 })
  withLyrics!: number;

  @ApiProperty({ description: "Tracks with word-synced lyrics", example: 902 })
  word!: number;

  @ApiProperty({ description: "Tracks with line-synced lyrics", example: 431 })
  line!: number;

  @ApiProperty({ description: "Tracks with unsynced plain lyrics", example: 51 })
  plain!: number;

  @ApiProperty({ description: "Tracks without lyrics", example: 136 })
  none!: number;

  @ApiProperty({ description: "Tracks with a translation", example: 214 })
  translation!: number;

  @ApiProperty({ description: "Tracks with romanization", example: 97 })
  romaji!: number;

  @ApiProperty({ description: "Human-verified tracks", example: 12 })
  verified!: number;
}

export class LibraryProviderStatsDto implements LibraryProviderStats {
  @ApiProperty({
    description: "Lyrics provider identifier ('unknown' if not recorded)",
    example: "amll-db",
  })
  provider!: string;

  @ApiProperty({ description: "Tracks with lyrics from this provider", example: 512 })
  total!: number;

  @ApiProperty({ description: "Word-synced tracks from this provider", example: 498 })
  word!: number;

  @ApiProperty({ description: "Line-synced tracks from this provider", example: 14 })
  line!: number;

  @ApiProperty({ description: "Plain tracks from this provider", example: 0 })
  plain!: number;
}

export class LibraryPlatformStatsDto implements LibraryPlatformStats {
  @ApiProperty({
    description: "Streaming platform",
    enum: ["spotify", "appleMusic", "deezer", "netease", "qqMusic"],
    example: "spotify",
  })
  platform!: LibraryPlatform;

  @ApiProperty({ description: "Tracks with an ID on this platform", example: 1402 })
  count!: number;
}

export class LibraryDailyStatsDto implements LibraryDailyStats {
  @ApiProperty({ description: "UTC day (YYYY-MM-DD)", example: "2026-10-24" })
  date!: string;

  @ApiProperty({ description: "Tracks added on this day", example: 37 })
  count!: number;
}

export class LibraryRecentTrackDto implements LibraryRecentTrack {
  @ApiProperty({ description: "Track ID", example: "6f1c2b9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f" })
  id!: string;

  @ApiProperty({ description: "Track title", example: "Blinding Lights" })
  title!: string;

  @ApiProperty({ type: [String], example: ["The Weeknd"] })
  artists!: string[];

  @ApiProperty({ type: String, nullable: true, example: "After Hours" })
  album!: string | null;

  @ApiProperty({
    enum: ["word", "line", "plain"],
    nullable: true,
    description: "Lyrics sync type, null if the track has no lyrics",
    example: "word",
  })
  lyricsType!: LibraryRecentTrack["lyricsType"];

  @ApiProperty({
    type: Object,
    nullable: true,
    description: "Artwork metadata, if known",
  })
  artwork!: LibraryRecentTrack["artwork"];

  @ApiProperty({
    description: "UNIX millisecond timestamp when the track was added",
    example: 1787262680794,
  })
  createdAt!: number;
}

export class LibraryStatsResponseDto implements LibraryStats {
  @ApiProperty({
    description: "UNIX millisecond timestamp when these stats were computed",
    example: 1787262680794,
  })
  generatedAt!: number;

  @ApiProperty({ type: LibraryStatsTotalsDto })
  totals!: LibraryStatsTotalsDto;

  @ApiProperty({
    type: [LibraryProviderStatsDto],
    description: "Per-provider breakdown, sorted by total descending",
  })
  providers!: LibraryProviderStatsDto[];

  @ApiProperty({ type: [LibraryPlatformStatsDto] })
  platforms!: LibraryPlatformStatsDto[];

  @ApiProperty({
    type: [LibraryDailyStatsDto],
    description: "Tracks added per UTC day over the last 30 days, oldest first",
  })
  dailyAdded!: LibraryDailyStatsDto[];

  @ApiProperty({
    type: [LibraryRecentTrackDto],
    description: "The 5 most recently added tracks, newest first",
  })
  recentlyAdded!: LibraryRecentTrackDto[];
}
