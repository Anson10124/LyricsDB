import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";

export type RateLimitType = "cached" | "uncached";

export interface RateLimitConfig {
  cachedRpm: number;
  uncachedRpm: number;
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  cachedRpm: 60,
  uncachedRpm: 6,
  windowMs: 60_000,
};

const MAX_BUCKET_ENTRIES = 20_000;

@Injectable()
export class IpRateLimiterService implements OnModuleDestroy {
  private readonly config: RateLimitConfig;
  private readonly cachedBuckets = new Map<string, number[]>();
  private readonly uncachedBuckets = new Map<string, number[]>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    @Optional()
    @Inject("RATE_LIMIT_CONFIG")
    customConfig?: Partial<RateLimitConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...(customConfig || {}) };

    // Clean up stale IP timestamps every 2 minutes
    this.cleanupInterval = setInterval(() => {
      this.pruneStaleEntries();
    }, 120_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Consumes a rate limit token for the given IP address.
   * Throws HTTP 429 if the limit is exceeded.
   */
  consume(ip: string, type: RateLimitType): void {
    const cleanIp = ip.trim() || "127.0.0.1";
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const buckets =
      type === "cached" ? this.cachedBuckets : this.uncachedBuckets;
    const limit =
      type === "cached" ? this.config.cachedRpm : this.config.uncachedRpm;

    let timestamps = buckets.get(cleanIp) || [];
    // Filter timestamps within current sliding window
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] || now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + this.config.windowMs - now) / 1000),
      );

      const errorMessage =
        type === "cached"
          ? `Rate limit exceeded for cached lookups (limit: ${limit} req/min). Please try again in ${retryAfterSec}s.`
          : `Rate limit exceeded for uncached live resolutions (limit: ${limit} req/min). Cached lookups remain accessible. Please try again in ${retryAfterSec}s.`;

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: errorMessage,
          error: "Too Many Requests",
          retryAfter: retryAfterSec,
          rateLimitType: type,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Protect against unbounded memory growth: evict oldest entry if cap is reached
    if (!buckets.has(cleanIp) && buckets.size >= MAX_BUCKET_ENTRIES) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey) buckets.delete(oldestKey);
    }

    timestamps.push(now);
    buckets.set(cleanIp, timestamps);
  }

  /**
   * Returns current usage for a specific IP.
   */
  getUsage(ip: string): {
    cached: { used: number; limit: number; remaining: number };
    uncached: { used: number; limit: number; remaining: number };
  } {
    const cleanIp = ip.trim() || "127.0.0.1";
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const cachedTimestamps = (this.cachedBuckets.get(cleanIp) || []).filter(
      (ts) => ts > windowStart,
    );
    const uncachedTimestamps = (this.uncachedBuckets.get(cleanIp) || []).filter(
      (ts) => ts > windowStart,
    );

    return {
      cached: {
        used: cachedTimestamps.length,
        limit: this.config.cachedRpm,
        remaining: Math.max(0, this.config.cachedRpm - cachedTimestamps.length),
      },
      uncached: {
        used: uncachedTimestamps.length,
        limit: this.config.uncachedRpm,
        remaining: Math.max(
          0,
          this.config.uncachedRpm - uncachedTimestamps.length,
        ),
      },
    };
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [ip, timestamps] of this.cachedBuckets.entries()) {
      const active = timestamps.filter((ts) => ts > windowStart);
      if (active.length === 0) {
        this.cachedBuckets.delete(ip);
      } else {
        this.cachedBuckets.set(ip, active);
      }
    }

    for (const [ip, timestamps] of this.uncachedBuckets.entries()) {
      const active = timestamps.filter((ts) => ts > windowStart);
      if (active.length === 0) {
        this.uncachedBuckets.delete(ip);
      } else {
        this.uncachedBuckets.set(ip, active);
      }
    }
  }

  reset(ip?: string): void {
    if (ip) {
      this.cachedBuckets.delete(ip);
      this.uncachedBuckets.delete(ip);
    } else {
      this.cachedBuckets.clear();
      this.uncachedBuckets.clear();
    }
  }
}
