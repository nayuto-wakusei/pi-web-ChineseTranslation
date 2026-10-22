import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isNodeErrorWithCode } from "../workspaces/pathSafety.js";

export async function normalSessionReadAllowed(
  cwd: string,
  projectPathForCwd: ((cwd: string) => Promise<string | undefined>) | undefined,
  managementProjectRoot: string | undefined,
): Promise<boolean> {
  if (projectPathForCwd === undefined) return false;
  try {
    const project = await projectPathForCwd(cwd);
    if (project === undefined || project === "") return false;
    if (managementProjectRoot === undefined) return true;
    const root = resolve(managementProjectRoot);
    const target = resolve(cwd);
    if (insideOrSame(root, target)) return false;
    const [physicalRoot, physicalTarget] = await Promise.all([resolveMissingPath(root), resolveMissingPath(target)]);
    return !insideOrSame(physicalRoot, physicalTarget);
  } catch {
    // An unavailable authority or unverifiable path never grants a read.
    return false;
  }
}

function insideOrSame(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function resolveMissingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const parent = dirname(path);
    if (!isNodeErrorWithCode(error, "ENOENT") || parent === path) throw error;
    // Archives can outlive their cwd; resolve existing symlinked ancestors.
    return join(await resolveMissingPath(parent), basename(path));
  }
}
