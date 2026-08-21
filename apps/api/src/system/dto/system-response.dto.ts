import { ApiProperty } from "@nestjs/swagger";
import type { ProviderMetrics } from "@repo/music-resolver";

export class ProviderMetricsDto implements ProviderMetrics {
  @ApiProperty({
    description: "Provider identifier name",
    example: "spotify",
  })
  provider!: string;

  @ApiProperty({
    description: "Current circuit breaker state",
    enum: ["HEALTHY", "DEGRADED", "COOLDOWN", "HALF_OPEN"],
    example: "HEALTHY",
  })
  state!: "HEALTHY" | "DEGRADED" | "COOLDOWN" | "HALF_OPEN";

  @ApiProperty({
    description: "Number of active in-flight concurrent requests",
    example: 1,
  })
  activeCount!: number;

  @ApiProperty({
    description: "Number of queued requests waiting for semaphore slot",
    example: 0,
  })
  queueLength!: number;

  @ApiProperty({
    description: "Total lifetime requests dispatched to provider",
    example: 142,
  })
  totalRequests!: number;

  @ApiProperty({
    description: "Total successful requests",
    example: 142,
  })
  totalSuccesses!: number;

  @ApiProperty({
    description: "Total failed requests",
    example: 0,
  })
  totalFailures!: number;

  @ApiProperty({
    description: "Total HTTP 429 Too Many Requests received",
    example: 0,
  })
  total429s!: number;

  @ApiProperty({
    required: false,
    description: "Timestamp when current cooldown expires (if in COOLDOWN)",
    example: 1787262740794,
  })
  cooldownEndsAt?: number;

  @ApiProperty({
    required: false,
    description: "Remaining cooldown time in seconds",
    example: 0,
  })
  remainingCooldownSeconds?: number;

  @ApiProperty({
    required: false,
    description: "Last encountered error message",
    example: "HTTP 429 Rate Limit hit",
  })
  lastError?: string;
}

export class SystemProvidersResponseDto {
  @ApiProperty({
    description: "Overall system provider health status",
    enum: ["HEALTHY", "DEGRADED"],
    example: "HEALTHY",
  })
  status!: string;

  @ApiProperty({
    description: "Current UNIX millisecond timestamp",
    example: 1787262680794,
  })
  timestamp!: number;

  @ApiProperty({
    type: [ProviderMetricsDto],
    description: "Array of provider health and rate limiting metrics",
  })
  providers!: ProviderMetricsDto[];
}
