// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilePreviewerContribution, FilePreviewerInput, FilePreviewRequest, WorkspaceFilesContextValue } from "../../../plugin-api";
import type { FilePreviewerHost } from "../components/FilePreviewerHost";
import { PluginRegistry } from "./registry";
import { adaptPublicPlugin } from "./publicContext";
import { filePreviewingCapabilityToken } from "./filePreviewing";

const request: FilePreviewRequest = { machineId: "remote", projectId: "project", workspaceId: "workspace", file: {
  path: "demo.PDF", encoding: "utf8", size: 3, modifiedAt: "now", content: "abc", truncated: false, binary: true, mimeType: "application/pdf",
} };
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test fixture value is missing");
  return value;
}

function unusedFileOperation(): never {
  throw new Error("Workspace file operations are unused in previewer tests");
}

const files: WorkspaceFilesContextValue = {
  readFile: unusedFileOperation,
  listFiles: unusedFileOperation,
  writeFile: unusedFileOperation,
  deleteFile: unusedFileOperation,
  moveFile: unusedFileOperation,
};
const contribution = (changes: Partial<FilePreviewerContribution> = {}): FilePreviewerContribution => ({ id: "preview", title: "PDF", fileExtensions: ["pdf"], render: () => html`<p>Preview</p>`, ...changes });
const plugin = (filePreviewers: FilePreviewerContribution[]) => adaptPublicPlugin({ apiVersion: 5, name: "Preview", activate: () => ({ contributions: { filePreviewers } }) });
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

async function mount(registry: PluginRegistry, fail = vi.fn(), source = request) {
  const root = document.createElement("div"); document.body.append(root);
  const update = (next = source, previewerId = "provider:preview") => {
    render(registry.filePreviewing.renderPreview({ ...next, previewerId, files, fail }), root);
  };
  update();
  const host = required(root.querySelector<FilePreviewerHost>("pi-web-file-previewer"));
  await host.updateComplete;
  return { host, update, root, fail };
}

describe("file previewing", () => {
  it("publishes a dynamic host capability, immutable snapshots and localized display getters", async () => {
    const registry = new PluginRegistry(); const resolved = vi.fn();
    await registry.register({ id: "consumer", plugin: { ...plugin([]), requires: [filePreviewingCapabilityToken], activate: () => ({ contributions: {}, start: ({ capabilities }) => { resolved(capabilities.resolve(filePreviewingCapabilityToken)); } }) } });
    expect(resolved).toHaveBeenCalledWith(registry.filePreviewing);
    expect(registry.filePreviewing.listPreviewers(request)).toEqual([]);
    let title = "PDF"; const supports = vi.fn((input: FilePreviewRequest) => { expect(Object.isFrozen(input.file)).toBe(true); return true; });
    const value = { ...contribution({ supports }), get title() { return title; } };
    await registry.register({ id: "provider", plugin: plugin([value]) });
    const option = required(registry.filePreviewing.listPreviewers(request)[0]);
    title = "Document"; value.fileExtensions = ["txt"];
    expect(option.title).toBe("Document"); expect(option.label).toBe("Document");
    expect(registry.filePreviewing.listPreviewers(request)).toHaveLength(1);
    expect(registry.filePreviewing.listPreviewers({ ...request, file: { ...request.file, path: "other.txt" } })).toEqual([]);
    await registry.dispose(); expect(registry.filePreviewing.listPreviewers(request)).toEqual([]);
  });

  it.each([
    { title: "" }, { render: null }, { supports: true }, { renderMode: "bad" },
    { fileExtensions: [".pdf"] }, { mimeTypes: ["application"] }, { fileExtensions: [] },
  ])("rejects malformed contributions transactionally: %j", async (invalid) => {
    const registry = new PluginRegistry();
    const invalidContribution = contribution({ id: "bad" });
    // Model malformed contributions arriving from an untyped plugin.
    for (const [key, value] of Object.entries(invalid)) Reflect.set(invalidContribution, key, value);
    await expect(registry.register({ id: "provider", plugin: plugin([contribution(), invalidContribution]) })).rejects.toThrow();
    expect(registry.filePreviewing.listPreviewers(request)).toEqual([]);
    await registry.dispose();
  });

  it("rejects v4 contributions and applies remote shadowing and activity gates", async () => {
    const registry = new PluginRegistry({ isContributionEnabled: (_id, machine) => machine !== "disabled" });
    await expect(registry.register({ id: "legacy", plugin: { apiVersion: 4, name: "Old", activate: () => ({ contributions: { filePreviewers: [contribution()] } }) } })).rejects.toThrow(/v5/u);
    await registry.register({ id: "provider", plugin: plugin([contribution()]) });
    await registry.register({ id: "remote-provider", sourcePluginId: "provider", machineId: "remote", machineSpecific: true, plugin: plugin([contribution()]) });
    expect(registry.filePreviewing.listPreviewers(request).map(({ id }) => id)).toEqual(["remote-provider:preview"]);
    expect(registry.filePreviewing.listPreviewers({ ...request, machineId: "elsewhere" }).map(({ id }) => id)).toEqual(["provider:preview"]);
    expect(registry.filePreviewing.listPreviewers({ ...request, machineId: "disabled" })).toEqual([]);
    expect(registry.filePreviewing.renderPreview({ ...request, files, fail: vi.fn(), previewerId: "provider:preview" })).toBeUndefined();
    await registry.dispose();
  });

  it("matches MIME wildcards, supports-only and contains predicate failures", async () => {
    const registry = new PluginRegistry(); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await registry.register({ id: "provider", plugin: plugin([
      contribution({ id: "mime", fileExtensions: [], mimeTypes: ["application/*"] }),
      contribution({ id: "predicate", fileExtensions: [], supports: () => true }),
      contribution({ id: "throw", supports: () => { throw new Error("bad"); } }),
      contribution({ id: "restricted", supports: () => false }),
    ]) });
    expect(registry.filePreviewing.listPreviewers(request).map(({ id }) => id)).toEqual(["provider:mime", "provider:predicate"]);
    expect(warning).toHaveBeenCalled(); await registry.dispose();
  });

  it("preserves render lifetime across parent updates and cancels changed files, selection, unmount and disposal", async () => {
    const registry = new PluginRegistry(); const inputs: FilePreviewerInput[] = [];
    const renderPreview = vi.fn((input: FilePreviewerInput) => { inputs.push(input); return html`<p>Document</p>`; });
    await registry.register({ id: "provider", backendRevision: "revision", pairedResourceVersion: 1, plugin: plugin([contribution({ render: renderPreview }), contribution({ id: "other", render: renderPreview })]) });
    registry.filePreviewing.listPreviewers(request); expect(renderPreview).not.toHaveBeenCalled();
    const { host, update, root, fail } = await mount(registry);
    expect(host.shadowRoot?.textContent).toContain("Document"); expect(inputs).toHaveLength(1);
    const backend = required(required(inputs[0]).backend);
    const scope = backend.forScope({ kind: "workspace", projectId: request.projectId, workspaceId: request.workspaceId });
    const url = required(scope.resourceUrl?.("document", { path: request.file.path }));
    expect(url).toContain("/paired-plugin-backends/provider/"); expect(url).toContain("revision=revision"); expect(url).toContain("/machines/remote/");
    update({ ...request, file: { ...request.file } }); await host.updateComplete;
    expect(inputs).toHaveLength(1); expect(required(inputs[0]).signal.aborted).toBe(false);
    update({ ...request, file: { ...request.file, modifiedAt: "later" } }); await host.updateComplete;
    expect(required(inputs[0]).signal.aborted).toBe(true); required(inputs[0]).fail("obsolete"); expect(fail).not.toHaveBeenCalled();
    update(request, "provider:other"); await host.updateComplete;
    expect(required(inputs[1]).signal.aborted).toBe(true);
    root.remove(); expect(required(inputs[2]).signal.aborted).toBe(true);
    document.body.append(root); await host.updateComplete;
    await registry.dispose(); expect(required(inputs.at(-1)).signal.aborted).toBe(true);
  });

  it("forwards synchronous and asynchronous failures only from current renders", async () => {
    const registry = new PluginRegistry(); let input: FilePreviewerInput | undefined;
    await registry.register({ id: "provider", plugin: plugin([contribution({ render: (value) => { input = value; return html`ok`; } })]) });
    const mounted = await mount(registry); required(input).fail("async"); await mounted.host.updateComplete;
    expect(mounted.fail).toHaveBeenCalledWith("async"); expect(required(input).signal.aborted).toBe(true);
    await registry.dispose();
    const throwing = new PluginRegistry();
    await throwing.register({ id: "provider", plugin: plugin([contribution({ render: () => { throw new Error("sync"); } })]) });
    const failed = await mount(throwing); expect(failed.fail).toHaveBeenCalledWith(expect.objectContaining({ message: "sync" }));
    await throwing.dispose();
  });
});
