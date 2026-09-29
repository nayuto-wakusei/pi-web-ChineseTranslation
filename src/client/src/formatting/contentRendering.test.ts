// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import type { ContentRendererContribution } from "../../../plugin-api";
import { FormattedText } from "../components/FormattedText";
import { ContentRendererHost } from "../components/ContentRendererHost";
import { PluginRegistry } from "../plugins/registry";
import { createContentRenderingCapability, isClosedFence, MAX_CONTENT_RENDERER_LENGTH } from "./contentRendering";
import { RenderIntentMemory } from "./renderIntentMemory";

afterEach(() => {
  document.body.replaceChildren();
});

function renderer(renderMode: "manual" | "automatic" = "automatic"): ContentRendererContribution {
  return { id: "diagram", renderMode, languages: ["diagram"], render: ({ text }) => html`<div class="diagram">${text}</div>` };
}

async function mount(text: string, contribution = renderer()) {
  const registry = new PluginRegistry();
  await registry.register({ id: "test", plugin: { apiVersion: 4, name: "测试", activate: () => ({ contributions: { contentRenderers: [contribution] } }) } });
  const element = new FormattedText();
  element.text = text;
  element.contentRendering = registry.chatContentRendering;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe("content rendering", () => {
  it("skips open fences, truncated text, and oversize input", async () => {
    const open = await mount("```diagram\nstill streaming");
    expect(open.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
    expect(isClosedFence({ type: "code", raw: "```diagram\nopen", text: "open" })).toBe(false);
    expect(isClosedFence({ type: "code", raw: "```diagram\nclosed\n```", text: "closed" })).toBe(true);

    const capability = createContentRenderingCapability(() => [{ id: "diagram", label: "图表", renderer: renderer() }]);
    expect(capability.renderText({ machineId: "local", text: "x".repeat(MAX_CONTENT_RENDERER_LENGTH + 1), language: "diagram" })).toBeUndefined();
    expect(capability.renderText({ machineId: "local", text: "closed", language: "diagram", truncated: true })).toBeUndefined();
  });

  it("replaces a closed fence and keeps raw source available", async () => {
    const element = await mount("```diagram\nA --> B\n```");
    const host = requiredHost(element.shadowRoot?.querySelector("pi-web-content-renderer"));
    await host.updateComplete;
    expect(host.shadowRoot?.querySelector(".diagram")?.textContent).toBe("A --> B");
    const root = host.shadowRoot;
    if (root === null) throw new Error("Expected renderer shadow root");
    const raw = [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === "原始");
    raw?.click();
    await host.updateComplete;
    expect(host.shadowRoot?.querySelector("pre code")?.textContent).toBe("A --> B");
  });

  it("expires render intent from the last choice, not from access", () => {
    let now = 0;
    const memory = new RenderIntentMemory(() => now);
    memory.choose("block", "source", { rendererId: "a", raw: false });
    now = 14 * 60_000;
    expect(memory.read("block", "source", ["a"])).toEqual({ rendererId: "a", raw: false });
    now = 15 * 60_000;
    expect(memory.read("block", "source", ["a"])).toBeUndefined();
  });
});

function requiredHost(value: Element | null | undefined): ContentRendererHost {
  if (!(value instanceof ContentRendererHost)) throw new Error("Expected a content renderer host");
  return value;
}

describe("content renderer registry", () => {
  it("resolves the host capability and the files file query", async () => {
    const registry = new PluginRegistry();
    const resolved = vi.fn();
    await registry.register({ id: "consumer", plugin: { apiVersion: 4, name: "消费者", requires: [{ pluginId: "pi-web", id: "content-rendering", version: 1, parse: (value) => value }], activate: () => ({ contributions: {}, start: ({ capabilities }) => { resolved(capabilities.resolve({ pluginId: "pi-web", id: "content-rendering", version: 1, parse: (value) => value })); } }) } });
    expect(resolved).toHaveBeenCalledWith(registry.contentRendering);
  });
});
