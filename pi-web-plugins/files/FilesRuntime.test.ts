import type {
  FileContentResponse,
  FileTreeEntry,
  FileTreeResponse,
  WorkspaceFilesCapabilityV1,
  WorkspacePanelContext,
  WorkspacePanelNavigationV1,
  WriteWorkspaceFileResponse,
} from "@chainingintention/pi-web-cn/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import { FilesRuntime, workspaceUploadPath } from "./FilesRuntime";
import { createExplorerViewStateStore } from "./explorerViewState";

describe("FilesRuntime tree and selection", () => {
  it("refreshes the root and healthy expansions when an expanded directory disappears", async () => {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path) => path === "deleted"
      ? Promise.reject(new Error("Path does not exist"))
      : Promise.resolve(treeResponse(path, path === "" ? [directoryEntry("kept"), fileEntry("new.txt")] : [fileEntry("kept/current.txt")])));
    const context = createContext({ files: createFiles({ listFiles }) });
    const runtime = new FilesRuntime();
    const scope = runtime.snapshot(context);
    scope.fileTree = [directoryEntry("deleted")];
    scope.expandedDirs = { deleted: [], kept: [] };
    scope.expandedPaths = ["deleted", "kept"];
    await runtime.refreshFiles(context);
    expect(scope.fileTree).toEqual([directoryEntry("kept"), fileEntry("new.txt")]);
    expect(scope.expandedDirs).toEqual({ kept: [fileEntry("kept/current.txt")] });
    expect(scope.error).toBeUndefined();
    await runtime.refreshFiles(context);
    expect(scope.error).toBeUndefined();
    expect(listFiles.mock.calls.filter(([path]) => path === "deleted")).toHaveLength(0);
  });
  it("creates files without overwriting and selects the result", async () => {
    const writeFile = vi.fn<WorkspaceFilesCapabilityV1["writeFile"]>((path) => Promise.resolve(writeResponse(path, 0)));
    const context = createContext({ files: createFiles({ writeFile }) });
    const runtime = new FilesRuntime();
    await runtime.createFile(context, "src/new.txt");
    expect(writeFile).toHaveBeenCalledExactlyOnceWith("src/new.txt", "", { createDirs: true, overwrite: false });
    expect(runtime.snapshot(context).selectedFilePath).toBe("src/new.txt");
  });

  it("creates, moves and deletes empty directories through directory operations only", async () => {
    const createDirectory = vi.fn((path: string) => Promise.resolve({ path }));
    const moveDirectory = vi.fn((_from: string, path: string) => Promise.resolve({ path }));
    const deleteDirectory = vi.fn((path: string) => Promise.resolve({ path, deleted: true as const }));
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path)));
    const files = createFiles({ createDirectory, moveDirectory, deleteDirectory, readFile });
    const context = createContext({ files });
    const runtime = new FilesRuntime();
    await runtime.createDirectory(context, "src/new");
    expect(runtime.snapshot(context).selectedDirectoryPath).toBe("src/new");
    runtime.snapshot(context).expandedDirs = { "src/new": [], "src/new/child": [] };
    await runtime.moveSelectedPath(context, "src/renamed");
    expect(moveDirectory).toHaveBeenCalledExactlyOnceWith("src/new", "src/renamed");
    expect(runtime.snapshot(context).expandedDirs).toEqual({});
    expect(runtime.snapshot(context).selectedDirectoryPath).toBe("src/renamed");
    await runtime.deleteSelectedPath(context);
    expect(deleteDirectory).toHaveBeenCalledExactlyOnceWith("src/renamed");
    expect(runtime.snapshot(context).selectedDirectoryPath).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("moves and deletes files using non-overwriting file operations", async () => {
    const moveFile = vi.fn<WorkspaceFilesCapabilityV1["moveFile"]>((fromPath, toPath) => Promise.resolve({ fromPath, toPath, size: 2, modifiedAt: "now", overwritten: false }));
    const deleteFile = vi.fn<WorkspaceFilesCapabilityV1["deleteFile"]>((path) => Promise.resolve({ path, existed: true }));
    const context = createContext({ files: createFiles({ moveFile, deleteFile }) });
    const runtime = new FilesRuntime();
    await runtime.selectFile(context, "a.txt");
    await runtime.moveSelectedPath(context, "b.txt");
    expect(moveFile).toHaveBeenCalledExactlyOnceWith("a.txt", "b.txt", { overwrite: false });
    expect(runtime.snapshot(context).selectedFilePath).toBe("b.txt");
    await runtime.deleteSelectedPath(context);
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith("b.txt");
    expect(runtime.snapshot(context).selectedFilePath).toBeUndefined();
  });

  it("preserves selection and surfaces mutation failures without pretending success", async () => {
    const deleteFile = vi.fn<WorkspaceFilesCapabilityV1["deleteFile"]>(() => Promise.reject(new Error("permission denied")));
    const context = createContext({ files: createFiles({ deleteFile }) });
    const runtime = new FilesRuntime();
    await runtime.selectFile(context, "a.txt");
    await runtime.deleteSelectedPath(context);
    expect(runtime.snapshot(context)).toMatchObject({ selectedFilePath: "a.txt", error: "permission denied", mutating: false });
  });

  it("does not steal a newer selection when a create completes late", async () => {
    let complete!: (value: WriteWorkspaceFileResponse) => void;
    const writeFile = vi.fn<WorkspaceFilesCapabilityV1["writeFile"]>(() => new Promise((resolve) => { complete = resolve; }));
    const context = createContext({ files: createFiles({ writeFile }) });
    const runtime = new FilesRuntime();
    const pending = runtime.createFile(context, "new.txt");
    await runtime.selectFile(context, "other.txt");
    complete(writeResponse("new.txt", 0));
    await pending;
    expect(runtime.snapshot(context).selectedFilePath).toBe("other.txt");
  });

  it("keeps a late mutation in its original machine and never navigates a disconnected panel", async () => {
    let complete!: (value: WriteWorkspaceFileResponse) => void;
    const writeFile = vi.fn<WorkspaceFilesCapabilityV1["writeFile"]>(() => new Promise((resolve) => { complete = resolve; }));
    const set = vi.fn<WorkspacePanelNavigationV1["set"]>();
    const context = createContext({ files: createFiles({ writeFile }), navigation: createNavigation({}, set) });
    const runtime = new FilesRuntime();
    const unsubscribe = runtime.subscribe(context, () => undefined);
    const pending = runtime.createFile(context, "new.txt");
    unsubscribe();
    const other = { ...context, machine: { id: "other", name: "Other", kind: "remote" as const } };
    runtime.snapshot(other);
    complete(writeResponse("new.txt", 0));
    await pending;
    expect(runtime.snapshot(other).selectedFilePath).toBeUndefined();
    expect(runtime.snapshot(context).treeStale).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it("refreshes root and expanded directories, then collapses locally", async () => {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path) => Promise.resolve(treeResponse(path, {
      "": [directoryEntry("src"), fileEntry("README.md")],
      src: [fileEntry("src/index.ts")],
    }[path] ?? [])));
    const context = createContext({ files: createFiles({ listFiles }) });
    const runtime = new FilesRuntime();
    const scope = runtime.snapshot(context);
    scope.expandedDirs = { src: [fileEntry("src/stale.ts")] };
    scope.expandedPaths = ["src"];
    scope.treeStale = true;

    await runtime.refreshFiles(context);

    expect(listFiles.mock.calls.find(([path]) => path === "")?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(listFiles.mock.calls.find(([path]) => path === "src")?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(scope.fileTree).toEqual([directoryEntry("src"), fileEntry("README.md")]);
    expect(scope.expandedDirs).toEqual({ src: [fileEntry("src/index.ts")] });
    expect(scope.treeStale).toBe(false);

    listFiles.mockClear();
    await runtime.expandDir(context, "src");
    expect(listFiles).not.toHaveBeenCalled();
    expect(scope.expandedDirs).toEqual({});
  });

  it("joins the mount refresh during route finalization but replaces it on mutation", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }) });
    const runtime = new FilesRuntime();
    const scope = runtime.prepare(context);
    const route = runtime.invalidate(context);
    expect(trees.fn).toHaveBeenCalledOnce();
    expect(trees.request(0).signal.aborted).toBe(false);

    const mutation = runtime.invalidate(context, { reason: "mutation", resources: ["workspace.files"] });
    expect(trees.request(0).signal.aborted).toBe(true);
    trees.request(1).resolve(treeResponse("", [fileEntry("new.txt")]));
    await Promise.all([route, mutation]);
    expect(scope.fileTree).toEqual([fileEntry("new.txt")]);
    expect(scope.treeStale).toBe(false);
  });

  it("batches reachable expanded siblings and preserves traversal of nested expansions", async () => {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path) =>
      Promise.resolve(treeResponse(path, path === "" ? [directoryEntry("src"), directoryEntry("docs")] : [fileEntry("src/lib/main.ts")])));
    const listFilesBatch = vi.fn<NonNullable<WorkspaceFilesCapabilityV1["listFilesBatch"]>>(() =>
      Promise.resolve({ results: [
        { path: "docs", tree: treeResponse("docs", [fileEntry("docs/readme.md")]) },
        { path: "src", tree: treeResponse("src", [directoryEntry("src/lib")]) },
      ] }));
    const context = createContext({ files: createFiles({ listFiles, listFilesBatch }) });
    const runtime = new FilesRuntime();
    const scope = runtime.snapshot(context);
    scope.expandedPaths = ["src", "docs", "src/lib", "removed"];

    await runtime.refreshFiles(context);

    expect(listFiles.mock.calls.map(([path]) => path)).toEqual(["", "src/lib"]);
    expect(listFilesBatch).toHaveBeenCalledExactlyOnceWith(["src", "docs"], { signal: listFiles.mock.calls[0]?.[1]?.signal });
    expect(scope.expandedDirs).toEqual({
      src: [directoryEntry("src/lib")], docs: [fileEntry("docs/readme.md")], "src/lib": [fileEntry("src/lib/main.ts")],
    });
  });

  it("aborts superseded refreshes and directory expansions before stale results can commit", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }) });
    const runtime = new FilesRuntime();

    const staleRefresh = runtime.refreshFiles(context);
    const currentRefresh = runtime.refreshFiles(context);
    expect(trees.request(0).signal.aborted).toBe(true);
    trees.request(1).resolve(treeResponse("", [directoryEntry("src")]));
    await Promise.all([staleRefresh, currentRefresh]);
    expect(runtime.snapshot(context).fileTree).toEqual([directoryEntry("src")]);

    const staleExpansion = runtime.expandDir(context, "src");
    const concurrentExpansion = runtime.expandDir(context, "docs");
    await runtime.expandDir(context, "src"); // A second click cancels the pending expansion.
    const currentExpansion = runtime.expandDir(context, "src");
    expect(trees.request(2).signal.aborted).toBe(true);
    expect(trees.request(3).signal.aborted).toBe(false);
    trees.request(3).resolve(treeResponse("docs", [fileEntry("docs/guide.md")]));
    trees.request(4).resolve(treeResponse("src", [fileEntry("src/current.ts")]));
    await Promise.all([staleExpansion, concurrentExpansion, currentExpansion]);
    expect(runtime.snapshot(context).expandedDirs).toEqual({
      docs: [fileEntry("docs/guide.md")],
      src: [fileEntry("src/current.ts")],
    });
  });

  it("aborts tree work when its last observer disconnects and refreshes on reconnect", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }) });
    const runtime = new FilesRuntime();
    const unsubscribe = runtime.subscribe(context, vi.fn());

    const refresh = runtime.refreshFiles(context);
    const expansion = runtime.expandDir(context, "src");
    unsubscribe();

    expect(trees.request(0).signal.aborted).toBe(true);
    expect(trees.request(1).signal.aborted).toBe(true);
    expect(runtime.snapshot(context)).toMatchObject({ initialized: false, treeLoading: false, treeStale: true });
    await Promise.all([refresh, expansion]);
    await runtime.invalidate(context);
    expect(trees.fn).toHaveBeenCalledTimes(2);

    runtime.subscribe(context, vi.fn());
    const scope = runtime.prepare(context);
    trees.request(2).resolve(treeResponse("", [fileEntry("README.md")]));
    await vi.waitFor(() => { expect(scope.fileTree).toEqual([fileEntry("README.md")]); });
    expect(trees.request(2).signal.aborted).toBe(false);
  });

  it("keeps expected failures visible and clears its tree error after recovery", async () => {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>()
      .mockRejectedValueOnce(new Error("tree unavailable"))
      .mockResolvedValue(treeResponse("", [fileEntry("README.md")]));
    const context = createContext({ files: createFiles({ listFiles }) });
    const runtime = new FilesRuntime();
    const scope = runtime.snapshot(context);

    await runtime.refreshFiles(context);
    expect(scope.error).toBe("tree unavailable");

    await runtime.refreshFiles(context);
    expect(scope.error).toBeUndefined();
    expect(scope.fileTree).toEqual([fileEntry("README.md")]);
  });

  it("preserves a collapse while a refresh is awaiting expanded directory contents", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }) });
    const runtime = new FilesRuntime();
    const scope = runtime.snapshot(context);
    scope.fileTree = [fileEntry("README.md")];
    scope.expandedDirs = { src: [fileEntry("src/old.ts")] };
    scope.expandedPaths = ["src"];
    const refresh = runtime.refreshFiles(context);
    trees.request(0).resolve(treeResponse("", [directoryEntry("src")]));
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(2); });
    await runtime.expandDir(context, "src");
    expect(trees.request(1).signal.aborted).toBe(true);
    await refresh;
    expect(scope.expandedDirs).toEqual({});
    expect(scope.fileTree).toEqual([directoryEntry("src")]);
    expect(scope.error).toBeUndefined();
  });

  it("supersedes an older tree snapshot with the completed mutation refresh", async () => {
    const trees = deferredTrees();
    const writeFile = vi.fn<WorkspaceFilesCapabilityV1["writeFile"]>(() => Promise.resolve(writeResponse("new.txt", 0)));
    const context = createContext({ files: createFiles({ listFiles: trees.fn, writeFile }) });
    const runtime = new FilesRuntime();
    const stale = runtime.refreshFiles(context);
    const mutation = runtime.createFile(context, "new.txt");
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(2); });
    expect(trees.request(0).signal.aborted).toBe(true);
    trees.request(1).resolve(treeResponse("", [fileEntry("new.txt")]));
    await Promise.all([stale, mutation]);
    expect(runtime.snapshot(context).fileTree).toEqual([fileEntry("new.txt")]);
    expect(runtime.snapshot(context).selectedFilePath).toBe("new.txt");
    expect(runtime.snapshot(context).treeStale).toBe(false);
  });

  it("keeps late tree snapshots in their original machine scope", async () => {
    const firstTrees = deferredTrees();
    const secondTrees = deferredTrees();
    const first = createContext({ files: createFiles({ listFiles: firstTrees.fn }) });
    const second = createContext({ machineId: "remote-2", files: createFiles({ listFiles: secondTrees.fn }) });
    const runtime = new FilesRuntime();
    const oldRefresh = runtime.refreshFiles(first);
    const currentRefresh = runtime.refreshFiles(second);
    secondTrees.request(0).resolve(treeResponse("", [fileEntry("current.txt")]));
    await currentRefresh;
    firstTrees.request(0).resolve(treeResponse("", [fileEntry("old-scope.txt")]));
    await oldRefresh;
    expect(runtime.snapshot(second).fileTree).toEqual([fileEntry("current.txt")]);
    expect(runtime.snapshot(first).fileTree).toEqual([fileEntry("old-scope.txt")]);
  });

  it("rejects stale A to B to A responses and aborts obsolete reads", async () => {
    const reads = deferredReads();
    const setNavigation = vi.fn<WorkspacePanelNavigationV1["set"]>();
    const navigation = createNavigation({}, setNavigation);
    const context = createContext({ files: createFiles({ readFile: reads.fn }), navigation });
    const runtime = new FilesRuntime();

    const firstA = runtime.selectFile(context, "a.txt");
    const loadB = runtime.selectFile(context, "b.txt");
    const latestA = runtime.selectFile(context, "a.txt");

    expect(reads.request(0).signal.aborted).toBe(true);
    expect(reads.request(1).signal.aborted).toBe(true);
    reads.request(0).resolve(fileResponse("a.txt", "first A"));
    reads.request(1).resolve(fileResponse("b.txt", "stale B"));
    reads.request(2).resolve(fileResponse("a.txt", "latest A"));
    await Promise.all([firstA, loadB, latestA]);

    const scope = runtime.snapshot(context);
    expect(scope.selectedFilePath).toBe("a.txt");
    expect(scope.selectedFileContent?.content).toBe("latest A");
    expect(setNavigation).toHaveBeenNthCalledWith(1, "file", "a.txt");
    expect(setNavigation).toHaveBeenNthCalledWith(2, "file", "b.txt");
    expect(setNavigation).toHaveBeenNthCalledWith(3, "file", "a.txt");
  });

  it("isolates equal paths across machine/workspace scope and keeps current read errors local", async () => {
    const firstReads = deferredReads();
    const secondReads = deferredReads();
    const runtime = new FilesRuntime();
    const first = createContext({ files: createFiles({ readFile: firstReads.fn }) });
    const second = createContext({ machineId: "remote-2", workspaceId: "workspace-2", files: createFiles({ readFile: secondReads.fn }) });

    const stale = runtime.selectFile(first, "same.txt");
    const current = runtime.selectFile(second, "same.txt");
    firstReads.request(0).resolve(fileResponse("same.txt", "old scope"));
    secondReads.request(0).reject(new Error("Path does not exist: same.txt"));
    await Promise.all([stale, current]);

    expect(runtime.snapshot(first).selectedFileContent?.content).toBe("old scope");
    expect(runtime.snapshot(second).selectedFileContent).toBeUndefined();
    expect(runtime.snapshot(second).selectedFileLoadError).toBe("Path does not exist: same.txt");
  });

  it("follows back and forward navigation delivered through panel invalidation", async () => {
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path, `loaded:${path}`)));
    const files = createFiles({ readFile });
    const runtime = new FilesRuntime();
    const first = createContext({ files, navigation: createNavigation({ file: "a.txt" }) });
    const scope = runtime.prepare(first);
    await vi.waitFor(() => { expect(scope.selectedFileContent?.content).toBe("loaded:a.txt"); });
    const contexts: WorkspacePanelContext[] = [];
    runtime.subscribe(first, (_snapshot, context) => { contexts.push(context); });

    const second = { ...first, navigation: createNavigation({ file: "b.txt", mode: "raw" }) };
    await runtime.invalidate(second);
    await vi.waitFor(() => { expect(scope.selectedFileContent?.content).toBe("loaded:b.txt"); });

    const back = { ...first, navigation: createNavigation({ file: "a.txt", mode: "preview" }) };
    await runtime.invalidate(back);
    await vi.waitFor(() => { expect(scope.selectedFileContent?.content).toBe("loaded:a.txt"); });
    expect(contexts).toContain(second);
    expect(contexts.at(-1)).toBe(back);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(["a.txt", "b.txt", "a.txt"]);
  });

  it("restores the aliased navigation snapshot and reports missing required host capabilities", async () => {
    const navigation = createNavigation({ file: "src/main.ts" });
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path, "restored")));
    const context = createContext({ files: createFiles({ readFile }), navigation });
    const runtime = new FilesRuntime();

    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.selectedFileContent?.content).toBe("restored"); });
    expect(readFile.mock.calls[0]?.[0]).toBe("src/main.ts");
    expect(readFile.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const unavailable = createContext({ files: legacyFiles(), navigation: null });
    expect(runtime.prepare(unavailable).capabilityError).toContain("workspace-files capability v1");
  });
});

describe("FilesRuntime navigation flows", () => {
  const directories: Record<string, FileTreeEntry[]> = {
    "": [directoryEntry("src"), directoryEntry("docs")],
    src: [directoryEntry("src/lib"), fileEntry("src/main.ts")],
    "src/lib": [fileEntry("src/lib/deep.ts")],
    docs: [fileEntry("docs/guide.md")],
  };

  function navigationFixture(path = "src/lib/deep.ts") {
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((folder) => Promise.resolve(treeResponse(folder, directories[folder] ?? [])));
    const context = createContext({ files: createFiles({ listFiles }), navigation: createNavigation({ file: path }) });
    return { context, listFiles };
  }

  it("restores a nested URL destination and reveals it independently of preview loading", async () => {
    const { context, listFiles } = navigationFixture();
    const reads = deferredReads();
    const runtime = new FilesRuntime();
    const linked = { ...context, files: createFiles({ listFiles, readFile: reads.fn }) };
    const scope = runtime.prepare(linked);

    await vi.waitFor(() => { expect(scope.revealRequest?.path).toBe("src/lib/deep.ts"); });
    expect(scope.selectedFileContent).toBeUndefined();
    expect(scope.expandedPaths).toEqual(["src", "src/lib"]);
    expect(scope.expandedDirs["src/lib"]).toEqual([fileEntry("src/lib/deep.ts")]);
    expect(listFiles.mock.calls.map(([path]) => path)).toEqual(["", "src", "src/lib"]);
    reads.request(0).resolve(fileResponse("src/lib/deep.ts"));
    await vi.waitFor(() => { expect(scope.selectedFileContent?.path).toBe("src/lib/deep.ts"); });
  });

  it("resumes manual collapse and scroll on tab return, but reveals the URL again on reload", async () => {
    const explorerViewState = createExplorerViewStateStore();
    const { context } = navigationFixture();
    const runtime = new FilesRuntime({ explorerViewState });
    const unsubscribe = runtime.subscribe(context, vi.fn());
    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.revealRequest).toBeDefined(); });
    runtime.acknowledgeReveal(context, scope.revealRequest?.id ?? -1, 120);
    await runtime.expandDir(context, "src");
    runtime.rememberScroll(context, 45);
    unsubscribe();

    runtime.subscribe(context, vi.fn());
    runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.treeLoading).toBe(false); });
    expect(scope.expandedPaths).not.toContain("src");
    expect(scope.revealRequest).toBeUndefined();
    expect(scope.scrollTop).toBe(45);
    expect(scope.selectedFileContent?.path).toBe("src/lib/deep.ts");

    const reloaded = new FilesRuntime({ explorerViewState }).prepare(context);
    await vi.waitFor(() => { expect(reloaded.revealRequest?.path).toBe("src/lib/deep.ts"); });
    expect(reloaded.expandedPaths).toContain("src");
  });

  it("retries an interrupted expansion on return instead of losing the user's intent", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }) });
    const runtime = new FilesRuntime();
    const unsubscribe = runtime.subscribe(context, vi.fn());
    const scope = runtime.prepare(context);
    trees.request(0).resolve(treeResponse("", directories[""]));
    await vi.waitFor(() => { expect(scope.treeLoading).toBe(false); });
    const expansion = runtime.expandDir(context, "src");
    unsubscribe();
    await expansion;
    expect(scope.expandedPaths).toEqual(["src"]);

    runtime.subscribe(context, vi.fn());
    runtime.prepare(context);
    trees.request(2).resolve(treeResponse("", directories[""]));
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(4); });
    trees.request(3).resolve(treeResponse("src", directories["src"]));
    await vi.waitFor(() => { expect(scope.expandedDirs["src"]).toEqual(directories["src"]); });
  });

  it("opens tree clicks in place, but reveals external navigation and browser history destinations", async () => {
    const { context, listFiles } = navigationFixture();
    const runtime = new FilesRuntime();
    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.revealRequest).toBeDefined(); });
    runtime.acknowledgeReveal(context, scope.revealRequest?.id ?? -1, 75);
    listFiles.mockClear();
    await runtime.selectFile(context, "src/main.ts");
    expect(listFiles).not.toHaveBeenCalled();
    expect(scope.revealRequest).toBeUndefined();
    expect(scope.scrollTop).toBe(75);

    const external = { ...context, navigation: createNavigation({ file: "docs/guide.md" }) };
    await runtime.invalidate(external);
    expect(scope.revealRequest?.path).toBe("docs/guide.md");
    expect(scope.expandedPaths).toEqual(expect.arrayContaining(["src", "src/lib", "docs"]));
    expect(listFiles.mock.calls.filter(([path]) => path === "")).toHaveLength(1);
    await runtime.invalidate({ ...context, navigation: createNavigation({ file: "src/main.ts" }) });
    expect(scope.revealRequest?.path).toBe("src/main.ts");
    expect(scope.selectedFileContent?.path).toBe("src/main.ts");
  });

  it("does not let an obsolete reveal overwrite a newer collapse", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }), navigation: createNavigation({ file: "src/lib/deep.ts" }) });
    const runtime = new FilesRuntime();
    const scope = runtime.prepare(context);
    trees.request(0).resolve(treeResponse("", directories[""]));
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(2); });
    await runtime.expandDir(context, "src");
    expect(trees.request(1).signal.aborted).toBe(true);
    expect(scope.expandedPaths).not.toContain("src");
    trees.request(1).resolve(treeResponse("src", directories["src"]));
    await runtime.refreshFiles({ ...context, files: navigationFixture().context.files });
    expect(scope.revealRequest).toBeUndefined();
    expect(scope.expandedDirs["src"]).toBeUndefined();
    expect(scope.selectedFilePath).toBe("src/lib/deep.ts");
  });

  it("cancels an obsolete history reveal before it can scroll the new destination", async () => {
    const trees = deferredTrees();
    const context = createContext({ files: createFiles({ listFiles: trees.fn }), navigation: createNavigation({ file: "src/lib/deep.ts" }) });
    const runtime = new FilesRuntime();
    const scope = runtime.prepare(context);
    trees.request(0).resolve(treeResponse("", directories[""]));
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(2); });
    const next = { ...context, navigation: createNavigation({ file: "docs/guide.md" }) };
    const navigating = runtime.invalidate(next);
    expect(trees.request(1).signal.aborted).toBe(true);
    trees.request(2).resolve(treeResponse("", directories[""]));
    await vi.waitFor(() => { expect(trees.fn).toHaveBeenCalledTimes(5); });
    trees.request(3).resolve(treeResponse("src", []));
    trees.request(4).resolve(treeResponse("docs", directories["docs"]));
    await navigating;
    expect(scope.revealRequest?.path).toBe("docs/guide.md");
    expect(scope.selectedFileContent?.path).toBe("docs/guide.md");
  });

  it("restores remembered folders after cache eviction without undoing a deliberate collapse", async () => {
    const runtime = new FilesRuntime();
    const { context } = navigationFixture();
    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.revealRequest).toBeDefined(); });
    runtime.acknowledgeReveal(context, scope.revealRequest?.id ?? -1, 80);
    await runtime.expandDir(context, "docs");
    await runtime.expandDir(context, "src");
    for (let index = 0; index < 9; index += 1) {
      runtime.snapshot(createContext({ workspaceId: `other-${String(index)}` }));
    }
    const returned = runtime.prepare(context);
    expect(returned).not.toBe(scope);
    await vi.waitFor(() => { expect(returned.treeLoading).toBe(false); });
    expect(returned.expandedPaths).toContain("docs");
    expect(returned.expandedPaths).not.toContain("src");
    expect(returned.expandedDirs["docs"]).toEqual(directories["docs"]);
    expect(returned.revealRequest).toBeUndefined();
    expect(returned.scrollTop).toBe(80);
    expect(returned.selectedFileContent?.path).toBe("src/lib/deep.ts");
  });

  it("keeps tree restoration failures separate from a successfully opened preview", async () => {
    const { context } = navigationFixture();
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path) => path === "src"
      ? Promise.reject(new Error("directory unavailable"))
      : Promise.resolve(treeResponse(path, directories[path] ?? [])));
    const runtime = new FilesRuntime();
    const scope = runtime.prepare({ ...context, files: createFiles({ listFiles }) });
    await vi.waitFor(() => { expect(scope.error).toBe("directory unavailable"); });
    expect(scope.selectedFileContent?.path).toBe("src/lib/deep.ts");
    expect(scope.fileTree).toEqual(directories[""]);
    expect(scope.revealRequest).toBeUndefined();
    await runtime.refreshFiles(context);
    expect(scope.error).toBeUndefined();
    expect(scope.revealRequest?.path).toBe("src/lib/deep.ts");
  });

  it("defers navigation while Files is suspended and reveals the destination on return", async () => {
    const { context, listFiles } = navigationFixture();
    const runtime = new FilesRuntime();
    const unsubscribe = runtime.subscribe(context, vi.fn());
    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.revealRequest).toBeDefined(); });
    runtime.acknowledgeReveal(context, scope.revealRequest?.id ?? -1, 50);
    unsubscribe();
    listFiles.mockClear();
    const linked = { ...context, navigation: createNavigation({ file: "docs/guide.md" }) };
    await runtime.invalidate(linked);
    expect(listFiles).not.toHaveBeenCalled();
    expect(scope.selectedFilePath).toBe("docs/guide.md");
    runtime.subscribe(linked, vi.fn());
    runtime.prepare(linked);
    await vi.waitFor(() => { expect(scope.revealRequest?.path).toBe("docs/guide.md"); });
    expect(scope.selectedFileContent?.path).toBe("docs/guide.md");
  });

  it("retains an unacknowledged reveal when its inactive content cache is evicted", async () => {
    const runtime = new FilesRuntime();
    const { context } = navigationFixture();
    const scope = runtime.prepare(context);
    await vi.waitFor(() => { expect(scope.revealRequest).toBeDefined(); });
    const reveal = scope.revealRequest;
    for (let index = 0; index < 9; index += 1) runtime.snapshot(createContext({ workspaceId: `other-${String(index)}` }));
    const returned = runtime.prepare(context);
    expect(returned).not.toBe(scope);
    await vi.waitFor(() => { expect(returned.revealRequest).toEqual(reveal); });
  });

  it("ignores deleted remembered folders and scopes presentation by workspace and machine", async () => {
    const runtime = new FilesRuntime();
    const first = navigationFixture().context;
    await runtime.expandDir(first, "deleted");
    await runtime.refreshFiles(first);
    expect(runtime.snapshot(first).error).toBeUndefined();
    runtime.rememberScroll(first, 100);
    expect(runtime.snapshot({ ...first, machine: { ...first.machine, id: "other" } }).scrollTop).toBe(0);
    expect(runtime.snapshot({ ...first, workspace: { ...first.workspace, id: "other" } }).expandedPaths).toEqual([]);
  });
});

describe("FilesRuntime uploads", () => {
  it.each([
    ["machine", { machineId: "remote-2" }],
    ["project", { projectId: "project-2" }],
    ["workspace", { workspaceId: "workspace-2" }],
  ] as const)("isolates equal upload batch ids across %s scopes, including cancellation", async (_scope, otherScope) => {
    const firstUploads = controllableUploads({ rejectOnCancel: true });
    const otherUploads = controllableUploads({ rejectOnCancel: true });
    const first = createContext({ files: createFiles({ uploadFile: firstUploads.fn }) });
    const other = createContext({ ...otherScope, files: createFiles({ uploadFile: otherUploads.fn }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "shared-batch" });
    const firstRun = runtime.startWorkspaceUpload(first, [new File(["aa"], "first.txt")], { destinationFolder: "uploads", selectUploadedFile: false });
    expect(firstRun?.batchId).toBe("shared-batch");
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]?.files[0]?.name).toBe("first.txt");
    expect(runtime.snapshot(other).uploadBatches).toEqual({});
    runtime.cancelWorkspaceUpload(other, "shared-batch");
    expect(firstUploads.cancel(0)).not.toHaveBeenCalled();
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]?.status).toBe("uploading");

    const otherRun = runtime.startWorkspaceUpload(other, [new File(["bbb"], "other.txt")], { destinationFolder: "uploads", selectUploadedFile: false });
    expect(otherRun?.batchId).toBe("shared-batch");
    firstUploads.progress(0, { loaded: 1, total: 2, percent: 0.5, lengthComputable: true });
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]).toMatchObject({ loaded: 1, total: 2, files: [{ name: "first.txt" }] });
    expect(runtime.snapshot(other).uploadBatches["shared-batch"]).toMatchObject({ loaded: 0, total: 3, files: [{ name: "other.txt" }] });
    runtime.cancelWorkspaceUpload(other, "shared-batch");
    await otherRun?.done;
    expect(otherUploads.cancel(0)).toHaveBeenCalledOnce();
    expect(firstUploads.cancel(0)).not.toHaveBeenCalled();
    expect(runtime.snapshot(other).uploadBatches["shared-batch"]?.status).toBe("cancelled");
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]?.status).toBe("uploading");

    firstUploads.resolve(0, writeResponse("uploads/first.txt", 2));
    await firstRun?.done;
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]?.status).toBe("completed");
    expect(runtime.snapshot(other).uploadBatches["shared-batch"]?.status).toBe("cancelled");
    runtime.clearWorkspaceUpload(other, "shared-batch");
    expect(runtime.snapshot(other).uploadBatches).toEqual({});
    expect(runtime.snapshot(first).uploadBatches["shared-batch"]?.status).toBe("completed");
  });

  it("uploads sequentially with progress, safe defaults, refresh, and first-success selection", async () => {
    const uploads = controllableUploads();
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>(() => Promise.resolve(treeResponse("")));
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path)));
    const files = createFiles({ uploadFile: uploads.fn, listFiles, readFile });
    const setNavigation = vi.fn<WorkspacePanelNavigationV1["set"]>();
    const navigation = createNavigation({}, setNavigation);
    const context = createContext({ files, navigation });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1", now: sequenceNow("start", "complete") });
    const selected = [new File(["aa"], "a.txt"), new File(["bbb"], "b.txt")];

    const run = runtime.startWorkspaceUpload(context, selected, { destinationFolder: "uploads/manual" });
    expect(run?.batchId).toBe("batch-1");
    expect(uploads.fn).toHaveBeenCalledTimes(1);
    expect(uploads.options(0)).toMatchObject({
      destinationFolder: "uploads/manual",
      createDirs: true,
      overwrite: false,
    });

    uploads.progress(0, { loaded: 1, total: 2, percent: 0.5, lengthComputable: true });
    expect(runtime.snapshot(context).uploadBatches["batch-1"]).toMatchObject({ loaded: 1, total: 5, percent: 0.2 });

    uploads.resolve(0, writeResponse("uploads/manual/a.txt", 2));
    await vi.waitFor(() => { expect(uploads.fn).toHaveBeenCalledTimes(2); });
    uploads.resolve(1, writeResponse("uploads/manual/b.txt", 3));
    await run?.done;

    expect(runtime.snapshot(context).uploadBatches["batch-1"]).toMatchObject({
      status: "completed",
      completedAt: "complete",
      files: [
        { path: "uploads/manual/a.txt", status: "completed" },
        { path: "uploads/manual/b.txt", status: "completed" },
      ],
    });
    expect(listFiles.mock.calls.find(([path]) => path === "")?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(readFile).toHaveBeenCalledWith("uploads/manual/a.txt", expect.anything());
    expect(setNavigation).toHaveBeenCalledWith("file", "uploads/manual/a.txt");
  });

  it("continues after one file fails and selects the first successful upload", async () => {
    const uploads = controllableUploads();
    const context = createContext({ files: createFiles({
      uploadFile: uploads.fn,
      listFiles: () => Promise.resolve(treeResponse("")),
      readFile: (path) => Promise.resolve(fileResponse(path)),
    }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1", now: sequenceNow("start", "failed") });
    const run = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt"), new File(["b"], "b.txt")], { destinationFolder: "uploads" });

    uploads.reject(0, new Error("File already exists: uploads/a.txt"));
    await vi.waitFor(() => { expect(uploads.fn).toHaveBeenCalledTimes(2); });
    uploads.resolve(1, writeResponse("uploads/b.txt", 1));
    await run?.done;

    expect(runtime.snapshot(context).uploadBatches["batch-1"]).toMatchObject({
      status: "error",
      error: "File already exists: uploads/a.txt",
      files: [
        { status: "error", error: "File already exists: uploads/a.txt" },
        { status: "completed", path: "uploads/b.txt" },
      ],
    });
    expect(runtime.snapshot(context).selectedFilePath).toBe("uploads/b.txt");
  });

  it("refreshes and selects a successful file when a later upload is cancelled", async () => {
    const uploads = controllableUploads({ rejectOnCancel: true });
    const listFiles = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>(() => Promise.resolve(treeResponse("")));
    const readFile = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path) => Promise.resolve(fileResponse(path)));
    const context = createContext({ files: createFiles({ uploadFile: uploads.fn, listFiles, readFile }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1" });
    const run = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt"), new File(["b"], "b.txt")], { destinationFolder: "uploads" });

    uploads.resolve(0, writeResponse("uploads/a.txt", 1));
    await vi.waitFor(() => { expect(uploads.fn).toHaveBeenCalledTimes(2); });
    runtime.cancelWorkspaceUpload(context, "batch-1");
    await run?.done;

    expect(runtime.snapshot(context).uploadBatches["batch-1"]?.status).toBe("cancelled");
    expect(listFiles.mock.calls.find(([path]) => path === "")?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(readFile).toHaveBeenCalledWith("uploads/a.txt", expect.anything());
    expect(runtime.snapshot(context).selectedFilePath).toBe("uploads/a.txt");
  });

  it("dismisses a completed batch without retaining cancellation state", async () => {
    const uploads = controllableUploads();
    const context = createContext({ files: createFiles({ uploadFile: uploads.fn }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "reused-batch" });
    const first = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "uploads", selectUploadedFile: false });
    uploads.resolve(0, writeResponse("uploads/a.txt", 1));
    await first?.done;
    runtime.clearWorkspaceUpload(context, "reused-batch");

    const second = runtime.startWorkspaceUpload(context, [new File(["b"], "b.txt")], { destinationFolder: "uploads", selectUploadedFile: false });
    expect(uploads.fn).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot(context).uploadBatches["reused-batch"]?.status).toBe("uploading");
    uploads.resolve(1, writeResponse("uploads/b.txt", 1));
    await second?.done;
  });

  it("cancels and dismisses an in-flight upload without resurrecting its batch", async () => {
    const uploads = controllableUploads({ rejectOnCancel: true });
    const context = createContext({ files: createFiles({ uploadFile: uploads.fn }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "batch-1", now: sequenceNow("start", "cancel") });
    const run = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "uploads" });

    runtime.cancelWorkspaceUpload(context, "batch-1");
    await run?.done;
    expect(uploads.cancel(0)).toHaveBeenCalledOnce();
    expect(runtime.snapshot(context).uploadBatches["batch-1"]).toMatchObject({ status: "cancelled", error: "Upload cancelled" });

    runtime.clearWorkspaceUpload(context, "batch-1");
    expect(runtime.snapshot(context).uploadBatches).toEqual({});
  });

  it("never evicts an inactive scope while its upload is in flight", async () => {
    const uploads = controllableUploads({ rejectOnCancel: true });
    const context = createContext({ files: createFiles({ uploadFile: uploads.fn }) });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "protected-batch" });
    const run = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "uploads" });

    for (let index = 0; index < 10; index += 1) {
      runtime.snapshot(createContext({ machineId: `remote-${String(index)}`, workspaceId: `workspace-${String(index)}` }));
    }

    expect(runtime.snapshot(context).uploadBatches["protected-batch"]?.status).toBe("uploading");
    runtime.cancelWorkspaceUpload(context, "protected-batch");
    await run?.done;
  });

  it("rejects traversal before starting transport", () => {
    const uploadFile = vi.fn<WorkspaceFilesCapabilityV1["uploadFile"]>();
    const context = createContext({ files: createFiles({ uploadFile }) });
    const runtime = new FilesRuntime();

    expect(runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "../outside" })).toBeUndefined();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(runtime.snapshot(context).error).toContain("path traversal");
  });
});

describe("FilesRuntime localization", () => {
  function fixture() {
    const service = new LocalizationService({ preferences: { language: "en", formatLocale: "en" }, diagnostic: () => undefined });
    const lifetime = new AbortController();
    const localization = createPluginLocalization(service, "files", "files", lifetime.signal);
    service.registerCatalog({
      id: "runtime-fr", namespace: "plugin:files:runtime", locale: "fr",
      load: () => Promise.resolve({
        filesCapability: "Capacité fichiers indisponible",
        navigationCapability: "Navigation indisponible",
        destinationTraversal: "Destination sans traversée de chemin",
        uploadCancelled: "Envoi annulé",
        uploadsFailed: "{count, plural, one {# échec} other {# échecs}}",
      }),
    });
    const runtime = new FilesRuntime({ createUploadBatchId: () => "localized-batch" });
    return { runtime, localization, service, lifetime };
  }

  it("keeps retained capability and validation strings live even when localization is attached later", async () => {
    const { runtime, localization, service, lifetime } = fixture();
    try {
      const unavailable = runtime.snapshot(createContext({ workspaceId: "legacy", files: legacyFiles() }));
      const noNavigation = runtime.snapshot(createContext({ workspaceId: "no-navigation", navigation: null }));
      const context = createContext();
      runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "../outside" });
      const scope = runtime.snapshot(context);
      expect(scope.error).toBe("upload destination must not contain path traversal");
      runtime.setLocalization(localization);
      runtime.setLocalization(localization); // Reusing an activation must not register its namespace twice.
      await service.setPreferences({ language: "fr", formatLocale: "en" });
      expect(unavailable.capabilityError).toBe("Capacité fichiers indisponible");
      expect(noNavigation.capabilityError).toBe("Navigation indisponible");
      expect(scope.error).toBe("Destination sans traversée de chemin");
      await service.setPreferences({ language: "en", formatLocale: "en" });
      expect(scope.error).toBe("upload destination must not contain path traversal");
      await runtime.refreshFiles(context);
      expect(scope.error).toBeUndefined();
    } finally { lifetime.abort(); }
  });

  it("retranslates stored cancellation diagnostics without altering paths or completed state", async () => {
    const { runtime, localization, service, lifetime } = fixture();
    try {
      runtime.setLocalization(localization);
      const uploads = controllableUploads({ rejectOnCancel: true });
      const context = createContext({ files: createFiles({ uploadFile: uploads.fn }) });
      const run = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt"), new File(["b"], "b.txt")], { destinationFolder: "uploads" });
      runtime.cancelWorkspaceUpload(context, "localized-batch");
      await run?.done;
      const batch = runtime.snapshot(context).uploadBatches["localized-batch"];
      expect(batch?.error).toBe("Upload cancelled");
      await service.setPreferences({ language: "fr", formatLocale: "en" });
      expect(batch).toMatchObject({ status: "cancelled", error: "Envoi annulé", files: [
        { status: "cancelled", error: "Envoi annulé", path: "uploads/a.txt" },
        { status: "cancelled", error: "Envoi annulé", path: "uploads/b.txt" },
      ] });
    } finally { lifetime.abort(); }
  });

  it("localizes aggregate failures but preserves backend diagnostics verbatim, including text matching local messages", async () => {
    const { runtime, localization, service, lifetime } = fixture();
    try {
      runtime.setLocalization(localization);
      const backend = "Upload cancelled";
      const context = createContext({ files: createFiles({
        listFiles: () => Promise.reject(new Error(backend)),
        readFile: () => Promise.reject(new Error(backend)),
        uploadFile: () => { throw new Error(backend); },
      }) });
      await runtime.refreshFiles(context);
      await runtime.selectFile(context, "user/<img>.txt");
      const single = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt")], { destinationFolder: "uploads" });
      await single?.done;
      const singleBatch = runtime.snapshot(context).uploadBatches["localized-batch"];
      runtime.clearWorkspaceUpload(context, "localized-batch");
      const multiple = runtime.startWorkspaceUpload(context, [new File(["a"], "a.txt"), new File(["b"], "b.txt")], { destinationFolder: "uploads" });
      await multiple?.done;
      const scope = runtime.snapshot(context);
      expect(scope.uploadBatches["localized-batch"]?.error).toBe("2 files failed to upload");
      await service.setPreferences({ language: "fr", formatLocale: "en" });
      expect(singleBatch?.error).toBe(backend);
      expect(scope.error).toBe(backend);
      expect(scope.selectedFileLoadError).toBe(backend);
      expect(scope.selectedFilePath).toBe("user/<img>.txt");
      expect(scope.uploadBatches["localized-batch"]).toMatchObject({ error: "2 échecs", files: [{ error: backend }, { error: backend }] });
    } finally { lifetime.abort(); }
  });

  it.each([
    ["/absolute", "a.txt", "upload destination must be workspace-relative"],
    ["ok", "../outside", "upload file name must not contain path traversal"],
    ["ok", "", "upload file name must not be empty"],
    ["ok", "C:\\outside", "upload file name must be workspace-relative"],
  ])("preserves validation and English errors for %s / %s", (folder, name, message) => {
    expect(() => workspaceUploadPath(folder, name)).toThrow(message);
  });
});

interface ContextOptions {
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  files?: WorkspacePanelContext["files"];
  navigation?: WorkspacePanelNavigationV1 | null;
}

function createContext(options: ContextOptions = {}): WorkspacePanelContext {
  return {
    navigate: () => Promise.resolve(),
    machine: { id: options.machineId ?? "remote-1", name: "Remote", kind: "remote" },
    workspace: { id: options.workspaceId ?? "workspace-1", projectId: options.projectId ?? "project-1", path: "/repo", label: "repo", isMain: true },
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
    uploadFile: () => { throw new Error("not implemented"); },
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

function createNavigation(
  query: Record<string, string | readonly string[]> = {},
  set: WorkspacePanelNavigationV1["set"] = vi.fn<WorkspacePanelNavigationV1["set"]>(),
): WorkspacePanelNavigationV1 {
  return { version: 1, contributionId: "files:workspace.files", query, set };
}

function deferredTrees() {
  const requests: {
    path: string;
    signal: AbortSignal;
    resolve: (value: FileTreeResponse) => void;
  }[] = [];
  const fn = vi.fn<WorkspaceFilesCapabilityV1["listFiles"]>((path, options) => new Promise((resolve, reject) => {
    const signal = options?.signal ?? new AbortController().signal;
    requests.push({ path, signal, resolve });
    signal.addEventListener("abort", () => { reject(new DOMException("cancelled", "AbortError")); }, { once: true });
  }));
  return {
    fn,
    request: (index: number) => {
      const request = requests[index];
      if (request === undefined) throw new Error(`Missing tree request ${String(index)}`);
      return request;
    },
  };
}

function deferredReads() {
  const requests: {
    path: string;
    signal: AbortSignal;
    resolve: (value: FileContentResponse) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const fn = vi.fn<WorkspaceFilesCapabilityV1["readFile"]>((path, options) => new Promise((resolve, reject) => {
    requests.push({ path, signal: options?.signal ?? new AbortController().signal, resolve, reject });
  }));
  return {
    fn,
    request: (index: number) => {
      const request = requests[index];
      if (request === undefined) throw new Error(`Missing read ${String(index)}`);
      return request;
    },
  };
}

function controllableUploads(options: { rejectOnCancel?: boolean } = {}) {
  const calls: {
    options: Parameters<WorkspaceFilesCapabilityV1["uploadFile"]>[1];
    resolve: (value: WriteWorkspaceFileResponse) => void;
    reject: (error: unknown) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const fn = vi.fn<WorkspaceFilesCapabilityV1["uploadFile"]>((file, uploadOptions) => {
    let resolveTask: (value: WriteWorkspaceFileResponse) => void = () => undefined;
    let rejectTask: (error: unknown) => void = () => undefined;
    const completed = new Promise<WriteWorkspaceFileResponse>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const cancel = vi.fn(() => {
      if (options.rejectOnCancel === true) rejectTask(new DOMException("cancelled", "AbortError"));
    });
    calls.push({ options: uploadOptions, resolve: resolveTask, reject: rejectTask, cancel });
    return { path: `${uploadOptions?.destinationFolder ?? ".pi-web/uploads"}/${file.name}`, completed, cancel };
  });
  const call = (index: number) => {
    const entry = calls[index];
    if (entry === undefined) throw new Error(`Missing upload ${String(index)}`);
    return entry;
  };
  return {
    fn,
    options: (index: number) => call(index).options,
    progress: (index: number, progress: Parameters<NonNullable<NonNullable<Parameters<WorkspaceFilesCapabilityV1["uploadFile"]>[1]>["onProgress"]>>[0]) => { call(index).options?.onProgress?.(progress); },
    resolve: (index: number, response: WriteWorkspaceFileResponse) => { call(index).resolve(response); },
    reject: (index: number, error: unknown) => { call(index).reject(error); },
    cancel: (index: number) => call(index).cancel,
  };
}

function sequenceNow(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? "now";
}

function treeResponse(path: string, entries: FileTreeEntry[] = []): FileTreeResponse {
  return { path, entries, scannedAt: "2026-06-25T00:00:00.000Z", truncated: false };
}

function directoryEntry(path: string): FileTreeEntry {
  return { name: path.split("/").at(-1) ?? path, path, type: "directory" };
}

function fileEntry(path: string): FileTreeEntry {
  return { name: path.split("/").at(-1) ?? path, path, type: "file", size: 2 };
}

function fileResponse(path: string, content = "aa"): FileContentResponse {
  return { path, encoding: "utf8", size: content.length, modifiedAt: "2026-06-25T00:00:00.000Z", content, truncated: false, binary: false };
}

function writeResponse(path: string, size: number): WriteWorkspaceFileResponse {
  return { path, size, modifiedAt: "2026-06-25T00:00:00.000Z", created: true };
}
