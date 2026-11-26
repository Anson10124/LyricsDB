// Copies NetEase's afp.wasm from @repo/audio-fingerprint into public/ so the
// listen page can load it. Run before `next dev` and `next build`; the copy is
// gitignored so the package stays the only source of the file.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = require.resolve("@repo/audio-fingerprint/afp.wasm");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "fingerprint", "afp.wasm");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[fingerprint] copied afp.wasm to public/fingerprint/`);
