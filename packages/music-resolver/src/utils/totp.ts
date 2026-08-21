import { createHmac } from "node:crypto";
import { HttpClient } from "./http.js";

export const DEFAULT_SPOTIFY_SECRET =
  process.env.SPOTIFY_TOTP_SECRET || "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH";
export const DEFAULT_SPOTIFY_VERSION = 59;
export const SPOTIFY_PLAYER_JS_REGEX =
  /"(https:\/\/[^" ]+\/(?:mobile-)?web-player\.[0-9a-f]+\.js)"/;
export const SPOTIFY_SECRETS_REGEX =
  /\{\s*secret\s*:\s*["']([^"']+)["']\s*,\s*version\s*:\s*(\d+)\s*\}/g;

export function generateSpotifyTotp(
  serverTime: number,
  secret: string = DEFAULT_SPOTIFY_SECRET,
): string {
  const secretArray = Array.from(secret, (c) => c.charCodeAt(0));
  const transformed = secretArray.map(
    (element, index) => element ^ ((index % 33) + 9),
  );

  const hexSecret = Buffer.from(transformed.join(""), "utf8").toString("hex");
  const secretBytes = Buffer.from(hexSecret, "hex");

  const counter = Math.floor(serverTime / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", secretBytes);
  hmac.update(counterBuffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1]! & 0xf;
  const code =
    ((hmacResult[offset]! & 0x7f) << 24) |
    ((hmacResult[offset + 1]! & 0xff) << 16) |
    ((hmacResult[offset + 2]! & 0xff) << 8) |
    (hmacResult[offset + 3]! & 0xff);

  return (code % 10 ** 6).toString().padStart(6, "0");
}

export async function scrapeSpotifySecrets(
  baseUrl = "https://open.spotify.com",
  timeout = 8000,
): Promise<{ secret: string; version: number }> {
  const html = await HttpClient.get<string>(baseUrl, { timeout });
  const jsMatch = html.match(SPOTIFY_PLAYER_JS_REGEX);
  if (!jsMatch || !jsMatch[1]) {
    throw new Error("Could not find Spotify player JS bundle URL");
  }

  const js = await HttpClient.get<string>(jsMatch[1], { timeout });

  let latestVersion = 0;
  let latestSecret = "";
  let match;
  while ((match = SPOTIFY_SECRETS_REGEX.exec(js)) !== null) {
    const version = parseInt(match[2]!, 10);
    if (version > latestVersion) {
      latestVersion = version;
      latestSecret = match[1]!;
    }
  }
  SPOTIFY_SECRETS_REGEX.lastIndex = 0;

  if (!latestSecret) {
    throw new Error("Failed to extract Spotify TOTP secret from bundle");
  }

  return { secret: latestSecret, version: latestVersion };
}

export async function requestSpotifyTokenWithSecret(
  baseUrl: string,
  secret: string,
  version: number,
  timeout: number,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const { serverTime } = await HttpClient.get<{ serverTime: number }>(
    `${baseUrl}/api/server-time`,
    { timeout },
  );

  const totp = generateSpotifyTotp(serverTime, secret);

  const tokenUrl = new URL(`${baseUrl}/api/token`);
  tokenUrl.searchParams.set("reason", "init");
  tokenUrl.searchParams.set("productType", "web-player");
  tokenUrl.searchParams.set("totp", totp);
  tokenUrl.searchParams.set("totpServer", totp);
  tokenUrl.searchParams.set("totpVer", version.toString());
  tokenUrl.searchParams.set("ts", serverTime.toString());

  const tokenData = await HttpClient.get<{
    accessToken?: string;
    accessTokenExpirationTimestampMs?: number;
  }>(tokenUrl.toString(), {
    headers: {
      Accept: "application/json",
      Referer: `${baseUrl}/`,
      Origin: baseUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    },
    timeout,
  });

  if (tokenData?.accessToken) {
    const expiresAt = Math.floor(
      (tokenData.accessTokenExpirationTimestampMs || Date.now() + 3600 * 1000) /
        1000,
    );
    return { accessToken: tokenData.accessToken, expiresAt };
  }

  return null;
}
