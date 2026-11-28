import {
  createFingerprinter,
  createShazamSignature,
  FP_CLIP_SAMPLES,
  FP_CLIP_SECONDS,
  FP_SAMPLE_RATE,
  resample,
  SHAZAM_CLIP_SECONDS,
  SHAZAM_SAMPLE_RATE,
  type Fingerprinter,
} from "@repo/audio-fingerprint";
import type { AudioMatchMode } from "@repo/types";
import type { RecordedClip } from "./recorder";

// Copied here from @repo/audio-fingerprint by scripts/copy-fingerprint-wasm.mjs
const WASM_URL = "/fingerprint/afp.wasm";

let loading: Promise<Fingerprinter> | null = null;

// Loads NetEase's fingerprinter the first time it's needed, then reuses it
export function loadFingerprinter(): Promise<Fingerprinter> {
  loading ??= createFingerprinter(fetch(WASM_URL)).catch((error: unknown) => {
    // Let the next attempt try again
    loading = null;
    throw error;
  });
  return loading;
}

export const usesNetease = (mode: AudioMatchMode) => mode !== "shazam";
export const usesShazam = (mode: AudioMatchMode) => mode !== "netease";

// How much audio a listen records: enough for every service the mode may ask
export function clipSeconds(mode: AudioMatchMode): number {
  return usesShazam(mode) ? Math.max(SHAZAM_CLIP_SECONDS, FP_CLIP_SECONDS) : FP_CLIP_SECONDS;
}

export interface ClipFingerprints {
  // NetEase's fingerprint of the clip's first 3 s
  fingerprint?: string;
  // Shazam's signature of the whole clip
  shazamSignature?: string;
}

// Turns one recorded clip into what each service in the mode needs. Both start
// at the clip's first sample, so their offsets mean the same thing.
export async function fingerprintClip(
  clip: RecordedClip,
  mode: AudioMatchMode,
): Promise<ClipFingerprints> {
  const out: ClipFingerprints = {};
  if (usesNetease(mode)) {
    const fingerprinter = await loadFingerprinter();
    out.fingerprint = fingerprinter.fingerprint(
      resample(clip.samples, clip.sampleRate, FP_SAMPLE_RATE, FP_CLIP_SAMPLES),
    );
  }
  if (usesShazam(mode)) {
    const pcm = resample(
      clip.samples,
      clip.sampleRate,
      SHAZAM_SAMPLE_RATE,
      SHAZAM_CLIP_SECONDS * SHAZAM_SAMPLE_RATE,
    );
    out.shazamSignature = createShazamSignature(pcm).uri;
  }
  return out;
}
