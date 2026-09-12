import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type GitDiffResponse, type GitStatusResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { GitController } from "./gitController";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("GitController request lifecycle", () => {
  it("stops polling while hidden and refreshes once when visible again", async () => {
    const documentState = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", documentState);
    const setInterval = vi.fn(() => 1);
    const clearInterval = vi.fn();
    vi.stubGlobal("window", { setInterval, clearInterval });
    const fetchStatus = vi.spyOn(api, "gitStatus").mockResolvedValue(status("visible"));
    const harness = createHarness({ workspaceTool: "core:workspace.git" });
    harness.controller.connect();
    harness.controller.updatePolling();
    documentState.visibilityState = "hidden";
    documentState.dispatchEvent(new Event("visibilitychange"));
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(fetchStatus).not.toHaveBeenCalled();
    documentState.visibilityState = "visible";
    documentState.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    harness.controller.dispose();
  });

  it("keeps a newer file diff when the old response arrives last", async () => {
    const first = deferred<GitDiffResponse>();
    vi.spyOn(api, "gitDiff").mockImplementation((_project, _workspace, options) => options?.path === "a.ts"
      ? first.promise : Promise.resolve(diff("b.ts", "new")));
    const harness = createHarness();
    const loadingA = harness.controller.restoreDiff("a.ts");
    await harness.controller.restoreDiff("b.ts");
    first.resolve(diff("a.ts", "old"));
    await loadingA;

    expect(harness.state.selectedDiffPath).toBe("b.ts");
    expect(harness.state.selectedDiff?.diff).toBe("new");
    expect(harness.state.selectedStagedDiff?.diff).toBe("new");
  });

  it("rejects old same-file responses after reselection", async () => {
    const first = deferred<GitDiffResponse>();
    vi.spyOn(api, "gitDiff")
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(first.promise)
      .mockResolvedValue(diff("a.ts", "new"));
    const harness = createHarness();
    const loading = harness.controller.restoreDiff("a.ts");
    await harness.controller.restoreDiff("a.ts");
    first.resolve(diff("a.ts", "old"));
    await loading;
    expect(harness.state.selectedDiff?.diff).toBe("new");
  });

  it.each(["machine", "project", "workspace"] as const)("ignores diff responses after switching %s", async (scope) => {
    const pending = deferred<GitDiffResponse>();
    vi.spyOn(api, "gitDiff").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.restoreDiff("a.ts");
    harness.switchSelection(scope);
    pending.resolve(diff("a.ts", "old"));
    await loading;
    expect(harness.state.selectedDiff).toBeUndefined();
  });

  it("ignores stale diff errors", async () => {
    const pending = deferred<GitDiffResponse>();
    vi.spyOn(api, "gitDiff").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.restoreDiff("a.ts");
    harness.switchSelection("workspace");
    pending.reject(new Error("old error"));
    await loading;
    expect(harness.state.error).toBe("");
  });

  it.each(["machine", "project", "workspace"] as const)("ignores status responses after switching %s", async (scope) => {
    const pending = deferred<GitStatusResponse>();
    vi.spyOn(api, "gitStatus").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.refreshGit();
    harness.switchSelection(scope);
    pending.resolve(status("old"));
    await loading;
    expect(harness.state.gitStatus).toBeUndefined();
  });

  it.each(["machine", "project", "workspace"] as const)("starts a refresh for the new %s scope while the old request is pending", async (scope) => {
    const oldRequest = deferred<GitStatusResponse>();
    const newRequest = deferred<GitStatusResponse>();
    const fetchStatus = vi.spyOn(api, "gitStatus").mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const harness = createHarness();
    const oldLoading = harness.controller.refreshGit();
    harness.switchSelection(scope);
    const newLoading = harness.controller.refreshGit();

    expect(fetchStatus).toHaveBeenCalledTimes(2);
    newRequest.resolve(status("new"));
    await newLoading;
    oldRequest.resolve(status("old"));
    await oldLoading;

    expect(harness.state.gitStatus?.hash).toBe("new");
  });

  it("keeps a trailing refresh in the scope that requested it", async () => {
    const oldRequest = deferred<GitStatusResponse>();
    const newRequest = deferred<GitStatusResponse>();
    const oldTrailingRequest = deferred<GitStatusResponse>();
    const trailingStarted = deferred<boolean>();
    let requestCount = 0;
    const fetchStatus = vi.spyOn(api, "gitStatus").mockImplementation(() => {
      requestCount += 1;
      if (requestCount === 1) return oldRequest.promise;
      if (requestCount === 2) return newRequest.promise;
      trailingStarted.resolve(true);
      return oldTrailingRequest.promise;
    });
    const harness = createHarness();
    const oldLoading = harness.controller.refreshGit();
    void harness.controller.refreshGit(false);
    harness.switchSelection("workspace");
    const newLoading = harness.controller.refreshGit();

    expect(fetchStatus).toHaveBeenCalledTimes(2);
    newRequest.resolve(status("new"));
    await newLoading;
    oldRequest.resolve(status("old"));
    await trailingStarted.promise;

    expect(fetchStatus).toHaveBeenLastCalledWith("project", "workspace", "local", false);
    oldTrailingRequest.resolve(status("old-trailing"));
    await oldLoading;
    expect(harness.state.gitStatus?.hash).toBe("new");
  });

  it("coalesces overlapping status refreshes and runs one trailing refresh", async () => {
    const pending = deferred<GitStatusResponse>();
    const fetchStatus = vi.spyOn(api, "gitStatus").mockReturnValueOnce(pending.promise).mockResolvedValue(status("new"));
    const harness = createHarness();
    const loading = harness.controller.refreshGit();
    const trailing = harness.controller.refreshGit();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    pending.resolve(status("old"));
    await Promise.all([loading, trailing]);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(harness.state.gitStatus?.hash).toBe("new");
  });

  it("does not cancel an initial refresh when updating polling", async () => {
    const pending = deferred<GitStatusResponse>();
    vi.spyOn(api, "gitStatus").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.refreshGit();
    harness.controller.updatePolling();
    pending.resolve(status("current"));
    await loading;
    expect(harness.state.gitStatus?.hash).toBe("current");
  });

  it("restarts only the timer and stops polling on disposal", async () => {
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const setInterval = vi.fn<(callback: () => void, delay: number) => number>((callback) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    });
    const clearInterval = vi.fn((timer: number) => { timers.delete(timer); });
    vi.stubGlobal("window", { setInterval, clearInterval });
    const pending = deferred<GitStatusResponse>();
    const fetchStatus = vi.spyOn(api, "gitStatus").mockReturnValueOnce(pending.promise).mockResolvedValue(status("polled"));
    const harness = createHarness({ workspaceTool: "core:workspace.git" });
    const loading = harness.controller.refreshGit();

    harness.controller.updatePolling();
    harness.controller.updatePolling();

    expect(timers.size).toBe(1);
    expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 8000);
    pending.resolve(status("initial"));
    await loading;
    expect(harness.state.gitStatus?.hash).toBe("initial");
    for (const callback of timers.values()) callback();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(harness.state.gitStatus?.hash).toBe("polled");

    harness.controller.dispose();
    expect(timers.size).toBe(0);
  });

  it("uses a slower poll interval for large Git status lists", () => {
    const setInterval = vi.fn(() => 1);
    vi.stubGlobal("window", { setInterval, clearInterval: vi.fn() });
    const files = Array.from({ length: 1_001 }, (_, index) => ({ path: `${String(index)}.ts`, index: "modified" as const, workingTree: "modified" as const }));
    const harness = createHarness({ workspaceTool: "core:workspace.git", gitStatus: { ...status("large"), files } });

    harness.controller.updatePolling();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("ignores pending responses after disposal", async () => {
    const pending = deferred<GitStatusResponse>();
    vi.spyOn(api, "gitStatus").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.refreshGit();
    harness.controller.dispose();
    pending.resolve(status("old"));
    await loading;
    expect(harness.state.gitStatus).toBeUndefined();
  });

  it("does not resume a disposed status refresh after reconnecting", async () => {
    const documentState = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", documentState);
    const oldRequest = deferred<GitStatusResponse>();
    const newRequest = deferred<GitStatusResponse>();
    let requestCount = 0;
    const fetchStatus = vi.spyOn(api, "gitStatus").mockImplementation(() => {
      requestCount += 1;
      if (requestCount === 1) return oldRequest.promise;
      if (requestCount === 2) return newRequest.promise;
      return Promise.resolve(status("unexpected-old-trailing"));
    });
    const harness = createHarness();
    const oldLoading = harness.controller.refreshGit();
    void harness.controller.refreshGit(false);
    harness.controller.dispose();
    harness.controller.connect();
    const newLoading = harness.controller.refreshGit();

    expect(fetchStatus).toHaveBeenCalledTimes(2);
    oldRequest.resolve(status("old"));
    await oldLoading;
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    newRequest.resolve(status("new"));
    await newLoading;
    expect(harness.state.gitStatus?.hash).toBe("new");
    harness.controller.dispose();
  });

  it("ignores stale status errors", async () => {
    const pending = deferred<GitStatusResponse>();
    vi.spyOn(api, "gitStatus").mockReturnValue(pending.promise);
    const harness = createHarness();
    const loading = harness.controller.refreshGit();
    harness.switchSelection("workspace");
    pending.reject(new Error("old error"));
    await loading;
    expect(harness.state.error).toBe("");
  });
});

function createHarness(patch: Partial<AppState> = {}) {
  const project = { id: "project", name: "Project", path: "/repo", createdAt: "now" };
  const workspace = { id: "workspace", projectId: project.id, path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false };
  let state: AppState = { ...initialAppState(), selectedProject: project, selectedWorkspace: workspace, ...patch };
  const controller = new GitController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn());
  return {
    controller,
    get state() { return state; },
    switchSelection(scope: "machine" | "project" | "workspace") {
      if (scope === "machine") state = { ...state, selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" } };
      else if (scope === "project") state = { ...state, selectedProject: { ...project, id: "other" } };
      else state = { ...state, selectedWorkspace: { ...workspace, id: "other" } };
    },
  };
}

function diff(path: string, text: string): GitDiffResponse {
  return { path, diff: text, staged: false, hash: text, truncated: false };
}

function status(hash: string): GitStatusResponse {
  return { hash, isGitRepo: true, files: [], submodules: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
