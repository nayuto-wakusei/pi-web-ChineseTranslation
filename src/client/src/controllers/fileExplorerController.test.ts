import { afterEach, describe, expect, it, vi } from "vitest";
import { api as defaultApi, WorkspaceUploadBatchError, WorkspaceUploadCancelledError, type FileContentResponse, type FileTreeEntry, type FileTreeResponse, type Machine, type Project, type Workspace, type WorkspaceUploadBatchProgress, type WriteWorkspaceFileResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { FileExplorerController, type FileExplorerControllerDependencies } from "./fileExplorerController";

type UploadWorkspaceFiles = NonNullable<FileExplorerControllerDependencies["uploadWorkspaceFiles"]>;
type UploadWorkspaceFilesOptions = NonNullable<Parameters<UploadWorkspaceFiles>[3]>;

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
});

const machine: Machine = {
  id: "remote-1",
  name: "Remote",
  kind: "remote",
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

const project: Project = {
  id: "project-1",
  name: "Project",
  path: "/repo",
  createdAt: "2026-06-25T00:00:00.000Z",
};

const workspace: Workspace = {
  id: "workspace-1",
  projectId: project.id,
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

describe("FileExplorerController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates, moves, deletes, and downloads selected workspace paths", async () => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/app", pathname: "/app", search: "", hash: "" },
      history: { replaceState: vi.fn(), pushState: vi.fn() },
    });
    const initialEntries: FileTreeEntry[] = [
      { name: "src", path: "src", type: "directory" },
      { name: "old.txt", path: "src/old.txt", type: "file" },
      { name: "empty", path: "empty", type: "directory" },
    ];
    const oldEntry = initialEntries[1];
    if (oldEntry === undefined) throw new Error("Expected file entry");
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project,
      selectedWorkspace: workspace,
      selectedFilePath: "src/old.txt",
      fileTree: initialEntries,
      expandedDirs: { src: [oldEntry] },
    };
    const calls: string[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      createWorkspaceFile: (_projectId, _workspaceId, path) => {
        calls.push(`create-file:${path}`);
        return Promise.resolve({ path, size: 0, modifiedAt: "now", created: true });
      },
      createWorkspaceDirectory: (_projectId, _workspaceId, path) => {
        calls.push(`create-dir:${path}`);
        return Promise.resolve({ path });
      },
      moveWorkspaceFile: (_projectId, _workspaceId, fromPath, toPath) => {
        calls.push(`move-file:${fromPath}->${toPath}`);
        return Promise.resolve({ fromPath, toPath, size: 0, modifiedAt: "now" });
      },
      moveWorkspaceDirectory: (_projectId, _workspaceId, fromPath, toPath) => {
        calls.push(`move-dir:${fromPath}->${toPath}`);
        return Promise.resolve({ path: toPath });
      },
      deleteWorkspaceFile: (_projectId, _workspaceId, path) => {
        calls.push(`delete-file:${path}`);
        return Promise.resolve({ path, existed: true });
      },
      deleteWorkspaceDirectory: (_projectId, _workspaceId, path) => {
        calls.push(`delete-dir:${path}`);
        return Promise.resolve({ deleted: true, path });
      },
      downloadWorkspaceFile: (_projectId, _workspaceId, path) => {
        calls.push(`download-file:${path}`);
        return Promise.resolve();
      },
      workspaceTree: () => Promise.resolve({ path: "", entries: initialEntries, scannedAt: "now", truncated: false }),
      workspaceFile: (_projectId, _workspaceId, path) => Promise.resolve({ path, encoding: "utf8", size: 0, modifiedAt: "now", content: "", truncated: false, binary: false }),
    };
    const updateUrl = vi.fn();
    const controller = new FileExplorerController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      updateUrl,
      { api },
    );

    await controller.createFile("src/new.txt");
    await controller.createDirectory("src/new-dir");
    state = { ...state, selectedFilePath: "src/old.txt", fileTree: initialEntries, expandedDirs: { src: [oldEntry] } };
    await controller.moveSelectedPath("src/renamed.txt");
    await controller.downloadSelectedFile();
    await controller.deleteSelectedPath();
    state = { ...state, selectedFilePath: "empty" };
    await controller.moveSelectedPath("renamed-empty");
    state = { ...state, selectedFilePath: "renamed-empty", fileTree: [{ name: "renamed-empty", path: "renamed-empty", type: "directory" }] };
    await controller.deleteSelectedPath();

    expect(calls).toEqual([
      "create-file:src/new.txt",
      "create-dir:src/new-dir",
      "move-file:src/old.txt->src/renamed.txt",
      "download-file:src/renamed.txt",
      "delete-file:src/renamed.txt",
      "move-dir:empty->renamed-empty",
      "delete-dir:renamed-empty",
    ]);
    expect(state.selectedFilePath).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("drops stale expanded directories after moving a selected directory", async () => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/app", pathname: "/app", search: "", hash: "" },
      history: { replaceState: vi.fn(), pushState: vi.fn() },
    });
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project,
      selectedWorkspace: workspace,
      selectedFilePath: "empty",
      fileTree: [{ name: "empty", path: "empty", type: "directory" }],
      expandedDirs: { empty: [] },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      moveWorkspaceDirectory: () => Promise.resolve({ path: "renamed-empty" }),
      workspaceTree: (_projectId, _workspaceId, path) => {
        if (path === "") return Promise.resolve({
          path: "",
          entries: [{ name: "renamed-empty", path: "renamed-empty", type: "directory" }],
          scannedAt: "now",
          truncated: false,
        });
        throw new Error("Path does not exist");
      },
    };
    const controller = new FileExplorerController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      vi.fn(),
      { api },
    );

    await controller.moveSelectedPath("renamed-empty");

    expect(state.selectedFilePath).toBe("renamed-empty");
    expect(state.expandedDirs).toEqual({});
    expect(state.error).toBe("");
  });
});

describe("FileExplorerController workspace uploads", () => {
  it("tracks upload progress, completes from final responses, refreshes files, and selects the first uploaded file", async () => {
    const upload = controllableUpload();
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn, now: sequenceNow("start", "complete") });
    const files = [new File(["aa"], "a.txt", { type: "text/plain" }), new File(["bbb"], "b.txt")];

    const run = harness.controller.startWorkspaceUpload(files, { destinationFolder: "uploads/manual", overwrite: false });

    expect(run?.batchId).toBe("batch-1");
    expect(upload.fn).toHaveBeenCalledWith("project-1", "workspace-1", files, expect.objectContaining({
      destinationFolder: "uploads/manual",
      machineId: "remote-1",
      overwrite: false,
      createDirs: true,
    }));
    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      destinationFolder: "uploads/manual",
      overwrite: false,
      createDirs: true,
      status: "uploading",
      startedAt: "start",
      total: 5,
      files: [
        { name: "a.txt", path: "uploads/manual/a.txt", status: "uploading", total: 2 },
        { name: "b.txt", path: "uploads/manual/b.txt", status: "pending", total: 3 },
      ],
    });

    upload.emitProgress({
      currentFileIndex: 0,
      files: [
        { index: 0, name: "a.txt", path: "uploads/manual/a.txt", loaded: 1, total: 2, percent: 0.5, lengthComputable: true, done: false },
        { index: 1, name: "b.txt", path: "uploads/manual/b.txt", loaded: 0, total: 3, percent: 0, lengthComputable: true, done: false },
      ],
      loaded: 1,
      total: 5,
      percent: 0.2,
      done: false,
    });

    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      loaded: 1,
      percent: 0.2,
      files: [
        { path: "uploads/manual/a.txt", loaded: 1, percent: 0.5, status: "uploading" },
        { path: "uploads/manual/b.txt", loaded: 0, status: "pending" },
      ],
    });

    upload.resolve([
      writeResponse("uploads/manual/a.txt", 2),
      writeResponse("uploads/manual/b.txt", 3),
    ]);
    await run?.done;

    expect(harness.api.workspaceTree).toHaveBeenCalledWith("project-1", "workspace-1", "", "remote-1");
    expect(harness.api.workspaceFile).toHaveBeenCalledWith("project-1", "workspace-1", "uploads/manual/a.txt", "remote-1");
    expect(harness.updateUrl).toHaveBeenCalledWith({ replace: true });
    expect(harness.state.selectedFilePath).toBe("uploads/manual/a.txt");
    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      status: "completed",
      completedAt: "complete",
      loaded: 5,
      percent: 1,
      files: [
        { status: "completed", response: { path: "uploads/manual/a.txt", size: 2 } },
        { status: "completed", response: { path: "uploads/manual/b.txt", size: 3 } },
      ],
    });
  });

  it("defaults uploads to create parent folders without overwriting existing files", () => {
    const upload = controllableUpload();
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn });
    const files = [new File(["aa"], "a.txt")];

    const run = harness.controller.startWorkspaceUpload(files, { destinationFolder: "uploads" });

    expect(run?.batchId).toBe("batch-1");
    expect(upload.fn).toHaveBeenCalledWith("project-1", "workspace-1", files, expect.objectContaining({
      destinationFolder: "uploads",
      machineId: "remote-1",
      overwrite: false,
      createDirs: true,
    }));
    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      destinationFolder: "uploads",
      overwrite: false,
      createDirs: true,
    });
  });

  it("cancels an in-flight upload without setting the global error", async () => {
    const upload = controllableUpload({ rejectOnCancel: true });
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn, now: sequenceNow("start", "cancel") });
    const run = harness.controller.startWorkspaceUpload([new File(["aa"], "a.txt")], { destinationFolder: "uploads" });

    harness.controller.cancelWorkspaceUpload(run?.batchId ?? "missing");
    await run?.done;

    expect(upload.cancel).toHaveBeenCalledTimes(1);
    expect(harness.state.error).toBe("");
    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      status: "cancelled",
      completedAt: "cancel",
      error: "上传已取消",
      files: [{ status: "cancelled", error: "上传已取消" }],
    });
  });

  it("clears an in-flight upload by cancelling the request and removing the batch", async () => {
    const upload = controllableUpload({ rejectOnCancel: true });
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn });
    const run = harness.controller.startWorkspaceUpload([new File(["aa"], "a.txt")], { destinationFolder: "uploads" });

    expect(run?.batchId).toBe("batch-1");
    expect(harness.state.workspaceUploadBatches["batch-1"]?.status).toBe("uploading");

    harness.controller.clearWorkspaceUpload(run?.batchId ?? "missing");
    await run?.done;

    expect(upload.cancel).toHaveBeenCalledTimes(1);
    expect(harness.state.workspaceUploadBatches).toEqual({});
    expect(harness.state.error).toBe("");
  });

  it("keeps per-file errors accurate and refreshes after partial batch success", async () => {
    const upload = controllableUpload();
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn, now: sequenceNow("start", "fail") });
    const run = harness.controller.startWorkspaceUpload([new File(["aa"], "a.txt"), new File(["bbbb"], "b.txt")], { destinationFolder: "uploads" });

    upload.emitProgress({
      currentFileIndex: 1,
      files: [
        { index: 0, name: "a.txt", path: "uploads/a.txt", loaded: 2, total: 2, percent: 1, lengthComputable: true, done: true, error: "File already exists: uploads/a.txt" },
        { index: 1, name: "b.txt", path: "uploads/b.txt", loaded: 4, total: 4, percent: 1, lengthComputable: true, done: true },
      ],
      loaded: 6,
      total: 6,
      percent: 1,
      done: true,
    });
    upload.reject(new WorkspaceUploadBatchError(
      [{ index: 0, name: "a.txt", path: "uploads/a.txt", error: "File already exists: uploads/a.txt" }],
      [writeResponse("uploads/b.txt", 4)],
    ));
    await run?.done;

    expect(harness.api.workspaceTree).toHaveBeenCalledWith("project-1", "workspace-1", "", "remote-1");
    expect(harness.api.workspaceFile).toHaveBeenCalledWith("project-1", "workspace-1", "uploads/b.txt", "remote-1");
    expect(harness.state.error).toBe("");
    expect(harness.state.selectedFilePath).toBe("uploads/b.txt");
    expect(harness.state.workspaceUploadBatches["batch-1"]).toMatchObject({
      status: "error",
      completedAt: "fail",
      error: "File already exists: uploads/a.txt",
      loaded: 6,
      total: 6,
      percent: 1,
      files: [
        { path: "uploads/a.txt", status: "error", error: "File already exists: uploads/a.txt" },
        { path: "uploads/b.txt", status: "completed" },
      ],
    });
  });

  it("rejects unsafe upload destinations before starting a batch", () => {
    const upload = controllableUpload();
    const harness = createHarness({ uploadWorkspaceFiles: upload.fn });

    const run = harness.controller.startWorkspaceUpload([new File(["aa"], "a.txt")], { destinationFolder: "../outside" });

    expect(run).toBeUndefined();
    expect(upload.fn).not.toHaveBeenCalled();
    expect(harness.state.workspaceUploadBatches).toEqual({});
    expect(harness.state.error).toContain("上传目标不能包含路径穿越");
  });
});

function createHarness(deps: FileExplorerControllerDependencies = {}, statePatch: Partial<AppState> = {}) {
  installWindow("http://localhost/app");
  let state: AppState = {
    ...initialAppState(),
    selectedMachine: machine,
    selectedProject: project,
    selectedWorkspace: workspace,
    ...statePatch,
  };
  const api: NonNullable<FileExplorerControllerDependencies["api"]> = deps.api ?? {
    workspaceTree: vi.fn<NonNullable<FileExplorerControllerDependencies["api"]>["workspaceTree"]>((_projectId, _workspaceId, path = "") => Promise.resolve(treeResponse(path))),
    workspaceFile: vi.fn<NonNullable<FileExplorerControllerDependencies["api"]>["workspaceFile"]>((_projectId, _workspaceId, path) => Promise.resolve(fileResponse(path))),
    createWorkspaceFile: vi.fn(() => Promise.reject(new Error("createWorkspaceFile not used in this test"))),
    createWorkspaceDirectory: vi.fn(() => Promise.reject(new Error("createWorkspaceDirectory not used in this test"))),
    moveWorkspaceFile: vi.fn(() => Promise.reject(new Error("moveWorkspaceFile not used in this test"))),
    moveWorkspaceDirectory: vi.fn(() => Promise.reject(new Error("moveWorkspaceDirectory not used in this test"))),
    deleteWorkspaceFile: vi.fn(() => Promise.reject(new Error("deleteWorkspaceFile not used in this test"))),
    deleteWorkspaceDirectory: vi.fn(() => Promise.reject(new Error("deleteWorkspaceDirectory not used in this test"))),
    downloadWorkspaceFile: vi.fn(() => Promise.reject(new Error("downloadWorkspaceFile not used in this test"))),
  };
  const updateUrl = vi.fn();
  let batchSequence = 0;
  const controller = new FileExplorerController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    updateUrl,
    {
      ...deps,
      api,
      createUploadBatchId: deps.createUploadBatchId ?? (() => {
        batchSequence += 1;
        return `batch-${String(batchSequence)}`;
      }),
    },
  );
  return {
    controller,
    api,
    updateUrl,
    get state(): AppState { return state; },
  };
}

function installWindow(href: string): void {
  const url = new URL(href);
  const fakeWindow = {
    location: {
      href: url.href,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn(),
    },
  };
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
}

function controllableUpload(options: { rejectOnCancel?: boolean } = {}) {
  let resolveUpload: ((responses: WriteWorkspaceFileResponse[]) => void) | undefined;
  let rejectUpload: ((error: unknown) => void) | undefined;
  let uploadOptions: UploadWorkspaceFilesOptions | undefined;
  const cancel = vi.fn(() => {
    if (options.rejectOnCancel === true) rejectUpload?.(new WorkspaceUploadCancelledError());
  });
  const fn = vi.fn<UploadWorkspaceFiles>((_projectId, _workspaceId, _files, sentOptions = {}) => {
    uploadOptions = sentOptions;
    const promise = new Promise<WriteWorkspaceFileResponse[]>((resolve, reject) => {
      resolveUpload = resolve;
      rejectUpload = reject;
    });
    return { promise, cancel };
  });
  return {
    fn,
    cancel,
    emitProgress: (progress: WorkspaceUploadBatchProgress) => { uploadOptions?.onProgress?.(progress); },
    resolve: (responses: WriteWorkspaceFileResponse[]) => { resolveUpload?.(responses); },
    reject: (error: unknown) => { rejectUpload?.(error); },
  };
}

function sequenceNow(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? "now";
}

function treeResponse(path: string, entries: FileTreeEntry[] = []): FileTreeResponse {
  return { path, entries, scannedAt: "2026-06-25T00:00:00.000Z", truncated: false };
}

function fileResponse(path: string): FileContentResponse {
  return { path, encoding: "utf8", size: 2, modifiedAt: "2026-06-25T00:00:00.000Z", content: "aa", truncated: false, binary: false };
}

function writeResponse(path: string, size: number): WriteWorkspaceFileResponse {
  return { path, size, modifiedAt: "2026-06-25T00:00:00.000Z", created: true };
}
