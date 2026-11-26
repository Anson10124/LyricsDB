import { FP_CLIP_SAMPLES, FP_SAMPLE_RATE, resample } from "@repo/audio-fingerprint";

export interface RecordedClip {
  // 8 kHz mono samples, ready for the fingerprinter
  samples: Float32Array;
  // performance.now() time at which the first sample was heard
  startedAtPerfMs: number;
}

export class MicUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "missing" | "unsupported",
  ) {
    super(message);
    this.name = "MicUnavailableError";
  }
}

const WORKLET_URL = "/listen/capture-worklet.js";

// The mic, kept open between recordings while listen mode follows a song. The
// AudioContext runs at the device's own rate (Firefox won't connect a mic to a
// context at another rate) and clips are resampled to 8 kHz afterwards.
export class MicListener {
  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
  ) {}

  static async open(): Promise<MicListener> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      throw new MicUnavailableError("This browser can't record audio.", "unsupported");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Cleanup meant for voices removes the music we want to hear
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new MicUnavailableError("Microphone access was blocked.", "denied");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new MicUnavailableError("No microphone was found.", "missing");
      }
      throw error;
    }

    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule(WORKLET_URL);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "listen-capture", {
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // Silent sink: some browsers only run a worklet that leads somewhere
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node).connect(mute).connect(context.destination);
      if (context.state === "suspended") await context.resume();
      return new MicListener(context, stream, node);
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      await context.close().catch(() => {});
      throw error;
    }
  }

  // Records `seconds` of audio; onLevel gets the loudness (0-1) as it goes
  record(
    seconds: number,
    onLevel?: (rms: number) => void,
    signal?: AbortSignal,
  ): Promise<RecordedClip> {
    const rate = this.context.sampleRate;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.node.port.onmessage = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort);

      this.node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as
          | { type: "level"; rms: number }
          | { type: "done"; samples: Float32Array; startTime: number };
        if (data.type === "level") {
          onLevel?.(data.rms);
          return;
        }
        cleanup();
        resolve({
          samples: resample(data.samples, rate, FP_SAMPLE_RATE, FP_CLIP_SAMPLES),
          startedAtPerfMs: this.toPerfTime(data.startTime),
        });
      };
      // A little extra so the resampled clip is never short
      this.node.port.postMessage({ type: "start", frames: Math.ceil(seconds * rate) + 64 });
    });
  }

  // Maps a time on the audio clock to performance.now() time
  private toPerfTime(contextTime: number): number {
    const stamp = this.context.getOutputTimestamp?.();
    if (stamp?.contextTime !== undefined && stamp.performanceTime !== undefined) {
      return stamp.performanceTime - (stamp.contextTime - contextTime) * 1000;
    }
    return performance.now() - (this.context.currentTime - contextTime) * 1000;
  }

  async close(): Promise<void> {
    this.node.port.onmessage = null;
    this.stream.getTracks().forEach((t) => t.stop());
    await this.context.close().catch(() => {});
  }
}
