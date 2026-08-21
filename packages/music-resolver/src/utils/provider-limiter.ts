export type ProviderState = "HEALTHY" | "DEGRADED" | "COOLDOWN" | "HALF_OPEN";

export interface ProviderConfig {
  concurrency: number;
  rpm: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
  consecutiveFailureThreshold: number;
}

export interface ProviderMetrics {
  provider: string;
  state: ProviderState;
  activeCount: number;
  queueLength: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  total429s: number;
  cooldownEndsAt?: number;
  remainingCooldownSeconds?: number;
  lastError?: string;
}

export class ProviderRateLimitedError extends Error {
  constructor(
    public provider: string,
    public retryAfterSeconds: number,
    message?: string,
  ) {
    super(
      message ||
        `Provider "${provider}" is currently rate limited / in cooldown. Retry after ${retryAfterSeconds}s.`,
    );
    this.name = "ProviderRateLimitedError";
  }
}

export class ProviderQueueFullError extends Error {
  constructor(public provider: string) {
    super(`Provider "${provider}" request queue is full.`);
    this.name = "ProviderQueueFullError";
  }
}

export class ProviderQueueTimeoutError extends Error {
  constructor(public provider: string) {
    super(`Provider "${provider}" request queued for too long and timed out.`);
    this.name = "ProviderQueueTimeoutError";
  }
}

interface QueuedTask<T> {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  priority: number;
  enqueuedAt: number;
  timeoutTimer: NodeJS.Timeout;
}

const DEFAULT_PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  spotify: {
    concurrency: 3,
    rpm: 60,
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  deezer: {
    concurrency: 4,
    rpm: 60,
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  appleMusic: {
    concurrency: 5,
    rpm: 60,
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  applemusic: {
    concurrency: 5,
    rpm: 60,
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  netease: {
    concurrency: 5,
    rpm: 120,
    baseCooldownMs: 45_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 60,
    consecutiveFailureThreshold: 6,
  },
  qqMusic: {
    concurrency: 4,
    rpm: 60,
    baseCooldownMs: 45_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  qqmusic: {
    concurrency: 4,
    rpm: 60,
    baseCooldownMs: 45_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 50,
    consecutiveFailureThreshold: 5,
  },
  musixmatch: {
    concurrency: 2,
    rpm: 30,
    baseCooldownMs: 120_000,
    maxCooldownMs: 900_000,
    queueTimeoutMs: 15_000,
    maxQueueSize: 40,
    consecutiveFailureThreshold: 3,
  },
  lrclib: {
    concurrency: 3,
    rpm: 30,
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    queueTimeoutMs: 12_000,
    maxQueueSize: 40,
    consecutiveFailureThreshold: 4,
  },
};

const GENERIC_DEFAULT_CONFIG: ProviderConfig = {
  concurrency: 4,
  rpm: 60,
  baseCooldownMs: 60_000,
  maxCooldownMs: 600_000,
  queueTimeoutMs: 10_000,
  maxQueueSize: 50,
  consecutiveFailureThreshold: 5,
};

class SingleProviderLimiter {
  readonly provider: string;
  private config: ProviderConfig;

  private state: ProviderState = "HEALTHY";
  private activeCount = 0;
  private queue: Array<QueuedTask<unknown>> = [];
  private requestTimestamps: number[] = [];

  private cooldownTimer: NodeJS.Timeout | null = null;
  private cooldownEndsAt = 0;
  private currentCooldownDurationMs = 0;
  private consecutiveFailures = 0;

  // Metrics
  private totalRequests = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private total429s = 0;
  private lastError?: string;

  constructor(provider: string, customConfig?: Partial<ProviderConfig>) {
    this.provider = provider;
    const baseConfig =
      DEFAULT_PROVIDER_CONFIGS[provider] || GENERIC_DEFAULT_CONFIG;
    this.config = { ...baseConfig, ...customConfig };
  }

  isAvailable(): boolean {
    if (this.state === "COOLDOWN") {
      // Check if cooldown has elapsed
      if (Date.now() >= this.cooldownEndsAt) {
        this.transitionToHalfOpen();
        return true;
      }
      return false;
    }
    return true;
  }

  getState(): ProviderState {
    if (this.state === "COOLDOWN" && Date.now() >= this.cooldownEndsAt) {
      this.transitionToHalfOpen();
    }
    return this.state;
  }

  getMetrics(): ProviderMetrics {
    const currentState = this.getState();
    const remaining =
      currentState === "COOLDOWN"
        ? Math.max(0, Math.ceil((this.cooldownEndsAt - Date.now()) / 1000))
        : undefined;

    return {
      provider: this.provider,
      state: currentState,
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      totalRequests: this.totalRequests,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      total429s: this.total429s,
      cooldownEndsAt:
        currentState === "COOLDOWN" ? this.cooldownEndsAt : undefined,
      remainingCooldownSeconds: remaining,
      lastError: this.lastError,
    };
  }

  async schedule<T>(
    task: () => Promise<T>,
    priority = 0,
    bypassQueueIfDisabled = false,
  ): Promise<T> {
    this.totalRequests++;

    if (!this.isAvailable()) {
      const remainingSec = Math.max(
        1,
        Math.ceil((this.cooldownEndsAt - Date.now()) / 1000),
      );
      if (bypassQueueIfDisabled) {
        throw new ProviderRateLimitedError(this.provider, remainingSec);
      }
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      throw new ProviderQueueFullError(this.provider);
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        // Remove from queue on timeout
        const index = this.queue.findIndex((t) => t.resolve === (resolve as unknown));
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new ProviderQueueTimeoutError(this.provider));
        }
      }, this.config.queueTimeoutMs);

      const queuedTask: QueuedTask<T> = {
        task,
        resolve,
        reject,
        priority,
        enqueuedAt: Date.now(),
        timeoutTimer,
      };

      if (priority > 0) {
        // Higher priority tasks inserted ahead
        const insertIdx = this.queue.findIndex((t) => t.priority < priority);
        if (insertIdx === -1) {
          this.queue.push(queuedTask as QueuedTask<unknown>);
        } else {
          this.queue.splice(insertIdx, 0, queuedTask as QueuedTask<unknown>);
        }
      } else {
        this.queue.push(queuedTask as QueuedTask<unknown>);
      }

      this.processNext();
    });
  }

  private processNext(): void {
    if (this.queue.length === 0) return;

    if (!this.isAvailable()) {
      return;
    }

    if (this.activeCount >= this.config.concurrency) {
      return;
    }

    // Sliding window RPM check
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > oneMinuteAgo,
    );

    if (this.requestTimestamps.length >= this.config.rpm) {
      // Re-check after the earliest timestamp in the window expires
      const oldest = this.requestTimestamps[0] || now;
      const waitMs = Math.max(50, oldest + 60_000 - now + 10);
      setTimeout(() => this.processNext(), waitMs);
      return;
    }

    const queuedTask = this.queue.shift();
    if (!queuedTask) return;

    clearTimeout(queuedTask.timeoutTimer);

    this.activeCount++;
    this.requestTimestamps.push(now);

    (async () => {
      try {
        const result = await queuedTask.task();
        this.recordSuccess();
        queuedTask.resolve(result);
      } catch (error) {
        this.recordFailure(error);
        queuedTask.reject(error);
      } finally {
        this.activeCount--;
        this.processNext();
      }
    })();
  }

  recordSuccess(): void {
    this.totalSuccesses++;
    this.consecutiveFailures = 0;
    if (this.state === "HALF_OPEN" || this.state === "DEGRADED") {
      this.state = "HEALTHY";
      this.currentCooldownDurationMs = 0;
      console.log(`[ProviderLimiter] Provider "${this.provider}" restored to HEALTHY`);
    }
  }

  recordFailure(error: unknown): void {
    this.totalFailures++;
    this.consecutiveFailures++;

    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;

    // Check for HTTP 429 or status 429
    let is429 = false;
    let retryAfterSeconds: number | undefined;

    if (
      message.includes("429") ||
      message.toLowerCase().includes("too many requests") ||
      message.toLowerCase().includes("rate limit")
    ) {
      is429 = true;
    }

    if (error && typeof error === "object") {
      const errObj = error as {
        status?: number;
        statusCode?: number;
        retryAfter?: string | number;
      };
      if (errObj.status === 429 || errObj.statusCode === 429) {
        is429 = true;
      }
      if (errObj.retryAfter) {
        const parsed = Number(errObj.retryAfter);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterSeconds = parsed;
        }
      }
    }

    // Captcha detection (e.g. Musixmatch)
    const isCaptcha =
      message.toLowerCase().includes("captcha") ||
      message.toLowerCase().includes("bot detected");

    if (is429 || isCaptcha) {
      this.total429s++;
      const cooldownSec =
        retryAfterSeconds ||
        Math.min(
          this.config.maxCooldownMs / 1000,
          (this.currentCooldownDurationMs
            ? this.currentCooldownDurationMs * 2
            : this.config.baseCooldownMs) / 1000,
        );
      this.triggerCooldown(
        cooldownSec,
        isCaptcha ? "Captcha detected" : "HTTP 429 Rate Limit hit",
      );
      return;
    }

    if (this.state === "HALF_OPEN") {
      // Half-open test request failed -> back to cooldown with doubled backoff
      this.triggerCooldown(
        Math.min(
          this.config.maxCooldownMs / 1000,
          (this.currentCooldownDurationMs * 2) / 1000,
        ),
        "Failed probe in HALF_OPEN state",
      );
      return;
    }

    if (
      this.consecutiveFailures >= this.config.consecutiveFailureThreshold &&
      this.state !== "COOLDOWN"
    ) {
      this.state = "DEGRADED";
      console.warn(
        `[ProviderLimiter] Provider "${this.provider}" has ${this.consecutiveFailures} consecutive errors (marked DEGRADED)`,
      );
    }
  }

  triggerCooldown(cooldownSeconds: number, reason = "Rate limited"): void {
    const cooldownMs = Math.min(
      this.config.maxCooldownMs,
      Math.max(this.config.baseCooldownMs, cooldownSeconds * 1000),
    );

    this.currentCooldownDurationMs = cooldownMs;
    this.cooldownEndsAt = Date.now() + cooldownMs;
    this.state = "COOLDOWN";

    console.warn(
      `[ProviderLimiter] Provider "${this.provider}" entered COOLDOWN for ${Math.round(
        cooldownMs / 1000,
      )}s. Reason: ${reason}`,
    );

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    this.cooldownTimer = setTimeout(() => {
      this.transitionToHalfOpen();
    }, cooldownMs);

    // Reject all tasks currently queued for this provider so they don't block
    const queuedCount = this.queue.length;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        clearTimeout(task.timeoutTimer);
        task.reject(
          new ProviderRateLimitedError(
            this.provider,
            Math.round(cooldownMs / 1000),
            `Provider "${this.provider}" entered cooldown while task was queued.`,
          ),
        );
      }
    }

    if (queuedCount > 0) {
      console.log(
        `[ProviderLimiter] Cleared ${queuedCount} queued tasks for rate-limited provider "${this.provider}".`,
      );
    }
  }

  private transitionToHalfOpen(): void {
    if (this.state === "COOLDOWN") {
      this.state = "HALF_OPEN";
      console.log(
        `[ProviderLimiter] Provider "${this.provider}" transitioned to HALF_OPEN (probing health)`,
      );
      this.processNext();
    }
  }

  reset(): void {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.state = "HEALTHY";
    this.consecutiveFailures = 0;
    this.currentCooldownDurationMs = 0;
    this.cooldownEndsAt = 0;
  }
}

export class ProviderProtectionManager {
  private limiters = new Map<string, SingleProviderLimiter>();

  getLimiter(provider: string): SingleProviderLimiter {
    const key = provider.toLowerCase().replace(/[-_]/g, "");
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new SingleProviderLimiter(key);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  isAvailable(provider: string): boolean {
    return this.getLimiter(provider).isAvailable();
  }

  getState(provider: string): ProviderState {
    return this.getLimiter(provider).getState();
  }

  async schedule<T>(
    provider: string,
    task: () => Promise<T>,
    priority = 0,
    bypassIfDisabled = false,
  ): Promise<T> {
    return this.getLimiter(provider).schedule(task, priority, bypassIfDisabled);
  }

  triggerCooldown(
    provider: string,
    cooldownSeconds: number,
    reason?: string,
  ): void {
    this.getLimiter(provider).triggerCooldown(cooldownSeconds, reason);
  }

  recordSuccess(provider: string): void {
    this.getLimiter(provider).recordSuccess();
  }

  recordFailure(provider: string, error: unknown): void {
    this.getLimiter(provider).recordFailure(error);
  }

  getAllMetrics(): ProviderMetrics[] {
    // Ensure all known default providers are initialized
    for (const key of Object.keys(DEFAULT_PROVIDER_CONFIGS)) {
      this.getLimiter(key);
    }
    return Array.from(this.limiters.values()).map((l) => l.getMetrics());
  }

  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }
}

// Global shared provider protection instance
export const globalProviderLimiter = new ProviderProtectionManager();
