import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  IsValidPlatform,
  IsValidStreamingUrl,
} from "../../common/validators/validation.decorators";

export class ResolveQueryDto {
  @ApiProperty({
    description: "Source song URL from any supported streaming platform",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @IsNotEmpty({ message: 'Query parameter "url" is required.' })
  @IsString()
  @MaxLength(500)
  @IsValidStreamingUrl()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  url!: string;
}

export class ResolveDto {
  @ApiProperty({
    description: "Source song URL from any supported streaming platform",
    example: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  })
  @IsNotEmpty({ message: 'Field "url" is required in request body.' })
  @IsString()
  @MaxLength(500)
  @IsValidStreamingUrl()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  url!: string;

  @ApiProperty({
    required: false,
    description: "Optional list of target platforms to restrict resolution",
    type: [String],
    example: ["spotify", "deezer", "netease", "apple", "qq"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsValidPlatform({ each: true })
  targetPlatforms?: string[];
}
