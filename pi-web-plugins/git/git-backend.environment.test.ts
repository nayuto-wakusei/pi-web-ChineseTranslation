import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { ServerPluginActivationContext, ServerPluginExecFileResult } from "@chainingintention/pi-web-cn/server-plugin-api";
import { gitDiff, gitStatus } from "./git-backend.js";

const repositoryVariables = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS",
  "GIT_DIR", "GIT_GRAFT_FILE", "GIT_IMPLICIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY", "GIT_PREFIX", "GIT_QUARANTINE_PATH", "GIT_REPLACE_REF_BASE", "GIT_SHALLOW_FILE", "GIT_WORK_TREE",
];

it.each(["status", "diff"] as const)("sanitizes repository selection and Git configuration for every %s and root probe while preserving cancellation, deadline and truncation", async (operation) => {
  const cwd = resolve("/repo/folder");
  const root = resolve("/repo");
  const signal = new AbortController().signal;
  const execFile = vi.fn<ServerPluginActivationContext["execFile"]>(({ args }) => Promise.resolve({
    exitCode: 0, signal: null, stderr: "", stderrTruncated: false,
    stdout: args?.includes("--show-toplevel") === true ? `${root}\n` : operation === "status" ? "# branch.head main\0" : "diff --git a/a b/a\n",
    stdoutTruncated: args?.[0] === "diff",
  } satisfies ServerPluginExecFileResult));
  const context: ServerPluginActivationContext = {
    apiVersion: 3, pluginId: "git", packageRoot: "/plugins/git", dataDirectory: "/data/git", settings: {}, execFile,
    logger: { debug() { /* no-op */ }, info() { /* no-op */ }, warn() { /* no-op */ }, error() { /* no-op */ } },
    signal: new AbortController().signal, lifetimeSignal: new AbortController().signal,
  };
  if (operation === "status") expect(await gitStatus(context, cwd, signal)).toMatchObject({ isGitRepo: true, branch: "main" });
  else expect(await gitDiff(context, cwd, {}, signal)).toMatchObject({ truncated: true });
  expect(execFile.mock.calls.some(([request]) => request.args?.includes("--show-toplevel") === true)).toBe(true);
  for (const [request] of execFile.mock.calls) {
    expect(request.unsetEnv).toEqual(repositoryVariables);
    expect(request.signal).toBe(signal);
    expect(request.timeoutMs).toBe(10_000);
  }
});
