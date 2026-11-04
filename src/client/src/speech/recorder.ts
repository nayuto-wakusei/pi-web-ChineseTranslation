/** One finished recording, ready to be encoded for the daemon. */
export interface SpeechRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/**
 * Containers a MediaRecorder implementation may produce, in preference order.
 * Every one of these is accepted by the daemon and by OpenAI-compatible speech
 * services, so no browser-side transcoding is needed.
 */
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

/**
 * Hand data over while recording instead of only at stop, so a long utterance
 * does not accumulate entirely inside the recorder's own buffer.
 */
const RECORDING_TIMESLICE_MS = 1_000;

/** Dictation needs a secure context plus MediaRecorder; both are feature-detected. */
export function speechRecordingAvailable(): boolean {
  return typeof navigator !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && microphoneDevices() !== undefined;
}

/**
 * `navigator.mediaDevices` is typed as always present but is genuinely absent on
 * insecure origins, so it is read structurally instead of through the type.
 */
function microphoneDevices(): MediaDevices | undefined {
  if (typeof navigator === "undefined") return undefined;
  const devices: unknown = Reflect.get(navigator, "mediaDevices");
  return isMediaDevices(devices) ? devices : undefined;
}

function isMediaDevices(value: unknown): value is MediaDevices {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "getUserMedia") === "function";
}

export function preferredSpeechRecordingMimeType(
  isTypeSupported: (type: string) => boolean = (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | undefined {
  return RECORDING_MIME_TYPES.find((type) => isTypeSupported(type));
}

/**
 * One capture round. Callbacks handed to the MediaRecorder close over their own
 * session, so a tail packet or stop event that arrives after the round was
 * abandoned can never write into, or clear, a newer recording.
 */
interface RecordingSession {
  readonly recorder: MediaRecorder;
  readonly chunks: Blob[];
  readonly startedAt: number;
  readonly onData: (event: BlobEvent) => void;
  cancelled: boolean;
}

/**
 * Captures a single utterance. Microphone tracks are released on every exit
 * path so the browser's recording indicator never lingers after a failure.
 */
export class SpeechRecorder {
  #session: RecordingSession | undefined;
  #stream: MediaStream | undefined;
  // Single-flight capture: the microphone request may still be pending when the
  // user presses the control again, so concurrent starts share one stream.
  #starting: Promise<void> | undefined;
  #cancelled = false;

  get active(): boolean {
    return this.#session !== undefined;
  }

  start(): Promise<void> {
    if (this.#session !== undefined) return Promise.resolve();
    this.#starting ??= this.#begin().finally(() => { this.#starting = undefined; });
    return this.#starting;
  }

  async #begin(): Promise<void> {
    this.#cancelled = false;
    const devices = microphoneDevices();
    if (devices === undefined) throw new Error("Speech recording is unavailable in this browser context");
    const stream = await devices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (this.#wasCancelled()) {
      stopTracks(stream);
      throw new DOMException("Speech recording was cancelled", "AbortError");
    }
    try {
      const mimeType = preferredSpeechRecordingMimeType();
      const recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
      const session: RecordingSession = {
        recorder,
        chunks: [],
        startedAt: Date.now(),
        cancelled: false,
        // Writes only to this round, even if the round has already been abandoned.
        onData: (event: BlobEvent) => { if (event.data.size > 0) session.chunks.push(event.data); },
      };
      recorder.addEventListener("dataavailable", session.onData);
      recorder.start(RECORDING_TIMESLICE_MS);
      this.#session = session;
      this.#stream = stream;
    } catch (error) {
      stopTracks(stream);
      throw error;
    }
  }

  /** Stop and return the recording; the microphone is released either way. */
  async stop(): Promise<SpeechRecording | undefined> {
    const session = this.#session;
    if (session === undefined) return undefined;
    const { recorder } = session;
    const mimeType = recorder.mimeType === "" ? "audio/webm" : recorder.mimeType;
    const durationMs = Math.max(0, Date.now() - session.startedAt);
    // Detach before awaiting the flush so the next round can start immediately.
    this.#session = undefined;
    const recording = new Promise<SpeechRecording | undefined>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (session.cancelled) {
          this.#detach(session);
          resolve(undefined);
          return;
        }
        // `stop()` flushes the remaining buffer through `dataavailable` first,
        // so read this round's live chunk list rather than a snapshot.
        const blob = new Blob(session.chunks, { type: mimeType });
        // The Blob owns the bytes now; release the per-packet references and the
        // listener immediately so a late packet cannot re-append audio.
        this.#detach(session);
        resolve({ blob, mimeType, durationMs });
      };
      recorder.addEventListener("stop", finish, { once: true });
      if (recorder.state === "inactive") {
        recorder.removeEventListener("stop", finish);
        finish();
        return;
      }
      try {
        recorder.stop();
      } catch {
        // Already stopped elsewhere; keep whatever was delivered so far.
        recorder.removeEventListener("stop", finish);
        finish();
      }
    });
    this.#releaseStream();
    return await recording;
  }

  /** Abandon the in-flight or pending recording without producing a result. */
  cancel(): void {
    this.#cancelled = true;
    const session = this.#session;
    this.#session = undefined;
    this.#releaseStream();
    if (session === undefined) return;
    session.cancelled = true;
    // Detach before stopping: the stop flush must not repopulate the abandoned
    // buffer, and the discarded audio should become collectable right away.
    this.#detach(session);
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        // Already transitioned; releasing the stream is what matters.
      }
    }
  }

  #releaseStream(): void {
    const stream = this.#stream;
    this.#stream = undefined;
    if (stream !== undefined) stopTracks(stream);
  }

  /** Drop a finished round's audio references and its packet listener. */
  #detach(session: RecordingSession): void {
    session.recorder.removeEventListener("dataavailable", session.onData);
    session.chunks.length = 0;
  }

  /**
   * `cancel()` runs while `#begin` is suspended in `getUserMedia`, so the flag
   * must be read through a call: locals narrowed before the await would be stale.
   */
  #wasCancelled(): boolean {
    return this.#cancelled;
  }
}

/** Base64 without a data: URL prefix, matching the request contract. */
export async function readSpeechRecordingBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
