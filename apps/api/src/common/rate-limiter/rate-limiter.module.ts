import { Global, Module } from "@nestjs/common";
import { IpRateLimiterService } from "./ip-rate-limiter.service";

@Global()
@Module({
  providers: [IpRateLimiterService],
  exports: [IpRateLimiterService],
})
export class RateLimiterModule {}
