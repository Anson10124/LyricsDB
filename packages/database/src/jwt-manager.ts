import { eq } from 'drizzle-orm';
import { db as defaultDb, type DatabaseClient } from './client.js';
import { jwts } from './schema/jwt.js';

const DEEZER_PROVIDER = 'deezer';
const JWT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      .where(eq(jwts.deezer, DEEZER_PROVIDER))
      .limit(1);

    const record = existing[0];
    if (record?.token && record?.created) {
      const createdTime = new Date(record.created).getTime();
      const age = Date.now() - createdTime;

      // If token is less than 5 minutes old, reuse it
      if (age < JWT_CACHE_TTL_MS) {
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
  const now = new Date();

  try {
    await client
      .insert(jwts)
      .values({
        deezer: DEEZER_PROVIDER,
        token: newToken,
        created: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jwts.deezer,
        set: {
          token: newToken,
          created: now,
          updatedAt: now,
        },
      });
  } catch {
    // Graceful fallback if DB write fails
  }

  return newToken;
}
