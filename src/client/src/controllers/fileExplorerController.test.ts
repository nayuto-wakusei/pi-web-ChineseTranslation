import { afterEach, describe, expect, it, vi } from "vitest";
import { api as defaultApi, type FileTreeEntry, type Project, type Workspace, type WorkspaceUploadResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { FileExplorerController } from "./fileExplorerController";

const project: Project = { id: "project-1", name: "Project", path: "/repo", createdAt: "now" };
const workspace: Workspace = { id: "workspace-1", projectId: project.id, path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false };

describe("FileExplorerController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads selected files next to the currently selected file", async () => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/app", pathname: "/app", search: "", hash: "" },
      history: { replaceState: vi.fn(), pushState: vi.fn() },
    });
    let state: AppState = { ...initialAppState(), selectedProject: project, selectedWorkspace: workspace, selectedFilePath: "src/current.ts" };
    const uploads: { path: string; file: File }[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      uploadWorkspaceFile: (_projectId, _workspaceId, path, file) => {
        uploads.push({ path, file });
        return Promise.resolve({ path, size: file.size, modifiedAt: "now" } satisfies WorkspaceUploadResponse);
      },
      workspaceTree: () => Promise.resolve({ path: "", entries: [], scannedAt: "now", truncated: false }),
      workspaceFile: () => Promise.resolve({ path: "src/note.txt", encoding: "utf8", size: 5, modifiedAt: "now", content: "hello", truncated: false, binary: false }),
    };
    const updateUrl = vi.fn();
    const controller = new FileExplorerController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      updateUrl,
      { api },
    );

    await controller.uploadFiles([new File(["hello"], "note.txt")]);

    expect(uploads.map((upload) => upload.path)).toEqual(["src/note.txt"]);
    expect(state.selectedFilePath).toBe("src/note.txt");
    expect(state.error).toBe("");
    expect(updateUrl).toHaveBeenCalledWith({ replace: true });
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
        return Promise.resolve({ path, size: 0, modifiedAt: "now" });
      },
      createWorkspaceDirectory: (_projectId, _workspaceId, path) => {
        calls.push(`create-dir:${path}`);
        return Promise.resolve({ path });
      },
      moveWorkspaceFile: (_projectId, _workspaceId, fromPath, toPath) => {
        calls.push(`move-file:${fromPath}->${toPath}`);
        return Promise.resolve({ path: toPath });
      },
      moveWorkspaceDirectory: (_projectId, _workspaceId, fromPath, toPath) => {
        calls.push(`move-dir:${fromPath}->${toPath}`);
        return Promise.resolve({ path: toPath });
      },
      deleteWorkspaceFile: (_projectId, _workspaceId, path) => {
        calls.push(`delete-file:${path}`);
        return Promise.resolve({ deleted: true, path });
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
