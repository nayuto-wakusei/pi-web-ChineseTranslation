import type { ContentRendererInput } from "@chainingintention/pi-web-cn/plugin-api";
import { mermaidFrameDocument } from "./mermaidEngine.js";

const PREVIEW_TAG = "pi-web-mermaid-preview";

export function mountMermaidPreview(input: ContentRendererInput): HTMLElement {
  if (customElements.get(PREVIEW_TAG) === undefined) customElements.define(PREVIEW_TAG, MermaidPreviewElement);
  const preview = new MermaidPreviewElement();
  preview.input = input;
  return preview;
}

class MermaidPreviewElement extends HTMLElement {
  input: ContentRendererInput | undefined;
  private frame: HTMLIFrameElement | undefined;
  private cleanup: (() => void) | undefined;
  private generation = 0;

  connectedCallback(): void {
    this.replaceChildren();
    const frame = document.createElement("iframe");
    frame.title = "图表";
    frame.sandbox.add("allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.srcdoc = mermaidFrameDocument();
    frame.style.cssText = "display:block;width:100%;height:180px;border:0;background:white";
    this.replaceChildren(frame);
    this.frame = frame;
    this.draw();
  }

  disconnectedCallback(): void {
    this.generation += 1;
    this.cleanup?.();
    this.cleanup = undefined;
  }

  private draw(): void {
    this.cleanup?.();
    const input = this.input;
    const frame = this.frame;
    const generation = ++this.generation;
    if (input === undefined || frame === undefined || input.signal.aborted) return;
    const current = () => this.isConnected && !input.signal.aborted && generation === this.generation;
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!current() || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type === "mermaid-ready") {
        frame.contentWindow?.postMessage({ type: "mermaid-render", text: input.text }, "*");
      } else if (data.type === "mermaid-error") {
        input.fail(new Error("无法渲染此图表源码"));
        cleanup();
      } else if (data.type === "mermaid-rendered" && "height" in data && typeof data.height === "number" && Number.isFinite(data.height)) {
        frame.style.height = `${String(Math.min(1600, Math.max(120, data.height + 24)))}px`;
        cleanup();
      }
    };
    const timeout = window.setTimeout(() => {
      if (current()) input.fail(new Error("图表预览超时"));
      cleanup();
    }, 30_000);
    const onAbort = () => { cleanup(); };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      input.signal.removeEventListener("abort", onAbort);
    };
    this.cleanup = cleanup;
    window.addEventListener("message", onMessage);
    input.signal.addEventListener("abort", onAbort, { once: true });
  }
}
