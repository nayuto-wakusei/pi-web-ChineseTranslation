// @vitest-environment happy-dom
import { render } from "lit";
import type { ServerNotice } from "../../../shared/apiTypes";
import "./nodeThemePlugin.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { initialAppState, type AppState } from "../appState";
import type { AppAction } from "../actions";
import { browserErrorScopeKey, machineBrowserErrorScope, workspaceBrowserErrorScope } from "../browserErrors";
import { HttpRequestError } from "../api/http";
import { ServerNoticesController } from "../serverNotices";
import type { Machine, Workspace } from "../api";
import type { ParsedAppRoute } from "../route";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { AppShellController } from "../appShell/appShellController";
import { localization } from "../localization/browser";
import { BrowserErrorReporter, type BrowserError } from "../browserErrors";
import { navigationOrderPort } from "../api/navigationOrder";
import { NavigationOrderController } from "../controllers/navigationOrderController";
import { ProjectWorkspaceError, projectWorkspaceMessages } from "../controllers/projectWorkspaceMessages";
import { appFeedbackMessages } from "../appFeedbackMessages";

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

it("reports a gateway presentation failure visibly on the currently selected remote machine", async () => {
  const app = createApp();
  const remote: Machine = { id: "remote-1", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" };
  setState(app, { selectedMachine: remote });
  Reflect.set(app, "applyPreferredTheme", () => undefined);
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Missing plugin registry");
  const ready: unknown = Reflect.get(app, "builtInPluginsReady");
  if (!(ready instanceof Promise)) throw new Error("Missing core plugin initialization");
  await ready;
  registry.uiPresentation.register([{ id: "custom:nav", pluginId: "custom", region: "navigation", active: () => true, render: () => html`` }]);
  expect(registry.uiPresentation.fail("navigation", new Error("Renderer unavailable"))).toBe(true);
  expect(appState(app).browserErrors[browserErrorScopeKey(machineBrowserErrorScope(remote.id))]?.message).toBe("custom: Renderer unavailable");
  await registry.dispose();
});

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
type SetRemoteRouteRestoreMessage = (route: ParsedAppRoute, options?: { exhausted?: boolean }) => void;
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

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  document.body.replaceChildren();
  localStorage.clear();
});

function invoke(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  return Reflect.apply(method, app, args);
}

async function expectLiveFeedback(error: BrowserError | undefined, detail?: string): Promise<void> {
  if (error === undefined) throw new Error("Missing retained browser feedback");
  const english = error.displayMessage?.();
  expect(english).toBe(error.message);
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(error.displayMessage?.()).not.toBe(english);
    if (detail !== undefined) expect(error.displayMessage?.()).toContain(detail);
    expect(error.message).toBe(english);
  }
  await localization.setPreferences({ language: "en", formatLocale: "ar" });
  expect(error.displayMessage?.()).toBe(english);
}

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

  it("retains machine-scoped navigation ordering failures through live language changes", async () => {
    const app = createApp();
    const failure = new Error("order.json / 日本語");
    vi.spyOn(navigationOrderPort, "load").mockRejectedValue(failure);
    const controller: unknown = Reflect.get(app, "navigationOrder");
    if (!(controller instanceof NavigationOrderController)) throw new Error("Missing navigation order");
    await expect(controller.ensure({ kind: "projects", machineId: "remote-1" })).rejects.toBe(failure);
    const error = appState(app).browserErrors[browserErrorScopeKey(machineBrowserErrorScope("remote-1"))];
    expect(error?.message).toBe("Failed to load or save navigation order: order.json / 日本語");
    await expectLiveFeedback(error, failure.message);
  });

  it("localizes remote-machine confirmation at invocation without altering its name or removing a cancelled machine", async () => {
    const app = createApp();
    const confirm = vi.fn<typeof window.confirm>(() => false);
    Object.assign(window, { confirm });
    const remote: Machine = { id: "remote-1", name: "User machine/日本語", kind: "remote", createdAt: "now", updatedAt: "now" };
    setState(app, { machines: [remote], selectedMachine: remote });
    for (const language of ["en", "en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      await invoke(app, "removeMachine", remote);
      expect(confirm).toHaveBeenLastCalledWith(appFeedbackMessages.t("removeMachine", { name: remote.name }));
      expect(confirm.mock.lastCall?.[0]).toContain(remote.name);
      expect(appState(app).machines).toEqual([remote]);
    }
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("keeps nested browser-owned action guidance live instead of freezing its language", async () => {
    const app = createApp();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new ProjectWorkspaceError(() => projectWorkspaceMessages.t("projectNotFound"));
    privateRunAction(app)({ id: "test.action", title: "Test", run: () => { throw failure; } });
    await vi.waitFor(() => { expect(Object.keys(appState(app).browserErrors)).toHaveLength(1); });
    const error = appState(app).browserErrors[browserErrorScopeKey({ kind: "global" })];
    for (const language of ["en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      expect(error?.displayMessage?.()).toBe(appFeedbackMessages.t("actionFailed", { detail: failure.message }));
      expect(error?.displayMessage?.()).not.toContain("Project not found");
    }
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
    expect(appState(app).browserErrors[browserErrorScopeKey(machineBrowserErrorScope(remote.id))]?.message).toBe("Remote is unavailable; reconnecting…");
  });

  it("retains live reconnect feedback without nesting banners or recognizing English diagnostic prefixes", async () => {
    const app = createApp();
    const remote: Machine = { id: "remote-1", name: "Remote/日本語", kind: "remote", createdAt: "now", updatedAt: "now" };
    setState(app, { machines: [remote], selectedMachine: remote });
    const scope = machineBrowserErrorScope(remote.id);
    // This is a raw diagnostic, even though it starts like the old generated banner.
    const detail = `${remote.name} is unavailable: raw connection failure`;
    new BrowserErrorReporter(() => appState(app), (patch) => { setState(app, patch); }).report(scope, detail);
    const route: ParsedAppRoute = { machineId: remote.id, projectId: undefined, workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined };
    const report = setRemoteRouteRestoreMessage(app);
    report(route);
    const first = appState(app).browserErrors[browserErrorScopeKey(scope)];
    expect(first?.message).toBe(`${remote.name} is unavailable; reconnecting… ${detail}`);
    for (const language of ["en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      expect(first?.displayMessage?.()).not.toBe(first?.message);
      expect(first?.displayMessage?.()).toContain(detail);
      expect(first?.displayMessage?.()).toContain(remote.name);
      report(route, { exhausted: true });
      const retry = appState(app).browserErrors[browserErrorScopeKey(scope)];
      expect(retry?.displayMessage?.()).toContain(detail);
      expect(retry?.displayMessage?.().split(detail)).toHaveLength(2);
    }
    await localization.setPreferences({ language: "en", formatLocale: "ar" });
    expect(appState(app).browserErrors[browserErrorScopeKey(scope)]?.displayMessage?.()).toBe(`${remote.name} is still unavailable. ${detail}`);
  });

  it("keeps unexpected action failures on the global browser surface", async () => {
    const app = createApp();
    const runAction = privateRunAction(app);
    const failure = new Error("action failed");
    const originalWarn = console.warn;
    const capturedWarnings: unknown[][] = [];
    const unexpectedWarnings: unknown[][] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      if (args.length === 2 && args[0] === "Action failed: test.action" && args[1] === failure) {
        capturedWarnings.push(args);
      } else {
        unexpectedWarnings.push(args);
        originalWarn(...args);
      }
    });
    const action: AppAction = { id: "test.action", title: "Test action", run: () => Promise.reject(failure) };

    runAction(action);
    await vi.waitFor(() => {
      expect(appState(app).browserErrors[browserErrorScopeKey({ kind: "global" })]?.message).toBe("Action failed: action failed");
    });

    expect(appState(app).error).toBe("");
    expect(unexpectedWarnings).toEqual([]);
    expect(capturedWarnings).toEqual([["Action failed: test.action", failure]]);
    await expectLiveFeedback(appState(app).browserErrors[browserErrorScopeKey({ kind: "global" })], failure.message);
  });
});

describe("PiWebApp route restoration", () => {
  it("keeps an unavailable project URL and reports the requested destination", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local], selectedMachine: local });
    stubSelectedMachinePluginLoad(app);
    installSearch("?project=missing-project&workspace=missing-workspace&session=missing-session");
    const requestedUrl = window.location.search;

    await privateRestoreRouteFor(app)({
      machineId: undefined, projectId: "missing-project", workspaceId: "missing-workspace", sessionId: "missing-session", tool: undefined, view: undefined,
    }, false);

    expect(window.location.search).toBe(requestedUrl);
    expect(routeContentError(app)()).toBe("Project not found: missing-project");
    expect(appState(app).selectedSession).toBeUndefined();
  });

  it("does not substitute the local machine for an unavailable remote URL", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [local], selectedMachine: local, projects: [] });
    stubSelectedMachinePluginLoad(app);
    installSearch("?machine=offline&project=remote-project");
    const requestedUrl = window.location.search;

    await privateRestoreRouteFor(app)({
      machineId: "offline", projectId: "remote-project", workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined,
    }, false);

    expect(window.location.search).toBe(requestedUrl);
    expect(appState(app).selectedMachine?.id).toBe(local.id);
    expect(routeContentError(app)()).toBe("Machine not found: offline");
  });

  it("restores a registered remote machine without rewriting its project destination", async () => {
    const app = createApp();
    const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
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
    expect(routeContentError(app)()).toBe("Project not found: remote-project");
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
    const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
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

  it.each([
    { machineId: "remote-1", tool: "machine.remote-1.notes:workspace.notes", view: "workspace", panelId: "machine.remote-1.notes:workspace.notes", switchMachine: false },
    { machineId: "local", tool: "terminal", view: "terminal", panelId: "pi-web.terminal:workspace.terminal", switchMachine: false },
    { machineId: "remote-1", tool: "machine.remote-1.notes:workspace.notes", view: "workspace", panelId: "machine.remote-1.notes:workspace.notes", switchMachine: true },
  ] as const)("finishes delayed panel resolution for a missing project without crossing machines ($machineId, $view, switched: $switchMachine)", async ({ machineId, tool, view, panelId, switchMachine }) => {
    const app = createApp();
    const machine: Machine = { id: machineId, name: "Target", kind: machineId === "local" ? "local" : "remote", createdAt: "now", updatedAt: "now" };
    const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
    setState(app, { ...initialAppState(), machines: [machine], selectedMachine: machine, projects: [] });
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Plugin registry was unavailable");
    let loaded = false;
    let finishLoading: () => void = () => { throw new Error("Plugin loader was not started"); };
    const pluginsReady = new Promise<void>((resolve) => { finishLoading = resolve; });
    vi.spyOn(registry, "resolveWorkspacePanelRouteId").mockImplementation((value) => loaded && (value === tool || value === panelId) ? panelId : undefined);
    Reflect.set(app, "loadPluginsForSelectedMachine", async () => { await pluginsReady; loaded = true; });

    const restore = privateRestoreRouteFor(app)({ machineId, projectId: "missing", workspaceId: undefined, sessionId: undefined, tool, view }, false);
    // Hierarchy failure is observable even while the browser module is pending.
    await vi.waitFor(() => { expect(appState(app).browserErrors[browserErrorScopeKey(machineBrowserErrorScope(machineId))]?.message).toContain("missing"); });
    expect(loaded).toBe(false);
    expect(appState(app).workspaceTool).toBeUndefined();
    if (switchMachine) setState(app, { selectedMachine: local, mainView: "chat" });
    finishLoading();
    await restore;

    expect(loaded).toBe(true);
    expect(appState(app).workspaceTool).toBe(switchMachine ? undefined : panelId);
    expect(appState(app).mainView).toBe(switchMachine ? "chat" : "workspace");
    expect(appState(app).selectedMachine?.id).toBe(switchMachine ? "local" : machineId);
    expect(appState(app).selectedSession).toBeUndefined();
  });
});

describe("PiWebApp workspace removal browser error boundary", () => {
  it("retains unavailable-removal guidance without attempting provider removal", async () => {
    const app = createApp();
    setState(app, { selectedWorkspace: workspace });
    await invoke(app, "deleteWorkspace", workspace);
    const error = appState(app).browserErrors[browserErrorScopeKey(workspaceBrowserErrorScope("local", workspace.projectId, workspace.id))];
    expect(error?.message).toBe("Workspace removal is not available");
    await expectLiveFeedback(error);
  });

  it("retains completed-removal refresh feedback and nested browser guidance while scheduling a retry", async () => {
    const app = createApp();
    setState(app, { selectedProject: { id: workspace.projectId, name: "Repo", path: "/repo", createdAt: "now" } });
    const controller = new AbortController();
    Reflect.set(app, "workspaceDeletionRefreshAbort", controller);
    const generation: unknown = Reflect.get(app, "workspaceDeletionRefreshGeneration");
    const workspaces: unknown = Reflect.get(app, "workspaces");
    if (typeof workspaces !== "object" || workspaces === null) throw new Error("Missing workspaces");
    const failure = new ProjectWorkspaceError(() => projectWorkspaceMessages.t("projectNotFound"));
    const refresh = vi.fn(() => Promise.reject(failure));
    Reflect.set(workspaces, "refreshAfterWorkspaceDeleted", refresh);
    await invoke(app, "handleCompletedWorkspaceDeletionRun", {
      id: "run", projectId: workspace.projectId, status: "succeeded",
      metadata: { "pi.operation": "workspace.delete", "target.workspaceId": workspace.id },
    }, "local", workspace.projectId, generation, controller);
    expect(refresh).toHaveBeenCalledOnce();
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);
    const error = appState(app).browserErrors[browserErrorScopeKey(scope)];
    expect(error?.message).toContain("Retrying");
    for (const language of ["en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      expect(error?.displayMessage?.()).toBe(appFeedbackMessages.t("workspaceRemovalRefreshFailed", { detail: failure.message }));
    }
  });

  it("renders retained generated server notices live, keeps raw plugin messages and dismisses the original id", async () => {
    const app = createApp();
    const controller: unknown = Reflect.get(app, "serverNotices");
    if (!(controller instanceof ServerNoticesController)) throw new Error("Missing notices");
    const diagnostic = "raw <img> /repo {value}";
    const notices: ServerNotice[] = [
      { id: "start", severity: "error", message: `Workspace removal failed: ${diagnostic}`, presentation: { kind: "workspaceRemovalFailed", detail: diagnostic }, createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "exit", severity: "warning", message: "Workspace removal failed. See terminal output.", presentation: { kind: "workspaceRemovalCommandFailed" }, createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "plugin", severity: "info", message: "Workspace removal failed. See terminal output.", source: "plugin:custom", createdAt: "2026-08-01T00:00:00.000Z" },
    ];
    vi.spyOn(controller, "projection").mockReturnValue({ machineId: "local", status: "fresh", daemonInstanceId: "daemon", revision: 1, notices });
    const dismiss = vi.spyOn(controller, "dismiss").mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    for (const language of ["en", "en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      render(invoke(app, "renderServerNoticeBanners"), container);
      const banners = container.querySelectorAll(".error-text");
      expect(banners).toHaveLength(3);
      expect(banners[0]?.textContent).toContain(diagnostic);
      expect(banners[0]?.textContent === notices[0]?.message).toBe(language === "en");
      expect(banners[1]?.textContent === notices[1]?.message).toBe(language === "en");
      expect(banners[2]?.textContent).toBe(notices[2]?.message);
      expect(container.querySelector("img")).toBeNull();
    }
    container.querySelector("button")?.click();
    expect(dismiss).toHaveBeenCalledWith("local", "start");
  });

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

    expect(appState(app).browserErrors[browserErrorScopeKey(scope)]?.message).toBe("Failed to start workspace removal: workspace confirmation is stale");
    expect(hasNotice).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith("local");
    await expectLiveFeedback(appState(app).browserErrors[browserErrorScopeKey(scope)], "workspace confirmation is stale");
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

    expect(appState(app).browserErrors[browserErrorScopeKey(scope)]?.message).toBe("Failed to start workspace removal: Session daemon unavailable: connection refused");
    expect(hasNotice).not.toHaveBeenCalled();
    await expectLiveFeedback(appState(app).browserErrors[browserErrorScopeKey(scope)], "Session daemon unavailable: connection refused");
  });
});
