// Short audio previews from NetEase Cloud Music, timed against the full song so
// the lyrics can follow them.

// The endpoint only hands out audio to mainland China addresses, so requests
// carry one in the forwarding headers
export const DEFAULT_NETEASE_REAL_IP = "116.25.146.177";

// How much of a song a preview covers when NetEase returns the whole track
export const PREVIEW_LENGTH_MS = 30_000;

// Largest clip we will download, whatever NetEase reports
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

// Extra audio kept past the cut so the clip doesn't stop short of `endMs`
const CUT_MARGIN_MS = 1000;

export interface NeteasePreview {
  // HTTPS link to the audio file; NetEase expires it after `expiresInMs`
  url: string;
  // Where the clip sits within the full song
  startMs: number;
  endMs: number;
  expiresInMs: number;
  // How much of the file to download: all of a trial clip, or the opening bytes
  // of a whole song (the bitrate is constant, so bytes track time)
  bytes: number;
}

export interface NeteasePlayerUrlEntry {
  id?: number;
  url?: string | null;
  code?: number;
  // Length of the audio file in ms
  time?: number;
  // Size of the audio file in bytes
  size?: number;
  // Seconds of link validity
  expi?: number;
  // Set for paid songs: the file is just this slice of the song, in seconds
  freeTrialInfo?: { start?: number; end?: number } | null;
}

/**
 * Turns one entry of the player URL response into a preview window.
 * Paid songs come as a trial slice (`freeTrialInfo`); free songs come whole,
 * in which case only the first {@link PREVIEW_LENGTH_MS} is offered.
 */
export function parseNeteasePreview(
  entry: NeteasePlayerUrlEntry | undefined,
): NeteasePreview | null {
  if (!entry?.url || entry.code !== 200) return null;

  const fileMs = typeof entry.time === "number" && entry.time > 0 ? entry.time : 0;
  const size = typeof entry.size === "number" && entry.size > 0 ? entry.size : 0;
  if (!fileMs || !size) return null;

  const trial = entry.freeTrialInfo;
  let startMs = 0;
  let endMs: number;
  let playedMs: number;
  if (trial && typeof trial.start === "number") {
    startMs = Math.max(0, trial.start * 1000);
    // The file length is more exact than the whole seconds in `end`
    endMs = startMs + fileMs;
    playedMs = fileMs;
  } else {
    endMs = Math.min(fileMs, PREVIEW_LENGTH_MS);
    playedMs = Math.min(fileMs, endMs + CUT_MARGIN_MS);
  }

  const bytes = Math.min(size, Math.ceil((size * playedMs) / fileMs));
  if (bytes > MAX_PREVIEW_BYTES) return null;

  return {
    url: entry.url.replace(/^http:\/\//i, "https://"),
    startMs,
    endMs,
    expiresInMs: (entry.expi && entry.expi > 0 ? entry.expi : 1200) * 1000,
    bytes,
  };
}

export async function fetchNeteasePreview(
  neteaseId: string,
  options?: { timeout?: number; realIp?: string },
): Promise<NeteasePreview | null> {
  const id = neteaseId.trim();
  if (!/^\d+$/.test(id)) return null;

  const realIp = options?.realIp || DEFAULT_NETEASE_REAL_IP;
  const body = new URLSearchParams({
    ids: `[${id}]`,
    level: "standard",
    encodeType: "flac",
  });

  try {
    const res = await fetch(
      "https://interface.music.163.com/api/song/enhance/player/url/v1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "os=pc; appver=3.1.17.204416",
          "X-Real-IP": realIp,
          "X-Forwarded-For": realIp,
        },
        body,
        signal: AbortSignal.timeout(options?.timeout ?? 8000),
      },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as {
      code?: number;
      data?: NeteasePlayerUrlEntry[];
    };
    if (json.code !== 200) return null;

    return parseNeteasePreview(json.data?.find((d) => String(d.id) === id));
  } catch {
    return null;
  }
}

/**
 * Downloads the part of the audio file a preview plays. Returns null when the
 * link has expired or the download fails.
 */
export async function downloadNeteasePreview(
  preview: NeteasePreview,
  options?: { timeout?: number },
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(preview.url, {
      headers: { Range: `bytes=0-${preview.bytes - 1}` },
      signal: AbortSignal.timeout(options?.timeout ?? 10_000),
    });
    if (!res.ok || !res.body) return null;

    // Read no further than needed, even if the range was ignored
    const reader = res.body.getReader();
    const out = new Uint8Array(preview.bytes);
    let length = 0;
    while (length < preview.bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, preview.bytes - length);
      out.set(value.subarray(0, take), length);
      length += take;
    }
    await reader.cancel().catch(() => {});

    return length > 0 ? out.subarray(0, length) : null;
  } catch {
    return null;
  }
}
