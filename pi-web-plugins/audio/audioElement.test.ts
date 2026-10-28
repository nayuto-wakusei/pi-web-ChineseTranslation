// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPreviewElement, registerAudioPreviewElement, type AudioModel } from "./audioElement.js";

const pause = vi.fn<() => void>();
const load = vi.fn<() => void>();

beforeEach(() => {
  registerAudioPreviewElement();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function player(signal = new AbortController().signal) {
  const element = document.createElement("pi-web-audio-preview");
  if (!(element instanceof AudioPreviewElement)) throw new Error("Audio element is not registered");
  const fail = vi.fn();
  const model: AudioModel = { url: "https://example.test/audio", signal, fail, label: "Audio", errorMessage: "Download or open externally" };
  element.model = model;
  document.body.append(element);
  return { element, fail, model, get audio() { return requiredAudio(element); } };
}

function requiredAudio(element: AudioPreviewElement): HTMLAudioElement {
  const audio = element.querySelector("audio");
  if (audio === null) throw new Error("Expected an audio player");
  return audio;
}

describe("audio preview lifecycle", () => {
  it("uses native controls, metadata-only preload and never autoplay", () => {
    const { audio } = player();
    expect(audio.controls).toBe(true);
    expect(audio.preload).toBe("metadata");
    expect(audio.autoplay).toBe(false);
    expect(audio.getAttribute("aria-label")).toBe("Audio");
  });

  it.each(["abort", "unmount"])("stops playback and releases media on %s without reporting errors", (action) => {
    const controller = new AbortController();
    const { element, audio, fail } = player(controller.signal);
    if (action === "abort") controller.abort();
    else element.remove();
    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(audio.hasAttribute("src")).toBe(false);
    expect(element.querySelector("audio")).toBeNull();
    audio.dispatchEvent(new Event("error"));
    controller.abort();
    element.remove();
    expect(fail).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("surfaces codec, network and unknown errors, ignoring deliberate abort", () => {
    const { audio, fail } = player();
    for (const code of [2, 3, 4, undefined]) {
      Object.defineProperty(audio, "error", { configurable: true, value: code === undefined ? null : { code } });
      audio.dispatchEvent(new Event("error"));
    }
    expect(fail).toHaveBeenCalledTimes(4);
    expect(fail).toHaveBeenLastCalledWith(new Error("Download or open externally"));
    Object.defineProperty(audio, "error", { configurable: true, value: { code: 1 } });
    audio.dispatchEvent(new Event("error"));
    expect(fail).toHaveBeenCalledTimes(4);
  });

  it("cleans up previous model listeners and remounts safely", () => {
    const previous = new AbortController();
    const { element, audio, model, fail } = player(previous.signal);
    element.model = { ...model, signal: new AbortController().signal, url: "https://example.test/new" };
    const next = requiredAudio(element);
    expect(next).not.toBe(audio);
    expect(audio.hasAttribute("src")).toBe(false);
    previous.abort();
    audio.dispatchEvent(new Event("error"));
    expect(next.hasAttribute("src")).toBe(true);
    expect(fail).not.toHaveBeenCalled();
    element.remove();
    document.body.append(element);
    expect(element.querySelector("audio")).not.toBe(next);
  });

  it("does not create media for an already-aborted preview", () => {
    const controller = new AbortController();
    controller.abort();
    expect(player(controller.signal).element.querySelector("audio")).toBeNull();
  });
});
