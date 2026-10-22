import { describe, expect, it, vi } from "vitest";
import type { ServerPluginActivationContext, ServerPluginExecFileResult, ServerPluginPeerRequestContext } from "@chainingintention/pi-web-cn/server-plugin-api";
import { GIT_STATUS_OPERATION, requestGitBackend } from "./git-backend.js";

function context(execFile: ServerPluginActivationContext["execFile"]): ServerPluginActivationContext {
  return {
    apiVersion: 3, pluginId: "git", packageRoot: "pi-web-plugins/git", dataDirectory: "/data/git",
    logger: { debug() { /* no-op */ }, info() { /* no-op */ }, warn() { /* no-op */ }, error() { /* no-op */ } }, settings: {}, execFile,
    signal: new AbortController().signal, lifetimeSignal: new AbortController().signal,
  };
}

function request(signal = new AbortController().signal): ServerPluginPeerRequestContext {
  return {
    project: { id: "p", name: "Project", path: "/repo" },
    workspace: { id: "w", projectId: "p", path: "/repo", label: "Main", isMain: true },
    operation: GIT_STATUS_OPERATION, input: null, signal,
  };
}

function result(stdout = "", exitCode = 0): ServerPluginExecFileResult {
  return { exitCode, signal: null, stdout, stderr: "", stdoutTruncated: false, stderrTruncated: false };
}

describe("Git workspace peer status cache integration", () => {
  it("caches completed status, explicitly refreshes it and separates project roots and activation owners", async () => {
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>(({ args }) => Promise.resolve(result(args?.includes("--show-toplevel") === true ? "/repo\n" : "# branch.head main\0")));
    const activation = context(execFile);
    const first = await requestGitBackend(activation, request());
    expect(await requestGitBackend(activation, request())).toEqual(first);
    expect(execFile).toHaveBeenCalledTimes(2);
    execFile.mockImplementation(({ args }) => Promise.resolve(result(args?.includes("--show-toplevel") === true ? "/repo\n" : "# branch.head feature\0")));
    expect(await requestGitBackend(activation, { ...request(), input: { refresh: true } })).toMatchObject({ branch: "feature" });
    expect(await requestGitBackend(activation, request())).toMatchObject({ branch: "feature" });
    const other = request();
    await requestGitBackend(activation, { ...other, project: { ...other.project, path: "/other-owner" } });
    await requestGitBackend(context(execFile), request());
    expect(execFile).toHaveBeenCalledTimes(8);
  });

  it("shares only the same pending signal and prevents cancellation of one request from poisoning another", async () => {
    const resolvers: ((value: ServerPluginExecFileResult) => void)[] = [];
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>(({ args }) => args?.includes("--show-toplevel") === true
      ? Promise.resolve(result("/repo\n"))
      : new Promise((resolve) => { resolvers.push(resolve); }));
    const activation = context(execFile);
    const firstOwner = new AbortController();
    const secondOwner = new AbortController();
    const first = requestGitBackend(activation, request(firstOwner.signal));
    const refreshed = requestGitBackend(activation, { ...request(firstOwner.signal), input: { refresh: true } });
    const second = requestGitBackend(activation, request(secondOwner.signal));
    const failures = Promise.all([expect(first).rejects.toThrow("cancelled"), expect(refreshed).rejects.toThrow("cancelled")]);
    await Promise.resolve();
    expect(execFile).toHaveBeenCalledTimes(2);
    firstOwner.abort(new Error("cancelled"));
    const [completeFirst, completeSecond] = resolvers;
    if (completeFirst === undefined || completeSecond === undefined) throw new Error("Expected two independent scans");
    completeSecond(result("# branch.head survivor\0"));
    await expect(second).resolves.toMatchObject({ branch: "survivor" });
    completeFirst(result());
    await failures;
    expect(await requestGitBackend(activation, request())).toMatchObject({ branch: "survivor" });
    expect(execFile).toHaveBeenCalledTimes(4);
  });

  it("does not retain failed refresh or repository removal snapshots", async () => {
    const scan = vi.fn<ServerPluginActivationContext["execFile"]>().mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error("execution failed")).mockResolvedValueOnce(result("", 128)).mockResolvedValueOnce(result("# branch.head restored\0"));
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>((request) => request.args?.includes("--show-toplevel") === true
      ? Promise.resolve(result("/repo\n")) : scan(request));
    const activation = context(execFile);
    await requestGitBackend(activation, request());
    await expect(requestGitBackend(activation, { ...request(), input: { refresh: true } })).rejects.toThrow("execution failed");
    expect(await requestGitBackend(activation, request())).toMatchObject({ isGitRepo: false });
    expect(await requestGitBackend(activation, request())).toMatchObject({ branch: "restored" });
    expect(scan).toHaveBeenCalledTimes(4);
    expect(execFile).toHaveBeenCalledTimes(6);
  });
});
