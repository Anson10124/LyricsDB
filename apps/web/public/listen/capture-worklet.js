/* global AudioWorkletProcessor, currentTime, sampleRate, registerProcessor */
// Records a fixed number of mono samples from the mic for listen mode. Audio
// worklets must be loaded from their own file, so this one is plain JS.
// Messages in:  { type: "start", frames }  begins a recording of `frames` samples
// Messages out: { type: "level", rms }  about 20 times a second while recording
//               { type: "done", samples, startTime }  startTime is the audio
//               clock time (s) of the first recorded sample
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = null;
    this.filled = 0;
    this.startTime = 0;
    this.levelSum = 0;
    this.levelCount = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "start") {
        this.buffer = new Float32Array(event.data.frames);
        this.filled = 0;
        this.startTime = -1;
      }
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (!this.buffer || !channels || channels.length === 0) return true;
    if (this.startTime < 0) this.startTime = currentTime;

    const frames = channels[0].length;
    const take = Math.min(frames, this.buffer.length - this.filled);
    for (let i = 0; i < take; i++) {
      // Mix stereo mics down to mono
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      const sample = sum / channels.length;
      this.buffer[this.filled + i] = sample;
      this.levelSum += sample * sample;
    }
    this.filled += take;
    this.levelCount += take;

    if (this.levelCount >= sampleRate / 20) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.levelSum / this.levelCount) });
      this.levelSum = 0;
      this.levelCount = 0;
    }

    if (this.filled >= this.buffer.length) {
      const samples = this.buffer;
      this.buffer = null;
      this.port.postMessage({ type: "done", samples, startTime: this.startTime }, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor("listen-capture", CaptureProcessor);
