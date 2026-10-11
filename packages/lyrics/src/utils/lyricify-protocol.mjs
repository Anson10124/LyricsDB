// Protocol helpers for the Lyricify fetcher. No application side effects.
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
const REQUEST_AES_KEY = Buffer.from("lyricifygetlyric", "ascii");
export const LYRICIFY_VERSION = "4.4.0.260928-release";
const VERSION = LYRICIFY_VERSION;

/** @param {Record<string, string | undefined>} env */
export function buildAccount(env) {
  const id = env.LYRICIFY_SPOTIFY_USER_ID?.trim();
  const email = env.LYRICIFY_SPOTIFY_EMAIL?.trim();
  if (!id || !email)
    throw new Error(
      "Set LYRICIFY_SPOTIFY_USER_ID and LYRICIFY_SPOTIFY_EMAIL in the root .env or your shell.",
    );
  return {
    Name: id,
    Email: email,
    Key: null,
    Type: "user",
    Spotify: {
      DisplayName: env.LYRICIFY_SPOTIFY_DISPLAY_NAME || null,
      Email: email,
      Id: id,
      Region: env.LYRICIFY_SPOTIFY_REGION || null,
    },
    PremiumAd: null,
    Packed: null,
  };
}

/** @param {{spotifyId: string, title: string, artists: string[], durationMs: number, album?: string | null, isrc?: string | null, isLocal?: boolean}} record */
export function buildTrack(record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("Expected one LyricsDB track object.");
  if (
    typeof record.spotifyId !== "string" ||
    !/^[A-Za-z0-9]{22}$/.test(record.spotifyId)
  )
    throw new Error("Existing metadata must contain a 22-character spotifyId.");
  if (typeof record.title !== "string" || !record.title.trim())
    throw new Error("Existing metadata must contain a title.");
  if (
    !Array.isArray(record.artists) ||
    !record.artists.length ||
    !record.artists.every(
      (artist) => typeof artist === "string" && artist.trim(),
    )
  )
    throw new Error(
      "Existing metadata must contain a non-empty artists array.",
    );
  if (!Number.isSafeInteger(record.durationMs) || record.durationMs <= 0)
    throw new Error(
      "Existing metadata must contain a positive durationMs in milliseconds.",
    );
  for (const field of ["album", "isrc"]) {
    if (record[field] != null && typeof record[field] !== "string")
      throw new Error(`Existing metadata ${field} must be a string or null.`);
  }
  if (record.isLocal != null && typeof record.isLocal !== "boolean")
    throw new Error("Existing metadata isLocal must be a boolean.");
  return {
    Id: record.spotifyId,
    SpotifyUri: `spotify:track:${record.spotifyId}`,
    Isrc: record.isrc || null,
    Name: record.title,
    Artists: [...record.artists],
    Album: record.album ?? null,
    TrackLength: record.durationMs,
    IsLocal: record.isLocal ?? false,
  };
}

/** @param {ReturnType<typeof buildAccount>} account
 * @param {ReturnType<typeof buildTrack>} track
 * @param {string} source
 * @param {string} [version] */
export function makeRequestKey(account, track, source, version = VERSION) {
  const payload = {
    Version: version,
    Type: "Get",
    User: account,
    Track: track,
    Source: source,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const cipher = createCipheriv("aes-128-ecb", REQUEST_AES_KEY, null);
  return Buffer.concat([cipher.update(b64, "ascii"), cipher.final()]).toString(
    "base64",
  );
}

/** @param {ReturnType<typeof buildAccount>} account
 * @param {ReturnType<typeof buildTrack>} track
 * @param {boolean} [wrapped] */
export function responseKey(account, track, wrapped = true) {
  const md5 = createHash("md5")
    .update(account.Spotify.Id + JSON.stringify(track), "utf8")
    .digest("hex")
    .toUpperCase();
  return Buffer.from(
    [...md5].filter((_, index) => index % 2 === (wrapped ? 1 : 0)).join(""),
    "ascii",
  );
}

/** @param {string} value */
function decodeBase64(value) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid base64 in Lyricify response.");
  return Buffer.from(value, "base64");
}

/** @param {string} body */
export function responseCiphertext(body) {
  const parts = body.trim().split(/\s+/);
  let b64;
  if (parts.length === 1) b64 = parts[0];
  else if (parts.length === 3 && parts[0] === "ac" && parts[2] === "0")
    b64 = parts[1];
  else if (
    parts.length === 2 &&
    parts[0] === "ac" &&
    parts[1].endsWith("0") &&
    parts[1].length % 4 === 1
  )
    b64 = parts[1].slice(0, -1);
  else throw new Error("Unexpected Lyricify response envelope.");
  const ciphertext = decodeBase64(b64);
  if (!ciphertext.length || ciphertext.length % 16)
    throw new Error("Response ciphertext is not AES block-aligned.");
  return ciphertext;
}

/** @param {string} body
 * @param {Buffer} key
 * @returns {unknown} */
export function decryptResponse(body, key) {
  const ciphertext = responseCiphertext(body);
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "Lyricify decryption failed; check account identity, metadata, and protocol version.",
    );
  }
  const json = decodeBase64(plaintext.toString("utf8"));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
}

/** @param {string} body
 * @param {ReturnType<typeof buildAccount>} account
 * @param {ReturnType<typeof buildTrack>} track
 * @returns {unknown} */
export function decryptLyricifyResponse(body, account, track) {
  return decryptResponse(
    body,
    responseKey(account, track, /^ac\s/.test(body.trim())),
  );
}
