import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
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
    description: "Bypass cached database results and force live re-fetching",
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
