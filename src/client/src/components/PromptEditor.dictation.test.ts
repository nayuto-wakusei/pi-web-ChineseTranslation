// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import { speechApi } from "../api";

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(type: string): boolean {
    return type === "audio/webm;codecs=opus";
  }

  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    super();
    this.mimeType = options?.mimeType ?? "";
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, resolve: (value: T) => { settle?.(value); } };
}

function installMicrophone() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) } });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  return { stop };
}

async function mountEditor(options: { capable?: boolean; cwd?: string } = {}) {
  const editor = new PromptEditor();
  editor.sessionId = "dictation";
  editor.cwd = options.cwd ?? "/repo";
  editor.speechRecognition = options.capable ?? true;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function dictateButton(editor: PromptEditor): HTMLButtonElement | null {
  return editor.renderRoot.querySelector<HTMLButtonElement>(".dictate-button");
}

beforeEach(() => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Unknown browser");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux aarch64");
  vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer dictation", () => {
  it("hides the control when the machine does not advertise dictation", async () => {
    installMicrophone();
    const editor = await mountEditor({ capable: false });
    expect(dictateButton(editor)).toBeNull();
  });

  it("explains why the control is missing on an insecure origin", async () => {
    // No MediaRecorder: the browser withholds capture outside HTTPS/localhost.
    vi.stubGlobal("MediaRecorder", undefined);
    const editor = await mountEditor();
    expect(dictateButton(editor)).toBeNull();
    expect(editor.renderRoot.querySelector(".dictation-note")?.textContent).toContain("HTTPS");
  });

  it("records one utterance and inserts the transcript at the caret", async () => {
    const { stop } = installMicrophone();
    const transcribe = vi.spyOn(speechApi, "transcribe").mockResolvedValue({ text: "你好世界" });
    const editor = await mountEditor();

    editor.view?.dispatch({ selection: { anchor: 0 } });
    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
    expect(dictateButton(editor)?.getAttribute("aria-pressed")).toBe("true");

    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(transcribe).toHaveBeenCalledOnce(); });
    await vi.waitFor(() => { expect(editor.view?.state.doc.toString()).toBe("你好世界"); });

    const [body, machineId] = transcribe.mock.calls[0] ?? [];
    if (body === undefined) throw new Error("expected a transcription request");
    expect(body.cwd).toBe("/repo");
    expect(body.audio.mimeType).toBe("audio/webm;codecs=opus");
    expect(typeof body.durationMs).toBe("number");
    expect(machineId).toBe("local");
    expect(stop).toHaveBeenCalled();
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("idle"); });
  });

  it("separates dictation from text already in the draft", async () => {
    installMicrophone();
    vi.spyOn(speechApi, "transcribe").mockResolvedValue({ text: "继续" });
    const editor = await mountEditor();
    editor.replaceText("已完成");

    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(editor.view?.state.doc.toString()).toBe("已完成 继续"); });
  });

  it("keeps the draft intact and reports a transcription failure", async () => {
    const { stop } = installMicrophone();
    vi.spyOn(speechApi, "transcribe").mockRejectedValue(new Error("speech service down"));
    const editor = await mountEditor();
    editor.replaceText("保留");

    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
    dictateButton(editor)?.click();

    await vi.waitFor(() => { expect(editor.renderRoot.querySelector(".chip-error")?.textContent).toContain("speech service down"); });
    expect(editor.view?.state.doc.toString()).toBe("保留");
    // Failure still releases the microphone and returns the control to idle.
    expect(stop).toHaveBeenCalledOnce();
    expect(dictateButton(editor)?.dataset["state"]).toBe("idle");
  });

  it("records another utterance after a completed transcription", async () => {
    installMicrophone();
    const transcribe = vi.spyOn(speechApi, "transcribe")
      .mockResolvedValueOnce({ text: "第一段" })
      .mockResolvedValueOnce({ text: "第二段" });
    const editor = await mountEditor();

    for (const expected of ["第一段", "第二段"]) {
      dictateButton(editor)?.click();
      await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
      dictateButton(editor)?.click();
      await vi.waitFor(() => { expect(editor.view?.state.doc.toString()).toContain(expected); });
      await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("idle"); });
    }
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("abandons capture and transcription when the composer switches session", async () => {
    const { stop } = installMicrophone();
    const transcribe = vi.spyOn(speechApi, "transcribe").mockResolvedValue({ text: "迟到结果" });
    const editor = await mountEditor();

    dictateButton(editor)?.click();
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
    editor.sessionId = "another-session";
    await editor.updateComplete;

    expect(dictateButton(editor)?.dataset["state"]).toBe("idle");
    expect(stop).toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(editor.renderRoot.querySelector(".chip-error")).toBeNull();
  });

  it("disables the control while a prompt is being submitted", async () => {
    installMicrophone();
    const editor = await mountEditor();
    expect(dictateButton(editor)?.disabled).toBe(false);
    editor.sending = true;
    await editor.updateComplete;
    expect(dictateButton(editor)?.disabled).toBe(true);
  });

  it("ignores a second press while the microphone permission prompt is pending", async () => {
    const stop = vi.fn();
    const granted = deferred<{ getTracks: () => { stop: () => void }[] }>();
    const getUserMedia = vi.fn(() => granted.promise);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    const editor = await mountEditor();
    dictateButton(editor)?.click();
    dictateButton(editor)?.click();
    expect(getUserMedia).toHaveBeenCalledOnce();

    granted.resolve({ getTracks: () => [{ stop }] });
    await vi.waitFor(() => { expect(dictateButton(editor)?.dataset["state"]).toBe("recording"); });
    expect(stop).not.toHaveBeenCalled();

    editor.sessionId = "another-session";
    await editor.updateComplete;
    expect(stop).toHaveBeenCalledOnce();
  });
});
