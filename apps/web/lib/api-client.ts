import type {
  LibraryStats,
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

export interface TrackNeighbors {
  prev: string | null;
  next: string | null;
}

/**
 * Fetches the synced-lyrics tracks added just before and after this one.
 */
export async function fetchTrackNeighbors(id: string): Promise<TrackNeighbors> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(id)}/neighbors`,
  );
  if (!res.ok) {
    throw new Error("Failed to load neighbouring tracks");
  }
  return (await res.json()) as TrackNeighbors;
}

export interface TrackPreview {
  // Object URL of the downloaded clip; revoke it with URL.revokeObjectURL
  url: string;
  // The part of the full song the clip covers, in ms
  startMs: number;
  endMs: number;
}

/**
 * Downloads the short audio clip that plays along with the lyrics, or returns
 * null when the track has none. The clip is held in memory as a blob.
 */
export async function fetchTrackPreview(
  id: string,
  signal?: AbortSignal,
): Promise<TrackPreview | null> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(id)}/preview`,
    { signal },
  );
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error("Failed to load audio preview");
  }
  const startMs = Number(res.headers.get("X-Preview-Start-Ms"));
  const endMs = Number(res.headers.get("X-Preview-End-Ms"));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Audio preview is missing its timing");
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), startMs, endMs };
}

/**
 * Marks a track as verified correct. Pass a Turnstile token when verification is enabled.
 */
export async function markTrackVerified(
  id: string,
  turnstileToken?: string,
): Promise<SanitizedTrack<TrackRecord>> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(id)}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(turnstileToken ? { turnstileToken } : {}),
    },
  );
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Human verification failed. Please try again.");
    }
    if (res.status === 429) {
      throw new Error("Too many requests. Please wait a moment.");
    }
    throw new Error("Failed to mark track as correct");
  }
  return (await res.json()) as SanitizedTrack<TrackRecord>;
}

/**
 * Fetches the public Turnstile site key (null when verification is disabled).
 */
export async function fetchTurnstileConfig(): Promise<{
  siteKey: string | null;
}> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/api/turnstile/config`);
  if (!res.ok) {
    throw new Error("Failed to load verification config");
  }
  return (await res.json()) as { siteKey: string | null };
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

/**
 * Fetches aggregate statistics about the cached track library.
 */
export async function fetchLibraryStats(): Promise<LibraryStats> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/api/stats`);
  if (!res.ok) {
    throw new Error("Failed to load stats");
  }
  return (await res.json()) as LibraryStats;
}
