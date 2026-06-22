import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool, type EditOperations, type FindOperations, type GrepOperations, type LsOperations, type ReadOperations, type WriteOperations } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createBubblewrapPythonInvocation, createManagedSandboxEnvironment, DEFAULT_BUBBLEWRAP_PATHS } from "./managementSandbox.js";

interface ManagedAgentToolOptions {
  read: { operations: ReadOperations };
  edit: { operations: EditOperations };
  write: { operations: WriteOperations };
  grep: { operations: GrepOperations };
  find: { operations: FindOperations };
  ls: { operations: LsOperations };
}

export function createManagedAgentToolOptions(cwd: string): ManagedAgentToolOptions {
  const guard = createWorkspacePathGuard(cwd);
  return {
    read: { operations: createManagedReadOperations(guard) },
    edit: { operations: createManagedEditOperations(guard) },
    write: { operations: createManagedWriteOperations(guard) },
    grep: { operations: createManagedGrepOperations(guard) },
    find: { operations: createManagedFindOperations(guard) },
    ls: { operations: createManagedLsOperations(guard) },
  };
}

const pythonSchema = Type.Object({
  code: Type.String({ description: "Python code to run in the managed project workspace" }),
  timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds" })),
});

export function createManagedPythonToolDefinition(cwd: string, context: ManagementEmbedContext) {
  return defineTool<typeof pythonSchema, undefined>({
    name: "python",
    label: "python",
    description: "Run Python code inside the managed project workspace. Shell commands and paths outside the project are blocked.",
    promptSnippet: "Run Python code in the current project",
    promptGuidelines: ["Use python for scripts and calculations. Do not use it to run shell commands."],
    parameters: pythonSchema,
    async execute(_toolCallId, params, signal) {
      const configuredPython = context.sandbox?.pythonExecutable?.trim();
      const pythonExecutable = configuredPython === undefined || configuredPython === "" ? "python3" : configuredPython;
      const timeoutMs = Math.max(1_000, Math.min(params.timeoutMs ?? 30_000, 120_000));
      const env = createManagedSandboxEnvironment({ hostEnv: process.env, context });
      return runManagedPython({
        pythonExecutable,
        bubblewrapExecutable: bubblewrapExecutable(),
        cwd,
        code: params.code,
        timeoutMs,
        env,
        signal,
      });
    },
  });
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

interface RunManagedPythonOptions {
  pythonExecutable: string;
  bubblewrapExecutable: string;
  cwd: string;
  code: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal | undefined;
}

async function runManagedPython(options: RunManagedPythonOptions): Promise<{ content: { type: "text"; text: string }[]; details: undefined }> {
  const workspaceRoot = await realpath(options.cwd);
  const invocation = createBubblewrapPythonInvocation({
    bubblewrapExecutable: options.bubblewrapExecutable,
    pythonExecutable: options.pythonExecutable,
    workspaceRoot,
    env: options.env,
    readOnlyPaths: await readableBubblewrapPaths(),
  });

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new Error("Operation aborted"));
      return;
    }

    const child = spawn(invocation.command, invocation.args, { cwd: workspaceRoot, env: options.env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const output = truncateToolOutput([stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== "").join("\n"));
      const prefix = code === 0 ? "" : `Python exited with code ${String(code)}\n`;
      resolve({ content: [{ type: "text", text: `${prefix}${output}`.trimEnd() }], details: undefined });
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`Python execution timed out after ${String(options.timeoutMs)}ms`));
    }, options.timeoutMs);
    const onAbort = () => {
      child.kill();
      fail(new Error("Operation aborted"));
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      if (isNodeErrorWithCode(error, "ENOENT")) fail(new Error("Python sandbox is unavailable"));
      else fail(error);
    });
    child.on("close", finish);
    child.stdin.end(options.code);
  });
}

async function readableBubblewrapPaths(): Promise<string[]> {
  const paths = await Promise.all(DEFAULT_BUBBLEWRAP_PATHS.map(async (candidate) => {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      return undefined;
    }
  }));
  return paths.filter(isDefined);
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

function bubblewrapExecutable(): string {
  const configured = process.env["PI_WEB_BWRAP_EXECUTABLE"]?.trim() ?? process.env["PI_WEB_BUBBLEWRAP"]?.trim();
  return configured === undefined || configured === "" ? "bwrap" : configured;
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

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function truncateToolOutput(value: string): string {
  const limit = 20_000;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[output truncated]`;
}
