import { createFingerprinter, type Fingerprinter } from "@repo/audio-fingerprint";

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
