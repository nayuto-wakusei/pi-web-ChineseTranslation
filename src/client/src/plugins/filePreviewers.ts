import type { FilePreviewerContribution, FilePreviewRequest } from "../../../plugin-api";
import type { WorkspacePluginBinding } from "./types";
import { snapshotDisplayMetadata } from "./displayMetadata";
import { snapshotContentSelectors } from "./contentRenderers";

export interface RegisteredFilePreviewer extends FilePreviewerContribution {
  readonly pluginId: string;
  readonly machineId?: string;
  readonly sourcePluginId?: string;
  readonly binding: WorkspacePluginBinding;
  readonly lifetime: AbortSignal;
}

/** Copy only public request metadata, never consumer-owned backend or callbacks. */
export function snapshotFilePreviewRequest(request: FilePreviewRequest): Readonly<FilePreviewRequest> {
  return Object.freeze({ machineId: request.machineId, projectId: request.projectId, workspaceId: request.workspaceId,
    file: Object.freeze({ ...request.file }) });
}

export function snapshotFilePreviewer(value: FilePreviewerContribution): FilePreviewerContribution {
  if (typeof value.title !== "string" || value.title.trim() === "") throw new Error("File previewer title must be non-empty");
  if (typeof value.render !== "function") throw new Error("File previewer render must be a callback");
  if (value.supports !== undefined && typeof value.supports !== "function") throw new Error("File previewer supports must be a callback");
  const renderMode: unknown = value.renderMode;
  if (renderMode !== undefined && renderMode !== "manual" && renderMode !== "automatic") throw new Error("File previewer renderMode must be manual or automatic");
  const fileExtensions = snapshotContentSelectors(value, true).fileExtensions ?? Object.freeze([]);
  const mimeSelectors: unknown = value.mimeTypes;
  const normalizedMimes: string[] = [];
  if (mimeSelectors !== undefined) {
    if (!Array.isArray(mimeSelectors)) throw new Error("File previewer MIME selectors must be an array");
    for (const selector of mimeSelectors) {
      const mime: unknown = selector;
      if (typeof mime !== "string" || !/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/iu.test(mime)) throw new Error("File previewer MIME selectors must be exact types or type/*");
      normalizedMimes.push(mime.toLowerCase());
    }
  }
  const mimeTypes = Object.freeze([...new Set(normalizedMimes)]);
  if (fileExtensions.length + mimeTypes.length === 0 && value.supports === undefined) throw new Error("File previewer must declare a selector or supports");
  return Object.freeze(snapshotDisplayMetadata<FilePreviewerContribution>(value, { id: value.id, title: value.title, fileExtensions, mimeTypes,
    renderMode: value.renderMode ?? "manual", ...(value.supports === undefined ? {} : { supports: value.supports.bind(value) }), render: value.render.bind(value) }));
}

export function filePreviewerMatches(previewer: FilePreviewerContribution, request: FilePreviewRequest): boolean {
  const snapshot = snapshotFilePreviewRequest(request);
  const name = snapshot.file.path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const mime = snapshot.file.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  const hasSelectors = (previewer.fileExtensions?.length ?? 0) + (previewer.mimeTypes?.length ?? 0) > 0;
  const matches = previewer.fileExtensions?.some((ext) => name.endsWith(`.${ext}`)) === true
    || previewer.mimeTypes?.some((type) => type === mime || (type.endsWith("/*") && mime?.startsWith(type.slice(0, -1)) === true)) === true;
  if (hasSelectors && !matches) return false;
  if (previewer.supports === undefined) return matches;
  try {
    const result: unknown = previewer.supports(snapshot);
    if (result !== null && typeof result === "object" && "then" in result && typeof result.then === "function") void Promise.resolve(result).catch((error: unknown) => { console.warn("File previewer eligibility failed", previewer.id, error); });
    if (typeof result !== "boolean") throw new Error("File previewer supports must return a boolean synchronously");
    return result;
  } catch (error) {
    console.warn("File previewer eligibility failed", previewer.id, error);
    return false;
  }
}
