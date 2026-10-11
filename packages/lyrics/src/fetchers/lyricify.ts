import {
  buildAccount,
  buildTrack,
  decryptLyricifyResponse,
  makeRequestKey,
  LYRICIFY_VERSION,
} from "../utils/lyricify-protocol.mjs";

export interface LyricifyTrackQuery {
  spotifyId?: string;
  title: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
}

/** Only lyric fields are exposed; account, author, and server metadata stay upstream. */
export interface LyricifyLyricsEntry {
  Verbatim?: string | null;
  Text?: string | null;
  Trans?: string | null;
  Offset?: number;
  TitleLines?: number;
  EndingLines?: number;
  DuetProperties?: string | null;
}

export interface LyricifyFetchOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  timeout?: number;
}

export function canFetchLyricify(
  query: LyricifyTrackQuery,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    env.LYRICIFY_SPOTIFY_USER_ID?.trim() &&
    env.LYRICIFY_SPOTIFY_EMAIL?.trim() &&
    query.spotifyId &&
    /^[A-Za-z0-9]{22}$/.test(query.spotifyId) &&
    query.title.trim() &&
    query.artists?.length &&
    query.artists.every(
      (artist) => typeof artist === "string" && artist.trim(),
    ) &&
    Number.isSafeInteger(query.durationMs) &&
    query.durationMs! > 0,
  );
}

export async function fetchLyricifyLyrics(
  query: LyricifyTrackQuery,
  options: LyricifyFetchOptions = {},
): Promise<LyricifyLyricsEntry | null> {
  const env = options.env ?? process.env;
  if (!canFetchLyricify(query, env)) return null;
  const account = buildAccount(env);
  const track = buildTrack({
    ...query,
    spotifyId: query.spotifyId!,
    artists: query.artists!,
    durationMs: query.durationMs!,
  });
  const url = new URL("https://api.lyricify.app/lyrics/get");
  url.searchParams.set(
    "key",
    makeRequestKey(
      account,
      track,
      "qq",
      env.LYRICIFY_VERSION || LYRICIFY_VERSION,
    ),
  );
  let response: Response;
  let body: string;
  try {
    response = await (options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeout ?? 10_000),
      redirect: "error",
    });
    body = await response.text();
  } catch {
    throw new Error("Lyricify request failed or timed out.");
  }
  if (!response.ok) {
    const error = new Error(
      `Lyricify returned HTTP ${response.status}.`,
    ) as Error & { status: number; retryAfter?: string };
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after") ?? undefined;
    throw error;
  }
  let data: unknown;
  try {
    data = decryptLyricifyResponse(body, account, track);
  } catch {
    throw new Error("Lyricify response could not be decoded.");
  }
  if (!data || typeof data !== "object" || !("Wxriw" in data)) return null;
  const entry = data.Wxriw;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const lyrics: LyricifyLyricsEntry = {};
  for (const field of [
    "Verbatim",
    "Text",
    "Trans",
    "DuetProperties",
  ] as const) {
    const value = (entry as Record<string, unknown>)[field];
    if (value != null && typeof value !== "string")
      throw new Error("Invalid Lyricify lyric fields.");
    if (value !== undefined) lyrics[field] = value as string | null;
  }
  for (const field of ["Offset", "TitleLines", "EndingLines"] as const) {
    const value = (entry as Record<string, unknown>)[field];
    if (
      value != null &&
      (!Number.isSafeInteger(value) ||
        (field !== "Offset" && (value as number) < 0))
    ) {
      throw new Error("Invalid Lyricify timing or credit counts.");
    }
    lyrics[field] = value == null ? 0 : (value as number);
  }
  return lyrics;
}
