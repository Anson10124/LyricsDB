import { ForbiddenException, Injectable, Logger } from "@nestjs/common";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];

interface SiteverifyResult {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || "";
  private readonly secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || "";
  private readonly expectedHostnames = this.resolveExpectedHostnames();

  constructor() {
    if (!this.secretKey) {
      if (this.siteKey) {
        this.logger.warn(
          "TURNSTILE_SITE_KEY is set without TURNSTILE_SECRET_KEY; Turnstile checks are disabled.",
        );
      }
      return;
    }
    if (!this.siteKey) {
      this.logger.warn(
        "TURNSTILE_SECRET_KEY is set without TURNSTILE_SITE_KEY; the web app cannot render the widget, so protected actions will be rejected.",
      );
    }
    if (this.expectedHostnames.size === 0) {
      this.logger.warn(
        "No Turnstile hostnames configured (TURNSTILE_HOSTNAMES or PUBLIC_URL); protected actions will be rejected.",
      );
    }
  }

  // Checks are only enforced when a secret key is configured
  isEnabled(): boolean {
    return Boolean(this.secretKey);
  }

  getPublicSiteKey(): string | null {
    return this.isEnabled() && this.siteKey ? this.siteKey : null;
  }

  // Redeems a single-use widget token; throws unless it is valid for this action and host
  async verify(
    token: string | undefined,
    expectedAction: string,
    remoteIp?: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 2048 ||
      this.expectedHostnames.size === 0
    ) {
      throw new ForbiddenException("Human verification failed.");
    }

    const body = new URLSearchParams({
      secret: this.secretKey,
      response: token,
    });
    if (remoteIp) body.set("remoteip", remoteIp);

    let result: SiteverifyResult;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`siteverify ${res.status}`);
      result = (await res.json()) as SiteverifyResult;
    } catch (err) {
      // Fail closed when Cloudflare cannot be reached
      this.logger.warn(
        `Turnstile siteverify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ForbiddenException("Human verification failed.");
    }

    if (
      result.success !== true ||
      result.action !== expectedAction ||
      !result.hostname ||
      !this.expectedHostnames.has(result.hostname)
    ) {
      this.logger.warn(
        `Turnstile rejected token (action=${result.action}, hostname=${result.hostname}, errors=${result["error-codes"]?.join(",") || "none"})`,
      );
      throw new ForbiddenException("Human verification failed.");
    }
  }

  // Explicit TURNSTILE_HOSTNAMES wins; otherwise derive from the public URLs, plus localhost outside production
  private resolveExpectedHostnames(): Set<string> {
    const explicit = (process.env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean);
    if (explicit.length > 0) return new Set(explicit);

    const derived = [
      process.env.PUBLIC_URL,
      process.env.SERVICE_URL_WEB,
    ]
      .map(hostnameOf)
      .filter((hostname): hostname is string => Boolean(hostname));
    if (process.env.NODE_ENV !== "production") {
      derived.push(...LOCAL_HOSTNAMES);
    }
    return new Set(derived);
  }
}
