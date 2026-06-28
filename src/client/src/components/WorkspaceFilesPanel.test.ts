import { describe, expect, it, vi } from "vitest";
import type { WorkspaceUploadBatchState } from "../workspaceUploadState";
import { startDirectWorkspaceUpload, uploadBatchProgressValue, uploadBatchStatusLabel, workspaceUploadBatchesForScope, workspaceUploadReviewDefaults, workspaceUploadReviewError } from "./WorkspaceFilesPanel";

describe("workspaceUploadBatchesForScope", () => {
  it("filters upload batches to the selected project, workspace, and machine", () => {
    const matchingOlder = uploadBatch({ id: "older", startedAt: "2026-06-25T00:00:00.000Z" });
    const matchingNewer = uploadBatch({ id: "newer", startedAt: "2026-06-25T00:01:00.000Z" });
    const batches = {
      older: matchingOlder,
      otherProject: uploadBatch({ id: "otherProject", projectId: "project-2" }),
      otherWorkspace: uploadBatch({ id: "otherWorkspace", workspaceId: "workspace-2" }),
      otherMachine: uploadBatch({ id: "otherMachine", machineId: "remote-1" }),
      newer: matchingNewer,
    };

    expect(workspaceUploadBatchesForScope(batches, { projectId: "project-1", workspaceId: "workspace-1", machineId: "local" })).toEqual([matchingNewer, matchingOlder]);
  });
});

describe("workspace upload terminal display", () => {
  it("uses terminal labels and full progress for failed batches instead of stale partial percentages", () => {
    const failed = uploadBatch({ status: "error", percent: 0.31 });

    expect(uploadBatchStatusLabel(failed)).toBe("失败");
    expect(uploadBatchProgressValue(failed)).toBe(1);
  });

  it("keeps live percentages while a batch is uploading", () => {
    const uploading = uploadBatch({ status: "uploading", percent: 0.31 });

    expect(uploadBatchStatusLabel(uploading)).toBe("31%");
    expect(uploadBatchProgressValue(uploading)).toBe(0.31);
  });
});

describe("workspace upload defaults", () => {
  it("uses safe defaults for the review dialog", () => {
    expect(workspaceUploadReviewDefaults("project/uploads")).toEqual({
      destinationFolder: "project/uploads",
      createDirs: true,
      overwrite: false,
    });
  });

  it("starts drag/drop uploads directly with safe defaults", () => {
    const files = [new File(["a"], "a.txt")];
    const onStartWorkspaceUpload = vi.fn(() => ({ batchId: "batch-1", done: Promise.resolve() }));

    const run = startDirectWorkspaceUpload({ workspaceUploadDefaultFolder: "project/uploads", onStartWorkspaceUpload }, files);

    expect(run?.batchId).toBe("batch-1");
    expect(onStartWorkspaceUpload).toHaveBeenCalledWith(files, {
      destinationFolder: "project/uploads",
      createDirs: true,
      overwrite: false,
      selectUploadedFile: true,
    });
  });

  it("ignores empty drag/drop uploads", () => {
    const onStartWorkspaceUpload = vi.fn(() => ({ batchId: "batch-1", done: Promise.resolve() }));

    expect(startDirectWorkspaceUpload({ workspaceUploadDefaultFolder: "project/uploads", onStartWorkspaceUpload }, [])).toBeUndefined();
    expect(onStartWorkspaceUpload).not.toHaveBeenCalled();
  });
});

describe("workspaceUploadReviewError", () => {
  it("accepts one or more files with a workspace-relative destination", () => {
    expect(workspaceUploadReviewError([
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ], ".pi-web/uploads")).toBeUndefined();
  });

  it("rejects empty selections and unsafe destinations before starting an upload", () => {
    expect(workspaceUploadReviewError([], ".pi-web/uploads")).toBe("请至少选择一个要上传的文件。");
    expect(workspaceUploadReviewError([new File(["a"], "a.txt")], "../outside")).toContain("path traversal");
  });
});

function uploadBatch(patch: Partial<WorkspaceUploadBatchState> = {}): WorkspaceUploadBatchState {
  return {
    id: patch.id ?? "batch-1",
    projectId: patch.projectId ?? "project-1",
    workspaceId: patch.workspaceId ?? "workspace-1",
    machineId: patch.machineId ?? "local",
    destinationFolder: patch.destinationFolder ?? ".pi-web/uploads",
    overwrite: patch.overwrite ?? true,
    createDirs: patch.createDirs ?? true,
    files: patch.files ?? [],
    currentFileIndex: patch.currentFileIndex ?? -1,
    loaded: patch.loaded ?? 0,
    total: patch.total ?? 0,
    percent: patch.percent ?? 0,
    status: patch.status ?? "uploading",
    startedAt: patch.startedAt ?? "2026-06-25T00:00:00.000Z",
    ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
    ...(patch.error === undefined ? {} : { error: patch.error }),
  };
}
