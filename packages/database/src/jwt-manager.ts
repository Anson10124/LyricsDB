import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DatabaseClient } from './client.js';
import { jwts } from './schema/jwt.js';

const DEEZER_PROVIDER = 'deezer';
const DEEZER_JWT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SPOTIFY_PROVIDER = 'spotify';
const SPOTIFY_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (Spotify token lasts 60 min)
const DEFAULT_SPOTIFY_SECRET = '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH';
const DEFAULT_SPOTIFY_VERSION = 59;
const PLAYER_JS_REGEX = /"(https:\/\/[^" ]+\/(?:mobile-)?web-player\.[0-9a-f]+\.js)"/;
const SECRETS_REGEX = /\{\s*secret\s*:\s*["']([^"']+)["']\s*,\s*version\s*:\s*(\d+)\s*\}/g;

function generateTotp(serverTime: number, secret: string): string {
  const secretArray = Array.from(secret, (c) => c.charCodeAt(0));
  const transformed = secretArray.map((element, index) => element ^ ((index % 33) + 9));
  const hexSecret = Buffer.from(transformed.join(''), 'utf8').toString('hex');
  const secretBytes = Buffer.from(hexSecret, 'hex');

  const counter = Math.floor(serverTime / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secretBytes);
  hmac.update(counterBuffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1]! & 0xf;
  const code =
    ((hmacResult[offset]! & 0x7f) << 24) |
    ((hmacResult[offset + 1]! & 0xff) << 16) |
    ((hmacResult[offset + 2]! & 0xff) << 8) |
    (hmacResult[offset + 3]! & 0xff);

  return (code % 10 ** 6).toString().padStart(6, '0');
}

export async function fetchAnonymousDeezerJwt(options?: { timeout?: number }): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 8000);

  try {
    const res = await fetch('https://auth.deezer.com/login/anonymous?jo=p&rto=c', {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Failed to fetch anonymous Deezer JWT: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { jwt?: string };
    if (!data.jwt) {
      throw new Error('Deezer anonymous auth response did not include jwt');
    }

    return data.jwt;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function getDeezerJwt(
  dbClient?: DatabaseClient,
  options?: { timeout?: number }
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
  options?: { timeout?: number }
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

export async function fetchAnonymousSpotifyToken(options?: { timeout?: number }): Promise<string> {
  const timeout = options?.timeout ?? 8000;
  const baseUrl = 'https://open.spotify.com';

  const requestToken = async (secret: string, version: number): Promise<string | null> => {
    const timeRes = await fetch(`${baseUrl}/api/server-time`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!timeRes.ok) return null;
    const { serverTime } = (await timeRes.json()) as { serverTime: number };

    const totp = generateTotp(serverTime, secret);
    const tokenUrl = new URL(`${baseUrl}/api/token`);
    tokenUrl.searchParams.set('reason', 'init');
    tokenUrl.searchParams.set('productType', 'web-player');
    tokenUrl.searchParams.set('totp', totp);
    tokenUrl.searchParams.set('totpServer', totp);
    tokenUrl.searchParams.set('totpVer', version.toString());
    tokenUrl.searchParams.set('ts', serverTime.toString());

    const tokenRes = await fetch(tokenUrl.toString(), {
      headers: {
        Accept: 'application/json',
        Referer: `${baseUrl}/`,
        Origin: baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { accessToken?: string };
    return tokenData.accessToken || null;
  };

  // Stage 1: Try fast-path with default known secret & version
  try {
    const fastToken = await requestToken(DEFAULT_SPOTIFY_SECRET, DEFAULT_SPOTIFY_VERSION);
    if (fastToken) return fastToken;
  } catch {
    // Fallback to Stage 2
  }

  // Stage 2: Scrape web-player JS bundle for rotated secret
  const htmlRes = await fetch(baseUrl, { signal: AbortSignal.timeout(timeout) });
  const html = await htmlRes.text();
  const jsMatch = html.match(PLAYER_JS_REGEX);
  if (!jsMatch?.[1]) {
    throw new Error('Could not find Spotify player JS bundle URL');
  }

  const jsRes = await fetch(jsMatch[1], { signal: AbortSignal.timeout(timeout) });
  const js = await jsRes.text();

  let latestVersion = 0;
  let latestSecret = '';
  let match;
  while ((match = SECRETS_REGEX.exec(js)) !== null) {
    const ver = parseInt(match[2]!, 10);
    if (ver > latestVersion) {
      latestVersion = ver;
      latestSecret = match[1]!;
    }
  }
  SECRETS_REGEX.lastIndex = 0;

  if (!latestSecret) {
    throw new Error('Failed to extract Spotify TOTP secret from bundle');
  }

  const scrapedToken = await requestToken(latestSecret, latestVersion);
  if (!scrapedToken) {
    throw new Error('Failed to fetch Spotify anonymous token after bundle scrape');
  }

  return scrapedToken;
}

export async function getSpotifyToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number }
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
  options?: { timeout?: number }
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

const MUSIXMATCH_PROVIDER = 'musixmatch';
const MUSIXMATCH_TOKEN_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function generateMusixmatchRandomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
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
          authority: 'apic-desktop.musixmatch.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
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
        if (token && token !== 'Upgrade. Paid script.') {
          return token;
        }

        const hint = data.message?.header?.hint;
        if (hint === 'captcha' || data.message?.header?.status_code === 401) {
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

  throw new Error('Failed to acquire Musixmatch user token after multiple attempts');
}

export async function getMusixmatchToken(
  dbClient?: DatabaseClient,
  options?: { timeout?: number }
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
  options?: { timeout?: number }
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
