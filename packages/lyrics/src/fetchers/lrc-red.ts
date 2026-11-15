const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

// lrc.red's Cloudflare rejects Node's default "node" User-Agent with a 403.
const USER_AGENT = "LyricsDB/1.0 (https://github.com/lyricsdb)";

/**
 * Thrown when lrc.red refuses or throttles us, so the provider limiter counts
 * it as a failure (and backs off) instead of treating it as "no lyrics".
 */
export class LrcRedBlockedError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "LrcRedBlockedError";
  }
}

export async function fetchLrcRedTtml(
  isrc: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const normalizedIsrc = isrc.trim().toUpperCase();
  if (!ISRC_PATTERN.test(normalizedIsrc)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`https://lrc.red/s/${normalizedIsrc}.ttml`, {
      headers: {
        Accept: "application/ttml+xml, application/xml, text/xml",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return null;
  }

  try {
    if (response.status === 429) {
      // Carries status 429 so the limiter starts a rate-limit cooldown.
      throw new LrcRedBlockedError(
        "lrc.red rate limited the request (HTTP 429)",
        429,
        response.headers.get("retry-after") ?? undefined,
      );
    }
    if (response.status === 403) {
      // No status field: the limiter treats other 4xx codes as healthy answers,
      // but a 403 here means we are blocked, not that the song is missing.
      throw new LrcRedBlockedError("lrc.red refused the request (HTTP 403)");
    }
    if (!response.ok) return null;

    const ttml = await response.text();
    return /<\s*(?:[\w.-]+:)?tt(?:\s|>)/i.test(ttml) ? ttml : null;
  } catch (error) {
    if (error instanceof LrcRedBlockedError) throw error;
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
