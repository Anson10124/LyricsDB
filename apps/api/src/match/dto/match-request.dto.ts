import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBase64,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class MatchAudioDto {
  @ApiProperty({
    description:
      "Base64 audio fingerprint of a short clip, as made by NetEase's afp.wasm (lyricsdb's /listen page makes it in the browser from 3 s of 8 kHz mono audio)",
    example: "LZ/yfarQHqXkyBgtLEu/LzGrKMGmJUfwlNVxidKfSVJL…",
  })
  @IsString()
  @IsBase64()
  @MaxLength(16_384)
  fingerprint!: string;

  @ApiProperty({
    required: false,
    description: "Length of the fingerprinted clip in seconds (default 3)",
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  duration?: number;

  @ApiProperty({
    required: false,
    description:
      "While following a song: the track the listener is on. With expectedOffsetMs, a clip heard near that position is answered with this track without searching again",
    example: "89de8b58-f846-444d-8973-48a14052cc97",
  })
  @IsOptional()
  @IsUUID("4")
  expectedTrackId?: string;

  @ApiProperty({
    required: false,
    description:
      "While following a song: where in it the listener expects this clip to start, in ms. Helps pick the right repeat of a chorus",
    example: 74500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  expectedOffsetMs?: number;
}
