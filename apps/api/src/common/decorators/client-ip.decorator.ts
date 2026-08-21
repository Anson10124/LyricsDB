import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export function extractClientIp(req: Request): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  const xRealIp = req.headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim()) {
    return xRealIp.trim();
  }

  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim()) {
    const clientIp = xForwardedFor.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }

  if (req.ips && req.ips.length > 0 && req.ips[0]) {
    return req.ips[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return extractClientIp(req);
  },
);
