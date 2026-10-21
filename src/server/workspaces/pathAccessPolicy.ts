import { WorkspaceUserError } from "./workspaceUserError.js";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { PiWebPathAccessConfig } from "../../shared/apiTypes.js";
import { normalizeRelativePath } from "./pathSafety.js";

export interface AllowedPathRoot {
  /** Raw config value for diagnostics. */
  source: string;
  /** Host-absolute path after expanding ~ and normalizing syntax. */
  path: string;
  /** Canonical directory root used for containment checks. */
  realPath: string;
}

export interface PathAccessPolicy {
  workspaceRoot: string;
  allowedRoots: AllowedPathRoot[];
}

export type PathAccessTargetKind = "workspace" | "allowed";

export interface ResolvedPathAccessTarget {
  kind: PathAccessTargetKind;
  /** Canonical root that granted access: workspace root or allowed root. */
  root: string;
  /** Canonical existing target path. */
  target: string;
  /** Requestable path returned to clients and used to build child paths. */
  displayPath: string;
}

export interface PathAccessPolicyOptions {
  homeDir?: string;
}

export async function createPathAccessPolicy(workspaceRootPath: string, pathAccess: PiWebPathAccessConfig | undefined, options: PathAccessPolicyOptions = {}): Promise<PathAccessPolicy> {
  return {
    workspaceRoot: await canonicalDirectory(workspaceRootPath, "workspace"),
    allowedRoots: await resolveAllowedRoots(pathAccess?.allowedPaths ?? [], options),
  };
}

export async function resolveWorkspacePathAccessTarget(rootPath: string, requestedPath: string | undefined, pathAccess?: PiWebPathAccessConfig, options: PathAccessPolicyOptions = {}): Promise<ResolvedPathAccessTarget> {
  const request = requestedPath ?? "";
  const workspaceRoot = await canonicalDirectory(rootPath, "workspace");
  const allowedRoots = isAbsoluteishPath(request) ? await resolveAllowedRoots(pathAccess?.allowedPaths ?? [], options) : [];
  return resolvePathAccessTarget({ workspaceRoot, allowedRoots }, requestedPath, options);
}

export async function resolvePathAccessTarget(policy: PathAccessPolicy, requestedPath: string | undefined, options: PathAccessPolicyOptions = {}): Promise<ResolvedPathAccessTarget> {
  const request = requestedPath ?? "";
  if (isAbsoluteishPath(request)) return resolveAllowedTarget(policy, request, options);

  const displayPath = normalizeRelativePath(request);
  const target = await canonicalExistingPath(resolve(policy.workspaceRoot, displayPath));
  ensureInside(policy.workspaceRoot, target);
  return { kind: "workspace", root: policy.workspaceRoot, target, displayPath };
}

export function isAbsoluteishPath(path: string): boolean {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\") || isAbsolute(path) || win32.isAbsolute(path);
}

async function resolveAllowedRoots(allowedPaths: readonly string[], options: PathAccessPolicyOptions): Promise<AllowedPathRoot[]> {
  const roots: AllowedPathRoot[] = [];
  for (const source of allowedPaths) {
    const expanded = expandAbsoluteishPath(source, options, new WorkspaceUserError("server.files.allowedPathMustBeAbsolute", "Allowed path must be absolute or start with ~: {path}", { path: source }));
    const realPath = await canonicalDirectory(expanded, "allowed", source);
    if (roots.some((root) => root.realPath === realPath)) continue;
    roots.push({ source, path: expanded, realPath });
  }
  return roots;
}

async function resolveAllowedTarget(policy: PathAccessPolicy, request: string, options: PathAccessPolicyOptions): Promise<ResolvedPathAccessTarget> {
  if (policy.allowedRoots.length === 0) throw new WorkspaceUserError("server.files.absolutePathsDenied", "Absolute paths are not allowed");

  const displayPath = expandAbsoluteishPath(request, options, new WorkspaceUserError("server.files.pathNotAbsolute", "Path is not absolute: {path}", { path: request }));
  const target = await canonicalExistingPath(displayPath);
  const root = policy.allowedRoots.find((allowedRoot) => isInsideOrSame(allowedRoot.realPath, target));
  if (root === undefined) throw new WorkspaceUserError("server.files.pathNotAllowed", "Path is outside allowed paths");
  return { kind: "allowed", root: root.realPath, target, displayPath };
}

function expandAbsoluteishPath(path: string, options: PathAccessPolicyOptions, relativeError: WorkspaceUserError): string {
  const home = options.homeDir ?? homedir();
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  if (win32.isAbsolute(path)) throw new WorkspaceUserError("server.files.absolutePathInvalid", "Absolute path is not valid on this host: {path}", { path });
  throw relativeError;
}

async function canonicalDirectory(path: string, kind: "workspace" | "allowed", source = path): Promise<string> {
  const missing = kind === "workspace"
    ? new WorkspaceUserError("server.files.workspacePathMissing", "Workspace path does not exist")
    : new WorkspaceUserError("server.files.allowedPathMissing", "Allowed path {path} does not exist", { path: source });
  const canonical = await canonicalExistingPath(path, missing);
  const result = await stat(canonical);
  if (!result.isDirectory()) throw kind === "workspace"
    ? new WorkspaceUserError("server.files.workspaceMustBeDirectory", "Workspace path must be a directory")
    : new WorkspaceUserError("server.files.allowedMustBeDirectory", "Allowed path {path} must be a directory", { path: source });
  return canonical;
}

async function canonicalExistingPath(path: string, missing = new WorkspaceUserError("server.files.pathMissing", "Path does not exist")): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new WorkspaceUserError(missing.key, missing.fallback, missing.parameters, { cause: error });
    throw error;
  }
}

function ensureInside(root: string, target: string): void {
  if (!isInsideOrSame(root, target)) throw new WorkspaceUserError("server.files.pathOutsideWorkspace", "Path escapes workspace");
}

function isInsideOrSame(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
