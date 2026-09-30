import { MAX_INLINE_PREVIEW_BYTES } from "../../../shared/workspaceFiles";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import { uploadWorkspaceFile as defaultUploadWorkspaceFile, workspaceUploadPath, WorkspaceUploadCancelledError } from "../api/workspaceUploads";
import { workspaceFilePreviewUrl } from "../api/urls";
import type { WorkspaceFileReferenceOptions, WorkspaceFileRequestOptions, WorkspaceFilesCapabilityV1 } from "./types";
import type { WorkspaceInvalidation } from "./types";

export interface WorkspaceFilesOptions {
  readonly defaultUploadFolder?: string;
  readonly uploadWorkspaceFile?: typeof defaultUploadWorkspaceFile;
  readonly onInvalidate?: (invalidation: WorkspaceInvalidation) => void;
}

const mutationInvalidation: WorkspaceInvalidation = Object.freeze({ reason: "mutation", resources: Object.freeze(["workspace.files"] as const) });

/**
 * API surface the workspace files helper needs. Structurally satisfied by
 * `workspacesApi`; declared here so the helper stays testable with fakes.
 */
export interface WorkspaceFilesApi {
  workspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string, options?: WorkspaceFileRequestOptions): Promise<FileContentResponse>;
  workspaceTree(projectId: string, workspaceId: string, path?: string, machineId?: string, options?: WorkspaceFileRequestOptions): Promise<FileTreeResponse>;
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
export function createWorkspaceFiles(api: WorkspaceFilesApi, workspace: Pick<Workspace, "id" | "projectId">, machineId: string, onFilesChanged?: () => void, options: WorkspaceFilesOptions = {}): WorkspaceFilesCapabilityV1 {
  const scope = { projectId: workspace.projectId, workspaceId: workspace.id, machineId };
  const uploadFile = options.uploadWorkspaceFile ?? defaultUploadWorkspaceFile;
  const defaultUploadFolder = options.defaultUploadFolder ?? "";
  const publishMutation = () => {
    onFilesChanged?.();
    options.onInvalidate?.(mutationInvalidation);
  };
  return {
    capabilityVersion: 1,
    defaultUploadFolder,
    maxInlinePreviewBytes: MAX_INLINE_PREVIEW_BYTES,
    readFile: (path, requestOptions) => api.workspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId, requestOptions),
    listFiles: (path, requestOptions) => api.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId, requestOptions),
    previewUrl: (path, reference) => workspaceFilePreviewUrl(scope.projectId, scope.workspaceId, path, { machineId, ...referenceVersion(reference) }),
    downloadUrl: (path, reference) => workspaceFilePreviewUrl(scope.projectId, scope.workspaceId, path, { machineId, download: true, ...referenceVersion(reference) }),
    uploadFile: (file, uploadOptions) => {
      const path = workspaceUploadPath(uploadOptions?.destinationFolder ?? uploadOptions?.folder ?? defaultUploadFolder, file.name);
      const signal = uploadOptions?.signal;
      if (signal?.aborted === true) {
        return { path, completed: Promise.reject(new DOMException("Upload aborted", "AbortError")), cancel: () => { /* No transport was started. */ } };
      }
      const task = uploadFile(scope.projectId, scope.workspaceId, { path, file }, {
        machineId,
        createDirs: uploadOptions?.createDirs ?? true,
        overwrite: uploadOptions?.overwrite ?? false,
        ...(uploadOptions?.onProgress === undefined ? {} : { onProgress: uploadOptions.onProgress }),
      });
      const cancel = () => { task.cancel(); };
      signal?.addEventListener("abort", cancel, { once: true });
      const completed = task.promise.then((result) => {
        publishMutation();
        return result;
      }, (error: unknown) => {
        if (error instanceof WorkspaceUploadCancelledError) throw new DOMException(error.message, "AbortError");
        throw error;
      }).finally(() => { signal?.removeEventListener("abort", cancel); });
      return { path, completed, cancel };
    },
    writeFile: async (path, content, options) => {
      const result = await api.writeWorkspaceFile(scope.projectId, scope.workspaceId, path, content, options, scope.machineId);
      publishMutation();
      return result;
    },
    deleteFile: async (path) => {
      const result = await api.deleteWorkspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId);
      publishMutation();
      return result;
    },
    moveFile: async (fromPath, toPath, options) => {
      const result = await api.moveWorkspaceFile(scope.projectId, scope.workspaceId, fromPath, toPath, options, scope.machineId);
      publishMutation();
      return result;
    },
  };
}

function referenceVersion(reference: WorkspaceFileReferenceOptions | undefined): { modifiedAt?: string } {
  const version = reference?.version ?? reference?.modifiedAt;
  return version === undefined ? {} : { modifiedAt: version };
}
