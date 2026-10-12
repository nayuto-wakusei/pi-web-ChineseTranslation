import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_INLINE_PREVIEW_BYTES } from "../../../shared/workspaceFiles";
import {
  uploadWorkspaceFile,
  WorkspaceUploadCancelledError,
  type FileContentResponse,
  type FileTreeResponse,
  type WriteWorkspaceFileResponse,
} from "../api";
import { createWorkspaceFiles, type CreateWorkspaceFilesOptions, type WorkspaceFilesApi } from "./workspaceFiles";
import type { WorkspaceInvalidation } from "./types";

const workspace = { id: "w-1", projectId: "p-1" };

const mutationInvalidation: WorkspaceInvalidation = {
  reason: "mutation",
  resources: ["workspace.files"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createWorkspaceFiles", () => {
  it("advertises v1 host policy and returns browser-ready bound preview references", () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-web/" });
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote a", hostOptions({ defaultUploadFolder: "workspace/uploads" }));

    expect(files.capabilityVersion).toBe(1);
    expect(files.defaultUploadFolder).toBe("workspace/uploads");
    expect(files.maxInlinePreviewBytes).toBe(MAX_INLINE_PREVIEW_BYTES);
    expect(files.previewUrl("reports/a #1.html", { version: "2026-06-25T00:00:00.000Z" })).toBe(
      "https://pi.example.test/nested/pi-web/api/machines/remote%20a/projects/p-1/workspaces/w-1/file/preview?path=reports%2Fa+%231.html&v=2026-06-25T00%3A00%3A00.000Z",
    );
    expect(files.downloadUrl("reports/a #1.html")).toBe(
      "https://pi.example.test/nested/pi-web/api/machines/remote%20a/projects/p-1/workspaces/w-1/file/preview?path=reports%2Fa+%231.html&download=1",
    );
  });

  it("listFiles forwards cancellation to the bound workspace and machine", async () => {
    const tree = testFileTreeResponse();
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.resolve(tree));
    const files = createWorkspaceFiles(fakeApi({ workspaceTree }), workspace, "remote-1", hostOptions());
    const controller = new AbortController();

    await expect(files.listFiles(".pi-web/relays", { signal: controller.signal })).resolves.toBe(tree);
    expect(workspaceTree).toHaveBeenCalledWith("p-1", "w-1", ".pi-web/relays", "remote-1", { signal: controller.signal });
  });

  it("listFiles rejects when the directory is missing, matching readFile error behavior", async () => {
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.reject(new Error("Path not found: .pi-web/relays")));
    const files = createWorkspaceFiles(fakeApi({ workspaceTree }), workspace, "local", hostOptions());

    await expect(files.listFiles(".pi-web/relays")).rejects.toThrow("Path not found: .pi-web/relays");
  });

  it("readFile forwards cancellation through the bound workspace and machine", async () => {
    const content = testFileContent("README.md");
    const workspaceFile = vi.fn<WorkspaceFilesApi["workspaceFile"]>(() => Promise.resolve(content));
    const files = createWorkspaceFiles(fakeApi({ workspaceFile }), workspace, "remote-1", hostOptions());
    const controller = new AbortController();

    await expect(files.readFile("README.md", { signal: controller.signal })).resolves.toBe(content);
    expect(workspaceFile).toHaveBeenCalledWith("p-1", "w-1", "README.md", "remote-1", { signal: controller.signal });
  });

  it("publishes workspace.files only after successful write, delete, and move mutations", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.resolve(testWriteFileResponse("out.txt")));
    const deleteWorkspaceFile = vi.fn<WorkspaceFilesApi["deleteWorkspaceFile"]>(() => Promise.resolve({ path: "old.txt", existed: true }));
    const moveWorkspaceFile = vi.fn<WorkspaceFilesApi["moveWorkspaceFile"]>(() => Promise.resolve({ fromPath: "old.txt", toPath: "new.txt", size: 0, modifiedAt: "2026-06-14T10:00:00.000Z" }));
    const onInvalidate = vi.fn();
    const files = createWorkspaceFiles(
      fakeApi({ writeWorkspaceFile, deleteWorkspaceFile, moveWorkspaceFile }),
      workspace,
      "local",
      hostOptions({ onInvalidate }),
    );

    await files.writeFile("out.txt", "hi");
    await files.deleteFile("old.txt");
    await files.moveFile("old.txt", "new.txt");

    expect(writeWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "out.txt", "hi", undefined, "local");
    expect(deleteWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "local");
    expect(moveWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "new.txt", undefined, "local");
    expect(onInvalidate).toHaveBeenCalledTimes(3);
    expect(onInvalidate).toHaveBeenNthCalledWith(1, mutationInvalidation);
    expect(onInvalidate).toHaveBeenNthCalledWith(2, mutationInvalidation);
    expect(onInvalidate).toHaveBeenNthCalledWith(3, mutationInvalidation);
  });

  it("does not publish invalidation when a mutation fails", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.reject(new Error("File exists: out.txt")));
    const onInvalidate = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "local", hostOptions({ onInvalidate }));

    await expect(files.writeFile("out.txt", "hi", { overwrite: false })).rejects.toThrow("File exists: out.txt");
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("starts one bound upload with safe defaults, progress, and success invalidation", async () => {
    const response = testWriteFileResponse("workspace/uploads/report.txt");
    const sourceCancel = vi.fn();
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise: Promise.resolve(response), cancel: sourceCancel }));
    const onProgress = vi.fn();
    const onInvalidate = vi.fn();
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1", hostOptions({
      defaultUploadFolder: "workspace/uploads",
      uploadWorkspaceFile: upload,
      onInvalidate,
    }));
    const file = new File(["report"], "report.txt", { type: "text/plain" });

    const task = files.uploadFile(file, { onProgress });
    expect(task.path).toBe("workspace/uploads/report.txt");
    expect(upload).toHaveBeenCalledWith("p-1", "w-1", { path: "workspace/uploads/report.txt", file }, {
      machineId: "remote-1",
      createDirs: true,
      overwrite: false,
      onProgress,
    });
    upload.mock.calls[0]?.[3]?.onProgress?.({ loaded: 3, total: 6, percent: 0.5, lengthComputable: true });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 3, total: 6, percent: 0.5, lengthComputable: true });

    await expect(task.completed).resolves.toBe(response);
    expect(onInvalidate).toHaveBeenCalledOnce();
    expect(onInvalidate).toHaveBeenCalledWith(mutationInvalidation);
    expect(sourceCancel).not.toHaveBeenCalled();
  });

  it("maps upload cancellation to AbortError and publishes no failed-upload invalidation", async () => {
    let rejectUpload: (error: unknown) => void = () => undefined;
    const promise = new Promise<WriteWorkspaceFileResponse>((_resolve, reject) => { rejectUpload = reject; });
    const sourceCancel = vi.fn(() => { rejectUpload(new WorkspaceUploadCancelledError()); });
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise, cancel: sourceCancel }));
    const onInvalidate = vi.fn();
    const files = createWorkspaceFiles(fakeApi(), workspace, "local", hostOptions({ uploadWorkspaceFile: upload, onInvalidate }));

    const task = files.uploadFile(new File(["x"], "cancel.txt"));
    task.cancel();

    await expect(task.completed).rejects.toMatchObject({ name: "AbortError" });
    expect(sourceCancel).toHaveBeenCalledOnce();
    expect(onInvalidate).not.toHaveBeenCalled();
  });
});

function hostOptions(overrides: Partial<CreateWorkspaceFilesOptions> = {}): CreateWorkspaceFilesOptions {
  return { defaultUploadFolder: ".pi-web/uploads", ...overrides };
}

function fakeApi(overrides: Partial<WorkspaceFilesApi> = {}): WorkspaceFilesApi {
  const unexpected = (name: string) => () => Promise.reject(new Error(`Unexpected ${name} call`));
  return {
    workspaceFile: vi.fn<WorkspaceFilesApi["workspaceFile"]>(unexpected("workspaceFile")),
    workspaceTree: vi.fn<WorkspaceFilesApi["workspaceTree"]>(unexpected("workspaceTree")),
    writeWorkspaceFile: vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(unexpected("writeWorkspaceFile")),
    deleteWorkspaceFile: vi.fn<WorkspaceFilesApi["deleteWorkspaceFile"]>(unexpected("deleteWorkspaceFile")),
    moveWorkspaceFile: vi.fn<WorkspaceFilesApi["moveWorkspaceFile"]>(unexpected("moveWorkspaceFile")),
    ...overrides,
  };
}

function testFileTreeResponse(path = ".pi-web/relays"): FileTreeResponse {
  return {
    path,
    entries: [{ name: "relays-panel-plugin", path: `${path}/relays-panel-plugin`, type: "directory", modifiedAt: "2026-06-14T10:00:00.000Z" }],
    scannedAt: "2026-06-14T10:00:01.000Z",
    truncated: false,
  };
}

function testFileContent(path: string): FileContentResponse {
  return {
    path,
    encoding: "utf8",
    size: 0,
    modifiedAt: "2026-06-14T10:00:00.000Z",
    content: "",
    truncated: false,
    binary: false,
  };
}

function testWriteFileResponse(path: string): WriteWorkspaceFileResponse {
  return {
    path,
    size: 2,
    modifiedAt: "2026-06-14T10:00:00.000Z",
    created: true,
  };
}


describe("preserved local host compatibility", () => {
it("binds directory operations to the original machine and publishes only successful mutations", async () => {
    const createWorkspaceDirectory = vi.fn<NonNullable<WorkspaceFilesApi["createWorkspaceDirectory"]>>((_project, _workspace, path) => Promise.resolve({ path }));
    const moveWorkspaceDirectory = vi.fn<NonNullable<WorkspaceFilesApi["moveWorkspaceDirectory"]>>((_project, _workspace, _from, path) => Promise.resolve({ path }));
    const deleteWorkspaceDirectory = vi.fn<NonNullable<WorkspaceFilesApi["deleteWorkspaceDirectory"]>>()
      .mockRejectedValueOnce(new Error("directory not empty")).mockResolvedValueOnce({ path: "b", deleted: true });
    const onInvalidate = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ createWorkspaceDirectory, moveWorkspaceDirectory, deleteWorkspaceDirectory }), workspace, "remote-a", undefined, { onInvalidate });
    await files.createDirectory?.("a");
    await files.moveDirectory?.("a", "b");
    await expect(files.deleteDirectory?.("b")).rejects.toThrow("directory not empty");
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    await files.deleteDirectory?.("b");
    expect(createWorkspaceDirectory).toHaveBeenCalledExactlyOnceWith("p-1", "w-1", "a", "remote-a");
    expect(moveWorkspaceDirectory).toHaveBeenCalledExactlyOnceWith("p-1", "w-1", "a", "b", "remote-a");
    expect(deleteWorkspaceDirectory).toHaveBeenLastCalledWith("p-1", "w-1", "b", "remote-a");
    expect(onInvalidate).toHaveBeenCalledTimes(3);
  });

it("publishes immutable resource invalidations after successful mutations only", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>()
      .mockResolvedValueOnce({ path: "a.txt", size: 2, modifiedAt: "now", created: true })
      .mockRejectedValueOnce(new Error("failed"));
    const onInvalidate = vi.fn<(invalidation: WorkspaceInvalidation) => void>();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "remote", undefined, { onInvalidate });
    await files.writeFile("a.txt", "hi");
    await expect(files.writeFile("b.txt", "hi")).rejects.toThrow("failed");
    expect(onInvalidate).toHaveBeenCalledExactlyOnceWith({ reason: "mutation", resources: ["workspace.files"] });
    expect(Object.isFrozen(onInvalidate.mock.calls[0]?.[0])).toBe(true);
    expect(Object.isFrozen(onInvalidate.mock.calls[0]?.[0].resources)).toBe(true);
  });

it("forwards read cancellation without changing workspace or machine identity", async () => {
    const workspaceFile = vi.fn<WorkspaceFilesApi["workspaceFile"]>(() => Promise.resolve(testFileContent("a.txt")));
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.resolve(testFileTreeResponse()));
    const signal = new AbortController().signal;
    const files = createWorkspaceFiles(fakeApi({ workspaceFile, workspaceTree }), workspace, "remote-1");
    await files.readFile("a.txt", { signal });
    await files.listFiles("", { signal });
    expect(workspaceFile).toHaveBeenCalledWith("p-1", "w-1", "a.txt", "remote-1", { signal });
    expect(workspaceTree).toHaveBeenCalledWith("p-1", "w-1", "", "remote-1", { signal });
  });

it("supports versioned preview and download references and the legacy alias", () => {
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1");
    const preview = new URL(files.previewUrl("a b.txt", { version: "new", modifiedAt: "old" }));
    const download = new URL(files.downloadUrl("a b.txt", { version: "new" }));
    expect(preview.pathname).toContain("/machines/remote-1/projects/p-1/workspaces/w-1/");
    expect(preview.searchParams.get("path")).toBe("a b.txt");
    expect(preview.searchParams.get("v")).toBe("new");
    expect(download.searchParams.get("v")).toBe("new");
    expect(download.searchParams.get("download")).toBe("1");
    expect(new URL(files.previewUrl("a.txt", { modifiedAt: "old" })).searchParams.get("v")).toBe("old");
  });

it("uploads through the scoped transport with progress and safe upstream defaults", async () => {
    const result = { path: "uploads/a.txt", size: 2, modifiedAt: "now", created: true };
    const cancel = vi.fn();
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise: Promise.resolve(result), cancel }));
    const changed = vi.fn();
    const progress = vi.fn();
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1", changed, { defaultUploadFolder: "uploads", uploadWorkspaceFile: upload });
    const file = new File(["hi"], "a.txt");
    const task = files.uploadFile(file, { onProgress: progress });
    expect(task.path).toBe("uploads/a.txt");
    expect(upload).toHaveBeenCalledWith("p-1", "w-1", { path: task.path, file }, { machineId: "remote-1", createDirs: true, overwrite: false, onProgress: progress });
    await expect(task.completed).resolves.toBe(result);
    expect(changed).toHaveBeenCalledOnce();
  });

it("cancels the transport, exposes AbortError and cleans up the signal listener", async () => {
    let rejectUpload!: (error: Error) => void;
    const promise = new Promise<never>((_resolve, reject) => { rejectUpload = reject; });
    const cancel = vi.fn(() => { rejectUpload(new WorkspaceUploadCancelledError()); });
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise, cancel }));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const changed = vi.fn();
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1", changed, { uploadWorkspaceFile: upload });
    const task = files.uploadFile(new File(["hi"], "a.txt"), { signal: controller.signal, destinationFolder: "new", folder: "old" });
    const rejected = expect(task.completed).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(task.path).toBe("new/a.txt");
    expect(cancel).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(changed).not.toHaveBeenCalled();
  });

it("rejects traversal and pre-aborted uploads without starting a transport", async () => {
    const upload = vi.fn<typeof uploadWorkspaceFile>();
    const files = createWorkspaceFiles(fakeApi(), workspace, "local", undefined, { uploadWorkspaceFile: upload });
    const file = new File(["hi"], "a.txt");
    expect(() => files.uploadFile(file, { destinationFolder: "../outside" })).toThrow("路径穿越");
    const controller = new AbortController();
    controller.abort();
    await expect(files.uploadFile(file, { signal: controller.signal }).completed).rejects.toMatchObject({ name: "AbortError" });
    expect(upload).not.toHaveBeenCalled();
  });

it("exposes explicit cancellation on the public upload task", async () => {
    let rejectUpload!: (error: Error) => void;
    const promise = new Promise<never>((_resolve, reject) => { rejectUpload = reject; });
    const cancel = vi.fn(() => { rejectUpload(new WorkspaceUploadCancelledError()); });
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise, cancel }));
    const files = createWorkspaceFiles(fakeApi(), workspace, "local", undefined, { uploadWorkspaceFile: upload });
    const task = files.uploadFile(new File(["hi"], "a.txt"));
    const rejected = expect(task.completed).rejects.toMatchObject({ name: "AbortError" });
    task.cancel();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

it("preserves transport errors and legacy destination options", async () => {
    const error = new Error("server rejected upload");
    const upload = vi.fn<typeof uploadWorkspaceFile>(() => ({ promise: Promise.reject(error), cancel: vi.fn() }));
    const changed = vi.fn();
    const files = createWorkspaceFiles(fakeApi(), workspace, "local", changed, { uploadWorkspaceFile: upload });
    const task = files.uploadFile(new File(["hi"], "a.txt"), { folder: "legacy", createDirs: false, overwrite: true });
    expect(task.path).toBe("legacy/a.txt");
    expect(upload.mock.calls[0]?.[3]).toEqual({ machineId: "local", createDirs: false, overwrite: true });
    await expect(task.completed).rejects.toBe(error);
    expect(changed).not.toHaveBeenCalled();
  });

it("listFiles resolves with the directory listing for the bound workspace and machine", async () => {
    const tree = testFileTreeResponse();
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.resolve(tree));
    const files = createWorkspaceFiles(fakeApi({ workspaceTree }), workspace, "remote-1");

    await expect(files.listFiles(".pi-web/relays")).resolves.toBe(tree);
    expect(workspaceTree).toHaveBeenCalledWith("p-1", "w-1", ".pi-web/relays", "remote-1", undefined);
  });

it("readFile reads through the bound workspace and machine", async () => {
    const content = testFileContent("README.md");
    const workspaceFile = vi.fn<WorkspaceFilesApi["workspaceFile"]>(() => Promise.resolve(content));
    const files = createWorkspaceFiles(fakeApi({ workspaceFile }), workspace, "remote-1");

    await expect(files.readFile("README.md")).resolves.toBe(content);
    expect(workspaceFile).toHaveBeenCalledWith("p-1", "w-1", "README.md", "remote-1", undefined);
  });

it("writeFile reports the change after a successful write", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.resolve({ path: "out.txt", size: 2, modifiedAt: "2026-06-14T10:00:00.000Z", created: true }));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "local", onFilesChanged);

    const result = await files.writeFile("out.txt", "hi");
    expect(result.created).toBe(true);
    expect(writeWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "out.txt", "hi", undefined, "local");
    expect(onFilesChanged).toHaveBeenCalledOnce();
  });

it("deleteFile and moveFile report the change after success", async () => {
    const deleteWorkspaceFile = vi.fn<WorkspaceFilesApi["deleteWorkspaceFile"]>(() => Promise.resolve({ path: "old.txt", existed: true }));
    const moveWorkspaceFile = vi.fn<WorkspaceFilesApi["moveWorkspaceFile"]>(() => Promise.resolve({ fromPath: "old.txt", toPath: "new.txt", size: 0, modifiedAt: "2026-06-14T10:00:00.000Z" }));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ deleteWorkspaceFile, moveWorkspaceFile }), workspace, "local", onFilesChanged);

    await files.deleteFile("old.txt");
    await files.moveFile("old.txt", "new.txt");
    expect(deleteWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "local");
    expect(moveWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "new.txt", undefined, "local");
    expect(onFilesChanged).toHaveBeenCalledTimes(2);
  });

it("does not report a change when a mutation fails", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.reject(new Error("File exists: out.txt")));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "local", onFilesChanged);

    await expect(files.writeFile("out.txt", "hi", { overwrite: false })).rejects.toThrow("File exists: out.txt");
    expect(onFilesChanged).not.toHaveBeenCalled();
  });
});
