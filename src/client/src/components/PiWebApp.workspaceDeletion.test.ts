import "./nodeThemePlugin.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { BrowserErrorReporter } from "../browserErrors";
import { terminalsApi, type Project, type TerminalCommandRun, type Workspace } from "../api";
import { WorkspaceController } from "../controllers/workspaceController";
import type { RequiredTerminalCommandRunQueryV1 } from "../plugins/requiredTerminalFacade";
import { targetWorkspaceIdForRun, workspaceDeletionMetadata } from "../workspaceDeletion";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const project: Project = { id: "project", name: "Project", path: "/project", createdAt: "2026-10-10" };
const workspace: Workspace = { id: "workspace", projectId: project.id, path: "/project/worktree", label: "worktree", effectiveConfig: {}, isMain: false, isGitRepo: true, isGitWorktree: true };
const appStates = new WeakMap<PiWebApp, AppState>();

describe("PiWebApp workspace deletion polling ownership", () => {
  it("passes cancellation to the required Terminal peer and does not restart polling after cancellation", async () => {
    const pending = deferred<TerminalCommandRun[]>();
    const query = vi.fn< (query: RequiredTerminalCommandRunQueryV1) => Promise<TerminalCommandRun[]> >().mockReturnValue(pending.promise);
    const app = createApp(query, [run("running")]);
    const refresh = call(app, "refreshWorkspaceDeletionRuns");
    const signal = query.mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);
    app.disconnectedCallback();
    expect(signal?.aborted).toBe(true);
    pending.resolve([run("running")]);
    await refresh;
    expect(Reflect.get(app, "workspaceDeletionPollTimer")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces overlapping refreshes into one trailing query", async () => {
    const pending = deferred<TerminalCommandRun[]>();
    const query = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    const app = createApp(query);
    const refresh = call(app, "refreshWorkspaceDeletionRuns");
    await call(app, "refreshWorkspaceDeletionRuns");
    await call(app, "refreshWorkspaceDeletionRuns");
    expect(query).toHaveBeenCalledOnce();
    pending.resolve([]);
    await refresh;
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an already queued trailing refresh after its owner is cancelled", async () => {
    const pending = deferred<TerminalCommandRun[]>();
    const query = vi.fn().mockReturnValue(pending.promise);
    const queued: (() => void)[] = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => { queued.push(callback); });
    const app = createApp(query);
    const refresh = call(app, "refreshWorkspaceDeletionRuns");
    await call(app, "refreshWorkspaceDeletionRuns");
    pending.resolve([]);
    await refresh;
    expect(queued).toHaveLength(1);
    call(app, "cancelWorkspaceDeletionRefresh");
    queued[0]?.();
    expect(query).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["project", "machine"])("cancels an old request on %s selection changes, including returning to the same scope", async (scope) => {
    const pending = deferred<TerminalCommandRun[]>();
    const query = vi.fn<(query: RequiredTerminalCommandRunQueryV1) => Promise<TerminalCommandRun[]>>().mockReturnValue(pending.promise);
    const app = createApp(query, [run("running")]);
    const refresh = call(app, "refreshWorkspaceDeletionRuns");
    const signal = query.mock.calls[0]?.[0].signal;
    for (const method of ["syncSessionUnreadMachines", "syncUnreadSessionIds", "syncUnreadPresence", "handleActivityTransition", "handleWorkspaceChange", "handleMachineChange", "syncMachineActivitySubscriptions"]) {
      Reflect.set(app, method, () => undefined);
    }
    const notifications: unknown = Reflect.get(app, "notifications");
    if (typeof notifications !== "object" || notifications === null) throw new Error("Notifications are unavailable");
    Reflect.set(notifications, "syncEnvironment", () => undefined);
    const publish: unknown = Reflect.get(PiWebApp.prototype, "setState");
    if (typeof publish !== "function") throw new Error("State publication is unavailable");
    const switchAway: Partial<AppState> = scope === "project"
      ? { selectedProject: { ...project, id: "other-project" } }
      : { selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "2026-10-10", updatedAt: "2026-10-10" } };
    const switchBack: Partial<AppState> = scope === "project" ? { selectedProject: project } : { selectedMachine: undefined };
    Reflect.apply(publish, app, [switchAway]);
    Reflect.apply(publish, app, [switchBack]);
    expect(signal?.aborted).toBe(true);
    pending.resolve([run("running")]);
    await refresh;
    const current: unknown = Reflect.get(app, "state");
    expect(current).toMatchObject({ workspaceDeletionRuns: {} });
    expect(Reflect.get(app, "workspaceDeletionPollTimer")).toBeUndefined();
  });

  it("retains pending runs belonging to a failed workspace query", async () => {
    const retained = run("running");
    const other = run("running", "other");
    const query = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = createApp(query, [retained, other]);
    await call(app, "refreshWorkspaceDeletionRuns");
    expect(state(app).workspaceDeletionRuns).toEqual({ target: retained });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("queries a tracked pending run even when its execution workspace has disappeared from the current list", async () => {
    const pendingRun = run("running", "missing");
    const query = vi.fn().mockResolvedValue([pendingRun]);
    const app = createApp(query, [pendingRun]);
    await call(app, "refreshWorkspaceDeletionRuns");
    expect(query).toHaveBeenCalledOnce();
    expect(state(app).workspaceDeletionRuns["target"]).toEqual(pendingRun);
  });

  it("retries successful deletion reconciliation with upstream backoff before marking it handled", async () => {
    const complete = run("succeeded");
    const query = vi.fn().mockResolvedValue([]);
    const app = createApp(query, [complete]);
    const reconcile = vi.spyOn(WorkspaceController.prototype, "refreshAfterWorkspaceDeleted")
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockRejectedValueOnce(new Error("refresh failed again"))
      .mockResolvedValue(undefined);
    const errors: unknown = Reflect.get(app, "browserErrors");
    if (!(errors instanceof BrowserErrorReporter)) throw new Error("Browser error reporter is unavailable");
    const report = vi.spyOn(errors, "report").mockImplementation(() => undefined);
    vi.spyOn(errors, "discard").mockImplementation(() => undefined);
    await call(app, "refreshWorkspaceDeletionRuns");
    expect(reconcile).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[1]).toContain("正在重试");
    expect(state(app).workspaceDeletionRuns["target"]).toEqual(complete);
    await vi.advanceTimersByTimeAsync(999);
    expect(reconcile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(state(app).workspaceDeletionRuns).toEqual({});
    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses controlled command-run HTTP in management mode without resolving an ordinary Terminal peer", async () => {
    const app = createApp(vi.fn());
    Reflect.set(app, "apiScope", "management");
    Reflect.set(app, "requiredTerminalByMachine", new Map());
    const list = vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([]);
    await call(app, "refreshWorkspaceDeletionRuns");
    expect(list).toHaveBeenCalledOnce();
    expect(list.mock.calls[0]?.[0]).toMatchObject({ projectId: project.id, workspaceId: workspace.id });
    expect(list.mock.calls[0]?.[1]).toBe("local");
    expect(list.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects recording a deletion from another selected project", () => {
    const app = createApp(vi.fn());
    expect(call(app, "recordWorkspaceDeletionRun", { ...run("running"), projectId: "elsewhere" }, "local")).toBe(false);
    expect(state(app).workspaceDeletionRuns).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not apply reconciliation completion after its ownership is cancelled", async () => {
    const complete = run("succeeded");
    const app = createApp(vi.fn(), [complete]);
    const pending = deferred<undefined>();
    const reconcile = vi.spyOn(WorkspaceController.prototype, "refreshAfterWorkspaceDeleted").mockReturnValue(pending.promise);
    const refresh = call(app, "refreshWorkspaceDeletionRuns");
    call(app, "cancelWorkspaceDeletionRefresh");
    const options = reconcile.mock.calls[0]?.[3];
    expect(options?.signal?.aborted).toBe(true);
    expect(options?.isCurrent?.()).toBe(false);
    pending.resolve(undefined);
    await refresh;
    expect(state(app).workspaceDeletionRuns["target"]).toEqual(complete);
    expect(Reflect.get(app, "workspaceDeletionPollTimer")).toBeUndefined();
  });
});

function createApp(query: (query: RequiredTerminalCommandRunQueryV1) => Promise<TerminalCommandRun[]>, runs: TerminalCommandRun[] = []): PiWebApp {
  vi.useFakeTimers();
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage, setTimeout, clearTimeout, removeEventListener: () => undefined });
  const app = new PiWebApp();
  const workspaceDeletionRuns: Record<string, TerminalCommandRun> = {};
  for (const value of runs) {
    const target = targetWorkspaceIdForRun(value);
    if (target !== undefined) workspaceDeletionRuns[target] = value;
  }
  appStates.set(app, { ...initialAppState(), selectedProject: project, workspaces: [workspace], workspaceDeletionRuns });
  Reflect.set(app, "state", state(app));
  Reflect.set(app, "requiredTerminalByMachine", new Map([["local", {
    binding: { sourcePluginId: "pi-web.terminal", backendRevision: "revision", pairedRequestVersion: 1 },
    facade: { listCommandRuns: query },
  }]]));
  // State publication is isolated from unrelated app subscriptions; polling remains real.
  Reflect.set(app, "setState", (patch: Partial<AppState>) => {
    appStates.set(app, { ...state(app), ...patch });
    Reflect.set(app, "state", state(app));
  });
  return app;
}

function state(app: PiWebApp): AppState {
  const result = appStates.get(app);
  if (result === undefined) throw new Error("App state fixture is unavailable");
  return result;
}

function call(app: PiWebApp, method: string, ...args: unknown[]): unknown {
  const fn: unknown = Reflect.get(app, method);
  if (typeof fn !== "function") throw new Error(`PiWebApp.${method} is unavailable`);
  return Reflect.apply(fn, app, args);
}

function run(status: TerminalCommandRun["status"], executionWorkspace = workspace.id): TerminalCommandRun {
  return { id: `run-${executionWorkspace}`, origin: "core", projectId: project.id, workspaceId: executionWorkspace, terminalId: "terminal", title: "Remove", command: "remove", status, createdAt: "2026-10-10", metadata: workspaceDeletionMetadata({ id: executionWorkspace === workspace.id || executionWorkspace === "missing" ? "target" : `target-${executionWorkspace}`, path: "/project/removed" }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
