// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentRendererInput } from "@chainingintention/pi-web-cn/plugin-api";
import { mountMermaidPreview } from "./mermaidPreviewElement.js";
import { loadMermaidEngine } from "./mermaidEngine.js";

vi.mock("./mermaidEngine.js", async (original) => ({
  ...await original<typeof import("./mermaidEngine.js")>(),
  loadMermaidEngine: vi.fn(),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function input(signal = new AbortController().signal): ContentRendererInput {
  return { text: "sequenceDiagram\nAlice->>Bob: 你好", signal, fail: vi.fn() };
}

describe("Mermaid preview lifetime", () => {
  it("loads the package-local engine into an opaque frame", async () => {
    vi.mocked(loadMermaidEngine).mockResolvedValue("window.engineReady = true;");
    const preview = mountMermaidPreview(input());
    document.body.append(preview);
    await Promise.resolve();
    const frame = preview.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.srcdoc).toContain("window.engineReady = true;");
    expect(frame?.srcdoc).not.toContain("Alice");
  });

  it("does not attach a late engine after disconnect", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(loadMermaidEngine).mockReturnValue(new Promise((done) => { resolve = done; }));
    const preview = mountMermaidPreview(input());
    document.body.append(preview);
    const frame = preview.querySelector("iframe");
    preview.remove();
    resolve("late engine");
    await Promise.resolve();
    expect(frame?.srcdoc).toBe("");
  });

  it("removes an aborted frame and ignores the late engine", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(loadMermaidEngine).mockReturnValue(new Promise((done) => { resolve = done; }));
    const controller = new AbortController();
    const request = input(controller.signal);
    const preview = mountMermaidPreview(request);
    document.body.append(preview);
    controller.abort();
    resolve("late engine");
    await Promise.resolve();
    expect(preview.querySelector("iframe")).toBeNull();
    expect(request.fail).not.toHaveBeenCalled();
  });

  it("reports engine loading errors so the host can fall back to source", async () => {
    const error = new Error("asset missing");
    vi.mocked(loadMermaidEngine).mockRejectedValue(error);
    const request = input();
    document.body.append(mountMermaidPreview(request));
    await Promise.resolve();
    expect(request.fail).toHaveBeenCalledWith(error);
  });

  it("accepts messages only from its own frame and sends source by postMessage", async () => {
    vi.mocked(loadMermaidEngine).mockResolvedValue("engine");
    const request = input();
    const preview = mountMermaidPreview(request);
    document.body.append(preview);
    await Promise.resolve();
    const frameWindow = preview.querySelector("iframe")?.contentWindow;
    if (frameWindow === null || frameWindow === undefined) throw new Error("Missing frame window");
    const send = vi.spyOn(frameWindow, "postMessage");
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "mermaid-ready" } }));
    expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { source: frameWindow, data: { type: "mermaid-ready" } }));
    expect(send).toHaveBeenCalledWith({ type: "mermaid-render", text: request.text }, "*");
    window.dispatchEvent(new MessageEvent("message", { source: frameWindow, data: { type: "mermaid-error" } }));
    expect(request.fail).toHaveBeenCalledOnce();
  });
});
