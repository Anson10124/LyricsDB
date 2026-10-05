import type { DeezerTrackLookupResponse } from "@repo/types";
import type {
  ResolveOptions,
  ResolverConfig,
  ResolvedLink,
  TrackMetadata,
} from "../types.js";
import { HttpClient, HttpError } from "./http.js";
import { globalProviderLimiter } from "./provider-limiter.js";

function normalizeIsrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const isrc = value.trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : undefined;
}

// Only use verified platform matches to avoid borrowing another recording's ISRC.
export async function backfillIsrc(
  metadata: TrackMetadata,
  links: Record<string, ResolvedLink | null>,
  config?: ResolverConfig,
  options?: ResolveOptions,
): Promise<void> {
  if (metadata.type !== "song" || metadata.isrc?.trim()) return;

  const candidates = [
    links.deezer,
    links.appleMusic,
    links.applemusic,
    links.apple,
  ];
  const applyIsrc = (value: unknown, platform: string): boolean => {
    const isrc = normalizeIsrc(value);
    if (!isrc) return false;
    metadata.isrc = isrc;
    options?.onProgress?.({
      stage: "resolving",
      step: "enriched_isrc",
      platform,
      data: { isrc },
    });
    return true;
  };

  for (const link of candidates) {
    if (link?.isVerified && applyIsrc(link.raw?.isrc, link.platform)) return;
  }

  const deezer = links.deezer;
  if (
    deezer?.isVerified &&
    deezer.id &&
    /^\d+$/.test(deezer.id) &&
    globalProviderLimiter.isAvailable("deezer")
  ) {
    try {
      const track = await HttpClient.get<DeezerTrackLookupResponse>(
        `${config?.deezer?.apiUrl || "https://api.deezer.com"}/track/${encodeURIComponent(deezer.id)}`,
        { timeout: options?.timeout, retries: options?.retries },
      );
      if (
        !track.error &&
        String(track.id) === deezer.id &&
        applyIsrc(track.isrc, "deezer")
      )
        return;
    } catch {
      // Apple Music can still supply the ISRC if Deezer is unavailable.
    }
  }

  const apple = candidates.slice(1).find((link) => link?.isVerified);
  const getToken = config?.appleMusic?.getToken;
  if (
    !apple?.id ||
    !/^\d+$/.test(apple.id) ||
    !getToken ||
    !globalProviderLimiter.isAvailable("appleMusic")
  )
    return;

  const country =
    options?.preferredCountry || config?.appleMusic?.country || "us";
  const url = `${config?.appleMusic?.apiUrl || "https://amp-api.music.apple.com"}/v1/catalog/${encodeURIComponent(country)}/songs/${encodeURIComponent(apple.id)}`;
  try {
    const request = async (forceRefresh = false) => {
      const token = await getToken(options, forceRefresh);
      if (!token) return null;
      return HttpClient.get<{
        data?: Array<{ id: string; attributes?: { isrc?: string } }>;
      }>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://music.apple.com",
          Referer: "https://music.apple.com/",
        },
        timeout: options?.timeout,
        retries: 0,
      });
    };
    let response;
    try {
      response = await request();
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      response = await request(true);
    }
    const song = response?.data?.find((item) => item.id === apple.id);
    applyIsrc(song?.attributes?.isrc, "appleMusic");
  } catch {
    // Missing ISRC must not prevent metadata or other lyrics providers resolving.
  }
}
