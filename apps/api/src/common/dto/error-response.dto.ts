import { ApiProperty } from "@nestjs/swagger";

export class ErrorResponseDto {
  @ApiProperty({
    example: 400,
    description: "HTTP response status code",
  })
  statusCode!: number;

  @ApiProperty({
    example: 'Please provide either "url" or both "platform" and "id".',
    description: "Detailed explanation of the error",
  })
  message!: string;

  @ApiProperty({
    example: "Bad Request",
    description: "HTTP error title / type name",
    required: false,
  })
  error?: string;
}
