import { RenderIntentMemory } from "./renderIntentMemory";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, render, type TemplateResult } from "lit";
import type { ContentRendererContribution, ContentRendererInput } from "../../../plugin-api";
import { ContentRenderingBoundary } from "../components/ContentRenderingBoundary";
import { useDeferredContent, settleDeferredContent } from "./deferredContent.testSupport";
import { setClientTranslations } from "../i18n";
import mainMessages from "../../../../pi-web-plugins/zh-cn/main.json";
import { FormattedText } from "../components/FormattedText";
import { ContentRendererHost } from "../components/ContentRendererHost";
import { writeClipboardText } from "../clipboard";
import { PluginRegistry } from "../plugins/registry";
import { renderWorkspaceMarkdownHtml } from "../../../../pi-web-plugins/files/workspaceMarkdown";
import { createContentRenderingCapability, MAX_CONTENT_RENDERER_LENGTH, isClosedFence } from "./contentRendering";

vi.mock("../clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(true) }));

useDeferredContent();
beforeEach(() => { setClientTranslations("zh-CN", mainMessages); });

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderer(callback: ContentRendererContribution["render"] = ({ text }) => html`<div class="diagram">${text}</div>`): ContentRendererContribution {
  return { id: "diagram", renderMode: "automatic", languages: ["diagram"], fileExtensions: ["diag"], render: callback };
}

async function mount(text: string, contribution = renderer()) {
  const registry = new PluginRegistry();
  await registry.register({ id: "test", plugin: { apiVersion: 4, name: "Test", activate: () => ({ contributions: { contentRenderers: [contribution] } }) } });
  const element = new FormattedText();
  element.text = text;
  element.contentRendering = registry.getChatContentRendering(element.machineId);
  document.body.append(element);
  await settleDeferredContent(element);
  return { element, registry };
}

async function hostIn(element: Element): Promise<ContentRendererHost> {
  const host = element.shadowRoot?.querySelector("pi-web-content-renderer");
  if (!(host instanceof ContentRendererHost)) throw new Error("Expected a content renderer host");
  await settleDeferredContent(host);
  return host;
}

async function renderPublicMarkdown(content: TemplateResult, root: HTMLElement): Promise<void> {
  render(content, root);
  const boundary = root.querySelector("pi-web-content-rendering-boundary");
  if (!(boundary instanceof ContentRenderingBoundary)) throw new Error("Expected a host rendering boundary");
  await settleDeferredContent(boundary);
}

function button(host: ContentRendererHost, label: string): HTMLButtonElement {
  const found = [...host.renderRoot.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Missing ${label} button`);
  return found;
}

describe("shared content rendering", () => {
  it("remembers independent duplicate blocks only with an opt-in identity and expires on revisit", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const manual = { ...renderer(), renderMode: "manual" as const };
    const { element } = await mount("```diagram\nsame\n```\n\n```diagram\nsame\n```", manual);
    element.intentKey = "memory-duplicates";
    await settleDeferredContent(element);
    const host = await hostIn(element);
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector(".diagram")).not.toBeNull();
    element.remove();
    document.body.append(element);
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector(".diagram")).not.toBeNull();
    const second = element.renderRoot.querySelectorAll<ContentRendererHost>("pi-web-content-renderer")[1];
    await settleDeferredContent(second);
    expect(second?.shadowRoot?.querySelector("pre")?.textContent).toBe("same");
    clock.mockReturnValue(1000 + 15 * 60_000);
    element.text += "\n\nprose";
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector(".diagram")).not.toBeNull();
    element.remove();
    document.body.append(element);
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre")?.textContent).toBe("same");
  });

  it("restores exact renderer and mode, but not across identities, source changes or missing renderers", async () => {
    const { element, registry } = await mount("```diagram\nsource\n```", { ...renderer(), renderMode: "manual" });
    await registry.register({ id: "z", plugin: { apiVersion: 4, name: "Z", activate: () => ({ contributions: { contentRenderers: [{ ...renderer(), renderMode: "manual" }] } }) } });
    element.contentRendering = registry.getChatContentRendering(element.machineId);
    element.intentKey = "memory-chooser";
    await settleDeferredContent(element);
    let host = await hostIn(element);
    button(host, "z / diagram").click();
    await settleDeferredContent(host);
    element.intentKey = "different-session";
    await settleDeferredContent(element);
    host = await hostIn(element);
    await settleDeferredContent(host);
    expect(button(host, "test / diagram").getAttribute("aria-pressed")).toBe("false");
    expect(host.shadowRoot?.querySelector("pre")).not.toBeNull();
    element.intentKey = "memory-chooser";
    await settleDeferredContent(element);
    host = await hostIn(element);
    await settleDeferredContent(host);
    expect(button(host, "z / diagram").getAttribute("aria-pressed")).toBe("true");
    expect(host.shadowRoot?.querySelector(".diagram")).not.toBeNull();
    button(host, "源码").click();
    await settleDeferredContent(host);
    element.remove();
    document.body.append(element);
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(button(host, "z / diagram").getAttribute("aria-pressed")).toBe("false");
    expect(button(host, "源码").getAttribute("aria-pressed")).toBe("true");
    expect(host.shadowRoot?.querySelector("pre")).not.toBeNull();
    element.text = "```diagram\nchanged\n```";
    await settleDeferredContent(element);
    host = await hostIn(element);
    await settleDeferredContent(host);
    expect(button(host, "test / diagram").getAttribute("aria-pressed")).toBe("false");
    expect(host.shadowRoot?.querySelector("pre")?.textContent).toBe("changed");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    host.choices = host.choices.filter(({ id }) => id !== "test:diagram");
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre")).not.toBeNull();
  });

  it("does not remember automatic rendering or opt-out Markdown activation", async () => {
    const { element } = await mount("```diagram\nsource\n```");
    element.intentKey = "automatic-is-not-intent";
    await settleDeferredContent(element);
    const host = await hostIn(element);
    // Isolate intent restoration from the parent's renderer-snapshot ownership.
    host.remove();
    host.choices = host.choices.map((choice) => ({ ...choice, renderer: { ...choice.renderer, renderMode: "manual" } }));
    document.body.append(host);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre")).not.toBeNull();
    host.intentKey = undefined;
    await settleDeferredContent(host);
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    host.remove();
    document.body.append(host);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre")).not.toBeNull();
  });

  it("defaults to manual, resets on source/renderer changes, and keeps activation across prose updates", async () => {
    const draw = vi.fn(({ text }: ContentRendererInput) => html`<b>${text}</b>`);
    const manual = renderer(draw);
    delete manual.renderMode;
    const { element, registry } = await mount("```diagram\none\n```", manual);
    let host = await hostIn(element);
    expect(draw).not.toHaveBeenCalled();
    expect(host.shadowRoot?.querySelector("pre")?.textContent).toBe("one");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledOnce();
    element.text += "\n\nMore prose";
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledOnce();
    element.text = "```diagram\ntwo\n```";
    await settleDeferredContent(element);
    host = await hostIn(element);
    await settleDeferredContent(host);
    expect(draw.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(draw).toHaveBeenCalledOnce();
    expect(host.shadowRoot?.querySelector("pre")?.textContent).toBe("two");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    const preview = host.shadowRoot?.querySelector("b");
    await registry.register({ id: "other", plugin: { apiVersion: 4, name: "Other", activate: () => ({ contributions: { contentRenderers: [{ ...manual, renderMode: "manual" }] } }) } });
    element.contentRendering = registry.getChatContentRendering(element.machineId);
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(element.renderRoot.querySelector("pi-web-content-renderer")).toBe(host);
    expect(host.shadowRoot?.querySelector("b")).toBe(preview);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(false);
    button(host, "other / diagram").click();
    await settleDeferredContent(host);
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(true);
    expect(draw).toHaveBeenCalledTimes(3);
    button(host, "源码").click();
    await settleDeferredContent(host);
    expect(draw.mock.calls[2]?.[0].signal.aborted).toBe(true);
    button(host, "复制源码").click();
    expect(writeClipboardText).toHaveBeenLastCalledWith("two");
  });

  it("keeps per-diagram controls independent, labelled and focused across toggles", async () => {
    const { element } = await mount("```diagram\nfirst\n```\n\n```diagram\nsecond\n```");
    const hosts = [...element.renderRoot.querySelectorAll<ContentRendererHost>("pi-web-content-renderer")];
    expect(hosts).toHaveLength(2);
    const [first, second] = hosts;
    if (first === undefined || second === undefined) throw new Error("Expected two diagrams");
    for (const host of hosts) await settleDeferredContent(host);
    const raw = button(first, "源码");
    raw.focus();
    raw.click();
    await settleDeferredContent(first);
    expect(first.shadowRoot?.activeElement).toBe(raw);
    expect(raw.getAttribute("aria-pressed")).toBe("true");
    expect(first.shadowRoot?.getElementById(raw.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(first.shadowRoot?.querySelector("pre")?.textContent).toBe("first");
    expect(second.shadowRoot?.querySelector(".diagram")?.textContent).toBe("second");
    button(second, "复制源码").click();
    await Promise.resolve();
    await settleDeferredContent(second);
    expect(writeClipboardText).toHaveBeenLastCalledWith("second");
    expect(second.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("已复制源码");
  });

  it("does not expose intent memory through public Markdown even to untyped callers", async () => {
    const capability = createContentRenderingCapability(() => [{ id: "manual", label: "Manual", renderer: { ...renderer(), renderMode: "manual" } }]);
    const request = { machineId: "local", text: "```diagram\nsource\n```", toSafeHtml: renderWorkspaceMarkdownHtml };
    Reflect.set(request, "intentKey", "untyped-public-memory");
    const root = document.createElement("div");
    document.body.append(root);
    const mountHost = async () => {
      await renderPublicMarkdown(capability.renderMarkdown(request), root);
      const host = root.querySelector<ContentRendererHost>("pi-web-content-renderer");
      if (host === null) throw new Error("Expected host");
      await settleDeferredContent(host);
      return host;
    };
    const first = await mountHost();
    expect(first.intentKey).toBeUndefined();
    button(first, "Manual").click();
    await settleDeferredContent(first);
    expect(first.renderRoot.querySelector(".diagram")).not.toBeNull();
    render(null, root);
    const second = await mountHost();
    expect(second.renderRoot.querySelector("pre")?.textContent).toBe("source");
  });

  it("ignores an untyped rendererId with embedded controls and lets the chooser switch", async () => {
    const first = vi.fn<ContentRendererContribution["render"]>(() => html`<b>First</b>`);
    const second = vi.fn(() => html`<b>Second</b>`);
    const capability = createContentRenderingCapability(() => [
      { id: "first", label: "First", renderer: renderer(first) },
      { id: "second", label: "Second", renderer: renderer(second) },
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const request = { machineId: "local", text: "source" };
    Reflect.set(request, "rendererId", "first"); // JavaScript consumer violates the public union.
    render(capability.renderText(request), root);
    const host = root.querySelector<ContentRendererHost>("pi-web-content-renderer");
    if (host === null) throw new Error("Expected host");
    await settleDeferredContent(host);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    button(host, "First").click();
    await settleDeferredContent(host);
    expect(first).toHaveBeenCalledOnce();
    expect(Object.keys(first.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["fail", "machineId", "signal", "text"]);
    expect(button(host, "First").getAttribute("aria-pressed")).toBe("true");
    expect(host.renderRoot.querySelector("b")?.textContent).toBe("First");
  });

  it("omits embedded controls only on request and retains failure source and cancellation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inputs: ContentRendererInput[] = [];
    const capability = createContentRenderingCapability(() => [{ id: "test:diagram", label: "Test / diagram", renderer: renderer((input) => {
      inputs.push(input);
      return html`<b>Preview</b>`;
    }) }]);
    const root = document.createElement("div");
    document.body.append(root);
    render(capability.renderText({ machineId: "local", text: "source", controls: "external" }), root);
    const host = root.querySelector<ContentRendererHost>("pi-web-content-renderer");
    if (host === null) throw new Error("Expected a renderer host");
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("button")).toBeNull();
    inputs[0]?.fail(new Error("failed"));
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre")?.textContent).toBe("source");
    expect(host.shadowRoot?.querySelector('p[role="status"]')?.textContent).toContain("预览失败");
    expect(inputs[0]?.signal.aborted).toBe(true);
  });

  it("previews closed fences during streaming without remounting on trailing prose, with raw and copy always available", async () => {
    const draw = vi.fn(({ text }: ContentRendererInput) => html`<div class="diagram">${text}</div>`);
    const { element } = await mount("```diagram\nA --> B", renderer(draw));
    expect(element.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
    expect(element.shadowRoot?.querySelector("pre code")?.textContent).toContain("A --> B");
    const copy = element.shadowRoot?.querySelector<HTMLButtonElement>(".code-copy-button");
    copy?.click();
    expect(writeClipboardText).toHaveBeenCalledWith("A --> B\n");

    element.text += "\n```\n\nTrailing";
    await settleDeferredContent(element);
    const host = await hostIn(element);
    expect(host.shadowRoot?.querySelector(".diagram")?.textContent).toBe("A --> B");
    const signal = draw.mock.calls[0]?.[0].signal;
    const diagram = host.shadowRoot?.querySelector(".diagram");
    element.text += " streaming prose\n\nMore.";
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(await hostIn(element)).toBe(host);
    expect(host.shadowRoot?.querySelector(".diagram")).toBe(diagram);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    button(host, "复制源码").click();
    await settleDeferredContent(host);
    expect(writeClipboardText).toHaveBeenLastCalledWith("A --> B");
    button(host, "源码").click();
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("pre code")?.textContent).toBe("A --> B");
    expect(signal?.aborted).toBe(true);
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledTimes(2);
    element.remove();
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(true);
  });

  it("keeps a four-space-indented fence marker raw until a valid closing fence arrives", async () => {
    const draw = vi.fn(({ text }: ContentRendererInput) => html`<div class="diagram">${text}</div>`);
    const { element } = await mount("```diagram\nsource\n    ```", renderer(draw));
    expect(element.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
    expect(element.shadowRoot?.querySelector("pre code")?.textContent).toContain("    ```");
    expect(element.shadowRoot?.querySelector(".code-copy-button")).not.toBeNull();
    expect(draw).not.toHaveBeenCalled();

    element.text += "\n   ```";
    await settleDeferredContent(element);
    expect((await hostIn(element)).text).toBe("source\n    ```");
    expect(draw).toHaveBeenCalledOnce();
  });

  it("contains synchronous and asynchronous failures, ignoring stale failure callbacks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inputs: ContentRendererInput[] = [];
    const { element } = await mount("```diagram\none\n```", renderer((input) => { inputs.push(input); return html`<b>${input.text}</b>`; }));
    let host = await hostIn(element);
    expect(host.shadowRoot?.querySelector("b")?.textContent).toBe("one");
    element.text = "```diagram\ntwo\n```";
    await settleDeferredContent(element);
    host = await hostIn(element);
    await settleDeferredContent(host);
    inputs[0]?.fail(new Error("obsolete"));
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("b")?.textContent).toBe("two");
    inputs[1]?.fail(new Error("current"));
    await settleDeferredContent(host);
    expect(host.shadowRoot?.textContent).toContain("预览失败");
    expect(button(host, "源码").getAttribute("aria-pressed")).toBe("true");
    expect(host.shadowRoot?.querySelector("pre code")?.textContent).toBe("two");
    button(host, "复制源码").click();
    expect(writeClipboardText).toHaveBeenLastCalledWith("two");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("b")?.textContent).toBe("two");
    const failed = await mount("```diagram\nthrow\n```", renderer(() => { throw new Error("sync"); }));
    expect((await hostIn(failed.element)).shadowRoot?.textContent).toContain("预览失败");
  });

  it("rejects accidental async render callbacks without leaking rejected promises", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = renderer();
    Reflect.set(invalid, "render", () => Promise.reject(new Error("async callback is unsupported")));
    const { element } = await mount("```diagram\nsource\n```", invalid);
    const host = await hostIn(element);
    expect(host.shadowRoot?.textContent).toContain("预览失败");
    expect(host.shadowRoot?.querySelector("pre code")?.textContent).toBe("source");
  });

  it("supports nested and tilde fences, full-document reference links, and keeps HTML inert", async () => {
    const { element } = await mount("> ~~~~diagram\n> nested\n> ~~~~\n\n[link][ref]\n\n[ref]: https://example.test\n\n<script>bad()</script>");
    expect((await hostIn(element)).text).toBe("nested");
    expect(element.shadowRoot?.querySelector("a")?.href).toBe("https://example.test/");
    expect(element.shadowRoot?.querySelector("script")).toBeNull();
    element.text = "~~~diagram\nunclosed\n~~";
    await settleDeferredContent(element);
    expect(element.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
  });

  it.each(["manual", "automatic"] as const)("keeps %s Markdown defaults unless consumer activation is supplied", async (renderMode) => {
    const draw = vi.fn(() => html`<b>Preview</b>`);
    const contribution = { ...renderer(draw), renderMode };
    const capability = createContentRenderingCapability(() => [{ id: "diagram", label: "Diagram", renderer: contribution }]);
    const root = document.createElement("div");
    document.body.append(root);
    const request = { machineId: "local", text: "```diagram\nsource\n```", toSafeHtml: renderWorkspaceMarkdownHtml };
    await renderPublicMarkdown(capability.renderMarkdown(request), root);
    const host = root.querySelector<ContentRendererHost>("pi-web-content-renderer");
    if (host === null) throw new Error("Expected fence host");
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledTimes(renderMode === "automatic" ? 1 : 0);
    await renderPublicMarkdown(capability.renderMarkdown({ ...request, allowManualPreview: false }), root);
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledTimes(renderMode === "automatic" ? 1 : 0);
    await renderPublicMarkdown(capability.renderMarkdown({ ...request, allowManualPreview: true }), root);
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledOnce();
    button(host, "源码").click();
    await settleDeferredContent(host);
    await renderPublicMarkdown(capability.renderMarkdown({ ...request, allowManualPreview: true }), root);
    await settleDeferredContent(host);
    expect(host.renderRoot.querySelector("pre")?.textContent).toBe("source");
    expect(draw).toHaveBeenCalledOnce();
  });

  it("retains the Files sanitizer while rendering fences and refuses truncated/oversize plugin input", async () => {
    const select = vi.fn(() => [{ id: "test:diagram", label: "Test / diagram", renderer: renderer() }]);
    const capability = createContentRenderingCapability(select);
    const root = document.createElement("div");
    document.body.append(root);
    const text = "```diagram\nsafe\n```\n\n![tracking](https://evil.test/pixel)\n\n<svg onload=bad()>";
    await renderPublicMarkdown(capability.renderMarkdown({ machineId: "remote", text, toSafeHtml: renderWorkspaceMarkdownHtml }), root);
    expect(root.querySelector("pi-web-content-renderer")).not.toBeNull();
    expect(root.querySelector("img,svg,script")).toBeNull();
    expect(root.textContent).toContain("已省略图片");
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ machineId: "remote", text: "safe", language: "diagram" }));
    await renderPublicMarkdown(capability.renderMarkdown({ machineId: "remote", text, truncated: true, toSafeHtml: renderWorkspaceMarkdownHtml }), root);
    expect(root.querySelector("pi-web-content-renderer")).toBeNull();
    expect(capability.renderText({ machineId: "remote", text: "x".repeat(MAX_CONTENT_RENDERER_LENGTH + 1), filePath: "a.diag" })).toBeUndefined();
    expect(capability.renderText({ machineId: "remote", text: "safe", truncated: true, filePath: "a.diag" })).toBeUndefined();
  });

  it("switches only one diagram, cancels stale work, resets failure and preserves choices during streaming", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inputs: ContentRendererInput[] = [];
    const draw = vi.fn((input: ContentRendererInput) => { inputs.push(input); return html`<b>Alternative</b>`; });
    const { element, registry } = await mount("```diagram\nfirst\n```\n\n```diagram\nsecond\n```");
    await registry.register({ id: "z-other", plugin: { apiVersion: 4, name: "Other", activate: () => ({ contributions: { contentRenderers: [renderer(draw)] } }) } });
    element.contentRendering = registry.getChatContentRendering(element.machineId);
    await settleDeferredContent(element);
    const host = await hostIn(element);
    const second = element.renderRoot.querySelectorAll<ContentRendererHost>("pi-web-content-renderer")[1];
    if (second === undefined) throw new Error("Expected second diagram");
    await settleDeferredContent(second);
    expect(host.renderRoot.querySelector("select")).toBeNull();
    expect([...host.renderRoot.querySelectorAll('.views button')].map((view) => view.textContent.trim()))
      .toEqual(["test / diagram", "z-other / diagram", "源码"]);
    expect(draw).toHaveBeenCalledTimes(2); // New last automatic becomes the default.
    for (const item of [host, second]) {
      button(item, "test / diagram").click();
      await settleDeferredContent(item);
    }
    draw.mockClear();
    inputs.length = 0;
    button(host, "z-other / diagram").click();
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledOnce();
    expect(second.shadowRoot?.querySelector(".diagram")?.textContent).toBe("second");
    element.text += "\n\nStreaming prose";
    await settleDeferredContent(element);
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledOnce();
    expect(button(host, "z-other / diagram").getAttribute("aria-pressed")).toBe("true");
    inputs[0]?.fail(new Error("current"));
    await settleDeferredContent(host);
    expect(host.shadowRoot?.textContent).toContain("预览失败");
    expect(button(host, "源码").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "z-other / diagram").getAttribute("aria-pressed")).toBe("false");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(inputs[0]?.signal.aborted).toBe(true);
    inputs[0]?.fail(new Error("stale"));
    await settleDeferredContent(host);
    expect(host.shadowRoot?.textContent).not.toContain("预览失败");
    expect(host.shadowRoot?.querySelector(".diagram")?.textContent).toBe("first");
    button(host, "复制源码").click();
    expect(writeClipboardText).toHaveBeenLastCalledWith("first");
    button(host, "源码").click();
    await settleDeferredContent(host);
    button(host, "z-other / diagram").click();
    await settleDeferredContent(host);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(button(host, "z-other / diagram").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "源码").getAttribute("aria-pressed")).toBe("false");
    button(host, "test / diagram").click();
    await settleDeferredContent(host);
    expect(inputs[1]?.signal.aborted).toBe(true);
  });
});


describe("preserved local host compatibility", () => {
it("skips open fences, truncated text, and oversize input", async () => {
    const { element: open } = await mount("```diagram\nstill streaming");
    expect(open.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
    expect(isClosedFence({ type: "code", raw: "```diagram\nopen", text: "open" })).toBe(false);
    expect(isClosedFence({ type: "code", raw: "```diagram\nclosed\n```", text: "closed" })).toBe(true);

    const capability = createContentRenderingCapability(() => [{ id: "diagram", label: "图表", renderer: renderer() }]);
    expect(capability.renderText({ machineId: "local", text: "x".repeat(MAX_CONTENT_RENDERER_LENGTH + 1), language: "diagram" })).toBeUndefined();
    expect(capability.renderText({ machineId: "local", text: "closed", language: "diagram", truncated: true })).toBeUndefined();
  });

it("replaces a closed fence and keeps raw source available", async () => {
    const { element } = await mount("```diagram\nA --> B\n```");
    const host = await hostIn(element);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector(".diagram")?.textContent).toBe("A --> B");
    const root = host.shadowRoot;
    if (root === null) throw new Error("Expected renderer shadow root");
    const raw = [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === "源码");
    raw?.click();
    await settleDeferredContent(host);
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

it("resolves the host capability and the files file query", async () => {
    const registry = new PluginRegistry();
    const resolved = vi.fn();
    await registry.register({ id: "consumer", plugin: { apiVersion: 4, name: "消费者", requires: [{ pluginId: "pi-web", id: "content-rendering", version: 1, parse: (value) => value }], activate: () => ({ contributions: {}, start: ({ capabilities }) => { resolved(capabilities.resolve({ pluginId: "pi-web", id: "content-rendering", version: 1, parse: (value) => value })); } }) } });
    expect(resolved).toHaveBeenCalledWith(registry.contentRendering);
  });
});
