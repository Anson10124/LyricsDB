# @repo/audio-fingerprint

Turns a 3-second, 8 kHz mono audio clip into the fingerprint that NetEase Cloud Music's audio match endpoint (`/api/music/audio/match`) expects. The web app's listen mode uses it in the browser, so only the ~1 KB fingerprint is sent anywhere, never the audio.

```ts
import { createFingerprinter, FP_CLIP_SAMPLES } from "@repo/audio-fingerprint";

const fingerprinter = await createFingerprinter(fetch("/fingerprint/afp.wasm"));
const fp = fingerprinter.fingerprint(pcm); // pcm: Float32Array of FP_CLIP_SAMPLES samples
```

## What is in here

- `wasm/afp.wasm` is NetEase's own fingerprinting code: C++ compiled to WebAssembly with Emscripten and embind. It comes from NetEase's audio recognition Chrome extension (`fn.music.163.com/g/chrome-extension-home-page-beta/`), as extracted by mos9527/ncm-afp and shipped in the [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) `audio_match_demo`. **It belongs to NetEase. It is not covered by this repository's license.** The tests pin its sha256.
- `src/runtime.ts` replaces the demo's ~1,600 lines of minified Emscripten glue. When the module starts, it registers one function (`ExtractQueryFP(std::string) -> vector<char>`) and the vector's `size`/`get`. The runtime records those registrations and calls them through the wasm function table. It loads once and is reused, instead of reloading for every clip.
- `test/fixtures/golden.json` holds fingerprints that the original glue produced for the fixed test signal in `test/signal.ts`. The tests check that this loader matches them byte for byte.
