// @vitest-environment happy-dom

import type { StylesheetIntegrationCapabilityV1, FileContentResponse, FileTreeResponse, WorkspaceFilesCapabilityV1, WorkspacePanelContext, WorkspacePanelNavigationV1, WriteWorkspaceFileResponse } from "@chainingintention/pi-web-cn/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFilesPanel, startDirectWorkspaceUpload, uploadBatchProgressValue, uploadBatchStatusLabel, workspaceUploadReviewDefaults, workspaceUploadReviewError } from "./FilesPanel";
import { filesLocalizationFixture } from "./filesLocalization.testSupport";
import { chinesePluginLocalization } from "../localization.testSupport";
import { createFilesContent } from "./filesLocalization";
import { WorkspaceFileViewer } from "./FilesViewer";
import type { FileIcon } from "./FileIcon";
import { FilesRuntime, type WorkspaceUploadBatchState } from "./FilesRuntime";
import { defineFilesCustomElements } from "./pi-web-plugin";
import { html, svg } from "lit";
import codexPlugin from "../custom-ui-codex/pi-web-plugin";
import { UiPresentationRuntime } from "../../src/client/src/plugins/uiPresentationRuntime";

function enableCodex(panel: WorkspaceFilesPanel): UiPresentationRuntime {
  const signal = new AbortController().signal;
  const activation = codexPlugin.activate({ apiVersion: 5, pluginId: "custom", runtimePluginId: "custom", html, svg, signal, lifetimeSignal: signal });
  const runtime = new UiPresentationRuntime(() => undefined);
  runtime.register(activation.contributions.uiPresentations.map((entry) => ({ ...entry, pluginId: "custom", active: () => true })));
  panel.presentation = { version: 1, regions: ["files-toolbar"], render: runtime.render.bind(runtime), subscribe: runtime.subscribe.bind(runtime), fail: runtime.fail.bind(runtime) };
  return runtime;
}

defineFilesCustomElements();

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Files panel component boundary", () => {
  it("updates file icons live without replacing rows or directory disclosures and releases subscriptions", async () => {
    const panel = await mountPanel(createContext({ files: createFiles({ listFiles: () => Promise.resolve(treeResponse("", [
      { name: "src", path: "src", type: "directory" },
      { name: "README.md", path: "README.md", type: "file" },
    ])) }) }));
    await vi.waitFor(() => { expect(panel.shadowRoot?.querySelector("pi-web-files-icon")).not.toBeNull(); });
    let url = "https://icons.example/markdown.svg";
    const listeners = new Set<() => void>();
    const release = vi.fn();
    const subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); release(); };
    });
    panel.fileIcons = { resolveIcon: () => url, subscribe };
    await panel.updateComplete;
    const row = buttonWithText(panel.shadowRoot, "README.md");
    const icon = requiredElement(row.querySelector<FileIcon>("pi-web-files-icon"), "file icon");
    expect(icon.url).toBe(url);
    expect(row.querySelector(".ui-file-leading")?.getAttribute("aria-hidden")).toBe("true");
    expect(buttonWithText(panel.shadowRoot, "src").getAttribute("aria-expanded")).toBe("false");
    expect(buttonWithText(panel.shadowRoot, "src").querySelector("pi-web-files-icon")).toBeNull();
    url = "https://icons.example/markdown-light.svg";
    for (const listener of listeners) listener();
    await panel.updateComplete;
    expect(buttonWithText(panel.shadowRoot, "README.md")).toBe(row);
    expect(icon.url).toBe(url);
    panel.remove();
    expect(listeners.size).toBe(0);
    expect(release).toHaveBeenCalledOnce();
    document.body.append(panel);
    await panel.updateComplete;
    expect(subscribe).toHaveBeenCalledTimes(2);
    panel.fileIcons = undefined;
    await panel.updateComplete;
    expect(listeners.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(2);
    expect(icon.url).toBeUndefined();
  });

  it("passes file previewing and the workspace's files helpers to its viewer", async () => {
    const context = createContext();
    const panel = await mountPanel(context);
    const capability = { listPreviewers: vi.fn(() => []), renderPreview: vi.fn(() => undefined) };
    panel.filePreviewing = capability;
    await panel.updateComplete;
    const viewer = panel.renderRoot.querySelector<WorkspaceFileViewer>("pi-web-files-viewer");
    expect(viewer?.filePreviewing).toBe(capability);
    expect(viewer?.files).toBe(context.files);
  });

  it("retranslates an open upload review without changing focus, paths, options or starting an upload", async () => {
    const { service, content } = filesLocalizationFixture("de-DE");
    const uploadFile = vi.fn<WorkspaceFilesCapabilityV1["uploadFile"]>();
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>(() => Promise.resolve(treeResponse("")));
    const panel = await mountPanel(createContext({ files: createFiles({ uploadFile, listFiles }) }));
    panel.content = content;
    panel.runtime?.setLocalization(content.localization);
    await panel.updateComplete;
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x".repeat(1536)], "user <img>.txt")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await panel.updateComplete;
    await panel.updateComplete;
    const destination = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-destination"), "destination");
    destination.value = "user/path";
    destination.dispatchEvent(new Event("input", { bubbles: true }));
    const overwrite = requiredElement(panel.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1], "overwrite");
    overwrite.click();
    destination.focus();
    const calls = listFiles.mock.calls.length;
    expect(panel.shadowRoot?.textContent).toContain("1,5 kB");
    for (const language of ["en-XA", "ar-XB"]) {
      await service.setPreferences({ ...service.preferences, language });
      await panel.updateComplete;
      await panel.updateComplete;
      expect(panel.shadowRoot?.querySelector("dialog")).not.toBeNull();
      expect(panel.shadowRoot?.querySelector("h2")?.textContent).not.toBe("Review file");
      expect(destination.value).toBe("user/path");
      expect(destination.dir).toBe("ltr");
      expect(overwrite.checked).toBe(true);
      expect(panel.shadowRoot?.activeElement).toBe(destination);
      expect(panel.shadowRoot?.textContent).toContain("user <img>.txt");
      expect(panel.shadowRoot?.querySelector("img")).toBeNull();
    }
    destination.value = "../escape";
    destination.dispatchEvent(new Event("input", { bubbles: true }));
    panel.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await panel.updateComplete;
    await service.setPreferences({ ...service.preferences, language: "en" });
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector('[role="alert"]')?.textContent).toBe("upload destination must not contain path traversal");
    await service.setPreferences({ ...service.preferences, language: "en-XA" });
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector('[role="alert"]')?.textContent).not.toBe("upload destination must not contain path traversal");
    expect(destination.value).toBe("../escape");
    expect(uploadFile).not.toHaveBeenCalled();
    expect(listFiles).toHaveBeenCalledTimes(calls);
  });

  it("passes stylesheet integration through viewer and raw-code roots and releases the whole subtree", async () => {
    const context = createContext({
      files: createFiles({ readFile: (path) => Promise.resolve(fileResponse(path)) }),
      navigation: createNavigation({ file: "a.ts", mode: "raw" }),
    });
    const panel = await mountPanel(context);
    const roots = new Set<ShadowRoot>();
    const registerRoot = vi.fn<StylesheetIntegrationCapabilityV1["registerRoot"]>((root) => {
      roots.add(root);
      return () => { roots.delete(root); };
    });
    panel.stylesheetIntegration = {
      registerRoot,
      createController: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    await vi.waitFor(() => { expect(roots.size).toBe(3); });
    const viewer = requiredElement(panel.shadowRoot?.querySelector("pi-web-files-viewer"), "viewer");
    const code = requiredElement(viewer.shadowRoot?.querySelector("pi-web-files-code-viewer"), "raw code");
    expect(roots).toEqual(new Set([panel.shadowRoot, viewer.shadowRoot, code.shadowRoot]));
    expect(registerRoot).toHaveBeenCalledWith(panel.shadowRoot, { sharedUi: true });
    expect(registerRoot).toHaveBeenCalledWith(viewer.shadowRoot);
    expect(registerRoot).toHaveBeenCalledWith(code.shadowRoot);
    panel.remove();
    expect(roots.size).toBe(0);
    document.body.append(panel);
    await vi.waitFor(() => { expect(roots.size).toBe(3); });
    expect(registerRoot).toHaveBeenCalledTimes(6);
  });

  it("rejects retained custom actions after a workspace switch or plugin removal", async () => {
    const panel = await mountPanel(createContext());
    const presentation = enableCodex(panel);
    let actions: readonly import("@chainingintention/pi-web-cn/plugin-api").UiPresentationActionV1[] = [];
    const render = panel.presentation?.render;
    panel.presentation = { ...panel.presentation, version: 1, regions: ["files-toolbar"], render: (context) => { actions = context.actions ?? []; return render?.(context); } };
    await panel.updateComplete;
    const oldCreate = actions.find((action) => action.id === "new-file");
    const prompt = vi.fn<Window["prompt"]>();
    vi.stubGlobal("prompt", prompt);
    panel.context = createContext();
    await oldCreate?.run();
    expect(prompt).not.toHaveBeenCalled();
    await panel.updateComplete;
    const nextCreate = actions.find((action) => action.id === "new-file");
    presentation.clear();
    await nextCreate?.run();
    expect(prompt).not.toHaveBeenCalled();
  });
  it("exposes compact file-row semantics while retaining selected directories", async () => {
    const context = createContext({ files: createFiles({ listFiles: (path) => Promise.resolve(treeResponse(path,
      path === "" ? [{ name: "src", path: "src", type: "directory" }, { name: "README.md", path: "README.md", type: "file" }] : [])) }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(2); });
    const directory = requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>('[title="src"]'), "directory row");
    const file = requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>('[title="README.md"]'), "file row");
    expect(directory.type).toBe("button");
    expect(directory.getAttribute("aria-expanded")).toBe("false");
    expect(file.hasAttribute("aria-expanded")).toBe(false);
    expect(file.querySelector('.ui-file-leading[aria-hidden="true"] pi-web-files-icon')).not.toBeNull();
    directory.click();
    await vi.waitFor(() => { expect(directory.getAttribute("aria-expanded")).toBe("true"); });
    expect(directory.getAttribute("aria-current")).toBe("page");
    expect(panel.runtime?.snapshot(context).selectedDirectoryPath).toBe("src");
    file.click();
    await vi.waitFor(() => { expect(file.getAttribute("aria-current")).toBe("page"); });
    expect(directory.hasAttribute("aria-current")).toBe(false);
  });

  it("reveals a selected file beyond the current 200-row render budget", async () => {
    const context = createContext({ files: createFiles({ listFiles: (path) => Promise.resolve(treeResponse(path,
      Array.from({ length: 1000 }, (_, index) => ({ name: `file-${String(index)}.txt`, path: `file-${String(index)}.txt`, type: "file" })))) }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(200); });
    buttonWithText(panel.shadowRoot, "显示更多").click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(400);
    panel.context = { ...context, navigation: createNavigation({ file: "file-899.txt" }) };
    await vi.waitFor(() => { expect(panel.shadowRoot?.querySelector(".row.selected")?.textContent).toContain("file-899.txt"); });
    expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(1000);
  });

  it("retains incremental tree rendering with an explicit load-more fallback", async () => {
    const context = createContext({ files: createFiles({ listFiles: (path) => Promise.resolve(treeResponse(path,
      Array.from({ length: 250 }, (_, index) => ({ name: `file-${String(index)}.txt`, path: `file-${String(index)}.txt`, type: "file" })))) }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(200); });
    buttonWithText(panel.shadowRoot, "显示更多").click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(250);
  });

  it("wires create, move, delete confirmation and scoped download without host-private callbacks", async () => {
    const writeFile = vi.fn<WorkspaceFilesCapabilityV1["writeFile"]>((path) => Promise.resolve({ path, size: 0, modifiedAt: "now", created: true }));
    const moveFile = vi.fn<WorkspaceFilesCapabilityV1["moveFile"]>((fromPath, toPath) => Promise.resolve({ fromPath, toPath, size: 0, modifiedAt: "now", overwritten: false }));
    const deleteFile = vi.fn<WorkspaceFilesCapabilityV1["deleteFile"]>((path) => Promise.resolve({ path, existed: true }));
    const context = createContext({ files: createFiles({ writeFile, moveFile, deleteFile }) });
    const panel = await mountPanel(context);
    const prompt = vi.fn<Window["prompt"]>().mockReturnValueOnce("new.txt").mockReturnValueOnce("renamed.txt");
    enableCodex(panel);
    await panel.updateComplete;
    vi.stubGlobal("prompt", prompt);
    requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='新建文件']"), "new file").click();
    await vi.waitFor(() => { expect(panel.runtime?.snapshot(context).selectedFilePath).toBe("new.txt"); });
    await panel.updateComplete;
    const download = requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='下载文件']"), "download");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.href).toContain("new.txt"); });
    download.click();
    expect(click).toHaveBeenCalledOnce();
    requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='移动或重命名']"), "move").click();
    await vi.waitFor(() => { expect(panel.runtime?.snapshot(context).selectedFilePath).toBe("renamed.txt"); });
    await panel.updateComplete;
    const confirm = vi.fn<Window["confirm"]>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const remove = requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='删除文件或文件夹']"), "delete");
    remove.click();
    expect(deleteFile).not.toHaveBeenCalled();
    remove.click();
    await vi.waitFor(() => { expect(deleteFile).toHaveBeenCalledExactlyOnceWith("renamed.txt"); });
    expect(confirm).toHaveBeenCalledWith("删除文件 renamed.txt？此操作无法撤销。");
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(moveFile).toHaveBeenCalledExactlyOnceWith("new.txt", "renamed.txt", { overwrite: false });
  });

  it("selects directories, creates children and disables unsupported directory mutations", async () => {
    const createDirectory = vi.fn((path: string) => Promise.resolve({ path }));
    const files = createFiles({ createDirectory, listFiles: (path) => Promise.resolve(treeResponse(path,
      path === "" ? [{ name: "src", path: "src", type: "directory" }] : [])) });
    const context = createContext({ files });
    const panel = await mountPanel(context);
    enableCodex(panel);
    await panel.updateComplete;
    await vi.waitFor(() => { expect(panel.shadowRoot?.textContent).toContain("src"); });
    buttonWithText(panel.shadowRoot, "src").click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("已选择文件夹：src");
    expect(requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='移动或重命名']"), "move").disabled).toBe(true);
    const prompt = vi.fn<Window["prompt"]>().mockReturnValue("src/child");
    vi.stubGlobal("prompt", prompt);
    requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("[aria-label='新建文件夹']"), "new directory").click();
    await vi.waitFor(() => { expect(createDirectory).toHaveBeenCalledExactlyOnceWith("src/child"); });
    expect(prompt).toHaveBeenCalledWith("新建文件夹路径", "src/new-folder");
  });

  it("loads and renders the tree, wires expansion/selection, and passes content to the viewer", async () => {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path) => Promise.resolve(path === ""
      ? treeResponse("", [{ name: "src", path: "src", type: "directory" }, { name: "README.md", path: "README.md", type: "file" }])
      : treeResponse(path, [{ name: "main.ts", path: "src/main.ts", type: "file" }])));
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path)));
    const context = createContext({ files: createFiles({ listFiles, readFile }) });
    const panel = await mountPanel(context);

    await vi.waitFor(() => { expect(panel.shadowRoot?.textContent).toContain("README.md"); });
    expect(buttonWithText(panel.shadowRoot, "src").getAttribute("aria-expanded")).toBe("false");
    buttonWithText(panel.shadowRoot, "src").click();
    await vi.waitFor(() => { expect(buttonWithText(panel.shadowRoot, "main.ts")).toBeDefined(); });
    expect(buttonWithText(panel.shadowRoot, "src").getAttribute("aria-expanded")).toBe("true");
    buttonWithText(panel.shadowRoot, "README.md").click();
    await vi.waitFor(() => {
      expect(buttonWithText(panel.shadowRoot, "README.md").getAttribute("aria-current")).toBe("page");
      const viewer = requiredElement(panel.shadowRoot?.querySelector<HTMLElement & { selectedPath?: string; file?: FileContentResponse }>("pi-web-files-viewer"), "Files viewer");
      expect(viewer.selectedPath).toBe("README.md");
      expect(viewer.file?.content).toBe("contents:README.md");
    });
    const expansionCall = listFiles.mock.calls.find(([path]) => path === "src");
    expect(expansionCall).toBeDefined();
    expect(expansionCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(readFile.mock.calls[0]?.[0]).toBe("README.md");
    expect(readFile.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reveals a nested link once without moving focus, then preserves manual collapse on reconnect", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      requiredElement(this.closest<HTMLElement>(".list.tree"), "tree list").scrollTop = 143;
    });
    const context = nestedContext();
    const runtime = new FilesRuntime();
    const acknowledge = vi.spyOn(runtime, "acknowledgeReveal");
    const panel = await mountPanel(context, runtime);
    const upload = buttonWithText(panel.shadowRoot, "Upload");
    upload.focus();
    const linked = { ...context, navigation: createNavigation({ file: "src/deep/main.ts" }) };
    await runtime.invalidate(linked);
    await panel.updateComplete;
    await vi.waitFor(() => { expect(scrollIntoView).toHaveBeenCalledOnce(); });
    const row = buttonWithText(panel.shadowRoot, "main.ts");
    expect(scrollIntoView.mock.instances[0]).toBe(row);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(linked, expect.any(Number), 143);
    expect(panel.shadowRoot?.activeElement).toBe(upload);
    panel.requestUpdate();
    await panel.updateComplete;
    expect(scrollIntoView).toHaveBeenCalledOnce();

    buttonWithText(panel.shadowRoot, "src").click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector('[title="src/deep/main.ts"]')).toBeNull();
    panel.remove();
    document.body.append(panel);
    await panel.updateComplete;
    await vi.waitFor(() => { expect(runtime.snapshot(linked).treeLoading).toBe(false); });
    expect(buttonWithText(panel.shadowRoot, "src").getAttribute("aria-expanded")).toBe("false");
    expect(panel.shadowRoot?.querySelector('[title="src/deep/main.ts"]')).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("shows expansion intent before the directory listing has loaded", async () => {
    let finishDirectory: (value: FileTreeResponse) => void = () => undefined;
    const context = createContext({ files: createFiles({ listFiles: (path) => path === ""
      ? Promise.resolve(treeResponse("", [{ name: "src", path: "src", type: "directory" }]))
      : new Promise((resolve) => { finishDirectory = resolve; }) }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(buttonWithText(panel.shadowRoot, "src")).toBeDefined(); });
    buttonWithText(panel.shadowRoot, "src").click();
    await panel.updateComplete;
    expect(buttonWithText(panel.shadowRoot, "src").getAttribute("aria-expanded")).toBe("true");
    expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(1);
    finishDirectory(treeResponse("src", [{ name: "main.ts", path: "src/main.ts", type: "file" }]));
    await vi.waitFor(() => { expect(buttonWithText(panel.shadowRoot, "main.ts")).toBeDefined(); });
  });

  it("does not overwrite remembered scroll when disconnected before restoration", async () => {
    const context = createContext({ files: createFiles({ listFiles: () => new Promise(() => undefined) }) });
    const runtime = new FilesRuntime();
    runtime.rememberScroll(context, 280);
    const panel = await mountPanel(context, runtime);
    const list = requiredElement(panel.shadowRoot?.querySelector<HTMLElement>(".list.tree"), "tree list");
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
    panel.remove();
    expect(runtime.snapshot(context).scrollTop).toBe(280);
  });

  it("opens tree clicks in place without issuing a reveal", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const context = nestedContext();
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(buttonWithText(panel.shadowRoot, "README.md")).toBeDefined(); });
    buttonWithText(panel.shadowRoot, "README.md").click();
    await panel.updateComplete;
    expect(buttonWithText(panel.shadowRoot, "README.md").getAttribute("aria-current")).toBe("page");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("remembers scroll events and restores on reconnect without reapplying it on updates", async () => {
    const context = nestedContext();
    const runtime = new FilesRuntime();
    const panel = await mountPanel(context, runtime);
    await vi.waitFor(() => { expect(runtime.snapshot(context).treeLoading).toBe(false); });
    await panel.updateComplete;
    const list = requiredElement(panel.shadowRoot?.querySelector<HTMLElement>(".list.tree"), "tree list");
    list.scrollTop = 215;
    list.dispatchEvent(new Event("scroll"));
    expect(runtime.snapshot(context).scrollTop).toBe(215);
    // Real browsers expose zero scroll geometry as soon as the host detaches.
    let visibleScrollTop = 215;
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => panel.isConnected ? visibleScrollTop : 0,
      set: (value: number) => { visibleScrollTop = value; },
    });
    panel.remove();
    list.dispatchEvent(new Event("scroll"));
    expect(runtime.snapshot(context).scrollTop).toBe(215);
    list.scrollTop = 0;
    document.body.append(panel);
    await panel.updateComplete;
    await vi.waitFor(() => { expect(list.scrollTop).toBe(215); });
    list.scrollTop = 180;
    panel.requestUpdate();
    await panel.updateComplete;
    expect(list.scrollTop).toBe(180);
  });

  it("preserves the previous workspace's scroll before reusing the list and waits for the new tree", async () => {
    const first = nestedContext();
    let finishTree: (value: FileTreeResponse) => void = () => undefined;
    const second = { ...createContext({ files: createFiles({ listFiles: () => new Promise((resolve) => { finishTree = resolve; }) }) }), workspace: { ...first.workspace, id: "workspace-2" } };
    const runtime = new FilesRuntime();
    runtime.rememberScroll(second, 340);
    const panel = await mountPanel(first, runtime);
    await vi.waitFor(() => { expect(runtime.snapshot(first).treeLoading).toBe(false); });
    await panel.updateComplete;
    const list = requiredElement(panel.shadowRoot?.querySelector<HTMLElement>(".list.tree"), "tree list");
    list.scrollTop = 125; // No scroll event: switching must capture the outgoing DOM.
    panel.context = second;
    await panel.updateComplete;
    expect(runtime.snapshot(first).scrollTop).toBe(125);
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
    expect(runtime.snapshot(second).scrollTop).toBe(340);
    finishTree(treeResponse("", [{ name: "other.ts", path: "other.ts", type: "file" }]));
    await vi.waitFor(() => { expect(list.scrollTop).toBe(340); });
    panel.context = first;
    await panel.updateComplete;
    await vi.waitFor(() => { expect(list.scrollTop).toBe(125); });
  });

  it("leaves hidden reveals pending until responsive visibility returns", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const context = nestedContext();
    const runtime = new FilesRuntime();
    const panel = await mountPanel(context, runtime);
    Object.defineProperty(panel, "getClientRects", { configurable: true, value: () => [] });
    await runtime.selectFile(context, "src/deep/main.ts", "reveal");
    await panel.updateComplete;
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(runtime.snapshot(context).revealRequest).toBeDefined();
    Object.defineProperty(panel, "getClientRects", { configurable: true, value: visibleClientRects });
    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => { expect(scrollIntoView).toHaveBeenCalledOnce(); });
    expect(runtime.snapshot(context).revealRequest).toBeUndefined();
  });

  it("adopts query-only back and forward contexts delivered through invalidation", async () => {
    const files = createFiles({ readFile: (path) => Promise.resolve({ ...fileResponse(path), mediaType: "markdown" }) });
    const first = createContext({ files, navigation: createNavigation({ file: "a.md", mode: "raw" }) });
    const runtime = new FilesRuntime();
    const panel = await mountPanel(first, runtime);
    panel.filePreviewing = {
      listPreviewers: () => [{ id: "fixture:markdown", label: "预览", renderMode: "manual" }],
      renderPreview: () => html`<p>Markdown fixture</p>`,
    };
    await vi.waitFor(() => {
      const viewer = requiredElement(panel.shadowRoot?.querySelector<HTMLElement>("pi-web-files-viewer"), "Files viewer");
      expect(buttonWithText(viewer.shadowRoot, "源码").getAttribute("aria-pressed")).toBe("true");
    });

    const restored = { ...first, navigation: createNavigation({ file: "b.md", mode: "preview" }) };
    await runtime.invalidate(restored);

    await vi.waitFor(() => {
      const viewer = requiredElement(panel.shadowRoot?.querySelector<HTMLElement & { file?: FileContentResponse }>("pi-web-files-viewer"), "Files viewer");
      expect(viewer.file?.path).toBe("b.md");
      expect(buttonWithText(viewer.shadowRoot, "预览").getAttribute("aria-pressed")).toBe("true");
    });
    expect(panel.context).toBe(restored);
  });

  it("cancels an obsolete selected-file request on disconnect and restores it on reconnect", async () => {
    const signals: AbortSignal[] = [];
    let readCount = 0;
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path, options) => {
      readCount += 1;
      const signal = options?.signal ?? new AbortController().signal;
      signals.push(signal);
      if (readCount > 1) return Promise.resolve(fileResponse(path));
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { reject(new DOMException("cancelled", "AbortError")); }, { once: true });
      });
    });
    const context = createContext({ files: createFiles({
      readFile,
      listFiles: () => Promise.resolve(treeResponse("", [{ name: "README.md", path: "README.md", type: "file" }])),
    }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(panel.shadowRoot?.textContent).toContain("README.md"); });
    buttonWithText(panel.shadowRoot, "README.md").click();
    await vi.waitFor(() => { expect(readFile).toHaveBeenCalledOnce(); });

    panel.remove();
    expect(signals[0]?.aborted).toBe(true);
    panel.context = { ...context, navigation: { ...createNavigation(), query: { file: "README.md" } } };
    document.body.append(panel);

    await vi.waitFor(() => { expect(readFile).toHaveBeenCalledTimes(2); });
    await vi.waitFor(() => {
      const viewer = requiredElement(panel.shadowRoot?.querySelector<HTMLElement & { file?: FileContentResponse }>("pi-web-files-viewer"), "Files viewer");
      expect(viewer.file?.content).toBe("contents:README.md");
    });
  });

  it("cancels an unobserved tree request on disconnect and reloads it on reconnect", async () => {
    const signals: AbortSignal[] = [];
    let listCount = 0;
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path, options) => {
      listCount += 1;
      const signal = options?.signal ?? new AbortController().signal;
      signals.push(signal);
      if (listCount > 1) return Promise.resolve(treeResponse(path, [{ name: "README.md", path: "README.md", type: "file" }]));
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { reject(new DOMException("cancelled", "AbortError")); }, { once: true });
      });
    });
    const context = createContext({ files: createFiles({ listFiles }) });
    const panel = await mountPanel(context);
    await vi.waitFor(() => { expect(listFiles).toHaveBeenCalledOnce(); });

    panel.remove();
    expect(signals[0]?.aborted).toBe(true);
    document.body.append(panel);

    await vi.waitFor(() => { expect(listFiles).toHaveBeenCalledTimes(2); });
    await vi.waitFor(() => { expect(panel.shadowRoot?.textContent).toContain("README.md"); });
    expect(signals[1]?.aborted).toBe(false);
  });

  it("uses a native modal dialog for upload review and restores trigger focus on close", async () => {
    const context = createContext();
    const panel = await mountPanel(context);
    const upload = buttonWithText(panel.shadowRoot, "Upload");
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    upload.focus();
    upload.click();
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["hello"], "hello.txt")] });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    await panel.updateComplete;

    const dialog = requiredElement(panel.shadowRoot?.querySelector<HTMLDialogElement>("dialog.upload-dialog"), "upload dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.matches("[open]")).toBe(true);
    expect(panel.shadowRoot?.activeElement?.id).toBe("workspace-upload-destination");

    dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
    expect(panel.shadowRoot?.activeElement).toBe(upload);
  });

  it("closes upload review without refocusing a hidden trigger when responsive layout hides the panel", async () => {
    const panel = await mountPanel(createContext());
    const upload = buttonWithText(panel.shadowRoot, "Upload");
    const focus = vi.spyOn(upload, "focus");
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    upload.click();
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["hello"], "hello.txt")] });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector<HTMLDialogElement>("dialog.upload-dialog")?.open).toBe(true);

    Object.defineProperty(panel, "getClientRects", { configurable: true, value: () => [] });
    focus.mockClear();
    window.dispatchEvent(new Event("resize"));
    await panel.updateComplete;
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    panel.requestUpdate();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
  });

  it("drops chooser results that arrive after responsive layout hides the panel", async () => {
    const panel = await mountPanel(createContext());
    const upload = buttonWithText(panel.shadowRoot, "Upload");
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    const focus = vi.spyOn(upload, "focus");

    upload.click();
    Object.defineProperty(panel, "getClientRects", { configurable: true, value: () => [] });
    window.dispatchEvent(new Event("resize"));
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["later"], "later.txt")] });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    Object.defineProperty(panel, "getClientRects", { configurable: true, value: visibleClientRects });
    panel.requestUpdate();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
  });

  it("renders a many-file review with native close, cancel, and submit controls", async () => {
    const panel = await mountPanel(createContext());
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    const files = Array.from({ length: 20 }, (_value, index) => new File(["content"], `file-${String(index)}.txt`));
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    await panel.updateComplete;

    const dialog = requiredElement(panel.shadowRoot?.querySelector<HTMLDialogElement>("dialog.upload-dialog"), "upload dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll(".review-file")).toHaveLength(20);
    expect(requiredElement(dialog.querySelector<HTMLButtonElement>(".close-button"), "close button").getAttribute("aria-label")).toBe("取消上传");
    expect(requiredElement(dialog.querySelector<HTMLButtonElement>("button[type='submit']"), "upload submit button").textContent).toContain("上传");

    buttonWithText(dialog, "Cancel").click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("dialog.upload-dialog")).toBeNull();
  });

  it("submits reviewed files with safe defaults and renders upload completion", async () => {
    let resolveUpload: (response: WriteWorkspaceFileResponse) => void = () => undefined;
    const uploadFile = vi.fn<WorkspaceFilesCapabilityV1["uploadFile"]>((file, options) => ({
      path: `${options?.destinationFolder ?? ""}/${file.name}`,
      completed: new Promise((resolve) => { resolveUpload = resolve; }),
      cancel: vi.fn(),
    }));
    const context = createContext({ files: createFiles({ uploadFile }) });
    const panel = await mountPanel(context);
    const input = requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("#workspace-upload-input"), "upload input");
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["hello"], "hello.txt")] });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    await panel.updateComplete;

    requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("dialog button[type='submit']"), "upload submit button").click();
    await vi.waitFor(() => { expect(uploadFile).toHaveBeenCalledOnce(); });
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: "hello.txt" }), expect.objectContaining({
      destinationFolder: ".pi-web/uploads",
      createDirs: true,
      overwrite: false,
    }));

    resolveUpload(writeResponse(".pi-web/uploads/hello.txt"));
    await vi.waitFor(() => { expect(panel.shadowRoot?.textContent).toContain("已上传 1 个文件"); });
    expect(panel.shadowRoot?.textContent).toContain("完成");
  });

  it("surfaces a bounded capability error instead of calling unsupported host methods", async () => {
    const context = createContext({ files: legacyFiles(), navigation: null });
    const panel = await mountPanel(context);

    expect(panel.shadowRoot?.querySelector("[role='alert']")?.textContent).toContain("工作区文件能力 v1");
    expect(panel.shadowRoot?.querySelector(".split")).toBeNull();
  });
});

describe("Files upload helpers", () => {
  it("validates destinations and uses the host-effective folder for direct drops", () => {
    expect(workspaceUploadReviewDefaults("project/uploads")).toEqual({ destinationFolder: "project/uploads", createDirs: true, overwrite: false });
    expect(workspaceUploadReviewError([], "project/uploads")).toBe("Choose at least one file to upload.");
    expect(workspaceUploadReviewError([new File(["a"], "a.txt")], "../outside")).toContain("traversal");

    const runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1" });
    const context = createContext();
    const run = startDirectWorkspaceUpload(runtime, context, [new File(["a"], "a.txt")]);
    expect(run?.batchId).toBe("batch-1");
    expect(runtime.snapshot(context).uploadBatches["batch-1"]?.destinationFolder).toBe(".pi-web/uploads");
  });

  it("shows terminal batch labels at full progress", () => {
    const failed = uploadBatch({ status: "error", percent: 0.31 });
    expect(uploadBatchStatusLabel(failed, filesLocalizationFixture().content)).toBe("Failed");
    expect(uploadBatchProgressValue(failed)).toBe(1);
    const uploading = uploadBatch({ status: "uploading", percent: 0.31 });
    expect(uploadBatchStatusLabel(uploading, filesLocalizationFixture().content)).toBe("31%");
    expect(uploadBatchProgressValue(uploading)).toBe(0.31);
  });
});

async function mountPanel(context: WorkspacePanelContext, runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1", now: () => "now" })): Promise<WorkspaceFilesPanel> {
  const panel = new WorkspaceFilesPanel();
  panel.content = createFilesContent(await chinesePluginLocalization("files"));
  runtime.setLocalization(panel.content.localization);
  panel.context = context;
  panel.runtime = runtime;
  // happy-dom has no layout engine; component visibility is an explicit
  // browser boundary for the responsive native-modal guard.
  Object.defineProperty(panel, "getClientRects", { configurable: true, value: visibleClientRects });
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function nestedContext(): WorkspacePanelContext {
  return createContext({ files: createFiles({
    readFile: (path) => Promise.resolve({ ...fileResponse(path), binary: true, content: "" }),
    listFiles: (path) => Promise.resolve(treeResponse(path, path === ""
    ? [{ name: "src", path: "src", type: "directory" }, { name: "README.md", path: "README.md", type: "file" }]
    : path === "src"
      ? [{ name: "deep", path: "src/deep", type: "directory" }]
      : [{ name: "main.ts", path: "src/deep/main.ts", type: "file" }])) }) });
}

interface ContextOptions {
  files?: WorkspacePanelContext["files"];
  navigation?: WorkspacePanelNavigationV1 | null;
}

function createContext(options: ContextOptions = {}): WorkspacePanelContext {
  return {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true },
    files: options.files ?? createFiles(),
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
    ...(options.navigation === null ? {} : { navigation: options.navigation ?? createNavigation() }),
  };
}

function createFiles(overrides: Partial<WorkspaceFilesCapabilityV1> = {}): WorkspaceFilesCapabilityV1 {
  return {
    capabilityVersion: 1,
    defaultUploadFolder: ".pi-web/uploads",
    maxInlinePreviewBytes: 1024 * 1024,
    readFile: (path) => Promise.resolve(fileResponse(path)),
    listFiles: (path) => Promise.resolve(treeResponse(path)),
    writeFile: () => Promise.reject(new Error("not implemented")),
    deleteFile: () => Promise.reject(new Error("not implemented")),
    moveFile: () => Promise.reject(new Error("not implemented")),
    previewUrl: (path) => `https://example.test/preview/${encodeURIComponent(path)}`,
    downloadUrl: (path) => `https://example.test/download/${encodeURIComponent(path)}`,
    uploadFile: () => ({ path: "pending", completed: new Promise(() => undefined), cancel: vi.fn() }),
    ...overrides,
  };
}

function legacyFiles(): WorkspacePanelContext["files"] {
  return {
    readFile: (path) => Promise.resolve(fileResponse(path)),
    listFiles: (path) => Promise.resolve(treeResponse(path)),
    writeFile: () => Promise.reject(new Error("not implemented")),
    deleteFile: () => Promise.reject(new Error("not implemented")),
    moveFile: () => Promise.reject(new Error("not implemented")),
  };
}

function createNavigation(query: WorkspacePanelNavigationV1["query"] = {}): WorkspacePanelNavigationV1 {
  return { version: 1, contributionId: "files:workspace.files", query, set: vi.fn() };
}

function treeResponse(path: string, entries: FileTreeResponse["entries"] = []): FileTreeResponse {
  return { path, entries, scannedAt: "now", truncated: false };
}

function fileResponse(path: string): FileContentResponse {
  const content = `contents:${path}`;
  return { path, encoding: "utf8", size: content.length, modifiedAt: "now", content, truncated: false, binary: false };
}

function writeResponse(path: string): WriteWorkspaceFileResponse {
  return { path, size: 5, modifiedAt: "now", created: true };
}

function uploadBatch(patch: Partial<WorkspaceUploadBatchState> = {}): WorkspaceUploadBatchState {
  return {
    id: "batch-1",
    destinationFolder: ".pi-web/uploads",
    overwrite: false,
    createDirs: true,
    files: [],
    currentFileIndex: -1,
    loaded: 0,
    total: 0,
    percent: 0,
    status: "uploading",
    startedAt: "now",
    ...patch,
  };
}

function visibleClientRects(): DOMRect[] {
  return [new DOMRect(0, 0, 800, 600)];
}

function buttonWithText(root: ParentNode | null | undefined, text: string): HTMLButtonElement {
  const button = [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((candidate) => candidate.textContent.trim().endsWith(text === "Upload" ? "上传" : text === "Cancel" ? "取消" : text) || (text === "Upload" && candidate.getAttribute("aria-label") === "上传文件"));
  return requiredElement(button, `${text} button`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
