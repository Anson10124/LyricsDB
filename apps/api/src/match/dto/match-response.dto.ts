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
    type: [AudioMatchCandidateDto],
    description: "Every upload NetEase heard in the clip, best guess first",
  })
  candidates!: AudioMatchCandidateDto[];
}
