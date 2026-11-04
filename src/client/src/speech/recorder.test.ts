import { afterEach, describe, expect, it, vi } from "vitest";
import {
  preferredSpeechRecordingMimeType,
  readSpeechRecordingBase64,
  speechRecordingAvailable,
  SpeechRecorder,
} from "./recorder";

/** Size of the synthetic utterance each fake recorder produces. */
const AUDIO_BYTES = 21;
const TIMESLICE_MS = 1_000;

class FakeMediaRecorder extends EventTarget {
  static supported: readonly string[] = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];
  static instances: FakeMediaRecorder[] = [];
  /** When true, `stop()` withholds the tail until `deliverTail()` is called. */
  static deferTail = false;
  static nextId = 0;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  readonly id = ++FakeMediaRecorder.nextId;
  /** Distinct payload per recorder so cross-round mixing is detectable. */
  readonly audio = new Uint8Array(AUDIO_BYTES).fill(this.id);
  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;
  timeslice: number | undefined;
  dataListeners = 0;
  #delivered = 0;
  #stopDispatched = false;

  constructor(readonly stream: unknown, options?: { mimeType?: string }) {
    super();
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (type === "dataavailable") this.dataListeners += 1;
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (type === "dataavailable") this.dataListeners -= 1;
    super.removeEventListener(type, callback, options);
  }

  start(timeslice?: number): void {
    this.state = "recording";
    this.timeslice = timeslice;
  }

  stop(): void {
    if (this.state === "inactive") {
      this.#dispatchStop();
      return;
    }
    this.state = "inactive";
    if (FakeMediaRecorder.deferTail) return;
    this.#flushTail();
  }

  /** Deliver a withheld tail, as a browser does after `stop()` returns. */
  deliverTail(): void {
    this.#flushTail();
  }

  /** Simulate a periodic timeslice delivery while recording. */
  emit(bytes: number): void {
    this.#emit(bytes);
  }

  get delivered(): number {
    return this.#delivered;
  }

  #flushTail(): void {
    this.#emit(this.audio.length - this.#delivered);
    this.#dispatchStop();
  }

  #dispatchStop(): void {
    if (this.#stopDispatched) return;
    this.#stopDispatched = true;
    this.dispatchEvent(new Event("stop"));
  }

  #emit(bytes: number): void {
    if (bytes <= 0) return;
    const chunk = this.audio.slice(this.#delivered, this.#delivered + bytes);
    this.#delivered += chunk.length;
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: new Blob([chunk], { type: "audio/webm" }) });
    this.dispatchEvent(event);
  }
}

interface FakeStream {
  getTracks: () => { stop: () => void }[];
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, resolve: (value: T) => { settle?.(value); } };
}

function fakeStream(stopTrack: () => void): FakeStream {
  return { getTracks: () => [{ stop: stopTrack }] };
}

function instanceAt(index: number): FakeMediaRecorder {
  const instance = FakeMediaRecorder.instances[index];
  if (instance === undefined) throw new Error(`expected recorder instance ${String(index)}`);
  return instance;
}

async function blobBytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

function installRecorderGlobals(): { getUserMedia: ReturnType<typeof vi.fn>; stopTrack: ReturnType<typeof vi.fn> } {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(() => Promise.resolve(fakeStream(stopTrack)));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.deferTail = false;
  return { getUserMedia, stopTrack };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("speech recorder", () => {
  it("reports availability only when the browser exposes microphone capture", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("MediaRecorder", undefined);
    expect(speechRecordingAvailable()).toBe(false);

    installRecorderGlobals();
    expect(speechRecordingAvailable()).toBe(true);
  });

  it("prefers Opus WebM and falls back through containers the services accept", () => {
    expect(preferredSpeechRecordingMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(preferredSpeechRecordingMimeType((type) => type === "audio/ogg;codecs=opus" || type === "audio/webm")).toBe("audio/webm");
    expect(preferredSpeechRecordingMimeType(() => false)).toBeUndefined();
  });

  it("records one utterance, requests timeslices, and releases the microphone", async () => {
    const { getUserMedia, stopTrack } = installRecorderGlobals();
    const recorder = new SpeechRecorder();

    await recorder.start();
    expect(recorder.active).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    expect(instanceAt(0).timeslice).toBe(TIMESLICE_MS);

    const recording = await recorder.stop();
    expect(recording?.mimeType).toBe("audio/webm;codecs=opus");
    expect(await blobBytes(recording?.blob ?? new Blob())).toEqual([...instanceAt(0).audio]);
    expect(recording?.durationMs).toBeGreaterThanOrEqual(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorder.active).toBe(false);
  });

  it("keeps audio delivered while recording and the tail flushed at stop", async () => {
    installRecorderGlobals();
    const recorder = new SpeechRecorder();
    await recorder.start();
    instanceAt(0).emit(8);

    const recording = await recorder.stop();
    expect(await blobBytes(recording?.blob ?? new Blob())).toEqual([...instanceAt(0).audio]);
  });

  it("detaches the packet listener once the recording stops", async () => {
    installRecorderGlobals();
    const recorder = new SpeechRecorder();
    await recorder.start();
    const instance = instanceAt(0);
    expect(instance.dataListeners).toBe(1);

    await recorder.stop();
    expect(instance.dataListeners).toBe(0);

    // A tail delivered after stop must not repopulate the released buffer or
    // disturb the next round.
    instance.emit(5);
    expect(recorder.active).toBe(false);
    await recorder.start();
    const next = instanceAt(1);
    const recording = await recorder.stop();
    expect(await blobBytes(recording?.blob ?? new Blob())).toEqual([...next.audio]);
  });

  it("detaches the packet listener when a recording is cancelled", async () => {
    installRecorderGlobals();
    FakeMediaRecorder.deferTail = true;
    const recorder = new SpeechRecorder();
    await recorder.start();
    const instance = instanceAt(0);
    expect(instance.dataListeners).toBe(1);

    recorder.cancel();
    expect(instance.dataListeners).toBe(0);
    // The abandoned round's flush has nowhere to append.
    instance.deliverTail();
    expect(recorder.active).toBe(false);
  });

  it("isolates a round from the previous round's late packets and stop event", async () => {
    installRecorderGlobals();
    const recorder = new SpeechRecorder();

    await recorder.start();
    const first = instanceAt(0);
    first.emit(5);
    // Round 1 stops but its tail and stop event are withheld, exactly like a
    // browser that delivers them on a later task.
    FakeMediaRecorder.deferTail = true;
    const stoppingFirst = recorder.stop();

    // Round 2 begins while round 1 is still flushing.
    await recorder.start();
    const second = instanceAt(1);
    second.emit(5);

    first.deliverTail();
    const firstRecording = await stoppingFirst;
    const firstBytes = await blobBytes(firstRecording?.blob ?? new Blob());
    expect(firstBytes).toHaveLength(AUDIO_BYTES);
    expect(firstBytes.every((byte) => byte === first.id)).toBe(true);

    FakeMediaRecorder.deferTail = false;
    const secondRecording = await recorder.stop();
    const secondBytes = await blobBytes(secondRecording?.blob ?? new Blob());
    expect(secondBytes).toEqual([...second.audio]);
    expect(secondBytes.every((byte) => byte === second.id)).toBe(true);
  });

  it("abandons a recording without producing a result", async () => {
    const { stopTrack } = installRecorderGlobals();
    const recorder = new SpeechRecorder();
    await recorder.start();
    recorder.cancel();
    expect(recorder.active).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(await recorder.stop()).toBeUndefined();
  });

  it("does not let an abandoned round's tail contaminate the next recording", async () => {
    installRecorderGlobals();
    FakeMediaRecorder.deferTail = true;
    const recorder = new SpeechRecorder();

    await recorder.start();
    const first = instanceAt(0);
    first.emit(5);
    recorder.cancel();

    await recorder.start();
    const second = instanceAt(1);
    second.emit(5);

    // The abandoned round delivers its tail and stop event after round 2 began.
    first.deliverTail();

    FakeMediaRecorder.deferTail = false;
    const recording = await recorder.stop();
    expect(await blobBytes(recording?.blob ?? new Blob())).toEqual([...second.audio]);
  });

  it("shares one microphone request between concurrent starts", async () => {
    const stopTrack = vi.fn();
    const granted = deferred<FakeStream>();
    const getUserMedia = vi.fn(() => granted.promise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.deferTail = false;

    const recorder = new SpeechRecorder();
    const first = recorder.start();
    const second = recorder.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    granted.resolve(fakeStream(stopTrack));
    await Promise.all([first, second]);
    expect(recorder.active).toBe(true);
    expect((await recorder.stop())?.blob.size).toBe(AUDIO_BYTES);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("releases a stream granted after the recording was cancelled", async () => {
    const stopTrack = vi.fn();
    const granted = deferred<FakeStream>();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => granted.promise } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.deferTail = false;

    const recorder = new SpeechRecorder();
    const starting = recorder.start();
    recorder.cancel();
    granted.resolve(fakeStream(stopTrack));

    await expect(starting).rejects.toThrow(/cancelled/u);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorder.active).toBe(false);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("releases the microphone when capture fails to start", async () => {
    const stopTrack = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(stopTrack)) } });
    vi.stubGlobal("MediaRecorder", class extends FakeMediaRecorder {
      override start(): void {
        throw new Error("recorder failed");
      }
    });
    const recorder = new SpeechRecorder();
    await expect(recorder.start()).rejects.toThrow("recorder failed");
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorder.active).toBe(false);
  });

  it("encodes the recording as base64 without a data URL prefix", async () => {
    expect(await readSpeechRecordingBase64(new Blob([new Uint8Array([104, 105])]))).toBe("aGk=");
  });
});
