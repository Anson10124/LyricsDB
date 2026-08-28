export interface AmllDbLyricsQueryParams {
  neteaseId?: string;
  qqMusicId?: string;
  appleMusicId?: string;
  spotifyId?: string;
  title?: string;
  artist?: string;
  artists?: string[];
  durationMs?: number;
}

export interface AmllDbFetchOptions {
  timeout?: number;
  mirrors?: string[];
}

export interface AmllDbLyricsResponse {
  ttml: string;
  matchedPlatform: "netease" | "qq" | "apple" | "spotify";
  matchedId: string;
  rawUrl?: string;
}

const DEFAULT_PRIMARY_BASE =
  "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main";

const DEFAULT_MIRROR_BASES = [
  "https://amlldb.bikonoo.com",
  "https://amll-ttml-db.gbclstudio.cn",
  "https://amll.mirror.dimeta.top/api/db",
];

async function fetchFromUrl(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "LyricsDB/1.0 (https://github.com/lyricsdb)",
        Accept: "application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 404) {
      return { ok: false, status: 404 };
    }

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    const text = await res.text();
    if (text && (text.includes("<tt") || text.includes("<tt:tt"))) {
      return { ok: true, status: 200, text };
    }

    return { ok: false, status: 200 };
  } catch {
    clearTimeout(timeoutId);
    return { ok: false, status: 0 };
  }
}

async function fetchPathWithFallbacks(
  path: string,
  options?: AmllDbFetchOptions,
): Promise<{ text: string; url: string } | null> {
  const timeout = options?.timeout ?? 8000;
  const primaryUrl = `${DEFAULT_PRIMARY_BASE}/${path}`;

  // 1. Try primary GitHub raw URL
  const primaryResult = await fetchFromUrl(primaryUrl, timeout);
  if (primaryResult.ok && primaryResult.text) {
    return { text: primaryResult.text, url: primaryUrl };
  }

  // If exact 404 from GitHub raw, the file does not exist in the repository
  if (primaryResult.status === 404) {
    return null;
  }

  // 2. If network error or non-404 failure, try mirrors as fallback
  const mirrors = options?.mirrors || DEFAULT_MIRROR_BASES;
  for (const mirrorBase of mirrors) {
    const mirrorUrl = `${mirrorBase.replace(/\/+$/, "")}/${path}`;
    const mirrorResult = await fetchFromUrl(mirrorUrl, timeout);
    if (mirrorResult.ok && mirrorResult.text) {
      return { text: mirrorResult.text, url: mirrorUrl };
    }
  }

  return null;
}

export async function fetchAmllDbLyrics(
  idOrParams: string | AmllDbLyricsQueryParams,
  options?: AmllDbFetchOptions,
): Promise<AmllDbLyricsResponse | null> {
  const params: AmllDbLyricsQueryParams =
    typeof idOrParams === "string" ? { neteaseId: idOrParams } : idOrParams;

  interface PlatformTarget {
    platform: "netease" | "apple" | "qq" | "spotify";
    id: string;
    path: string;
  }

  const targets: PlatformTarget[] = [];

  if (params.neteaseId?.trim()) {
    const id = params.neteaseId.trim();
    targets.push({
      platform: "netease",
      id,
      path: `ncm-lyrics/${id}.ttml`,
    });
  }

  if (params.appleMusicId?.trim()) {
    const id = params.appleMusicId.trim();
    targets.push({
      platform: "apple",
      id,
      path: `am-lyrics/${id}.ttml`,
    });
  }

  if (params.qqMusicId?.trim()) {
    const id = params.qqMusicId.trim();
    targets.push({
      platform: "qq",
      id,
      path: `qq-lyrics/${id}.ttml`,
    });
  }

  if (params.spotifyId?.trim()) {
    const id = params.spotifyId.trim();
    targets.push({
      platform: "spotify",
      id,
      path: `spotify-lyrics/${id}.ttml`,
    });
  }

  if (targets.length === 0) {
    return null;
  }

  // If only 1 target, fetch directly
  if (targets.length === 1) {
    const target = targets[0]!;
    const result = await fetchPathWithFallbacks(target.path, options);
    if (result) {
      return {
        ttml: result.text,
        matchedPlatform: target.platform,
        matchedId: target.id,
        rawUrl: result.url,
      };
    }
    return null;
  }

  // If multiple targets, query them concurrently and take the first successful match
  try {
    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const res = await fetchPathWithFallbacks(target.path, options);
        if (!res) {
          throw new Error("Not found");
        }
        return {
          ttml: res.text,
          matchedPlatform: target.platform,
          matchedId: target.id,
          rawUrl: res.url,
        };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        return r.value;
      }
    }
  } catch {
    // Ignore error and return null
  }

  return null;
}
