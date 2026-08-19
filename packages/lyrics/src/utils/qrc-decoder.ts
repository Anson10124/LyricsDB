import pako from 'pako';

// S-Boxes for QQ Music DES
const SBOX1 = new Uint8Array([
  14,  4, 13,  1,  2, 15, 11,  8,  3, 10,  6, 12,  5,  9,  0,  7,
   0, 15,  7,  4, 14,  2, 13,  1, 10,  6, 12, 11,  9,  5,  3,  8,
   4,  1, 14,  8, 13,  6,  2, 11, 15, 12,  9,  7,  3, 10,  5,  0,
  15, 12,  8,  2,  4,  9,  1,  7,  5, 11,  3, 14, 10,  0,  6, 13,
]);
const SBOX2 = new Uint8Array([
  15,  1,  8, 14,  6, 11,  3,  4,  9,  7,  2, 13, 12,  0,  5, 10,
   3, 13,  4,  7, 15,  2,  8, 15, 12,  0,  1, 10,  6,  9, 11,  5,
   0, 14,  7, 11, 10,  4, 13,  1,  5,  8, 12,  6,  9,  3,  2, 15,
  13,  8, 10,  1,  3, 15,  4,  2, 11,  6,  7, 12,  0,  5, 14,  9,
]);
const SBOX3 = new Uint8Array([
  10,  0,  9, 14,  6,  3, 15,  5,  1, 13, 12,  7, 11,  4,  2,  8,
  13,  7,  0,  9,  3,  4,  6, 10,  2,  8,  5, 14, 12, 11, 15,  1,
  13,  6,  4,  9,  8, 15,  3,  0, 11,  1,  2, 12,  5, 10, 14,  7,
   1, 10, 13,  0,  6,  9,  8,  7,  4, 15, 14,  3, 11,  5,  2, 12,
]);
const SBOX4 = new Uint8Array([
   7, 13, 14,  3,  0,  6,  9, 10,  1,  2,  8,  5, 11, 12,  4, 15,
  13,  8, 11,  5,  6, 15,  0,  3,  4,  7,  2, 12,  1, 10, 14,  9,
  10,  6,  9,  0, 12, 11,  7, 13, 15,  1,  3, 14,  5,  2,  8,  4,
   3, 15,  0,  6, 10, 10, 13,  8,  9,  4,  5, 11, 12,  7,  2, 14,
]);
const SBOX5 = new Uint8Array([
   2, 12,  4,  1,  7, 10, 11,  6,  8,  5,  3, 15, 13,  0, 14,  9,
  14, 11,  2, 12,  4,  7, 13,  1,  5,  0, 15, 10,  3,  9,  8,  6,
   4,  2,  1, 11, 10, 13,  7,  8, 15,  9, 12,  5,  6,  3,  0, 14,
  11,  8, 12,  7,  1, 14,  2, 13,  6, 15,  0,  9, 10,  4,  5,  3,
]);
const SBOX6 = new Uint8Array([
  12,  1, 10, 15,  9,  2,  6,  8,  0, 13,  3,  4, 14,  7,  5, 11,
  10, 15,  4,  2,  7, 12,  9,  5,  6,  1, 13, 14,  0, 11,  3,  8,
   9, 14, 15,  5,  2,  8, 12,  3,  7,  0,  4, 10,  1, 13, 11,  6,
   4,  3,  2, 12,  9,  5, 15, 10, 11, 14,  1,  7,  6,  0,  8, 13,
]);
const SBOX7 = new Uint8Array([
   4, 11,  2, 14, 15,  0,  8, 13,  3, 12,  9,  7,  5, 10,  6,  1,
  13,  0, 11,  7,  4,  9,  1, 10, 14,  3,  5, 12,  2, 15,  8,  6,
   1,  4, 11, 13, 12,  3,  7, 14, 10, 15,  6,  8,  0,  5,  9,  2,
   6, 11, 13,  8,  1,  4, 10,  7,  9,  5,  0, 15, 14,  2,  3, 12,
]);
const SBOX8 = new Uint8Array([
  13,  2,  8,  4,  6, 15, 11,  1, 10,  9,  3, 14,  5,  0, 12,  7,
   1, 15, 13,  8, 10,  3,  7,  4, 12,  5,  6, 11,  0, 14,  9,  2,
   7, 11,  4,  1,  9, 12, 14,  2,  0,  6, 10, 13, 15,  3,  5,  8,
   2,  1, 14,  7,  4, 10,  8, 13, 15, 12,  9,  0,  3,  5,  6, 11,
]);

const KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KEY_PERM_C = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
  9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
];
const KEY_PERM_D = [
  62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
];
const KEY_COMPRESSION = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9,
  22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47,
  43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];

const KEY1 = new Uint8Array([33, 64, 35, 41, 40, 78, 72, 76, 105, 117, 121, 42, 36, 37, 94, 38]); // "!@#)(NHLiuy*$%^&"
const KEY2 = new Uint8Array([49, 50, 51, 90, 88, 67, 33, 64, 35, 41, 40, 42, 36, 37, 94, 38]);      // "123ZXC!@#)(*$%^&"
const KEY3 = new Uint8Array([33, 64, 35, 41, 40, 42, 36, 37, 94, 38, 97, 98, 99, 68, 69, 70]);      // "!@#)(*$%^&abcDEF"

function bitnum(a: Uint8Array, b: number, c: number): number {
  const idx = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
  return (((a[idx]! >> (7 - (b % 8))) & 0x01) << c) >>> 0;
}

function bitnumintr(a: number, b: number, c: number): number {
  return (((a >>> (31 - b)) & 0x00000001) << c) >>> 0;
}

function bitnumintl(a: number, b: number, c: number): number {
  return (((a << b) & 0x80000000) >>> c) >>> 0;
}

function sboxbit(a: number): number {
  return ((a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)) & 0xff;
}

function IP(inB: Uint8Array): [number, number] {
  const state0 = (
    bitnum(inB, 57, 31) | bitnum(inB, 49, 30) | bitnum(inB, 41, 29) | bitnum(inB, 33, 28) |
    bitnum(inB, 25, 27) | bitnum(inB, 17, 26) | bitnum(inB, 9, 25) | bitnum(inB, 1, 24) |
    bitnum(inB, 59, 23) | bitnum(inB, 51, 22) | bitnum(inB, 43, 21) | bitnum(inB, 35, 20) |
    bitnum(inB, 27, 19) | bitnum(inB, 19, 18) | bitnum(inB, 11, 17) | bitnum(inB, 3, 16) |
    bitnum(inB, 61, 15) | bitnum(inB, 53, 14) | bitnum(inB, 45, 13) | bitnum(inB, 37, 12) |
    bitnum(inB, 29, 11) | bitnum(inB, 21, 10) | bitnum(inB, 13, 9) | bitnum(inB, 5, 8) |
    bitnum(inB, 63, 7) | bitnum(inB, 55, 6) | bitnum(inB, 47, 5) | bitnum(inB, 39, 4) |
    bitnum(inB, 31, 3) | bitnum(inB, 23, 2) | bitnum(inB, 15, 1) | bitnum(inB, 7, 0)
  ) >>> 0;

  const state1 = (
    bitnum(inB, 56, 31) | bitnum(inB, 48, 30) | bitnum(inB, 40, 29) | bitnum(inB, 32, 28) |
    bitnum(inB, 24, 27) | bitnum(inB, 16, 26) | bitnum(inB, 8, 25) | bitnum(inB, 0, 24) |
    bitnum(inB, 58, 23) | bitnum(inB, 50, 22) | bitnum(inB, 42, 21) | bitnum(inB, 34, 20) |
    bitnum(inB, 26, 19) | bitnum(inB, 18, 18) | bitnum(inB, 10, 17) | bitnum(inB, 2, 16) |
    bitnum(inB, 60, 15) | bitnum(inB, 52, 14) | bitnum(inB, 44, 13) | bitnum(inB, 36, 12) |
    bitnum(inB, 28, 11) | bitnum(inB, 20, 10) | bitnum(inB, 12, 9) | bitnum(inB, 4, 8) |
    bitnum(inB, 62, 7) | bitnum(inB, 54, 6) | bitnum(inB, 46, 5) | bitnum(inB, 38, 4) |
    bitnum(inB, 30, 3) | bitnum(inB, 22, 2) | bitnum(inB, 14, 1) | bitnum(inB, 6, 0)
  ) >>> 0;

  return [state0, state1];
}

function InvIP(state: [number, number], out: Uint8Array, offset: number) {
  const [s0, s1] = state;
  out[offset + 3] = bitnumintr(s1, 7, 7) | bitnumintr(s0, 7, 6) | bitnumintr(s1, 15, 5) |
                    bitnumintr(s0, 15, 4) | bitnumintr(s1, 23, 3) | bitnumintr(s0, 23, 2) |
                    bitnumintr(s1, 31, 1) | bitnumintr(s0, 31, 0);

  out[offset + 2] = bitnumintr(s1, 6, 7) | bitnumintr(s0, 6, 6) | bitnumintr(s1, 14, 5) |
                    bitnumintr(s0, 14, 4) | bitnumintr(s1, 22, 3) | bitnumintr(s0, 22, 2) |
                    bitnumintr(s1, 30, 1) | bitnumintr(s0, 30, 0);

  out[offset + 1] = bitnumintr(s1, 5, 7) | bitnumintr(s0, 5, 6) | bitnumintr(s1, 13, 5) |
                    bitnumintr(s0, 13, 4) | bitnumintr(s1, 21, 3) | bitnumintr(s0, 21, 2) |
                    bitnumintr(s1, 29, 1) | bitnumintr(s0, 29, 0);

  out[offset + 0] = bitnumintr(s1, 4, 7) | bitnumintr(s0, 4, 6) | bitnumintr(s1, 12, 5) |
                    bitnumintr(s0, 12, 4) | bitnumintr(s1, 20, 3) | bitnumintr(s0, 20, 2) |
                    bitnumintr(s1, 28, 1) | bitnumintr(s0, 28, 0);

  out[offset + 7] = bitnumintr(s1, 3, 7) | bitnumintr(s0, 3, 6) | bitnumintr(s1, 11, 5) |
                    bitnumintr(s0, 11, 4) | bitnumintr(s1, 19, 3) | bitnumintr(s0, 19, 2) |
                    bitnumintr(s1, 27, 1) | bitnumintr(s0, 27, 0);

  out[offset + 6] = bitnumintr(s1, 2, 7) | bitnumintr(s0, 2, 6) | bitnumintr(s1, 10, 5) |
                    bitnumintr(s0, 10, 4) | bitnumintr(s1, 18, 3) | bitnumintr(s0, 18, 2) |
                    bitnumintr(s1, 26, 1) | bitnumintr(s0, 26, 0);

  out[offset + 5] = bitnumintr(s1, 1, 7) | bitnumintr(s0, 1, 6) | bitnumintr(s1, 9, 5) |
                    bitnumintr(s0, 9, 4) | bitnumintr(s1, 17, 3) | bitnumintr(s0, 17, 2) |
                    bitnumintr(s1, 25, 1) | bitnumintr(s0, 25, 0);

  out[offset + 4] = bitnumintr(s1, 0, 7) | bitnumintr(s0, 0, 6) | bitnumintr(s1, 8, 5) |
                    bitnumintr(s0, 8, 4) | bitnumintr(s1, 16, 3) | bitnumintr(s0, 16, 2) |
                    bitnumintr(s1, 24, 1) | bitnumintr(s0, 24, 0);
}

function f(state: number, key: Uint8Array): number {
  const t1 = (
    bitnumintl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitnumintl(state, 4, 5) |
    bitnumintl(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitnumintl(state, 8, 11) |
    bitnumintl(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitnumintl(state, 12, 17) |
    bitnumintl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitnumintl(state, 16, 23)
  ) >>> 0;

  const t2 = (
    bitnumintl(state, 15, 0) | (((state & 0x0000f000) << 15) >>> 0) | bitnumintl(state, 20, 5) |
    bitnumintl(state, 19, 6) | (((state & 0x00000f00) << 13) >>> 0) | bitnumintl(state, 24, 11) |
    bitnumintl(state, 23, 12) | (((state & 0x000000f0) << 11) >>> 0) | bitnumintl(state, 28, 17) |
    bitnumintl(state, 27, 18) | (((state & 0x0000000f) << 9) >>> 0) | bitnumintl(state, 0, 23)
  ) >>> 0;

  const lrg0 = ((t1 >>> 24) & 0xff) ^ key[0]!;
  const lrg1 = ((t1 >>> 16) & 0xff) ^ key[1]!;
  const lrg2 = ((t1 >>> 8) & 0xff) ^ key[2]!;
  const lrg3 = ((t2 >>> 24) & 0xff) ^ key[3]!;
  const lrg4 = ((t2 >>> 16) & 0xff) ^ key[4]!;
  const lrg5 = ((t2 >>> 8) & 0xff) ^ key[5]!;

  const sOut = (
    (SBOX1[sboxbit(lrg0 >> 2)]! << 28) |
    (SBOX2[sboxbit(((lrg0 & 0x03) << 4) | (lrg1 >> 4))]! << 24) |
    (SBOX3[sboxbit(((lrg1 & 0x0f) << 2) | (lrg2 >> 6))]! << 20) |
    (SBOX4[sboxbit(lrg2 & 0x3f)]! << 16) |
    (SBOX5[sboxbit(lrg3 >> 2)]! << 12) |
    (SBOX6[sboxbit(((lrg3 & 0x03) << 4) | (lrg4 >> 4))]! << 8) |
    (SBOX7[sboxbit(((lrg4 & 0x0f) << 2) | (lrg5 >> 6))]! << 4) |
    SBOX8[sboxbit(lrg5 & 0x3f)]!
  ) >>> 0;

  return (
    bitnumintl(sOut, 15, 0) | bitnumintl(sOut, 6, 1) | bitnumintl(sOut, 19, 2) |
    bitnumintl(sOut, 20, 3) | bitnumintl(sOut, 28, 4) | bitnumintl(sOut, 11, 5) |
    bitnumintl(sOut, 27, 6) | bitnumintl(sOut, 16, 7) | bitnumintl(sOut, 0, 8) |
    bitnumintl(sOut, 14, 9) | bitnumintl(sOut, 22, 10) | bitnumintl(sOut, 25, 11) |
    bitnumintl(sOut, 4, 12) | bitnumintl(sOut, 17, 13) | bitnumintl(sOut, 30, 14) |
    bitnumintl(sOut, 9, 15) | bitnumintl(sOut, 1, 16) | bitnumintl(sOut, 7, 17) |
    bitnumintl(sOut, 23, 18) | bitnumintl(sOut, 13, 19) | bitnumintl(sOut, 31, 20) |
    bitnumintl(sOut, 26, 21) | bitnumintl(sOut, 2, 22) | bitnumintl(sOut, 8, 23) |
    bitnumintl(sOut, 18, 24) | bitnumintl(sOut, 12, 25) | bitnumintl(sOut, 29, 26) |
    bitnumintl(sOut, 5, 27) | bitnumintl(sOut, 21, 28) | bitnumintl(sOut, 10, 29) |
    bitnumintl(sOut, 3, 30) | bitnumintl(sOut, 24, 31)
  ) >>> 0;
}

function desKeySetup(key: Uint8Array, encrypt: boolean): Uint8Array[] {
  let C = 0;
  let D = 0;
  for (let i = 0; i < 28; i++) {
    C |= bitnum(key, KEY_PERM_C[i]!, 31 - i);
    D |= bitnum(key, KEY_PERM_D[i]!, 31 - i);
  }
  C = C >>> 0;
  D = D >>> 0;

  const schedule: Uint8Array[] = Array.from({ length: 16 }, () => new Uint8Array(6));

  for (let i = 0; i < 16; i++) {
    const shift = KEY_RND_SHIFT[i]!;
    C = (((C << shift) >>> 0) | (C >>> (28 - shift))) & 0xfffffff0;
    D = (((D << shift) >>> 0) | (D >>> (28 - shift))) & 0xfffffff0;

    const toGen = encrypt ? i : 15 - i;
    const roundKey = schedule[toGen]!;

    for (let j = 0; j < 24; j++) {
      roundKey[Math.floor(j / 8)]! |= bitnumintr(C, KEY_COMPRESSION[j]!, 7 - (j % 8));
    }
    for (let j = 24; j < 48; j++) {
      roundKey[Math.floor(j / 8)]! |= bitnumintr(D, KEY_COMPRESSION[j]! - 27, 7 - (j % 8));
    }
  }

  return schedule;
}

function desCrypt(inB: Uint8Array, inOffset: number, schedule: Uint8Array[], out: Uint8Array, outOffset: number) {
  const block = inB.subarray(inOffset, inOffset + 8);
  const state = IP(block);

  for (let idx = 0; idx < 15; idx++) {
    const t = state[1];
    state[1] = ((f(state[1], schedule[idx]!) ^ state[0]) >>> 0);
    state[0] = t;
  }
  state[0] = ((f(state[1], schedule[15]!) ^ state[0]) >>> 0);

  InvIP(state, out, outOffset);
}

function qrcDesProcess(buffer: Uint8Array, key: Uint8Array, encrypt: boolean): Uint8Array {
  const schedule = desKeySetup(key, encrypt);
  const out = new Uint8Array(buffer.length);
  const fullBlocks = Math.floor(buffer.length / 8) * 8;

  for (let i = 0; i < fullBlocks; i += 8) {
    desCrypt(buffer, i, schedule, out, i);
  }

  // Copy remaining tail bytes directly if length not multiple of 8
  for (let i = fullBlocks; i < buffer.length; i++) {
    out[i] = buffer[i]!;
  }

  return out;
}

// Decrypts raw encrypted QRC bytes (hex decoded) using QQMusic's 3-round DES sequence and decompresses with zlib.
export function decodeQrcBuffer(encryptedBytes: Uint8Array): string {
  if (!encryptedBytes || encryptedBytes.length === 0) return '';

  try {
    const step1 = qrcDesProcess(encryptedBytes, KEY1, false); // Ddes
    const step2 = qrcDesProcess(step1, KEY2, true);          // des
    const step3 = qrcDesProcess(step2, KEY3, false);         // Ddes

    const decompressed = pako.inflate(step3);
    return new TextDecoder('utf-8', { fatal: false }).decode(decompressed);
  } catch {
    return '';
  }
}

// Decodes encrypted QRC hex string into plaintext string / XML
export function decodeQrcHex(hexStr: string): string {
  const cleanHex = hexStr.trim();
  if (!cleanHex) return '';

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }

  return decodeQrcBuffer(bytes);
}
