import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { GetOrSyncTrackOptions } from "@repo/types";
import {
  IsValidFormat,
  IsValidPlatform,
  IsValidStreamingUrl,
  IsValidTrackId,
} from "../../common/validators/validation.decorators";

export class TrackQueryDto implements GetOrSyncTrackOptions {
  @ApiProperty({
    required: false,
    description: "Platform name (spotify, apple, deezer, netease, qq, isrc)",
    example: "spotify",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @IsValidPlatform()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  platform?: string;

  @ApiProperty({
    required: false,
    description: "Platform-specific track ID",
    example: "4cOdK2wGLETKBW3PvgPWqT",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsValidTrackId()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  id?: string;

  @ApiProperty({
    required: false,
    description: "Direct song/track URL from any supported service",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsValidStreamingUrl()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  url?: string;
}

export class TrackStreamQueryDto extends TrackQueryDto {
  @ApiProperty({
    required: false,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsValidFormat()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  format?: string;

  @ApiProperty({
    required: false,
    type: Boolean,
    description:
      "Bypass cached database results and force live re-fetching (rejected for verified tracks)",
    example: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === "true" || value === true || value === "1" || value === 1,
  )
  @IsBoolean()
  forceRefresh?: boolean;
}

export class TrackSearchQueryDto {
  @ApiProperty({
    required: true,
    description: "Search query keyword (song title, artist name, or album)",
    example: "Rick Astley Never Gonna Give You Up",
  })
  @IsNotEmpty({ message: 'Search query "q" cannot be empty.' })
  @IsString()
  @MinLength(1, { message: 'Search query "q" must have at least 1 character.' })
  @MaxLength(200, { message: 'Search query "q" cannot exceed 200 characters.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  q!: string;

  @ApiProperty({
    required: false,
    description: "Maximum number of results to return (default: 20, max: 100)",
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: "Search limit must be at least 1." })
  @Max(100, { message: "Search limit cannot exceed 100." })
  limit?: number = 20;
}

export class GetLyricsQueryDto extends TrackQueryDto {
  @ApiProperty({
    required: false,
    description:
      "Search keyword (title, artist, or album). Returns lyrics of the best indexed match with lyrics; used when no url or platform + id is given.",
    example: "Rick Astley Never Gonna Give You Up",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  q?: string;

  @ApiProperty({
    required: false,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsValidFormat()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  format?: string = "json";
}

export class FuzzyLyricsQueryDto {
  @ApiProperty({ required: true, description: "Song title", example: "Never Gonna Give You Up" })
  @IsNotEmpty({ message: 'Query "title" cannot be empty.' })
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  title!: string;

  @ApiProperty({ required: false, description: "Artist name", example: "Rick Astley" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  artist?: string;

  @ApiProperty({ required: false, description: "Album title", example: "Whenever You Need Somebody" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  album?: string;

  @ApiProperty({
    required: false,
    description: "Track length in seconds (values of 10000 or more are read as milliseconds)",
    example: 213,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36_000_000)
  duration?: number;

  @ApiProperty({
    required: false,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsValidFormat()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  format?: string = "json";
}

export class LyricsByIdQueryDto {
  @ApiProperty({
    required: false,
    description: "Output lyric format (default: json)",
    example: "json",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsValidFormat()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  format?: string = "json";
}

export class VerifyTrackDto {
  @ApiProperty({
    required: false,
    description:
      "Single-use Cloudflare Turnstile token (cf-turnstile-response). Required when human verification is enabled.",
    example: "0.AbCdEf...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}

export class EditTrackIdsDto {
  @ApiProperty({ required: false, nullable: true, example: "4cOdK2wGLETKBW3PvgPWqT" })
  spotifyId?: string | null;
  @ApiProperty({ required: false, nullable: true, example: "1559523359" })
  appleMusicId?: string | null;
  @ApiProperty({ required: false, nullable: true, example: "3135556" })
  deezerId?: string | null;
  @ApiProperty({ required: false, nullable: true, example: "5257138" })
  neteaseId?: string | null;
  @ApiProperty({ required: false, nullable: true, example: "0039MnYb0qxYhV" })
  qqMusicId?: string | null;
  @ApiProperty({ required: false, nullable: true, example: "GBARL9300135" })
  isrc?: string | null;
}

export class EditTrackDto {
  @ApiProperty({
    required: false,
    description:
      "Single-use Cloudflare Turnstile token (cf-turnstile-response) for the `edit-track` action. Required when human verification is enabled.",
    example: "0.AbCdEf...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;

  @ApiProperty({
    required: false,
    description:
      "The track's `updatedAt` when the editor was opened. If the track changed since, the edit is refused with 409 so it can't overwrite someone else's.",
    example: "2026-11-25T10:00:00.000Z",
  })
  @IsOptional()
  @IsDateString()
  baseUpdatedAt?: string;

  @ApiProperty({
    required: false,
    description:
      "The full edited lyrics in the compact JSON format (the same shape `format=json` returns). Omit to leave the lyrics unchanged.",
    type: "array",
    items: { type: "array", items: {} },
  })
  @IsOptional()
  @IsArray()
  lyrics?: unknown[];

  @ApiProperty({
    required: false,
    type: EditTrackIdsDto,
    description:
      "Platform IDs to change. Only the fields present are changed; null or an empty string removes an ID. A removed ID is never matched to this track again.",
  })
  @IsOptional()
  @IsObject()
  ids?: Record<string, string | null>;
}
