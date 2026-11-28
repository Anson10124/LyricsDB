import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createShazamSignature,
  decodeShazamSignature,
  encodeShazamSignature,
  findShazamPeaks,
  SHAZAM_SAMPLE_RATE,
  ShazamBand,
} from "../src/index.js";

// A reproducible 5 s clip at 16 kHz: chords that change every half second
// (with overtones reaching every band) plus a little seeded noise
function chords(seed: number, seconds = 5): Float32Array {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const notes = [261.63, 329.63, 392, 440, 523.25, 659.25, 783.99];
  const out = new Float32Array(SHAZAM_SAMPLE_RATE * seconds);
  for (let i = 0; i < out.length; i++) {
    const step = Math.floor(i / (SHAZAM_SAMPLE_RATE / 2)) + seed;
    const t = i / SHAZAM_SAMPLE_RATE;
    let s = 0;
    for (const [k, harmonic] of [1, 3, 6].entries()) {
      const f = notes[(step + k * 2) % notes.length]! * harmonic;
      s += (0.3 / harmonic) * Math.sin(2 * Math.PI * f * t);
    }
    out[i] = s + 0.05 * (random() * 2 - 1);
  }
  return out;
}

function bytesOf(uri: string): Uint8Array {
  const [prefix, data] = uri.split(",");
  assert.equal(prefix, "data:audio/vnd.shazam.sig;base64");
  return Buffer.from(data!, "base64");
}

test("finds peaks in every band of a tonal clip", () => {
  const bands = findShazamPeaks(chords(1));
  for (const band of [ShazamBand.Hz250To520, ShazamBand.Hz520To1450, ShazamBand.Hz1450To3500]) {
    assert.ok((bands.get(band)?.length ?? 0) > 0, `band ${band} has peaks`);
  }
  for (const peaks of bands.values()) {
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i]!.pass >= peaks[i - 1]!.pass);
  }
});

test("silence has no peaks", () => {
  assert.equal(findShazamPeaks(new Float32Array(SHAZAM_SAMPLE_RATE * 3)).size, 0);
});

test("signature decodes back to the peaks it was made from", () => {
  const pcm = chords(2);
  const signature = createShazamSignature(pcm);
  assert.equal(signature.sampleMs, 5000);
  const decoded = decodeShazamSignature(bytesOf(signature.uri));
  assert.equal(decoded.sampleCount, pcm.length);
  assert.deepEqual(decoded.bands, findShazamPeaks(pcm));
});

test("encodes long gaps between peaks with the 0xff escape", () => {
  const bands = new Map([
    [
      ShazamBand.Hz520To1450,
      [
        { pass: 3, magnitude: 9000, bin: 4000 },
        { pass: 700, magnitude: 9100, bin: 4100 },
        { pass: 701, magnitude: 9200, bin: 4200 },
      ],
    ],
  ]);
  const bytes = encodeShazamSignature({ sampleCount: 80000, bands });
  assert.equal(bytes.length % 4, 0);
  assert.deepEqual(decodeShazamSignature(bytes).bands, bands);
});

test("rejects a corrupted signature", () => {
  const bytes = bytesOf(createShazamSignature(chords(3)).uri);
  bytes[bytes.length - 3] ^= 0xff;
  assert.throws(() => decodeShazamSignature(bytes), /CRC/);
});

// Guards against accidental changes to the algorithm. This output was checked
// against Shazam's live tag endpoint with real recordings, which recognised
// them at the right positions; update the hash only on purpose.
test("signature output is stable", () => {
  const hash = createHash("sha256").update(bytesOf(createShazamSignature(chords(4)).uri)).digest("hex");
  assert.equal(hash, GOLDEN_HASH);
});

const GOLDEN_HASH = "db4a679d62d6cbbfdc1182dd0070a6f2b02113771eaafc57bbacecd70102fec0";
