import { createHmac } from 'node:crypto';

export const DEFAULT_SPOTIFY_SECRET = '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH';
export const DEFAULT_SPOTIFY_VERSION = 59;

export function generateSpotifyTotp(serverTime: number, secret: string = DEFAULT_SPOTIFY_SECRET): string {
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
