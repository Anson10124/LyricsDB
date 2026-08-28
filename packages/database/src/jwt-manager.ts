import { eq } from "drizzle-orm";
import { fetchAnonymousSpotifyToken } from "@repo/music-resolver";
import { db as defaultDb, type DatabaseClient } from "./client.js";
import { jwts } from "./schema/jwt.js";

const DEEZER_PROVIDER = "deezer";
const DEEZER_JWT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SPOTIFY_PROVIDER = "spotify";
const SPOTIFY_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (Spotify token lasts 60 min)

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

  try {
    const existing = await client
      .select()
      .from(jwts)
      .where(eq(jwts.provider, DEEZER_PROVIDER))
      .limit(1);

    const record = existing[0];
    if (record?.token && record?.expireAt) {
      if (new Date(record.expireAt) > new Date()) {
        return record.token;
      }
    }
  } catch {
    // If DB read fails, continue to fetch token directly
  }

  // Token is expired, missing, or DB had an error -> fetch a fresh one
  return refreshDeezerJwt(client, options);
}

export async function refreshDeezerJwt(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  const newToken = await fetchAnonymousDeezerJwt(options);
  const expireAt = new Date(Date.now() + DEEZER_JWT_CACHE_TTL_MS);

  try {
    await client
      .insert(jwts)
      .values({
        provider: DEEZER_PROVIDER,
        token: newToken,
        expireAt,
      })
      .onConflictDoUpdate({
        target: jwts.provider,
        set: {
          token: newToken,
          expireAt,
        },
      });
  } catch {
    // Graceful fallback if DB write fails
  }

  return newToken;
}

export { fetchAnonymousSpotifyToken };

export async function getSpotifyToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;

  try {
    const existing = await client
      .select()
      .from(jwts)
      .where(eq(jwts.provider, SPOTIFY_PROVIDER))
      .limit(1);

    const record = existing[0];
    if (record?.token && record?.expireAt) {
      if (new Date(record.expireAt) > new Date()) {
        return record.token;
      }
    }
  } catch {
    // If DB read fails, fallback to direct fetch
  }

  return refreshSpotifyToken(client, options);
}

export async function refreshSpotifyToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  const newToken = await fetchAnonymousSpotifyToken(options);
  const expireAt = new Date(Date.now() + SPOTIFY_TOKEN_CACHE_TTL_MS);

  try {
    await client
      .insert(jwts)
      .values({
        provider: SPOTIFY_PROVIDER,
        token: newToken,
        expireAt,
      })
      .onConflictDoUpdate({
        target: jwts.provider,
        set: {
          token: newToken,
          expireAt,
        },
      });
  } catch {
    // Graceful fallback if DB write fails
  }

  return newToken;
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

  try {
    const existing = await client
      .select()
      .from(jwts)
      .where(eq(jwts.provider, MUSIXMATCH_PROVIDER))
      .limit(1);

    const record = existing[0];
    if (record?.token && record?.expireAt) {
      if (new Date(record.expireAt) > new Date()) {
        return record.token;
      }
    }
  } catch {
    // If DB read fails, fallback to direct fetch
  }

  return refreshMusixmatchToken(client, options);
}

export async function refreshMusixmatchToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  const newToken = await fetchAnonymousMusixmatchToken(options);
  const expireAt = new Date(Date.now() + MUSIXMATCH_TOKEN_CACHE_TTL_MS);

  try {
    await client
      .insert(jwts)
      .values({
        provider: MUSIXMATCH_PROVIDER,
        token: newToken,
        expireAt,
      })
      .onConflictDoUpdate({
        target: jwts.provider,
        set: {
          token: newToken,
          expireAt,
        },
      });
  } catch {
    // Graceful fallback if DB write fails
  }

  return newToken;
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

  try {
    const existing = await client
      .select()
      .from(jwts)
      .where(eq(jwts.provider, APPLE_MUSIC_PROVIDER))
      .limit(1);

    const record = existing[0];
    if (record?.token && record?.expireAt) {
      if (new Date(record.expireAt) > new Date()) {
        return record.token;
      }
    }
  } catch {
    // Fallback to direct fetch
  }

  return refreshAppleMusicToken(client, options);
}

export async function refreshAppleMusicToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number },
): Promise<string> {
  const client = dbClient || defaultDb;
  const { token, expireAt } = await fetchAnonymousAppleMusicToken(options);

  try {
    await client
      .insert(jwts)
      .values({
        provider: APPLE_MUSIC_PROVIDER,
        token,
        expireAt,
      })
      .onConflictDoUpdate({
        target: jwts.provider,
        set: {
          token,
          expireAt,
        },
      });
  } catch {
    // Graceful fallback
  }

  return token;
}
