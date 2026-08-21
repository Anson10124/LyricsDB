import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { extractClientIp } from "../decorators/client-ip.decorator";

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Resolves verified client IP address according to Express trusted proxy configuration.
   */
  protected async getTracker(req: Request): Promise<string> {
    return extractClientIp(req);
  }
}

