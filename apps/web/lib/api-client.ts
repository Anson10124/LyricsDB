import type {
  AudioMatchResponse,
  LibraryStats,
  PlatformSearchResponse,
  SanitizedTrack,
  SearchablePlatform,
  SupportedLyricFormat,
  SyncedLyricsPayload,
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

// Thrown when the per-IP preview limit (2 a minute) is used up
export class PreviewRateLimitError extends Error {
  constructor(public readonly retryAfterSec: number | null) {
    super("Too many audio previews");
    this.name = "PreviewRateLimitError";
  }
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
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After-medium"));
    throw new PreviewRateLimitError(
      Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : null,
    );
  }
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
export type TrackIdField =
  | "spotifyId"
  | "appleMusicId"
  | "deezerId"
  | "neteaseId"
  | "qqMusicId"
  | "isrc";

export interface TrackEdit {
  baseUpdatedAt?: string;
  lyrics?: SyncedLyricsPayload;
  ids?: Partial<Record<TrackIdField, string | null>>;
}

// A refused edit. `trackId` names the track that already owns an ID (409).
export class TrackEditError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly trackId?: string,
  ) {
    super(message);
    this.name = "TrackEditError";
  }
}

export async function editTrack(
  id: string,
  edit: TrackEdit,
  turnstileToken?: string,
): Promise<SanitizedTrack<TrackRecord>> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(id)}/edit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...edit, ...(turnstileToken ? { turnstileToken } : {}) }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
      trackId?: string;
    } | null;
    const message =
      res.status === 403
        ? "Human verification failed. Please try again."
        : res.status === 429
          ? "Too many edits. Please wait a moment."
          : body?.message || "Failed to save your edit.";
    throw new TrackEditError(message, res.status, body?.trackId);
  }
  return (await res.json()) as SanitizedTrack<TrackRecord>;
}

// A platform search that didn't return results (rate limit, platform down, ...)
export class PlatformSearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PlatformSearchError";
  }
}

/**
 * Searches one platform for this track (using its stored details) to fill in
 * a missing ID. Nothing is saved.
 */
export async function searchPlatformId(
  trackId: string,
  platform: SearchablePlatform,
  signal?: AbortSignal,
): Promise<PlatformSearchResponse> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(
    `${apiBase}/api/tracks/${encodeURIComponent(trackId)}/platform-search?platform=${encodeURIComponent(platform)}`,
    { signal },
  );
  if (!res.ok) {
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After-medium"));
      throw new PlatformSearchError(
        Number.isFinite(wait) && wait > 0
          ? `Too many searches. Try again in ${Math.ceil(wait)}s.`
          : "Too many searches. Please wait a moment.",
        429,
      );
    }
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new PlatformSearchError(
      body?.message || "The search didn't work. Please try again.",
      res.status,
    );
  }
  return (await res.json()) as PlatformSearchResponse;
}

export type MatchErrorKind = "no-match" | "rate-limited" | "busy" | "failed";

// A song recognition that didn't find a track
export class MatchError extends Error {
  constructor(
    message: string,
    readonly kind: MatchErrorKind,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "MatchError";
  }
}

export interface MatchAudioRequest {
  fingerprint: string;
  duration: number;
  // While following a song: the track and where in it the clip should start
  expectedTrackId?: string;
  expectedOffsetMs?: number;
}

/**
 * Identifies the song in a fingerprinted clip and returns the track, where in
 * it the clip started, and its synced lyrics.
 */
export async function matchAudio(
  request: MatchAudioRequest,
  signal?: AbortSignal,
): Promise<AudioMatchResponse> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/api/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...request,
      expectedOffsetMs:
        request.expectedOffsetMs === undefined
          ? undefined
          : Math.max(0, Math.round(request.expectedOffsetMs)),
    }),
    signal,
  });
  if (res.ok) return (await res.json()) as AudioMatchResponse;

  const body = (await res.json().catch(() => null)) as {
    message?: string;
    retryAfter?: number;
  } | null;
  if (res.status === 404) {
    throw new MatchError(body?.message || "No song matched.", "no-match");
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After-medium"));
    const seconds = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : undefined;
    throw new MatchError(
      seconds
        ? `Listening too often. Try again in ${seconds}s.`
        : "Listening too often. Please wait a moment.",
      "rate-limited",
      seconds,
    );
  }
  if (res.status === 503) {
    throw new MatchError(
      body?.message || "Song recognition is busy. Try again shortly.",
      "busy",
      body?.retryAfter,
    );
  }
  throw new MatchError(body?.message || "Song recognition didn't work.", "failed");
}

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
