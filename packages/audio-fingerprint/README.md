# @repo/audio-fingerprint

Turns short mono audio clips into what song recognition services expect:

- a 3-second, 8 kHz clip into the fingerprint for NetEase Cloud Music's audio match endpoint (`/api/music/audio/match`);
- a clip of up to 12 seconds at 16 kHz into a Shazam signature (`data:audio/vnd.shazam.sig;base64,…`) for Shazam's tag endpoint.

The web app's listen mode uses both in the browser, so only these few-KB fingerprints are sent anywhere, never the audio.

```ts
import { createFingerprinter, FP_CLIP_SAMPLES } from "@repo/audio-fingerprint";

const fingerprinter = await createFingerprinter(fetch("/fingerprint/afp.wasm"));
const fp = fingerprinter.fingerprint(pcm); // pcm: Float32Array of FP_CLIP_SAMPLES samples

import { createShazamSignature } from "@repo/audio-fingerprint";

const { uri, sampleMs } = createShazamSignature(pcm16k); // pcm16k: 16 kHz mono, -1..1
```

## What is in here

- `wasm/afp.wasm` is NetEase's own fingerprinting code: C++ compiled to WebAssembly with Emscripten and embind. It comes from NetEase's audio recognition Chrome extension (`fn.music.163.com/g/chrome-extension-home-page-beta/`), as extracted by mos9527/ncm-afp and shipped in the [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) `audio_match_demo`. **It belongs to NetEase. It is not covered by this repository's license.** The tests pin its sha256.
- `src/runtime.ts` replaces the demo's ~1,600 lines of minified Emscripten glue. When the module starts, it registers one function (`ExtractQueryFP(std::string) -> vector<char>`) and the vector's `size`/`get`. The runtime records those registrations and calls them through the wasm function table. It loads once and is reused, instead of reloading for every clip.
- `src/shazam/` makes Shazam signatures in plain TypeScript (no wasm). It is this repository's own implementation of the publicly documented signature format, under this repository's license: a 2048-point Hann-windowed FFT every 128 samples, spectral peaks that stand out in time and frequency, sorted into four bands (250–520, 520–1450, 1450–3500 and 3500–5500 Hz), packed into Shazam's binary layout with a CRC-32. It was checked against Shazam's live endpoint with real recordings; `test/shazam-signature.test.ts` pins its output so changes are deliberate.
- `test/fixtures/golden.json` holds fingerprints that the original glue produced for the fixed test signal in `test/signal.ts`. The tests check that this loader matches them byte for byte.
