import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export function extractClientIp(req: Request): string {
  // Express handles trust proxy logic based on configured trusted hops/subnets.
  // req.ip automatically resolves to the client IP according to trust proxy configuration.
  let ip = req.ip || req.socket.remoteAddress || "127.0.0.1";

  // Normalize IPv4-mapped IPv6 addresses (e.g., "::ffff:127.0.0.1" -> "127.0.0.1")
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  return ip.trim() || "127.0.0.1";
}

export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return extractClientIp(req);
  },
);
