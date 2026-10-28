// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentRendererContributionV5, FilePreviewRequest, WorkspaceFilesContextValue } from "../../../plugin-api";
import type { FilePreviewerHost } from "../components/FilePreviewerHost";
import type { ContentRendererHost } from "../components/ContentRendererHost";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";
import { PluginRegistry } from "./registry";
import { adaptPublicPlugin } from "./publicContext";

useDeferredContent();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
const request: FilePreviewRequest = { machineId: "remote", projectId: "project", workspaceId: "workspace", file: {
  path: "source.diagram", content: "diagram", encoding: "utf8", size: 7, modifiedAt: "now", binary: false, truncated: false, language: "diagram",
} };
const unused = (): never => { throw new Error("Unused file operation"); };
const files: WorkspaceFilesContextValue = { readFile: unused, listFiles: unused, writeFile: unused, deleteFile: unused, moveFile: unused };
function plugin(renderers: ContentRendererContributionV5[]) {
  return adaptPublicPlugin({ apiVersion: 5, name: "Diagrams", activate: () => ({ contributions: { contentRenderers: renderers } }) });
}
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing fixture");
  return value;
}
async function mount(registry: PluginRegistry, id: string) {
  const root = document.createElement("div"); document.body.append(root);
  const update = (next = request) => { render(registry.filePreviewing.renderPreview({ ...next, files, previewerId: id, fail: vi.fn() }), root); };
  update();
  const host = required(root.querySelector<FilePreviewerHost>("pi-web-file-previewer"));
  await host.updateComplete;
  const textHost = required(host.shadowRoot?.querySelector<ContentRendererHost>("pi-web-content-renderer"));
  await settleDeferredContent(textHost);
  return { root, host, textHost, update };
}

describe("registry text file preview adapters", () => {
  it("retains qualified IDs, live titles, fallback labels and modes without changing the chat API", async () => {
    const registry = new PluginRegistry(); let title = "Diagram";
    const draw = vi.fn<ContentRendererContributionV5["render"]>(() => html`<b>diagram</b>`);
    await registry.register({ id: "provider", plugin: plugin([
      { id: "diagram", get title() { return title; }, languages: ["diagram"], renderMode: "automatic", render: draw },
      { id: "manual", languages: ["diagram"], render: draw },
    ]) });
    const choices = registry.filePreviewing.listPreviewers(request);
    expect(choices.map(({ id, label, renderMode }) => ({ id, label, renderMode }))).toEqual([
      { id: "provider:diagram", label: "Diagram", renderMode: "automatic" },
      { id: "provider:manual", label: "provider / manual", renderMode: "manual" },
    ]);
    title = "Translated";
    expect(choices[0]?.label).toBe("Translated");
    expect(draw).not.toHaveBeenCalled();
    const mounted = await mount(registry, "provider:manual");
    expect(mounted.textHost.externalControls).toBe(true);
    expect(mounted.textHost.rendererId).toBe("provider:manual");
    expect(mounted.textHost.allowManualPreview).toBe(true);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0]?.[0]).toMatchObject({ text: "diagram", machineId: "remote", filePath: "source.diagram", language: "diagram" });
    const chat = document.createElement("div"); document.body.append(chat);
    render(registry.contentRendering.renderText({ machineId: "remote", text: "chat", language: "diagram" }), chat);
    await settleDeferredContent(required(chat.querySelector<ContentRendererHost>("pi-web-content-renderer")));
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[1]?.[0].text).toBe("chat");
    await registry.dispose();
    expect(draw.mock.calls.every(([input]) => input.signal.aborted)).toBe(true);
  });

  it("adapts legacy v4 renderers using the same callback and qualified ID", async () => {
    const registry = new PluginRegistry();
    const draw = vi.fn(() => html`<b>legacy</b>`);
    await registry.register({ id: "legacy", plugin: { apiVersion: 4, name: "Legacy", activate: () => ({
      contributions: { contentRenderers: [{ id: "diagram", languages: ["diagram"], render: draw }] },
    }) } });
    expect(registry.filePreviewing.listPreviewers(request).map(({ id, label }) => ({ id, label })))
      .toEqual([{ id: "legacy:diagram", label: "legacy / diagram" }]);
    await mount(registry, "legacy:diagram");
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0]).toEqual([expect.objectContaining({ text: "diagram" })]);
    await registry.dispose();
  });

  it("matches only original plain source and honors the text capability's truncation and 100k guard", async () => {
    const registry = new PluginRegistry();
    await registry.register({ id: "provider", plugin: plugin([{ id: "diagram", supports: () => true, render: () => html`` }]) });
    expect(registry.filePreviewing.listPreviewers(request)).toHaveLength(1);
    for (const file of [
      { ...request.file, binary: true },
      ...(["image", "html", "pdf", "markdown"] as const).map((mediaType) => ({ ...request.file, mediaType })),
      { ...request.file, truncated: true },
      { ...request.file, content: "a".repeat(100_001) },
    ]) expect(registry.filePreviewing.listPreviewers({ ...request, file })).toEqual([]);
    expect(registry.filePreviewing.listPreviewers({ ...request, file: { ...request.file, content: "a".repeat(100_000) } })).toHaveLength(1);
    await registry.dispose();
  });

  it("captures provider backend identity and lifetime, shadows portable providers and cancels selection/unmount", async () => {
    const registry = new PluginRegistry({ isContributionEnabled: (_id, machine) => machine !== "disabled" });
    const draw = vi.fn<ContentRendererContributionV5["render"]>(() => html`<b>remote</b>`);
    const contribution = { id: "diagram", languages: ["diagram"], render: draw };
    await registry.register({ id: "provider", plugin: plugin([contribution]) });
    await registry.register({ id: "remote-provider", sourcePluginId: "provider", machineId: "remote", machineSpecific: true,
      backendRevision: "r7", pairedResourceVersion: 1, plugin: plugin([contribution]) });
    expect(registry.filePreviewing.listPreviewers(request).map(({ id }) => id)).toEqual(["remote-provider:diagram"]);
    expect(registry.filePreviewing.listPreviewers({ ...request, machineId: "other" }).map(({ id }) => id)).toEqual(["provider:diagram"]);
    expect(registry.filePreviewing.listPreviewers({ ...request, machineId: "disabled" })).toEqual([]);
    const { root, host, textHost, update } = await mount(registry, "remote-provider:diagram");
    expect(host.previewer?.binding).toMatchObject({ registrationPluginId: "remote-provider", sourcePluginId: "provider", backendRevision: "r7", pairedResourceVersion: 1 });
    const first = required(draw.mock.calls[0]?.[0]);
    update({ ...request, file: { ...request.file } }); await host.updateComplete;
    await settleDeferredContent(textHost);
    expect(draw).toHaveBeenCalledOnce();
    update({ ...request, file: { ...request.file, content: "changed" } }); await host.updateComplete;
    await settleDeferredContent(textHost);
    expect(first.signal.aborted).toBe(true);
    expect(draw).toHaveBeenCalledTimes(2);
    root.remove();
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(true);
    document.body.append(root); await host.updateComplete;
    await settleDeferredContent(required(host.shadowRoot?.querySelector<ContentRendererHost>("pi-web-content-renderer")));
    const current = required(draw.mock.calls.at(-1)?.[0]);
    await registry.dispose();
    expect(current.signal.aborted).toBe(true);
    current.fail("late");
    expect(registry.filePreviewing.listPreviewers(request)).toEqual([]);
  });
});
