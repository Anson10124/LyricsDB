import { eq } from "drizzle-orm";
import {
  fetchAnonymousSpotifyToken,
  runWithoutAbortSignal,
} from "@repo/music-resolver";
import { db as defaultDb, type DatabaseClient } from "./client.js";
import { jwts } from "./schema/jwt.js";

const DEEZER_PROVIDER = "deezer";
const DEEZER_JWT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SPOTIFY_PROVIDER = "spotify";
const SPOTIFY_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (Spotify token lasts 60 min)

interface CachedToken {
  token: string;
  expireAt: number;
}

// Process-local cache in front of the jwt table, so hot paths skip a DB read
const memoryTokens = new Map<string, CachedToken>();
// One refresh per provider at a time; concurrent callers share its promise
const inFlightRefreshes = new Map<string, Promise<string>>();
// After a failed refresh, callers get the same error for a short while
// instead of each hitting the upstream token endpoint again
const REFRESH_FAILURE_BACKOFF_MS = 10_000;
const refreshFailures = new Map<string, { error: unknown; until: number }>();

async function getStoredToken(
  provider: string,
  client: DatabaseClient,
  refresh: () => Promise<string>,
): Promise<string> {
  const cached = memoryTokens.get(provider);
  if (cached && cached.expireAt > Date.now()) {
    return cached.token;
  }

  try {
    const existing = await client
      .select()
      .from(jwts)
      .where(eq(jwts.provider, provider))
      .limit(1);

    const record = existing[0];
    const expireAt = record?.expireAt ? new Date(record.expireAt).getTime() : 0;
    if (record?.token && expireAt > Date.now()) {
      memoryTokens.set(provider, { token: record.token, expireAt });
      return record.token;
    }
  } catch (err) {
    // If DB read fails, continue to fetch token directly
    console.warn(`[jwt-manager] Failed to read ${provider} token from DB:`, err);
  }

  // Token is expired, missing, or DB had an error -> fetch a fresh one
  return refresh();
}

function refreshStoredToken(
  provider: string,
  client: DatabaseClient,
  fetchToken: () => Promise<{ token: string; expireAt: Date }>,
): Promise<string> {
  const inFlight = inFlightRefreshes.get(provider);
  if (inFlight) return inFlight;

  const failure = refreshFailures.get(provider);
  if (failure && failure.until > Date.now()) {
    return Promise.reject(failure.error);
  }

  // Detached from the starting caller's cancellation signal: other callers share
  // this refresh, so one caller's deadline or disconnect must not fail it for all
  const refresh = runWithoutAbortSignal(async () => {
    let fetched: { token: string; expireAt: Date };
    try {
      fetched = await fetchToken();
    } catch (err) {
      refreshFailures.set(provider, {
        error: err,
        until: Date.now() + REFRESH_FAILURE_BACKOFF_MS,
      });
      throw err;
    }

    const { token, expireAt } = fetched;
    refreshFailures.delete(provider);
    memoryTokens.set(provider, { token, expireAt: expireAt.getTime() });

    try {
      await client
        .insert(jwts)
        .values({ provider, token, expireAt })
        .onConflictDoUpdate({
          target: jwts.provider,
          set: { token, expireAt },
        });
    } catch (err) {
      // Graceful fallback if DB write fails
      console.warn(`[jwt-manager] Failed to store ${provider} token in DB:`, err);
    }

    return token;
  }).finally(() => {
    inFlightRefreshes.delete(provider);
  });

  inFlightRefreshes.set(provider, refresh);
  return refresh;
}

export async function fetchAnonymousDeezerJwt(options?: {
  timeout?: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? 8000,
  );

  try {
    const res = await fetch(
      "https://auth.deezer.com/login/anonymous?jo=p&rto=c",
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch anonymous Deezer JWT: HTTP ${res.status}`,
      );
    }

    const data = (await res.json()) as { jwt?: string };
    if (!data.jwt) {
      throw new Error("Deezer anonymous auth response did not include jwt");
    }

    return data.jwt;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function getDeezerJwt(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return getStoredToken(DEEZER_PROVIDER, client, () =>
    refreshDeezerJwt(client, options),
  );
}

export async function refreshDeezerJwt(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return refreshStoredToken(DEEZER_PROVIDER, client, async () => ({
    token: await fetchAnonymousDeezerJwt(options),
    expireAt: new Date(Date.now() + DEEZER_JWT_CACHE_TTL_MS),
  }));
}

export { fetchAnonymousSpotifyToken };

export async function getSpotifyToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return getStoredToken(SPOTIFY_PROVIDER, client, () =>
    refreshSpotifyToken(client, options),
  );
}

export async function refreshSpotifyToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return refreshStoredToken(SPOTIFY_PROVIDER, client, async () => ({
    token: await fetchAnonymousSpotifyToken(options),
    expireAt: new Date(Date.now() + SPOTIFY_TOKEN_CACHE_TTL_MS),
  }));
}

const MUSIXMATCH_PROVIDER = "musixmatch";
const MUSIXMATCH_TOKEN_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function generateMusixmatchRandomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function fetchAnonymousMusixmatchToken(options?: {
  timeout?: number;
  maxRetries?: number;
}): Promise<string> {
  const timeout = options?.timeout ?? 8000;
  const maxRetries = options?.maxRetries ?? 8;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const t = generateMusixmatchRandomId();
    const url = `https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&t=${t}`;

    try {
      const res = await fetch(url, {
        headers: {
          authority: "apic-desktop.musixmatch.com",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          message?: {
            header?: { status_code?: number; hint?: string };
            body?: { user_token?: string };
          };
        };

        const token = data.message?.body?.user_token;
        if (token && token !== "Upgrade. Paid script.") {
          return token;
        }

        const hint = data.message?.header?.hint;
        if (hint === "captcha" || data.message?.header?.status_code === 401) {
          // Wait briefly before next attempt
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
      }
    } catch {
      // Retry on network/timeout error
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error(
    "Failed to acquire Musixmatch user token after multiple attempts",
  );
}

export async function getMusixmatchToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return getStoredToken(MUSIXMATCH_PROVIDER, client, () =>
    refreshMusixmatchToken(client, options),
  );
}

export async function refreshMusixmatchToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return refreshStoredToken(MUSIXMATCH_PROVIDER, client, async () => ({
    token: await fetchAnonymousMusixmatchToken(options),
    expireAt: new Date(Date.now() + MUSIXMATCH_TOKEN_CACHE_TTL_MS),
  }));
}

const APPLE_MUSIC_PROVIDER = "apple";
const APPLE_MUSIC_TOKEN_CACHE_FALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function fetchAnonymousAppleMusicToken(options?: {
  timeout?: number;
}): Promise<{ token: string; expireAt: Date }> {
  const timeout = options?.timeout ?? 8000;
  const browseUrl = "https://music.apple.com/us/browse";

  const browseRes = await fetch(browseUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!browseRes.ok) {
    throw new Error(
      `Failed to fetch Apple Music browse page: HTTP ${browseRes.status}`,
    );
  }

  const html = await browseRes.text();
  const scriptRegex = /src="([^"]*\/assets\/index[^"]*\.js)"/g;
  let match = scriptRegex.exec(html);
  let jsPath = match ? match[1] : null;

  if (!jsPath) {
    const anyAssetRegex = /src="([^"]*\/assets\/[^"]+\.js)"/g;
    while ((match = anyAssetRegex.exec(html)) !== null) {
      if (match[1]?.includes("index") || match[1]?.includes("main")) {
        jsPath = match[1];
        break;
      }
    }
  }

  if (!jsPath) {
    throw new Error("Could not find index.js in Apple Music HTML");
  }

  const jsUrl = jsPath.startsWith("http")
    ? jsPath
    : `https://music.apple.com${jsPath}`;
  const jsRes = await fetch(jsUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!jsRes.ok) {
    throw new Error(`Failed to fetch Apple Music JS bundle: HTTP ${jsRes.status}`);
  }

  const jsContent = await jsRes.text();
  const tokenMatch = jsContent.match(/(eyJ(?:hbGc|0eXAi).+?)"/);
  if (!tokenMatch || !tokenMatch[1]) {
    throw new Error("Could not find Bearer token in Apple Music JS");
  }

  const token = tokenMatch[1];
  let expireAt = new Date(Date.now() + APPLE_MUSIC_TOKEN_CACHE_FALLBACK_TTL_MS);

  try {
    const parts = token.split(".");
    if (parts[1]) {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf8"),
      );
      if (payload.exp && typeof payload.exp === "number") {
        expireAt = new Date(payload.exp * 1000 - 24 * 60 * 60 * 1000);
      }
    }
  } catch {
    // Fallback TTL
  }

  return { token, expireAt };
}

export async function getAppleMusicToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return getStoredToken(APPLE_MUSIC_PROVIDER, client, () =>
    refreshAppleMusicToken(client, options),
  );
}

export async function refreshAppleMusicToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  return refreshStoredToken(APPLE_MUSIC_PROVIDER, client, () =>
    fetchAnonymousAppleMusicToken(options),
  );
}

// Clears the in-process token cache and refresh state (used by tests)
export function resetTokenCache(): void {
  memoryTokens.clear();
  inFlightRefreshes.clear();
  refreshFailures.clear();
}
