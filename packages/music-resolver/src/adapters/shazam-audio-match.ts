import { randomUUID } from "node:crypto";
import type { ResolveOptions } from "@repo/types";
import { HttpClient } from "../utils/http.js";

// Shazam's tag endpoint, as its mobile apps use it. It takes a signature made
// by @repo/audio-fingerprint's createShazamSignature and needs no account, but
// only answers app-style clients and rate-limits each IP quickly.
const SHAZAM_TAG_URL = "https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag";
const SHAZAM_TAG_QUERY =
  "sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3";

// A browser User-Agent gets an HTML page or a 405
const SHAZAM_HEADERS = {
  "X-Shazam-Platform": "IPHONE",
  "X-Shazam-AppVersion": "14.1.0",
  Accept: "*/*",
  "Accept-Language": "en-US",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910G Build/LMY47X)",
};

// Shazam's own check (as in ShazamIO's max_skew): a larger skew means the clip
// was sped up or pitched, or the match is a confident mistake
export const SHAZAM_MAX_SKEW = 1e-3;

export interface ShazamTagResponse {
  matches?: Array<{
    id?: string;
    // Where in the song the clip starts, in seconds
    offset?: number;
    timeskew?: number;
    frequencyskew?: number;
  }> | null;
  // How long Shazam asks to wait before tagging again, in ms
  retryms?: number;
  track?: {
    key?: string;
    title?: string;
    // The artist line, e.g. "Rosa Walton & Hallie Coggins"
    subtitle?: string;
    isrc?: string;
    hub?: {
      actions?: Array<{ type?: string; id?: string }> | null;
    } | null;
    sections?: Array<{
      type?: string;
      metadata?: Array<{ title?: string; text?: string }> | null;
    }> | null;
  } | null;
}

export interface ShazamMatch {
  shazamKey: string;
  title: string;
  artist: string;
  album: string | null;
  isrc: string | null;
  appleMusicId: string | null;
  // Where in the song the clip starts
  offsetMs: number;
}

export interface ShazamMatchResult {
  match: ShazamMatch | null;
  retryMs: number | null;
}

export function parseShazamResponse(response: ShazamTagResponse): ShazamMatchResult {
  if (!response || typeof response !== "object") {
    throw new Error("Shazam answered with something other than JSON");
  }
  const retryMs = typeof response.retryms === "number" ? response.retryms : null;
  const first = response.matches?.[0];
  const track = response.track;
  if (!first || !track?.key || !track.title) return { match: null, retryMs };

  const skew = Math.max(Math.abs(first.timeskew ?? 0), Math.abs(first.frequencyskew ?? 0));
  if (skew > SHAZAM_MAX_SKEW) return { match: null, retryMs };

  const album =
    track.sections
      ?.find((s) => s.type === "SONG")
      ?.metadata?.find((m) => m.title?.toLowerCase() === "album")?.text || null;
  const appleMusicId =
    track.hub?.actions?.find((a) => a.type === "applemusicplay" && a.id)?.id ?? null;

  return {
    match: {
      shazamKey: String(track.key),
      title: track.title,
      artist: track.subtitle ?? "",
      album,
      isrc: track.isrc?.trim().toUpperCase() || null,
      appleMusicId: appleMusicId ? String(appleMusicId) : null,
      offsetMs: Math.max(0, Math.round((first.offset ?? 0) * 1000)),
    },
    retryMs,
  };
}

// Asks Shazam which song a signature belongs to. Fails fast (one attempt, a
// short wait) because the caller falls back to NetEase.
export async function matchShazamSignature(
  signatureUri: string,
  sampleMs: number,
  options?: ResolveOptions,
): Promise<ShazamMatchResult> {
  const url = `${SHAZAM_TAG_URL}/${randomUUID().toUpperCase()}/${randomUUID().toUpperCase()}?${SHAZAM_TAG_QUERY}`;
  const now = Date.now();
  const response = await HttpClient.post<ShazamTagResponse>(
    url,
    {
      timezone: "Europe/London",
      signature: { uri: signatureUri, samplems: sampleMs },
      timestamp: now,
      context: {},
      geolocation: {},
    },
    {
      provider: "shazam",
      headers: { ...SHAZAM_HEADERS, ...options?.customHeaders },
      timeout: options?.timeout ?? 5000,
      retries: options?.retries ?? 0,
      priority: options?.priority,
    },
  );
  return parseShazamResponse(response);
}
