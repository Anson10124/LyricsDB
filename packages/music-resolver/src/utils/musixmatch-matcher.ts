import type {
  EnrichedMusixmatchMetadata,
  ResolveOptions,
  TrackMetadata,
} from "../types.js";
import { HttpClient } from "./http.js";
import { isSameRecording } from "./query.js";
import {
  MUSIXMATCH_API_BASE,
  MUSIXMATCH_APP_ID,
  MUSIXMATCH_USER_AGENT,
  generateMusixmatchRandomId,
  isMusixmatchDecoyTrackId,
  isUsableMusixmatchToken,
} from "./musixmatch-api.js";

export interface MusixmatchMatchParams {
  spotifyId?: string;
  appleMusicId?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  durationMs?: number;
}

export interface MusixmatchMatcherOptions extends ResolveOptions {
  apiUrl?: string;
  getToken?: (
    options?: ResolveOptions,
    forceRefresh?: boolean,
  ) => Promise<string>;
}

async function fetchAnonymousTokenFallback(timeout = 8000): Promise<string> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const url = new URL(`${MUSIXMATCH_API_BASE}/token.get`);
    url.searchParams.set("app_id", MUSIXMATCH_APP_ID);
    url.searchParams.set("t", generateMusixmatchRandomId());

    try {
      const res = await HttpClient.get<{
        message?: {
          header?: { status_code?: number; hint?: string };
          body?: { user_token?: string };
        };
      }>(url.toString(), {
        headers: { "User-Agent": MUSIXMATCH_USER_AGENT },
        timeout,
      });

      const token = res?.message?.body?.user_token;
      if (isUsableMusixmatchToken(token)) {
        return token;
      }

      // A captcha answer does not clear up within seconds, so retrying only adds load
      if (res?.message?.header?.hint === "captcha") break;
    } catch {
      // Retry
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error("Failed to acquire Musixmatch token in matcher");
}

interface MusixmatchTrackResponse {
  message?: {
    header?: {
      status_code?: number;
      hint?: string;
    };
    body?: {
      track?: {
        track_id?: number;
        track_name?: string;
        artist_name?: string;
        album_name?: string;
        track_isrc?: string;
        commontrack_isrcs?: string[][];
        track_spotify_id?: string;
        commontrack_spotify_ids?: string[];
        commontrack_itunes_ids?: number[];
        commontrack_id?: number;
        track_length?: number; // seconds
        instrumental?: number;
      };
    };
  };
}

// Whether a Musixmatch match may fill in a track's ISRC, album and links: it must
// be the same recording (length and version tags). Even an ID lookup can answer
// with another release, and a title search is fuzzy, so it also needs both
// lengths known.
export function isTrustedMusixmatchMatch(
  enriched: EnrichedMusixmatchMetadata,
  target: TrackMetadata,
): boolean {
  if (
    enriched.matchedBy === "title" &&
    (!enriched.durationMs || !target.durationMs)
  ) {
    return false;
  }
  return isSameRecording(
    {
      title: enriched.title,
      album: enriched.album,
      durationMs: enriched.durationMs,
    },
    target,
  );
}

export async function matchTrackWithMusixmatch(
  params: MusixmatchMatchParams,
  options?: MusixmatchMatcherOptions,
): Promise<EnrichedMusixmatchMetadata | null> {
  const spotifyId = params.spotifyId?.trim();
  const appleMusicId = params.appleMusicId?.trim();
  const isrc = params.isrc?.trim();
  const title = params.title?.trim();
  const artist = params.artist?.trim();

  // Need at least one identifier or title
  if (!spotifyId && !appleMusicId && !isrc && !title) {
    return null;
  }

  const baseUrl = options?.apiUrl || `${MUSIXMATCH_API_BASE}/matcher.track.get`;
  const matchedBy: EnrichedMusixmatchMetadata["matchedBy"] = spotifyId
    ? "spotify"
    : appleMusicId
      ? "apple"
      : isrc
        ? "isrc"
        : "title";

  const executeMatcherCall = async (
    token: string,
  ): Promise<MusixmatchTrackResponse | null> => {
    const url = new URL(baseUrl);
    url.searchParams.set("app_id", MUSIXMATCH_APP_ID);
    url.searchParams.set("format", "json");
    url.searchParams.set("usertoken", token);
    url.searchParams.set("t", generateMusixmatchRandomId());

    if (spotifyId) {
      url.searchParams.set("track_spotify_id", spotifyId);
    } else if (appleMusicId) {
      url.searchParams.set("track_itunes_id", appleMusicId);
    } else if (isrc) {
      url.searchParams.set("track_isrc", isrc);
    } else if (title) {
      url.searchParams.set("q_track", title);
      if (artist) {
        url.searchParams.set("q_artist", artist);
      }
      if (params.durationMs && params.durationMs > 0) {
        url.searchParams.set(
          "q_duration",
          String(Math.round(params.durationMs / 1000)),
        );
      }
    }

    try {
      return await HttpClient.get<MusixmatchTrackResponse>(url.toString(), {
        headers: { "User-Agent": MUSIXMATCH_USER_AGENT },
        timeout: options?.timeout ?? 8000,
        retries: 0,
      });
    } catch {
      return null;
    }
  };

  try {
    let token = options?.getToken
      ? await options.getToken(options)
      : await fetchAnonymousTokenFallback(options?.timeout);

    let res = await executeMatcherCall(token);

    // If 401, refresh token and retry once
    if (res?.message?.header?.status_code === 401) {
      token = options?.getToken
        ? await options.getToken(options, true)
        : await fetchAnonymousTokenFallback(options?.timeout);
      res = await executeMatcherCall(token);
    }

    if (!res || res.message?.header?.status_code !== 200) {
      return null;
    }

    const tr = res.message?.body?.track;
    // A decoy is a different song, so it must not fill in this track's metadata
    if (!tr || isMusixmatchDecoyTrackId(tr.track_id)) return null;

    // Only this exact track's own IDs. The commontrack_* lists cover every release
    // and version sharing its lyrics (remasters, live takes, remixes), so their
    // first entry is often a sibling. There is no per-track iTunes ID, so no
    // single Apple ID is taken from them.
    return {
      matchedBy,
      isrc: tr.track_isrc?.trim() || undefined,
      spotifyId: tr.track_spotify_id?.trim() || undefined,
      spotifyIds: tr.commontrack_spotify_ids?.filter(Boolean),
      appleMusicIds: tr.commontrack_itunes_ids
        ?.map((id) => String(id))
        .filter(Boolean),
      musixmatchId: tr.track_id ? String(tr.track_id) : undefined,
      title: tr.track_name,
      artist: tr.artist_name,
      album: tr.album_name,
      durationMs:
        tr.track_length && tr.track_length > 0
          ? tr.track_length * 1000
          : undefined,
      raw: tr as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
