import type {
  SanitizedTrack,
  SupportedLyricFormat,
  TrackRecord,
} from "@repo/types";

/**
 * Resolves the API base URL with smart auto-detection.
 *
 * Auto-detection strategy:
 * 1. Explicit `NEXT_PUBLIC_API_URL` if provided (e.g. separate API subdomain).
 * 2. In browser runtime (`window !== undefined`):
 *    - Returns empty string `""` so requests are relative to current domain/origin (`/api/...`).
 * 3. In server-side runtime (SSR):
 *    - Returns `API_INTERNAL_URL` (defaults to Docker service `http://api:4000` in production or `http://localhost:4000` in development).
 */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    // Client-side browser: use relative path for automatic host/port/protocol detection
    return "";
  }

  // Server-side (Node.js runtime / SSR)
  return (
    process.env.API_INTERNAL_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://api:4000"
      : "http://localhost:4000")
  );
}

/**
 * Builds the SSE URL for real-time lyrics resolution.
 */
export function getLyricsStreamUrl(params: {
  url?: string;
  platform?: string;
  id?: string;
  format?: SupportedLyricFormat | string;
  forceRefresh?: boolean;
}): string {
  const apiBase = getApiBaseUrl();
  const queryParams = new URLSearchParams();

  if (params.url) {
    queryParams.set("url", params.url);
  } else if (params.platform && params.id) {
    queryParams.set("platform", params.platform);
    queryParams.set("id", params.id);
  }

  if (params.format && params.format !== "json") {
    queryParams.set("format", params.format);
  }

  if (params.forceRefresh) {
    queryParams.set("forceRefresh", "true");
  }

  return `${apiBase}/api/lyrics/stream?${queryParams.toString()}`;
}

/**
 * Builds the SSE URL for real-time live activity notifications.
 */
export function getActivityStreamUrl(): string {
  const apiBase = getApiBaseUrl();
  return `${apiBase}/api/activity/stream`;
}

/**
 * Fetches sanitized track metadata by internal UUID.
 */
export async function fetchTrackById(
  id: string,
): Promise<SanitizedTrack<TrackRecord>> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/api/tracks/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Track not found");
    }
    throw new Error("Failed to load track");
  }
  return (await res.json()) as SanitizedTrack<TrackRecord>;
}

/**
 * Fetches track lyrics by internal UUID.
 */
export async function fetchTrackLyrics(
  id: string,
  format: string = "json",
): Promise<unknown> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(id)}/lyrics?format=${encodeURIComponent(format)}`,
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Lyrics not found for this track");
    }
    throw new Error("Failed to load lyrics");
  }

  if (format === "json") {
    return res.json();
  }
  return res.text();
}
