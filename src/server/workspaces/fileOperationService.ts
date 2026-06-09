import { createReadStream, type ReadStream } from "node:fs";
import { lstat, mkdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { resolveInsideWorkspace, resolveParentInsideWorkspace } from "./pathSafety.js";

export interface WorkspacePathInput {
  path: string;
}

export interface WorkspaceMoveInput {
  fromPath: string;
  toPath: string;
}

export interface WorkspacePathResponse {
  path: string;
}

export interface WorkspaceDeleteResponse {
  deleted: true;
  path: string;
}

export interface WorkspaceDownload {
  path: string;
  filename: string;
  size: number;
  modifiedAt: string;
  stream: ReadStream;
}

export async function moveWorkspaceFile(rootPath: string, input: WorkspaceMoveInput): Promise<WorkspacePathResponse> {
  const move = await resolveMove(rootPath, input);
  const s = await lstat(move.sourceTarget);
  if (!s.isFile()) throw new Error("Path is not a file");
  await rename(move.sourceTarget, move.destinationTarget);
  return { path: move.destinationRelativePath };
}

export async function deleteWorkspaceFile(rootPath: string, path: string | undefined): Promise<WorkspaceDeleteResponse> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, relativePath } = await resolveInsideWorkspace(rootPath, path);
  const s = await lstat(target);
  if (!s.isFile()) throw new Error("Path is not a file");
  await unlink(target);
  return { deleted: true, path: relativePath };
}

export async function createWorkspaceDirectory(rootPath: string, input: WorkspacePathInput): Promise<WorkspacePathResponse> {
  if (!isPathInput(input)) throw new Error("Directory body must include path");
  const { target, relativePath } = await resolveParentInsideWorkspace(rootPath, input.path);
  await mkdir(target);
  return { path: relativePath };
}

export async function moveWorkspaceDirectory(rootPath: string, input: WorkspaceMoveInput): Promise<WorkspacePathResponse> {
  const move = await resolveMove(rootPath, input);
  if (move.destinationRelativePath.startsWith(`${move.sourceRelativePath}/`)) throw new Error("Directory cannot be moved inside itself");
  const s = await lstat(move.sourceTarget);
  if (!s.isDirectory()) throw new Error("Path is not a directory");
  await rename(move.sourceTarget, move.destinationTarget);
  return { path: move.destinationRelativePath };
}

export async function deleteWorkspaceDirectory(rootPath: string, path: string | undefined): Promise<WorkspaceDeleteResponse> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, relativePath } = await resolveInsideWorkspace(rootPath, path);
  const s = await lstat(target);
  if (!s.isDirectory()) throw new Error("Path is not a directory");
  await rmdir(target).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOTEMPTY") || isNodeErrorWithCode(error, "EEXIST")) throw new Error("Directory is not empty");
    throw error;
  });
  return { deleted: true, path: relativePath };
}

export async function readWorkspaceFileDownload(rootPath: string, path: string | undefined): Promise<WorkspaceDownload> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, relativePath } = await resolveInsideWorkspace(rootPath, path);
  const s = await stat(target);
  if (!s.isFile()) throw new Error("Path is not a file");
  return {
    path: relativePath,
    filename: basename(relativePath),
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    stream: createReadStream(target),
  };
}

async function resolveMove(rootPath: string, input: WorkspaceMoveInput) {
  if (!isMoveInput(input)) throw new Error("Move body must include fromPath and toPath");
  const source = await resolveInsideWorkspace(rootPath, input.fromPath);
  const destination = await resolveParentInsideWorkspace(rootPath, input.toPath);
  if (source.relativePath === destination.relativePath) throw new Error("Destination path must be different");
  return {
    sourceTarget: source.target,
    sourceRelativePath: source.relativePath,
    destinationTarget: destination.target,
    destinationRelativePath: destination.relativePath,
  };
}

function isPathInput(input: unknown): input is WorkspacePathInput {
  return typeof input === "object" && input !== null && typeof Reflect.get(input, "path") === "string";
}

function isMoveInput(input: unknown): input is WorkspaceMoveInput {
  return typeof input === "object"
    && input !== null
    && typeof Reflect.get(input, "fromPath") === "string"
    && typeof Reflect.get(input, "toPath") === "string";
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
