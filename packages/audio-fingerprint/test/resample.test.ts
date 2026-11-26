import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resample } from "../src/resample.js";

function tone(hz: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

// Root mean square, skipping the edges where the filter runs out of input
function rms(samples: Float32Array): number {
  const inner = samples.subarray(200, samples.length - 200);
  let sum = 0;
  for (const s of inner) sum += s * s;
  return Math.sqrt(sum / inner.length);
}

describe("resample", () => {
  it("turns 3 s at 48 kHz into exactly 24,000 samples at 8 kHz", () => {
    assert.equal(resample(tone(440, 48_000, 3), 48_000, 8000).length, 24_000);
    assert.equal(resample(tone(440, 44_100, 3), 44_100, 8000).length, 24_000);
  });

  it("keeps a tone the new rate can carry", () => {
    const out = resample(tone(1000, 48_000, 1), 48_000, 8000);
    assert.ok(Math.abs(rms(out) - Math.SQRT1_2) < 0.02, `rms ${rms(out)}`);
    // Still 1 kHz: 8 samples per cycle, so the signal repeats every 8 samples
    for (let i = 300; i < 400; i++) assert.ok(Math.abs(out[i]! - out[i + 8]!) < 0.02);
  });

  it("removes sound above the new Nyquist limit instead of aliasing it", () => {
    // 6 kHz would fold back to 2 kHz at 8 kHz without filtering
    const out = resample(tone(6000, 48_000, 1), 48_000, 8000);
    assert.ok(rms(out) < 0.01, `rms ${rms(out)}`);
  });

  it("copies the input when the rates match", () => {
    const input = tone(440, 8000, 0.1);
    assert.deepEqual(resample(input, 8000, 8000), input);
  });

  it("can be asked for an exact length", () => {
    assert.equal(resample(tone(440, 48_000, 2.9), 48_000, 8000, 24_000).length, 24_000);
  });
});
