import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { globalProviderLimiter } from "@repo/music-resolver";
import { SystemProvidersResponseDto } from "./dto/system-response.dto";

@ApiTags("System")
@Controller(["api/system", "system"])
export class SystemController {
  @ApiOperation({
    summary: "Get upstream music providers health, queues, and rate-limit statuses",
    description:
      "Returns live operational metrics for all upstream music/lyrics providers, including circuit breaker states (HEALTHY, DEGRADED, COOLDOWN, HALF_OPEN), in-flight concurrent requests, queue depth, and remaining cooldown seconds.",
  })
  @ApiOkResponse({
    type: SystemProvidersResponseDto,
    description: "Array of provider health and rate limiting metrics",
  })
  @Get("providers")
  getProviderMetrics(): SystemProvidersResponseDto {
    const providers = globalProviderLimiter.getAllMetrics();
    const hasCooldown = providers.some((p) => p.state === "COOLDOWN");
    const hasDegraded = providers.some((p) => p.state === "DEGRADED");

    let overallStatus = "HEALTHY";
    if (hasCooldown) overallStatus = "DEGRADED";
    else if (hasDegraded) overallStatus = "DEGRADED";

    return {
      status: overallStatus,
      timestamp: Date.now(),
      providers,
    };
  }
}
