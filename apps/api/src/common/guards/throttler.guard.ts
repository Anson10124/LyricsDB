import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Resolves client IP address across reverse proxies (Cloudflare, Nginx, Docker, AWS ALB).
   */
  protected async getTracker(req: Request): Promise<string> {
    // 1. Cloudflare header
    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) {
      return cfIp.trim();
    }

    // 2. Nginx / Standard reverse proxy header
    const xRealIp = req.headers["x-real-ip"];
    if (typeof xRealIp === "string" && xRealIp.trim()) {
      return xRealIp.trim();
    }

    // 3. X-Forwarded-For (take the first client IP in chain)
    const xForwardedFor = req.headers["x-forwarded-for"];
    if (typeof xForwardedFor === "string" && xForwardedFor.trim()) {
      const clientIp = xForwardedFor.split(",")[0]?.trim();
      if (clientIp) return clientIp;
    }

    // 4. Express req.ips / req.ip
    if (req.ips && req.ips.length > 0 && req.ips[0]) {
      return req.ips[0].trim();
    }

    return req.ip || req.socket.remoteAddress || "127.0.0.1";
  }
}
