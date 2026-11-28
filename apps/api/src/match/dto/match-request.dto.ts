import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { AudioMatchMode } from "@repo/types";

export const MATCH_MODES = ["auto", "shazam", "netease"] as const satisfies readonly AudioMatchMode[];

export class MatchAudioDto {
  @ApiProperty({
    required: false,
    description:
      "Base64 audio fingerprint of a short clip, as made by NetEase's afp.wasm (lyricsdb's /listen page makes it in the browser from 3 s of 8 kHz mono audio). Needed for NetEase; send it, `shazamSignature`, or both",
    example: "LZ/yfarQHqXkyBgtLEu/LzGrKMGmJUfwlNVxidKfSVJL…",
  })
  @IsOptional()
  @IsString()
  @IsBase64()
  @MaxLength(16_384)
  fingerprint?: string;

  @ApiProperty({
    required: false,
    description:
      "Shazam signature of a clip of up to 12 s, as a data URI (lyricsdb's /listen page makes it in the browser from 16 kHz mono audio). Needed for Shazam",
    example: "data:audio/vnd.shazam.sig;base64,gCX+yp0u…",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32_768)
  @Matches(/^data:audio\/vnd\.shazam\.sig;base64,[A-Za-z0-9+/]+={0,2}$/, {
    message: "shazamSignature must be a data:audio/vnd.shazam.sig;base64 URI",
  })
  shazamSignature?: string;

  @ApiProperty({
    required: false,
    enum: MATCH_MODES,
    default: "auto",
    description:
      "Which song recognition to use. auto tries Shazam then NetEase for a new song, and NetEase then Shazam while following one (expectedTrackId set); either is skipped when its input is missing",
  })
  @IsOptional()
  @IsIn(MATCH_MODES)
  provider?: AudioMatchMode;

  @ApiProperty({
    required: false,
    description: "Length of the NetEase-fingerprinted clip in seconds (default 3)",
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
