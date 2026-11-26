import { randomBytes } from "node:crypto";
import type { AudioMatchCandidate, ResolveOptions } from "@repo/types";
import { HttpClient } from "../utils/http.js";

// NetEase's song recognition endpoint, as used by its desktop app and Chrome
// extension. It takes a fingerprint from afp.wasm (see @repo/audio-fingerprint)
// and needs no encryption or cookies.
export const NETEASE_AUDIO_MATCH_URL =
  "https://interface.music.163.com/api/music/audio/match";

export interface NeteaseAudioMatchResponse {
  code: number;
  data?: {
    queryId?: string;
    result?: Array<{
      startTime: number;
      song: {
        id: number;
        name: string;
        artists?: Array<{ name: string }> | null;
        album?: { name?: string | null } | null;
        duration?: number | null;
      };
    }> | null;
    // Set when nothing matched; NetEase does not document the values
    noMatchReason?: number | null;
  } | null;
}

export interface AudioMatchResult {
  candidates: AudioMatchCandidate[];
  noMatchReason: number | null;
}

export function parseAudioMatchResponse(
  response: NeteaseAudioMatchResponse,
): AudioMatchResult {
  if (response.code !== 200) {
    throw new Error(`NetEase audio match failed with code ${response.code}`);
  }
  const candidates = (response.data?.result ?? [])
    .filter((entry) => entry?.song?.id && entry.song.name)
    .map((entry) => ({
      neteaseId: String(entry.song.id),
      title: entry.song.name,
      artists: (entry.song.artists ?? []).map((a) => a.name).filter(Boolean),
      album: entry.song.album?.name || null,
      durationMs: entry.song.duration && entry.song.duration > 0 ? entry.song.duration : null,
      offsetMs: Math.max(0, Math.round(entry.startTime ?? 0)),
    }));
  return {
    candidates,
    noMatchReason: candidates.length > 0 ? null : (response.data?.noMatchReason ?? null),
  };
}

// Asks NetEase which songs a fingerprinted clip belongs to
export async function matchAudioFingerprint(
  fingerprint: string,
  durationSec: number,
  options?: ResolveOptions,
): Promise<AudioMatchResult> {
  const params = new URLSearchParams({
    sessionId: randomBytes(8).toString("hex"),
    algorithmCode: "shazam_v2",
    duration: String(durationSec),
    rawdata: fingerprint,
    times: "1",
    decrypt: "1",
  });
  const response = await HttpClient.get<NeteaseAudioMatchResponse>(
    `${NETEASE_AUDIO_MATCH_URL}?${params}`,
    {
      headers: { Referer: "https://music.163.com", ...options?.customHeaders },
      timeout: options?.timeout ?? 8000,
      retries: options?.retries ?? 1,
      priority: options?.priority,
    },
  );
  return parseAudioMatchResponse(response);
}
