import { FP_CLIP_SAMPLES, FP_SAMPLE_RATE, resample } from "@repo/audio-fingerprint";

export interface RecordedClip {
  // 8 kHz mono samples, ready for the fingerprinter
  samples: Float32Array;
  // performance.now() time at which the person heard the first sample
  startedAtPerfMs: number;
}

// Where listen mode gets its audio: the mic, or the sound this device is
// playing (a browser tab, or the whole system on Windows / macOS)
export type ListenSource = "mic" | "device";

// Fixed time (ms) between a sample being captured and the person hearing it,
// added to each clip's start time so the lyrics line up with what they hear.
// Tune these if lyrics run early (raise) or late (lower) in one mode.
// - mic: the mic hears the music when the person does, so nothing to add
// - device: capture takes the audio before it reaches the speakers; on top of
//   this constant the browser's own output latency estimate is added (see
//   DEVICE_USES_OUTPUT_LATENCY), which covers most of the Bluetooth delay
export const MIC_HEARD_DELAY_MS = 0;
export const DEVICE_HEARD_DELAY_MS = 0;
// Add AudioContext.outputLatency to device-mode clips. It measures this page's
// own output path, which is normally the same speakers or headphones the music
// plays through.
export const DEVICE_USES_OUTPUT_LATENCY = true;

export class MicUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "missing" | "unsupported",
  ) {
    super(message);
    this.name = "MicUnavailableError";
  }
}

export class DeviceAudioError extends Error {
  constructor(
    message: string,
    // cancelled: the person closed the picker; no-audio: they shared without
    // ticking "Share audio"; unreadable: the browser couldn't open the audio
    readonly reason: "cancelled" | "no-audio" | "unreadable" | "unsupported",
  ) {
    super(message);
    this.name = "DeviceAudioError";
  }
}

const WORKLET_URL = "/listen/capture-worklet.js";

async function getMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
    throw new MicUnavailableError("This browser can't record audio.", "unsupported");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
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
      throw new MicUnavailableError(
        "Microphone access was blocked. Allow it in your browser's site settings, then try again.",
        "denied",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicUnavailableError("No microphone was found.", "missing");
    }
    throw error;
  }
}

// Chromium-only options that the TypeScript DOM types don't list yet
interface SystemAudioOptions extends DisplayMediaStreamOptions {
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
}

// Asks the person to share a tab or screen and keeps only its audio. The
// picker needs a user gesture, so call this before awaiting anything else in
// the click handler.
export async function getSystemAudioStream(): Promise<MediaStream> {
  if (
    typeof navigator.mediaDevices?.getDisplayMedia !== "function" ||
    typeof AudioWorkletNode === "undefined"
  ) {
    throw new DeviceAudioError("This browser can't share the audio it's playing.", "unsupported");
  }

  const options: SystemAudioOptions = {
    // Chrome won't share audio without video; the video is dropped below
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Offer "Share system audio" when sharing a whole screen
    systemAudio: "include",
    // LyricsDB's own tab has nothing to hear
    selfBrowserSurface: "exclude",
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new DeviceAudioError("Sharing was cancelled.", "cancelled");
    }
    // Chrome couldn't open the system's audio (seen when sharing a whole
    // screen on Windows, depending on the output device); a tab still works
    if (error instanceof DOMException && error.name === "NotReadableError") {
      throw new DeviceAudioError(
        "Couldn't capture your system audio. Try again and pick the tab playing the music instead.",
        "unreadable",
      );
    }
    throw error;
  }

  const audio = stream.getAudioTracks();
  if (audio.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new DeviceAudioError(
      "No audio was shared. Try again and turn on “Share audio” in the picker.",
      "no-audio",
    );
  }
  // The screen itself is never used: stop it straight away
  stream.getVideoTracks().forEach((t) => t.stop());
  return new MediaStream(audio);
}

interface ListenerOptions {
  source: ListenSource;
  // Called if the stream ends on its own, e.g. "Stop sharing" in the browser bar
  onEnded?: () => void;
}

// An audio stream kept open between recordings while listen mode follows a
// song. The AudioContext runs at the device's own rate (Firefox won't connect a
// mic to a context at another rate); the worklet mixes any number of channels
// down to mono and clips are resampled to 8 kHz afterwards.
export class AudioListener {
  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    readonly source: ListenSource,
    private readonly onEnded?: () => void,
  ) {
    if (onEnded) {
      stream.getAudioTracks().forEach((t) => t.addEventListener("ended", onEnded));
    }
  }

  // Takes ownership of the stream: its tracks are stopped on close or failure
  static async fromStream(stream: MediaStream, options: ListenerOptions): Promise<AudioListener> {
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
      return new AudioListener(context, stream, node, options.source, options.onEnded);
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      await context.close().catch(() => {});
      throw error;
    }
  }

  // True once the audio has stopped for good (e.g. the person stopped sharing)
  get ended(): boolean {
    return this.stream.getAudioTracks().every((t) => t.readyState === "ended");
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
          startedAtPerfMs: this.toPerfTime(data.startTime) + this.heardDelayMs(),
        });
      };
      // A little extra so the resampled clip is never short
      this.node.port.postMessage({ type: "start", frames: Math.ceil(seconds * rate) + 64 });
    });
  }

  // How long after capture the person hears a sample (see the constants above)
  private heardDelayMs(): number {
    if (this.source === "mic") return MIC_HEARD_DELAY_MS;
    const measured = DEVICE_USES_OUTPUT_LATENCY ? (this.context.outputLatency || 0) * 1000 : 0;
    return DEVICE_HEARD_DELAY_MS + measured;
  }

  // Maps a time on the audio clock to performance.now() time. Uses the
  // context's processing clock rather than getOutputTimestamp, which follows
  // the speakers and so runs behind by the output latency (large on Bluetooth)
  // that has nothing to do with when the sound was captured.
  private toPerfTime(contextTime: number): number {
    return performance.now() - (this.context.currentTime - contextTime) * 1000;
  }

  async close(): Promise<void> {
    this.node.port.onmessage = null;
    if (this.onEnded) {
      this.stream.getAudioTracks().forEach((t) => t.removeEventListener("ended", this.onEnded!));
    }
    this.stream.getTracks().forEach((t) => t.stop());
    await this.context.close().catch(() => {});
  }
}

// The mic, exactly as listen mode has always opened it
export async function openMic(): Promise<AudioListener> {
  return AudioListener.fromStream(await getMicStream(), { source: "mic" });
}

// The audio this device is playing, chosen in the browser's share picker
export async function openDeviceAudio(onEnded: () => void): Promise<AudioListener> {
  return AudioListener.fromStream(await getSystemAudioStream(), { source: "device", onEnded });
}
