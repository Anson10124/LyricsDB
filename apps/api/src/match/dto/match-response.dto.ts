import { ApiProperty } from "@nestjs/swagger";
import { SanitizedTrackDto } from "../../tracks/dto/track-response.dto";

export class AudioMatchCandidateDto {
  @ApiProperty({ example: "1496089152", description: "NetEase song ID" })
  neteaseId!: string;

  @ApiProperty({ example: "I Really Want to Stay at Your House" })
  title!: string;

  @ApiProperty({ example: ["Rosa Walton", "Hallie Coggins"], type: [String] })
  artists!: string[];

  @ApiProperty({ example: "Cyberpunk 2077 (Original Soundtrack)", nullable: true, type: String })
  album!: string | null;

  @ApiProperty({ example: 246652, nullable: true, type: Number, description: "Length in ms" })
  durationMs!: number | null;

  @ApiProperty({ example: 51880, description: "Where in this song the clip started, in ms" })
  offsetMs!: number;
}

export class ShazamMatchCandidateDto {
  @ApiProperty({ example: "822309103", description: "Shazam track key" })
  shazamKey!: string;

  @ApiProperty({ example: "All At Once" })
  title!: string;

  @ApiProperty({ example: ["Madison Beer"], type: [String] })
  artists!: string[];

  @ApiProperty({ example: "F1 The Album", nullable: true, type: String })
  album!: string | null;

  @ApiProperty({ example: "USAT22503087", nullable: true, type: String })
  isrc!: string | null;

  @ApiProperty({ example: "1821963553", nullable: true, type: String })
  appleMusicId!: string | null;

  @ApiProperty({ example: 30000, description: "Where in this song the clip started, in ms" })
  offsetMs!: number;
}

export class AudioMatchResponseDto {
  @ApiProperty({ type: SanitizedTrackDto, description: "The recording the clip is from" })
  track!: SanitizedTrackDto;

  @ApiProperty({
    example: 51870,
    description: "Where in `track` the clip started, in ms. Add the time since recording began to follow along",
  })
  offsetMs!: number;

  @ApiProperty({
    nullable: true,
    description: "The track's synced lyrics in the compact JSON format, or null when it has none",
    type: "array",
    items: { type: "object" },
  })
  lyrics!: unknown[] | null;

  @ApiProperty({
    enum: ["shazam", "netease"],
    example: "shazam",
    description: "The service that recognised the clip",
  })
  provider!: "shazam" | "netease";

  @ApiProperty({
    type: [AudioMatchCandidateDto],
    description: "Every upload NetEase heard in the clip, best guess first (empty when Shazam answered)",
  })
  candidates!: AudioMatchCandidateDto[];

  @ApiProperty({
    type: ShazamMatchCandidateDto,
    nullable: true,
    description: "The song Shazam heard, when Shazam answered",
  })
  shazam!: ShazamMatchCandidateDto | null;
}
