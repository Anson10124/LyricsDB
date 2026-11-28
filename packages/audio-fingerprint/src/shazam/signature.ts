// Shazam's audio signature: the loudest spectral peaks of a 16 kHz mono clip,
// grouped into four frequency bands and packed into Shazam's binary format.
// The browser makes it, so only these peaks (never the audio) leave the device.
import { crc32 } from "./crc32.js";
import { Fft } from "./fft.js";

export const SHAZAM_SAMPLE_RATE = 16000;

const WINDOW = 2048;
const HOP = 128;
const BINS = WINDOW / 2 + 1;
// Spectra kept for the peak search, which looks up to ~250 hops back
const HISTORY = 256;
// The peak search judges the spectrum this many hops back, once its
// neighbours on both sides are known
const LOOKBACK = 46;
const MIN_MAGNITUDE = 1 / 64;
// Spread-spectrum bins compared with a candidate peak, relative to its bin
const NEIGHBOR_BINS = [-10, -7, -4, -3, 1, 2, 5, 8];
// Spread spectra (relative to the newest) a peak must also beat
const OTHER_HOPS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
// Hz per unit of a peak's frequency, which is in 1/64ths of an FFT bin
const HZ_PER_UNIT = SHAZAM_SAMPLE_RATE / 2 / 1024 / 64;

export enum ShazamBand {
  Hz250To520 = 0,
  Hz520To1450 = 1,
  Hz1450To3500 = 2,
  Hz3500To5500 = 3,
}

const BAND_LIMITS: Array<[ShazamBand, number, number]> = [
  [ShazamBand.Hz250To520, 250, 520],
  [ShazamBand.Hz520To1450, 520, 1450],
  [ShazamBand.Hz1450To3500, 1450, 3500],
  [ShazamBand.Hz3500To5500, 3500, 5500],
];

export interface ShazamPeak {
  // Hop (128 samples) the peak was found at
  pass: number;
  // Log-scaled loudness
  magnitude: number;
  // Frequency in 1/64ths of an FFT bin
  bin: number;
}

export interface DecodedShazamSignature {
  sampleCount: number;
  bands: Map<ShazamBand, ShazamPeak[]>;
}

export interface ShazamSignature {
  // data:audio/vnd.shazam.sig;base64,… as Shazam's tag endpoint takes it
  uri: string;
  // Length of the clip the signature describes
  sampleMs: number;
}

// Periodic Hann window over 2050 points with both zero ends dropped
const HANN = (() => {
  const w = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (WINDOW + 1));
  return w;
})();

let fft: Fft | null = null;

function bandOf(hz: number): ShazamBand | null {
  for (const [band, low, high] of BAND_LIMITS) if (hz > low && hz < high) return band;
  return null;
}

function logMagnitude(value: number): number {
  return Math.log(Math.max(MIN_MAGNITUDE, value)) * 1477.3 + 6144;
}

// Finds the signature peaks in 16 kHz mono samples (-1 to 1)
export function findShazamPeaks(pcm: Float32Array): Map<ShazamBand, ShazamPeak[]> {
  fft ??= new Fft(WINDOW);
  const samples = new Float64Array(WINDOW);
  let sampleIndex = 0;
  const spectra = Array.from({ length: HISTORY }, () => new Float64Array(BINS));
  const spread = Array.from({ length: HISTORY }, () => new Float64Array(BINS));
  let spectrumIndex = 0;
  let spreadIndex = 0;
  let spreadCount = 0;
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  const bands = new Map<ShazamBand, ShazamPeak[]>();

  for (let chunk = 0; chunk + HOP <= pcm.length; chunk += HOP) {
    // The window slides on by one hop; samples are scaled to 16-bit range
    for (let i = 0; i < HOP; i++) {
      const s = Math.max(-1, Math.min(1, pcm[chunk + i]!));
      samples[sampleIndex] = Math.round(s * 32767);
      sampleIndex = (sampleIndex + 1) & (WINDOW - 1);
    }

    // Power spectrum of the window, oldest sample first
    for (let i = 0; i < WINDOW; i++) {
      re[i] = samples[(i + sampleIndex) & (WINDOW - 1)]! * HANN[i]!;
      im[i] = 0;
    }
    fft.transform(re, im);
    const spectrum = spectra[spectrumIndex]!;
    for (let b = 0; b < BINS; b++) {
      spectrum[b] = Math.max((re[b]! * re[b]! + im[b]! * im[b]!) / (1 << 17), 1e-10);
    }
    spectrumIndex = (spectrumIndex + 1) % HISTORY;

    // Spread each bin's loudness to its two higher neighbours and back to
    // three earlier spectra, so a peak has to stand out in time and frequency
    const current = spread[spreadIndex]!;
    current.set(spectrum);
    for (let pos = 0; pos < BINS; pos++) {
      if (pos < BINS - 2) current[pos] = Math.max(current[pos]!, current[pos + 1]!, current[pos + 2]!);
      let max = current[pos]!;
      for (const back of [1, 3, 6]) {
        const former = spread[(spreadIndex - back + HISTORY) % HISTORY]!;
        max = Math.max(former[pos]!, max);
        former[pos] = max;
      }
    }
    spreadIndex = (spreadIndex + 1) % HISTORY;
    spreadCount++;

    if (spreadCount < LOOKBACK) continue;

    const judged = spectra[(spectrumIndex - LOOKBACK + HISTORY) % HISTORY]!;
    const around = spread[(spreadIndex - 49 + HISTORY) % HISTORY]!;
    for (let bin = 10; bin < 1015; bin++) {
      const value = judged[bin]!;
      if (value < MIN_MAGNITUDE || value < around[bin - 1]!) continue;

      let neighbours = 0;
      for (const offset of NEIGHBOR_BINS) neighbours = Math.max(neighbours, around[bin + offset]!);
      if (!(value > neighbours)) continue;

      let others = neighbours;
      for (const offset of OTHER_HOPS) {
        others = Math.max(others, spread[(spreadIndex + offset + HISTORY) % HISTORY]![bin - 1]!);
      }
      if (!(value > others)) continue;

      // Refine the frequency by fitting a parabola through the bin and its neighbours
      const magnitude = logMagnitude(value);
      const before = logMagnitude(judged[bin - 1]!);
      const after = logMagnitude(judged[bin + 1]!);
      const curvature = magnitude * 2 - before - after;
      if (!(curvature > 0)) continue;
      const corrected = bin * 64 + ((after - before) * 32) / curvature;
      const band = bandOf(corrected * HZ_PER_UNIT);
      if (band === null) continue;

      let list = bands.get(band);
      if (!list) bands.set(band, (list = []));
      list.push({
        pass: spreadCount - LOOKBACK,
        magnitude: Math.trunc(magnitude),
        bin: Math.trunc(corrected),
      });
    }
  }
  return bands;
}

const MAGIC_1 = 0xcafe2580;
const MAGIC_2 = 0x94119c00;
const HEADER_BYTES = 48;
// Shazam's id for 16 kHz
const SAMPLE_RATE_ID = 3;

// Packs peaks into Shazam's binary signature format (all little-endian)
export function encodeShazamSignature(decoded: DecodedShazamSignature): Uint8Array {
  const chunks: Uint8Array[] = [];
  let bodyBytes = 8;
  const sorted = [...decoded.bands.entries()].sort(([a], [b]) => a - b);
  for (const [band, peaks] of sorted) {
    if (peaks.length === 0) continue;
    const bytes: number[] = [];
    const u16 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff);
    const u32 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    let pass = 0;
    for (const peak of peaks) {
      // Passes are stored as steps from the last; a big jump is written in full
      if (peak.pass - pass >= 255) {
        bytes.push(0xff);
        u32(peak.pass);
        pass = peak.pass;
      }
      bytes.push(peak.pass - pass);
      u16(peak.magnitude);
      u16(peak.bin);
      pass = peak.pass;
    }
    const padded = Math.ceil(bytes.length / 4) * 4;
    const chunk = new Uint8Array(8 + padded);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 0x60030040 + band, true);
    view.setUint32(4, bytes.length, true);
    chunk.set(bytes, 8);
    chunks.push(chunk);
    bodyBytes += chunk.length;
  }

  const out = new Uint8Array(HEADER_BYTES + bodyBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC_1, true);
  view.setUint32(8, bodyBytes, true);
  view.setUint32(12, MAGIC_2, true);
  view.setUint32(28, SAMPLE_RATE_ID << 27, true);
  view.setUint32(40, Math.trunc(decoded.sampleCount + SHAZAM_SAMPLE_RATE * 0.24), true);
  view.setUint32(44, (15 << 19) + 0x40000, true);
  view.setUint32(48, 0x40000000, true);
  view.setUint32(52, bodyBytes, true);
  let offset = HEADER_BYTES + 8;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  view.setUint32(4, crc32(out.subarray(8)), true);
  return out;
}

// Reads a binary signature back; throws if it is malformed
export function decodeShazamSignature(bytes: Uint8Array): DecodedShazamSignature {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES + 8) throw new Error("Signature is too short");
  if (view.getUint32(0, true) !== MAGIC_1 || view.getUint32(12, true) !== MAGIC_2) {
    throw new Error("Not a Shazam signature");
  }
  if (view.getUint32(8, true) !== bytes.length - HEADER_BYTES) throw new Error("Bad size");
  if (view.getUint32(4, true) !== crc32(bytes.subarray(8))) throw new Error("Bad CRC");
  if (view.getUint32(28, true) >>> 27 !== SAMPLE_RATE_ID) throw new Error("Not 16 kHz");
  const sampleCount = view.getUint32(40, true) - SHAZAM_SAMPLE_RATE * 0.24;

  const bands = new Map<ShazamBand, ShazamPeak[]>();
  let offset = HEADER_BYTES + 8;
  while (offset + 8 <= bytes.length) {
    const band = (view.getUint32(offset, true) - 0x60030040) as ShazamBand;
    const size = view.getUint32(offset + 4, true);
    if (band < 0 || band > 3) throw new Error("Unknown band");
    const end = offset + 8 + size;
    let pos = offset + 8;
    let pass = 0;
    const peaks: ShazamPeak[] = [];
    while (pos < end) {
      let step = bytes[pos]!;
      pos += 1;
      if (step === 0xff) {
        pass = view.getUint32(pos, true);
        pos += 4;
        step = bytes[pos]!;
        pos += 1;
      }
      pass += step;
      peaks.push({ pass, magnitude: view.getUint16(pos, true), bin: view.getUint16(pos + 2, true) });
      pos += 4;
    }
    bands.set(band, peaks);
    offset += 8 + Math.ceil(size / 4) * 4;
  }
  return { sampleCount, bands };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The signature for a clip of 16 kHz mono samples, ready to send to Shazam
export function createShazamSignature(pcm16k: Float32Array): ShazamSignature {
  const bytes = encodeShazamSignature({
    sampleCount: pcm16k.length,
    bands: findShazamPeaks(pcm16k),
  });
  return {
    uri: `data:audio/vnd.shazam.sig;base64,${toBase64(bytes)}`,
    sampleMs: Math.round((pcm16k.length / SHAZAM_SAMPLE_RATE) * 1000),
  };
}
