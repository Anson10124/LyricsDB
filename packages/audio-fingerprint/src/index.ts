import { FingerprintRuntime } from "./runtime.js";

// NetEase's fingerprinter only works on 8 kHz mono audio
export const FP_SAMPLE_RATE = 8000;
// Length of the clip the audio match endpoint expects
export const FP_CLIP_SECONDS = 3;
export const FP_CLIP_SAMPLES = FP_SAMPLE_RATE * FP_CLIP_SECONDS;

export interface Fingerprinter {
  // Base64 fingerprint of a 3 s, 8 kHz mono clip, ready for NetEase's audio match
  fingerprint(pcm: Float32Array): string;
}

export type WasmSource = BufferSource | Response | Promise<Response>;

// Loads afp.wasm once; the returned fingerprinter can be reused for every clip
export async function createFingerprinter(source: WasmSource): Promise<Fingerprinter> {
  const runtime = await FingerprintRuntime.load(await toBytes(source));
  return {
    fingerprint(pcm) {
      if (pcm.length !== FP_CLIP_SAMPLES) {
        throw new RangeError(
          `Expected ${FP_CLIP_SAMPLES} samples (${FP_CLIP_SECONDS} s at ${FP_SAMPLE_RATE} Hz), got ${pcm.length}`,
        );
      }
      return toBase64(runtime.extractQueryFP(pcm));
    },
  };
}

async function toBytes(source: WasmSource): Promise<BufferSource> {
  const resolved = await source;
  if (typeof Response !== "undefined" && resolved instanceof Response) {
    if (!resolved.ok) throw new Error(`Could not load afp.wasm (HTTP ${resolved.status})`);
    return resolved.arrayBuffer();
  }
  return resolved as BufferSource;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
