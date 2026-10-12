import { MAX_INLINE_PREVIEW_BYTES } from "../../../shared/workspaceFiles";
import {
  uploadWorkspaceFile as defaultUploadWorkspaceFile,
  workspaceUploadPath,
  WorkspaceUploadCancelledError,
  type DeleteWorkspaceFileResponse,
  type FileContentResponse,
  type FileTreeResponse,
  type MoveWorkspaceFileOptions,
  type MoveWorkspaceFileResponse,
  type WriteWorkspaceFileOptions,
  type WriteWorkspaceFileResponse,
  type Workspace,
} from "../api";
import { workspaceFilePreviewUrl as defaultWorkspaceFilePreviewUrl } from "../api/urls";
import type {
  WorkspaceFileReferenceOptions,
  WorkspaceFileRequestOptions,
  WorkspaceFilesCapabilityV1,
  WorkspaceInvalidation,
} from "./types";

/**
 * API surface the workspace files helper needs. Structurally satisfied by
 * `workspacesApi`; declared here so the helper stays testable with fakes.
 */
export interface WorkspaceFilesApi {
  createWorkspaceDirectory?(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<{ path: string }>;
  moveWorkspaceDirectory?(projectId: string, workspaceId: string, fromPath: string, toPath: string, machineId?: string): Promise<{ path: string }>;
  deleteWorkspaceDirectory?(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<{ path: string; deleted: true }>;
  workspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string, options?: WorkspaceFileRequestOptions): Promise<FileContentResponse>;
  workspaceTree(projectId: string, workspaceId: string, path?: string, machineId?: string, options?: WorkspaceFileRequestOptions): Promise<FileTreeResponse>;
  writeWorkspaceFile(projectId: string, workspaceId: string, path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions, machineId?: string): Promise<WriteWorkspaceFileResponse>;
  deleteWorkspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<DeleteWorkspaceFileResponse>;
  moveWorkspaceFile(projectId: string, workspaceId: string, fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions, machineId?: string): Promise<MoveWorkspaceFileResponse>;
}

export interface CreateWorkspaceFilesOptions {
  readonly defaultUploadFolder: string;
  readonly maxInlinePreviewBytes?: number;
  readonly onInvalidate?: (invalidation: WorkspaceInvalidation) => void;
  readonly uploadWorkspaceFile?: typeof defaultUploadWorkspaceFile;
  readonly workspaceFilePreviewUrl?: typeof defaultWorkspaceFilePreviewUrl;
}

export type WorkspaceFilesOptions = Partial<CreateWorkspaceFilesOptions>;

const workspaceFilesMutationInvalidation: WorkspaceInvalidation = Object.freeze({
  reason: "mutation",
  resources: Object.freeze(["workspace.files"] as const),
});

/**
 * Build the versioned `files` capability exposed to workspace callbacks.
 * Authority is captured here: callers cannot choose a project, workspace, or
 * machine. Host adapters retain URL resolution, federation, and transport.
 */
export function createWorkspaceFiles(
  api: WorkspaceFilesApi,
  workspace: Pick<Workspace, "id" | "projectId">,
  machineId: string,
  optionsOrChanged?: CreateWorkspaceFilesOptions | (() => void),
  legacyOptions: WorkspaceFilesOptions = {},
): WorkspaceFilesCapabilityV1 {
  const options: WorkspaceFilesOptions = typeof optionsOrChanged === "function" || optionsOrChanged === undefined ? legacyOptions : optionsOrChanged;
  const onFilesChanged = typeof optionsOrChanged === "function" ? optionsOrChanged : undefined;
  const projectId = workspace.projectId;
  const workspaceId = workspace.id;
  const createDirectory = api.createWorkspaceDirectory?.bind(api);
  const moveDirectory = api.moveWorkspaceDirectory?.bind(api);
  const deleteDirectory = api.deleteWorkspaceDirectory?.bind(api);
  const previewUrl = options.workspaceFilePreviewUrl ?? defaultWorkspaceFilePreviewUrl;
  const uploadFile = options.uploadWorkspaceFile ?? defaultUploadWorkspaceFile;
  const publishMutation = () => { onFilesChanged?.(); options.onInvalidate?.(workspaceFilesMutationInvalidation); };

  return {
    capabilityVersion: 1,
    defaultUploadFolder: options.defaultUploadFolder ?? "",
    maxInlinePreviewBytes: options.maxInlinePreviewBytes ?? MAX_INLINE_PREVIEW_BYTES,
    ...(createDirectory === undefined ? {} : { createDirectory: async (path: string) => {
      const result = await createDirectory(projectId, workspaceId, path, machineId);
      publishMutation();
      return result;
    } }),
    ...(moveDirectory === undefined ? {} : { moveDirectory: async (fromPath: string, toPath: string) => {
      const result = await moveDirectory(projectId, workspaceId, fromPath, toPath, machineId);
      publishMutation();
      return result;
    } }),
    ...(deleteDirectory === undefined ? {} : { deleteDirectory: async (path: string) => {
      const result = await deleteDirectory(projectId, workspaceId, path, machineId);
      publishMutation();
      return result;
    } }),
    readFile: (path, requestOptions) => api.workspaceFile(projectId, workspaceId, path, machineId, requestOptions),
    listFiles: (path, requestOptions) => api.workspaceTree(projectId, workspaceId, path, machineId, requestOptions),
    writeFile: async (path, content, writeOptions) => {
      const result = await api.writeWorkspaceFile(projectId, workspaceId, path, content, writeOptions, machineId);
      publishMutation();
      return result;
    },
    deleteFile: async (path) => {
      const result = await api.deleteWorkspaceFile(projectId, workspaceId, path, machineId);
      publishMutation();
      return result;
    },
    moveFile: async (fromPath, toPath, moveOptions) => {
      const result = await api.moveWorkspaceFile(projectId, workspaceId, fromPath, toPath, moveOptions, machineId);
      publishMutation();
      return result;
    },
    previewUrl: (path, referenceOptions) => previewUrl(projectId, workspaceId, path, {
      machineId,
      ...referenceVersion(referenceOptions),
    }),
    downloadUrl: (path, referenceOptions) => previewUrl(projectId, workspaceId, path, {
      machineId,
      download: true,
      ...referenceVersion(referenceOptions),
    }),
    uploadFile: (file, uploadOptions) => {
      const path = workspaceUploadPath(uploadOptions?.destinationFolder ?? uploadOptions?.folder ?? options.defaultUploadFolder ?? "", file.name);
      const signal = uploadOptions?.signal;
      if (signal?.aborted === true) {
        return { path, completed: Promise.reject(publicUploadError(new WorkspaceUploadCancelledError())), cancel: () => { /* No transport was started. */ } };
      }
      const task = uploadFile(projectId, workspaceId, { path, file }, {
        machineId,
        createDirs: uploadOptions?.createDirs ?? true,
        overwrite: uploadOptions?.overwrite ?? false,
        ...(uploadOptions?.onProgress === undefined ? {} : { onProgress: uploadOptions.onProgress }),
      });
      const cancel = () => { task.cancel(); };
      signal?.addEventListener("abort", cancel, { once: true });
      const completed = task.promise.then(
        (result) => {
          publishMutation();
          return result;
        },
        (error: unknown) => { throw publicUploadError(error); },
      ).finally(() => { signal?.removeEventListener("abort", cancel); });
      return { path, completed, cancel };
    },
  };
}

function referenceVersion(reference: WorkspaceFileReferenceOptions | undefined): { modifiedAt?: string } {
  const version = reference?.version ?? reference?.modifiedAt;
  return version === undefined ? {} : { modifiedAt: version };
}

function publicUploadError(error: WorkspaceUploadCancelledError): Error;
function publicUploadError(error: unknown): unknown;
function publicUploadError(error: unknown): unknown {
  if (!(error instanceof WorkspaceUploadCancelledError)) return error;
  if (typeof DOMException !== "undefined") return new DOMException(error.message, "AbortError");
  const abortError = new Error(error.message);
  abortError.name = "AbortError";
  return abortError;
}
