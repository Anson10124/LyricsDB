// Converts mono audio to another sample rate with a windowed-sinc low-pass
// filter, so sound above the new Nyquist limit is removed instead of folding
// back as noise. Browsers record at 44.1 or 48 kHz; the fingerprinter needs
// 8 kHz.

// Zero crossings of the filter kernel on each side
const ZERO_CROSSINGS = 16;
// Cut-off as a share of the lower rate's Nyquist frequency, leaving room for
// the filter's slope
const CUTOFF = 0.9;

function blackman(x: number): number {
  // x in [-1, 1]
  const t = (x + 1) / 2;
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
}

export function resample(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
  outputLength = Math.floor((input.length * outputRate) / inputRate),
): Float32Array {
  if (!(inputRate > 0) || !(outputRate > 0)) {
    throw new RangeError("Sample rates must be positive");
  }
  const output = new Float32Array(outputLength);
  if (inputRate === outputRate) {
    output.set(input.subarray(0, Math.min(outputLength, input.length)));
    return output;
  }

  // Input samples per output sample
  const step = inputRate / outputRate;
  // Cut-off in cycles per input sample, below whichever Nyquist is lower
  const cutoff = (CUTOFF / 2) * Math.min(1, 1 / step);
  // The kernel's zero crossings are 1 / (2 * cutoff) input samples apart
  const halfWidth = ZERO_CROSSINGS / (2 * cutoff);

  for (let i = 0; i < outputLength; i++) {
    const center = i * step;
    const first = Math.max(0, Math.ceil(center - halfWidth));
    const last = Math.min(input.length - 1, Math.floor(center + halfWidth));
    let sum = 0;
    let weights = 0;
    for (let j = first; j <= last; j++) {
      const offset = j - center;
      const x = 2 * cutoff * offset;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const weight = sinc * blackman(offset / halfWidth);
      sum += input[j]! * weight;
      weights += weight;
    }
    // Normalised so a steady signal keeps its level
    output[i] = weights !== 0 ? sum / weights : 0;
  }
  return output;
}
