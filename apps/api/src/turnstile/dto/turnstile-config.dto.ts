import { ApiProperty } from "@nestjs/swagger";

export class TurnstileConfigResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: "0x4AAAAAAFjzJcDsRDWX-qM8",
    description:
      "Public Turnstile site key, or null when human verification is disabled",
  })
  siteKey!: string | null;
}
