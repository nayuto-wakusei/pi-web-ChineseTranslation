import { stat, writeFile } from "node:fs/promises";
import type { WorkspaceUploadResponse } from "../../shared/apiTypes.js";
import { resolveParentInsideWorkspace } from "./pathSafety.js";

export interface WorkspaceUploadInput {
  path: string;
  contentBase64: string;
}

export async function uploadWorkspaceFile(rootPath: string, input: WorkspaceUploadInput): Promise<WorkspaceUploadResponse> {
  if (!isWorkspaceUploadInput(input)) throw new Error("Upload body must include path and contentBase64");
  if (!isBase64Content(input.contentBase64)) throw new Error("contentBase64 must be valid base64");
  const { target, relativePath } = await resolveParentInsideWorkspace(rootPath, input.path);
  const buffer = Buffer.from(input.contentBase64, "base64");
  await writeFile(target, buffer);
  const s = await stat(target);
  return { path: relativePath, size: s.size, modifiedAt: s.mtime.toISOString() };
}

function isWorkspaceUploadInput(input: unknown): input is WorkspaceUploadInput {
  return typeof input === "object"
    && input !== null
    && typeof Reflect.get(input, "path") === "string"
    && typeof Reflect.get(input, "contentBase64") === "string";
}

function isBase64Content(value: string): boolean {
  return value === "" || /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
