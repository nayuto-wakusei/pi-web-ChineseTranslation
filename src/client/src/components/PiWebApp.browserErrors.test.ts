import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { AppAction } from "../actions";
import { browserErrorScopeKey, machineBrowserErrorScope, workspaceBrowserErrorScope } from "../browserErrors";
import { HttpRequestError } from "../api/http";
import { ServerNoticesController } from "../serverNotices";
import type { Machine, Workspace } from "../api";
import type { AppRoute, ParsedAppRoute } from "../route";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { AppShellController } from "../appShell/appShellController";

const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo-feature",
  label: "feature",
  isMain: false,
  isGitRepo: true,
  isGitWorktree: true,
  effectiveConfig: {},
};

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  });
  return new PiWebApp();
}

function appState(app: PiWebApp): AppState {
  const value: unknown = Reflect.get(app, "state");
  if (!isAppState(value)) throw new Error("PiWebApp state was unavailable");
  return value;
}

function setState(app: PiWebApp, patch: Partial<AppState>): AppState {
  const next: AppState = { ...appState(app), ...patch };
  if (!Reflect.set(app, "state", next)) throw new Error("Could not set PiWebApp state");
  return next;
}

type ReportWorkspaceRemovalFailure = (workspace: Workspace, machineId: string, scope: ReturnType<typeof workspaceBrowserErrorScope>, error: unknown) => Promise<void>;
type SetRemoteRouteRestoreMessage = (route: AppRoute, options?: { exhausted?: boolean }) => void;
type RunAction = (action: AppAction) => void;
type RestoreRouteFor = (route: ParsedAppRoute, updateUrl: boolean) => Promise<void>;
type RouteContentError = () => string;

function setRemoteRouteRestoreMessage(app: PiWebApp): SetRemoteRouteRestoreMessage {
  const method: unknown = Reflect.get(app, "setRemoteRouteRestoreMessage");
  if (!isSetRemoteRouteRestoreMessage(method)) throw new Error("Remote route restore message boundary was unavailable");
  return (route, options) => { method.call(app, route, options); };
}

function privateRunAction(app: PiWebApp): RunAction {
  const method: unknown = Reflect.get(app, "runAction");
  if (!isRunAction(method)) throw new Error("Action error boundary was unavailable");
  return (action) => { method.call(app, action); };
}

function reportWorkspaceRemovalFailure(app: PiWebApp): ReportWorkspaceRemovalFailure {
  const method: unknown = Reflect.get(app, "reportWorkspaceRemovalFailure");
  if (!isReportWorkspaceRemovalFailure(method)) throw new Error("Workspace removal failure boundary was unavailable");
  return (workspace, machineId, scope, error) => method.call(app, workspace, machineId, scope, error);
}

function isReportWorkspaceRemovalFailure(value: unknown): value is ReportWorkspaceRemovalFailure {
  return typeof value === "function";
}

function isSetRemoteRouteRestoreMessage(value: unknown): value is SetRemoteRouteRestoreMessage {
  return typeof value === "function";
}

function isRunAction(value: unknown): value is RunAction {
  return typeof value === "function";
}

function isRestoreRouteFor(value: unknown): value is RestoreRouteFor {
  return typeof value === "function";
}

function isRouteContentError(value: unknown): value is RouteContentError {
  return typeof value === "function";
}

function privateRestoreRouteFor(app: PiWebApp): RestoreRouteFor {
  const method: unknown = Reflect.get(app, "restoreRouteFor");
  if (!isRestoreRouteFor(method)) throw new Error("Route restore boundary was unavailable");
  return (route, updateUrl) => method.call(app, route, updateUrl);
}

function routeContentError(app: PiWebApp): RouteContentError {
  const method: unknown = Reflect.get(app, "contentError");
  if (!isRouteContentError(method)) throw new Error("Route error boundary was unavailable");
  return () => method.call(app);
}

function installSearch(search: string): void {
  if (!Reflect.set(window.location, "search", search)) throw new Error("Could not set the current route");
}

function stubSelectedMachinePluginLoad(app: PiWebApp): void {
  if (!Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve())) throw new Error("Could not stub plugin loading");
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "browserErrors" in value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp browser error boundaries", () => {
  it.each(["chat", undefined] as const)("restores mobile view %s without discarding the explicit chat destination", async (view) => {
    const app = createApp();
    const shell: unknown = Reflect.get(app, "appShell");
    if (!(shell instanceof AppShellController)) throw new Error("App shell was unavailable");
    shell.isMobileNavigationLayout = true;
    shell.isDesktopSideBySideLayout = false;
    stubSelectedMachinePluginLoad(app);
    await privateRestoreRouteFor(app)({ machineId: undefined, projectId: "missing", workspaceId: undefined, sessionId: "session-1", tool: undefined, view }, false);
    expect(appState(app).mainView).toBe(view ?? "navigation");
  });

  it("keeps remote route restore feedback on the affected machine", () => {
    const app = createApp();
    const remote: Machine = {
      id: "remote-1",
      name: "Remote",
      kind: "remote",
      createdAt: "now",
      updatedAt: "now",
    };
    setState(app, { machines: [remote], selectedMachine: remote, error: "A legacy failure" });

    setRemoteRouteRestoreMessage(app)({ machineId: remote.id, projectId: "project-1", workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined });

    expect(appState(app).error).toBe("A legacy failure");
    expect(appState(app).browserErrors[browserErrorScopeKey(machineBrowserErrorScope(remote.id))]?.message).toBe("Remote 暂不可用，正在重新连接…");
  });

  it("keeps unexpected action failures on the global browser surface", async () => {
    const app = createApp();
    const runAction = privateRunAction(app);
    const action: AppAction = { id: "test.action", title: "Test action", run: () => Promise.reject(new Error("action failed")) };

    runAction(action);
    await vi.waitFor(() => {
      expect(appState(app).browserErrors[browserErrorScopeKey({ kind: "global" })]?.message).toBe("操作失败：action failed");
    });

    expect(appState(app).error).toBe("");
  });
});

describe("PiWebApp route restoration", () => {
  it("keeps an unavailable project URL and reports the requested destination", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "本地", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local], selectedMachine: local });
    stubSelectedMachinePluginLoad(app);
    installSearch("?project=missing-project&workspace=missing-workspace&session=missing-session");
    const requestedUrl = window.location.search;

    await privateRestoreRouteFor(app)({
      machineId: undefined, projectId: "missing-project", workspaceId: "missing-workspace", sessionId: "missing-session", tool: undefined, view: undefined,
    }, false);

    expect(window.location.search).toBe(requestedUrl);
    expect(routeContentError(app)()).toBe("找不到项目：missing-project");
    expect(appState(app).selectedSession).toBeUndefined();
  });

  it("does not substitute the local machine for an unavailable remote URL", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "本地", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local], selectedMachine: local, projects: [] });
    stubSelectedMachinePluginLoad(app);
    installSearch("?machine=offline&project=remote-project");
    const requestedUrl = window.location.search;

    await privateRestoreRouteFor(app)({
      machineId: "offline", projectId: "remote-project", workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined,
    }, false);

    expect(window.location.search).toBe(requestedUrl);
    expect(appState(app).selectedMachine?.id).toBe(local.id);
    expect(routeContentError(app)()).toBe("找不到机器：offline");
  });

  it("restores a registered remote machine without rewriting its project destination", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "本地", kind: "local", createdAt: "now", updatedAt: "now" };
    const remote: Machine = { id: "remote-1", name: "远程", kind: "remote", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local, remote], selectedMachine: local, projects: [] });
    stubSelectedMachinePluginLoad(app);
    const machineController: unknown = Reflect.get(app, "machines");
    if (typeof machineController !== "object" || machineController === null) throw new Error("Machine controller was unavailable");
    if (!Reflect.set(machineController, "selectMachine", (selected: Machine) => {
      setState(app, { selectedMachine: selected });
      return Promise.resolve();
    })) {
      throw new Error("Could not stub machine selection");
    }
    installSearch("?machine=remote-1&project=remote-project");
    const requestedUrl = window.location.search;

    await privateRestoreRouteFor(app)({
      machineId: remote.id, projectId: "remote-project", workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined,
    }, false);

    expect(window.location.search).toBe(requestedUrl);
    expect(appState(app).selectedMachine?.id).toBe(remote.id);
    expect(routeContentError(app)()).toBe("找不到项目：remote-project");
  });

  it("waits for remote panel registration before resolving a deep link", async () => {
    const app = createApp();
    const remote: Machine = { id: "remote-1", name: "远程", kind: "remote", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [remote], selectedMachine: remote, projects: [] });
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Plugin registry was unavailable");
    let loaded = false;
    vi.spyOn(registry, "resolveWorkspacePanelRouteId").mockImplementation((value) => loaded && value === "machine.remote-1.notes:workspace.notes" ? value : undefined);
    Reflect.set(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
    Reflect.set(app, "loadPluginsForSelectedMachine", async () => { await Promise.resolve(); loaded = true; });
    const panelId = "machine.remote-1.notes:workspace.notes";

    await privateRestoreRouteFor(app)({ machineId: remote.id, projectId: "missing", workspaceId: undefined, sessionId: undefined, tool: panelId, view: "workspace" }, false);

    expect(loaded).toBe(true);
    expect(appState(app).workspaceTool).toBe(panelId);
    expect(appState(app).mainView).toBe("workspace");
  });

  it("reports unavailable workspace panels instead of silently selecting another", () => {
    const app = createApp();
    setState(app, { selectedWorkspace: workspace });
    installSearch("?project=project-1&workspace=workspace-1&tool=missing%3Apanel&view=workspace");
    const method: unknown = Reflect.get(app, "workspaceContentError");
    if (typeof method !== "function") throw new Error("Workspace panel error boundary was unavailable");

    expect(Reflect.apply(method, app, []))
      .toBe("工作区面板不可用：missing:panel");
  });

  it("restores the terminal view alias after the bundled plugin loads", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "本地", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local], selectedMachine: local, projects: [] });
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Plugin registry was unavailable");
    vi.spyOn(registry, "resolveWorkspacePanelRouteId").mockImplementation((value) => value === "terminal" ? "pi-web.terminal:workspace.terminal" : undefined);
    Reflect.set(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
    stubSelectedMachinePluginLoad(app);

    await privateRestoreRouteFor(app)({ machineId: undefined, projectId: "missing", workspaceId: undefined, sessionId: undefined, tool: "terminal", view: "terminal" }, false);

    expect(appState(app).workspaceTool).toBe("pi-web.terminal:workspace.terminal");
    expect(appState(app).mainView).toBe("workspace");
  });
});

describe("PiWebApp workspace removal browser error boundary", () => {
  it("does not add a browser fallback when a matching server notice is fresh", async () => {
    const app = createApp();
    setState(app, { selectedWorkspace: workspace });
    const noticesValue: unknown = Reflect.get(app, "serverNotices");
    if (!(noticesValue instanceof ServerNoticesController)) throw new Error("Server notices controller was unavailable");
    const notices = noticesValue;
    const hasNotice = vi.spyOn(notices, "hasNotice").mockImplementation((machineId, matches) => {
      expect(machineId).toBe("local");
      return matches({
        id: "notice-1",
        severity: "error",
        message: "工作区移除失败：workspace has unsubmitted changes",
        createdAt: "2026-08-01T00:00:00.000Z",
        source: "workspace.delete",
        scope: { projectId: workspace.projectId },
        context: { targetWorkspaceId: workspace.id },
      });
    });
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);

    await reportWorkspaceRemovalFailure(app)(workspace, "local", scope, new HttpRequestError("workspace has unsubmitted changes", 400));

    expect(hasNotice).toHaveBeenCalledTimes(2);
    expect(appState(app).browserErrors).toEqual({});
  });

  it("uses the browser fallback when a server response has no matching notice", async () => {
    const app = createApp();
    setState(app, { selectedWorkspace: workspace });
    const noticesValue: unknown = Reflect.get(app, "serverNotices");
    if (!(noticesValue instanceof ServerNoticesController)) throw new Error("Server notices controller was unavailable");
    const notices = noticesValue;
    const hasNotice = vi.spyOn(notices, "hasNotice").mockReturnValue(false);
    const refresh = vi.spyOn(notices, "refresh").mockResolvedValue();
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);

    await reportWorkspaceRemovalFailure(app)(workspace, "local", scope, new HttpRequestError("workspace confirmation is stale", 409));

    expect(appState(app).browserErrors[browserErrorScopeKey(scope)]?.message).toBe("启动工作区删除失败：workspace confirmation is stale");
    expect(hasNotice).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith("local");
  });

  it("keeps browser feedback for the gateway's session-daemon-unavailable response", async () => {
    const app = createApp();
    setState(app, { selectedWorkspace: workspace });
    const noticesValue: unknown = Reflect.get(app, "serverNotices");
    if (!(noticesValue instanceof ServerNoticesController)) throw new Error("Server notices controller was unavailable");
    const notices = noticesValue;
    const hasNotice = vi.spyOn(notices, "hasNotice");
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);

    await reportWorkspaceRemovalFailure(app)(workspace, "local", scope, new HttpRequestError("Session daemon unavailable: connection refused", 502));

    expect(appState(app).browserErrors[browserErrorScopeKey(scope)]?.message).toBe("启动工作区删除失败：Session daemon unavailable: connection refused");
    expect(hasNotice).not.toHaveBeenCalled();
  });
});
