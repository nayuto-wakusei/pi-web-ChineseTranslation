import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BashOperations, EditOperations, FindOperations, GrepOperations, LsOperations, ReadOperations, ToolsOptions, WriteOperations } from "@earendil-works/pi-coding-agent";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createBubblewrapShellInvocation, createManagedSandboxEnvironment } from "./managementSandbox.js";

const DEFAULT_BUBBLEWRAP_EXECUTABLE = envOrDefault("PI_WEB_BUBBLEWRAP", "bwrap");
const DEFAULT_SHELL_EXECUTABLE = envOrDefault("SHELL", "/bin/bash");

export function createManagedAgentToolOptions(cwd: string, context: ManagementEmbedContext): ToolsOptions {
  const guard = createWorkspacePathGuard(cwd);
  return {
    read: { operations: createManagedReadOperations(guard) },
    bash: { operations: createManagedBashOperations(cwd, context, guard) },
    edit: { operations: createManagedEditOperations(guard) },
    write: { operations: createManagedWriteOperations(guard) },
    grep: { operations: createManagedGrepOperations(guard) },
    find: { operations: createManagedFindOperations(guard) },
    ls: { operations: createManagedLsOperations(guard) },
  };
}

function createManagedReadOperations(guard: WorkspacePathGuard): ReadOperations {
  return {
    readFile: async (absolutePath) => readFile(await guard.existingPath(absolutePath)),
    access: async (absolutePath) => { await access(await guard.existingPath(absolutePath), constants.R_OK); },
  };
}

function createManagedEditOperations(guard: WorkspacePathGuard): EditOperations {
  return {
    readFile: async (absolutePath) => readFile(await guard.existingPath(absolutePath)),
    writeFile: async (absolutePath, content) => writeFile(await guard.writablePath(absolutePath), content),
    access: async (absolutePath) => { await access(await guard.existingPath(absolutePath), constants.R_OK | constants.W_OK); },
  };
}

function createManagedWriteOperations(guard: WorkspacePathGuard): WriteOperations {
  return {
    writeFile: async (absolutePath, content) => writeFile(await guard.writablePath(absolutePath), content),
    mkdir: async (dir) => mkdir(await guard.directoryTarget(dir), { recursive: true }).then(() => undefined),
  };
}

function createManagedLsOperations(guard: WorkspacePathGuard): LsOperations {
  return {
    exists: async (absolutePath) => {
      try {
        await guard.existingPath(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (absolutePath) => stat(await guard.existingPath(absolutePath)),
    readdir: async (absolutePath) => readdir(await guard.existingPath(absolutePath)),
  };
}

function createManagedGrepOperations(guard: WorkspacePathGuard): GrepOperations {
  return {
    isDirectory: async (absolutePath) => (await stat(await guard.existingPath(absolutePath))).isDirectory(),
    readFile: async (absolutePath) => readFile(await guard.existingPath(absolutePath), "utf8"),
  };
}

function createManagedFindOperations(guard: WorkspacePathGuard): FindOperations {
  return {
    exists: async (absolutePath) => {
      try {
        await guard.existingPath(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, searchCwd, options) => findMatchingPaths(await guard.existingPath(searchCwd), pattern, options.limit, guard),
  };
}

function createManagedBashOperations(cwd: string, context: ManagementEmbedContext, guard: WorkspacePathGuard): BashOperations {
  return {
    exec: async (command, requestedCwd, { onData, signal, timeout }) => {
      const workspaceRoot = await guard.workspaceRoot();
      const realRequestedCwd = await guard.existingPath(requestedCwd);
      if (realRequestedCwd !== workspaceRoot) throw new Error("Managed bash commands must run at the workspace root");
      const env = createManagedSandboxEnvironment({ hostEnv: process.env, context });
      const invocation = createBubblewrapShellInvocation({
        bubblewrapExecutable: DEFAULT_BUBBLEWRAP_EXECUTABLE,
        shellExecutable: DEFAULT_SHELL_EXECUTABLE,
        workspaceRoot,
        script: command,
        env,
      });

      return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new Error("aborted"));
          return;
        }

        const child = spawn(invocation.command, invocation.args, {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let timedOut = false;
        const effectiveTimeout = timeout === undefined || timeout <= 0 ? undefined : timeout;
        const timeoutHandle = effectiveTimeout === undefined ? undefined : setTimeout(() => {
          timedOut = true;
          killProcessGroup(child.pid, child.kill.bind(child));
        }, effectiveTimeout * 1000);

        const onAbort = () => {
          killProcessGroup(child.pid, child.kill.bind(child));
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("error", (error) => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
        child.on("close", (code) => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted === true) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${String(effectiveTimeout ?? "unknown")}`));
          else resolve({ exitCode: code });
        });
      });
    },
  };
}

interface WorkspacePathGuard {
  workspaceRoot(): Promise<string>;
  existingPath(absolutePath: string): Promise<string>;
  writablePath(absolutePath: string): Promise<string>;
  directoryTarget(absolutePath: string): Promise<string>;
}

function createWorkspacePathGuard(cwd: string): WorkspacePathGuard {
  const root = realpath(cwd);
  return {
    workspaceRoot: () => root,
    existingPath: async (absolutePath) => {
      const workspaceRoot = await root;
      const resolved = await realpath(absolutePath);
      assertInsideWorkspace(workspaceRoot, resolved, absolutePath);
      return resolved;
    },
    writablePath: async (absolutePath) => {
      const workspaceRoot = await root;
      const resolved = path.resolve(absolutePath);
      assertInsideWorkspace(workspaceRoot, resolved, absolutePath);
      try {
        const existing = await realpath(resolved);
        assertInsideWorkspace(workspaceRoot, existing, absolutePath);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        const parent = await nearestExistingParent(resolved);
        const realParent = await realpath(parent);
        assertInsideWorkspace(workspaceRoot, realParent, absolutePath);
      }
      return resolved;
    },
    directoryTarget: async (absolutePath) => {
      const workspaceRoot = await root;
      const resolved = path.resolve(absolutePath);
      assertInsideWorkspace(workspaceRoot, resolved, absolutePath);
      const parent = await nearestExistingParent(resolved);
      const realParent = await realpath(parent);
      assertInsideWorkspace(workspaceRoot, realParent, absolutePath);
      return resolved;
    },
  };
}

async function nearestExistingParent(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      await access(current, constants.F_OK);
      return current;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function envOrDefault(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function assertInsideWorkspace(workspaceRoot: string, target: string, originalPath: string): void {
  const relative = path.relative(workspaceRoot, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`path outside the managed project sandbox: ${originalPath}`);
}

async function findMatchingPaths(searchRoot: string, pattern: string, limit: number, guard: WorkspacePathGuard): Promise<string[]> {
  const matcher = globMatcher(pattern);
  const results: string[] = [];
  await walk(searchRoot, searchRoot, matcher, results, limit, guard);
  return results;
}

async function walk(root: string, dir: string, matcher: (relativePath: string, basename: string) => boolean, results: string[], limit: number, guard: WorkspacePathGuard): Promise<void> {
  if (results.length >= limit) return;
  const entries = await readdir(await guard.existingPath(dir), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (matcher(relativePath, entry.name)) results.push(absolutePath);
    if (results.length >= limit) return;
    if (entry.isDirectory()) await walk(root, absolutePath, matcher, results, limit, guard);
  }
}

function globMatcher(pattern: string): (relativePath: string, basename: string) => boolean {
  const relativePattern = globPatternToRegExp(toPosix(pattern));
  const basenamePattern = pattern.includes("/") || pattern.includes("\\") ? undefined : globPatternToRegExp(pattern);
  return (relativePath, basename) => relativePattern.test(relativePath) || basenamePattern?.test(basename) === true;
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function killProcessGroup(pid: number | undefined, fallbackKill: (signal?: NodeJS.Signals) => boolean): void {
  if (pid === undefined) {
    fallbackKill("SIGKILL");
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    fallbackKill("SIGKILL");
  }
}
