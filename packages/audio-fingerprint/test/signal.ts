// A fixed, reproducible 3 s test clip at 8 kHz: two tones that change every
// half second, plus a little seeded noise. The golden fingerprints in the
// tests were made by running NetEase's original afp.js glue on this signal.
export function testSignal(seed: number): Float32Array {
  let state = seed >>> 0;
  // mulberry32
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const notes = [220, 277.18, 329.63, 440, 554.37, 659.25];
  const out = new Float32Array(24000);
  for (let i = 0; i < out.length; i++) {
    const step = Math.floor(i / 4000) + seed;
    const t = i / 8000;
    out[i] =
      0.35 * Math.sin(2 * Math.PI * notes[step % 6]! * t) +
      0.25 * Math.sin(2 * Math.PI * notes[(step + 2) % 6]! * t) +
      0.08 * (random() * 2 - 1);
  }
  return out;
}
