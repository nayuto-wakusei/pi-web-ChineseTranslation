import { MAX_INLINE_PREVIEW_BYTES } from "../../../shared/workspaceFiles";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import { workspaceFileDownloadUrl, workspaceFilePreviewUrl } from "../api/urls";
import type { WorkspaceFileUploadOptions, WorkspaceFilesCapabilityV1 } from "./types";

/**
 * API surface the workspace files helper needs. Structurally satisfied by
 * `workspacesApi`; declared here so the helper stays testable with fakes.
 */
export interface WorkspaceFilesApi {
  workspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<FileContentResponse>;
  workspaceTree(projectId: string, workspaceId: string, path?: string, machineId?: string): Promise<FileTreeResponse>;
  writeWorkspaceFile(projectId: string, workspaceId: string, path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions, machineId?: string): Promise<WriteWorkspaceFileResponse>;
  deleteWorkspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<DeleteWorkspaceFileResponse>;
  moveWorkspaceFile(projectId: string, workspaceId: string, fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions, machineId?: string): Promise<MoveWorkspaceFileResponse>;
}

/**
 * Build the `files` helper exposed to workspace panel and label callbacks.
 * Every call is bound to the callback's workspace and machine, so local and
 * federated machines behave the same. `onFilesChanged` runs after a mutation
 * succeeds so the host can refresh its file explorer.
 */
export function createWorkspaceFiles(api: WorkspaceFilesApi, workspace: Pick<Workspace, "id" | "projectId">, machineId: string, onFilesChanged?: () => void): WorkspaceFilesCapabilityV1 {
  const scope = { projectId: workspace.projectId, workspaceId: workspace.id, machineId };
  return {
    capabilityVersion: 1,
    defaultUploadFolder: "",
    maxInlinePreviewBytes: MAX_INLINE_PREVIEW_BYTES,
    readFile: (path) => api.workspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId),
    listFiles: (path) => api.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId),
    previewUrl: (path, options) => workspaceFilePreviewUrl(scope.projectId, scope.workspaceId, path, { ...options, machineId: scope.machineId }),
    downloadUrl: (path, options) => workspaceFileDownloadUrl(scope.projectId, scope.workspaceId, path, { ...options, machineId: scope.machineId }),
    uploadFile: (file, options) => ({
      completed: uploadWorkspaceFile(api, scope, file, options).then((result) => {
        onFilesChanged?.();
        return result;
      }),
    }),
    writeFile: async (path, content, options) => {
      const result = await api.writeWorkspaceFile(scope.projectId, scope.workspaceId, path, content, options, scope.machineId);
      onFilesChanged?.();
      return result;
    },
    deleteFile: async (path) => {
      const result = await api.deleteWorkspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId);
      onFilesChanged?.();
      return result;
    },
    moveFile: async (fromPath, toPath, options) => {
      const result = await api.moveWorkspaceFile(scope.projectId, scope.workspaceId, fromPath, toPath, options, scope.machineId);
      onFilesChanged?.();
      return result;
    },
  };
}

async function uploadWorkspaceFile(
  api: WorkspaceFilesApi,
  scope: { projectId: string; workspaceId: string; machineId: string },
  file: File,
  options: WorkspaceFileUploadOptions | undefined,
): Promise<WriteWorkspaceFileResponse> {
  const signal = options?.signal;
  if (signal?.aborted === true) throw new DOMException("Upload aborted", "AbortError");
  const folder = options?.folder?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? "";
  const name = file.name.replace(/\\/g, "/").split("/").pop() ?? "";
  if (name === "" || name === "." || name === "..") throw new Error("上传文件名无效。");
  const path = folder === "" ? name : `${folder}/${name}`;
  const content = new Uint8Array(await file.arrayBuffer());
  return api.writeWorkspaceFile(scope.projectId, scope.workspaceId, path, content, {
    overwrite: options?.overwrite !== false,
  }, scope.machineId);
}
