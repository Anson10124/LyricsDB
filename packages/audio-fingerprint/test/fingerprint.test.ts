import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createFingerprinter,
  FP_CLIP_SAMPLES,
  type Fingerprinter,
} from "../src/index.js";
import { testSignal } from "./signal.js";
import golden from "./fixtures/golden.json" with { type: "json" };

const WASM_URL = new URL("../wasm/afp.wasm", import.meta.url);
// The build the golden fingerprints were made with
const WASM_SHA256 = "8064415bb66e45410e88877f07cd007a3ae62ebf463aac13c159a8f13e4c8fe8";

describe("afp.wasm", () => {
  it("is the pinned NetEase build", async () => {
    const bytes = await readFile(WASM_URL);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), WASM_SHA256);
  });
});

describe("createFingerprinter", () => {
  let fingerprinter: Fingerprinter;

  before(async () => {
    fingerprinter = await createFingerprinter(await readFile(WASM_URL));
  });

  for (const [seed, expected] of Object.entries(golden.fingerprints)) {
    it(`matches NetEase's original glue byte for byte (seed ${seed})`, () => {
      assert.equal(fingerprinter.fingerprint(testSignal(Number(seed))), expected);
    });
  }

  it("gives the same answer when reused many times", () => {
    const clip = testSignal(1);
    const first = fingerprinter.fingerprint(clip);
    for (let i = 0; i < 20; i++) {
      fingerprinter.fingerprint(testSignal(7));
      assert.equal(fingerprinter.fingerprint(clip), first);
    }
  });

  it("reads only the samples a subarray covers", () => {
    const padded = new Float32Array(FP_CLIP_SAMPLES + 100);
    padded.set(testSignal(1), 50);
    const view = padded.subarray(50, 50 + FP_CLIP_SAMPLES);
    assert.equal(fingerprinter.fingerprint(view), golden.fingerprints["1"]);
  });

  it("rejects clips that are not 3 s at 8 kHz", () => {
    assert.throws(() => fingerprinter.fingerprint(new Float32Array(8000)), RangeError);
  });

  it("refuses a wasm file that is not afp.wasm", async () => {
    // The smallest valid module: magic number and version, nothing exported
    const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await assert.rejects(createFingerprinter(empty));
  });
});
