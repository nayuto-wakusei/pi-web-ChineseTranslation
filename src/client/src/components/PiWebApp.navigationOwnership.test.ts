import "./nodeThemePlugin.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { workspacesApi, type Project } from "../api";
import { html } from "lit";
import { PluginRegistry } from "../plugins/registry";
import type { WorkspacePanelContext } from "../plugins/types";
import type { NavigationFreshness, NavigationScope, NavigationSelection } from "../controllers/types";
import { readRoute, writeRoute, type ParsedAppRoute } from "../route";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const project: Project = { id: "p", name: "Project", path: "/project", createdAt: "2026-10-10" };

describe("PiWebApp navigation ownership", () => {
  it("accepts the URL abbreviation of the captured full session but never a different creation token", () => {
    const app = createApp();
    writeRoute({ ...readRoute(), sessionId: "abc" });
    expect(invoke(app, "navigationSelectionMatchesUrl", { ...capture(app), sessionId: "abcdef" })).toBe(true);
    writeRoute({ ...readRoute(), sessionId: "creating:abc" });
    expect(invoke(app, "navigationSelectionMatchesUrl", { ...capture(app), sessionId: "creating:abcdef" })).toBe(false);
  });

  it("keeps the public workspace view independent from the selected panel", () => {
    const app = createApp();
    const open = vi.fn();
    Reflect.set(app, "openWorkspaceTool", open);
    invoke(app, "selectMainView", "workspace");
    expect(open).not.toHaveBeenCalled();
    expect(readRoute().view).toBe("workspace");
    expect(readRoute().tool).toBeUndefined();
  });

  it("does not restore an old file after its refresh loses route ownership", async () => {
    const app = createApp();
    const workspace = { id: "w", projectId: project.id, path: project.path, label: "main", isMain: true, effectiveConfig: {} };
    Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
    Reflect.set(app, "state", { ...initialAppState(), selectedProject: project, selectedWorkspace: workspace, mainView: "workspace", workspaceTool: "files:panel" });
    writeRoute({ ...readRoute(), projectId: project.id, workspaceId: workspace.id, tool: "files:panel", view: "workspace" });
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Missing plugin registry");
    let context: WorkspacePanelContext | undefined;
    await registry.register({ id: "files", plugin: { apiVersion: 4, name: "Files", activate: () => ({ contributions: { workspacePanels: [{ id: "panel", title: "Files", render: (value) => { context = value; return html``; } }] } }) } });
    const hostContext = invoke(app, "createWorkspacePanelContext", workspace);
    if (!isWorkspacePanelContext(hostContext)) throw new Error("Missing host context");
    registry.getWorkspacePanels().find((panel) => panel.id === "files:panel")?.render(hostContext);
    if (context === undefined) throw new Error("Missing scoped Files context");
    const scoped = context;
    let finish!: (file: Awaited<ReturnType<typeof workspacesApi.workspaceFile>>) => void;
    vi.spyOn(workspacesApi, "workspaceFile").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const refreshing = scoped.files.readFile("old.txt").then(() => scoped.navigation?.set("file", "old.txt"));
    writeRoute({ ...readRoute(), tool: "other:panel" });
    begin(app, ["tool", "view"]);
    finish({ path: "old.txt", content: "old", size: 3, encoding: "utf8", modifiedAt: "now", truncated: false, binary: false });
    await expect(refreshing).resolves.toBe(false);
    expect(new URL(window.location.href).searchParams.has("files.panel--file")).toBe(false);
    expect(readRoute().tool).toBe("other:panel");
  });

  it("restores the current URL rather than an obsolete initial capture after machine loading", async () => {
    const app = createApp();
    const machines: unknown = Reflect.get(app, "machines");
    const projects: unknown = Reflect.get(app, "projects");
    if (typeof machines !== "object" || machines === null || typeof projects !== "object" || projects === null) throw new Error("Controllers missing");
    Reflect.set(machines, "loadMachines", () => {
      writeRoute({ ...readRoute(), projectId: "newer" });
      return Promise.resolve(true);
    });
    Reflect.set(projects, "loadProjects", () => Promise.resolve());
    Reflect.set(app, "withChatScrollTransition", (action: () => Promise<void>) => action());
    const restored: ParsedAppRoute[] = [];
    Reflect.set(app, "restoreRouteFor", (route: ParsedAppRoute) => { restored.push(route); return Promise.resolve(); });
    Reflect.set(app, "refreshWorkspaceDeletionRuns", () => Promise.resolve());
    await invoke(app, "loadProjectsAndRestoreRoute");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.projectId).toBe("newer");
  });

  it("retires only fields changed in the URL, preserving selection during surface-only navigation", () => {
    const app = createApp();
    const selection = begin(app, ["machine", "project", "workspace", "session"]);
    const surface = begin(app, ["tool", "view"]);
    writeRoute({ ...readRoute(), tool: "third-party", view: "workspace" });
    expect(selection.isCurrent()).toBe(true);
    expect(surface.isCurrent()).toBe(false);
    writeRoute({ ...readRoute(), workspaceId: "other" });
    expect(selection.isCurrent()).toBe(false);
  });

  it("does not revive callbacks when navigation goes away and returns to the same route", () => {
    const app = createApp();
    const token = begin(app, ["workspace"]);
    const original = readRoute();
    writeRoute({ ...original, workspaceId: "other" });
    begin(app, ["workspace"]);
    writeRoute(original);
    expect(token.isCurrent()).toBe(false);
  });

  it("explicit same-route surface navigation retires panel callbacks but not selection work", () => {
    const app = createApp();
    const selection = begin(app, ["project", "workspace", "session"]);
    const panel = begin(app, ["tool", "view"]);
    invoke(app, "retireRouteRestoreForSynchronousNavigation");
    expect(selection.isCurrent()).toBe(true);
    expect(panel.isCurrent()).toBe(false);
  });

  it("publishes the destination URL before starting project selection and does not push a second history entry", async () => {
    const app = createApp();
    Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve());
    Reflect.set(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
    Reflect.set(app, "refreshRestoredWorkspaceTool", () => Promise.resolve());
    const workspaceController: unknown = Reflect.get(app, "workspaces");
    if (typeof workspaceController !== "object" || workspaceController === null) throw new Error("Workspace controller missing");
    const select = vi.fn((_project: Project, options: { navigation: NavigationFreshness }) => {
      expect(readRoute().projectId).toBe(project.id);
      expect(options.navigation.isCurrent()).toBe(true);
      Reflect.set(app, "state", { ...initialAppState(), projects: [project], selectedProject: project });
      return Promise.resolve();
    });
    Reflect.set(workspaceController, "selectProject", select);
    await invoke(app, "navigateToProjectFromController", project);
    expect(select).toHaveBeenCalledOnce();
    expect(Reflect.get(window.history, "pushState")).toHaveBeenCalledOnce();
    expect(readRoute().projectId).toBe(project.id);
  });

  it("rejects an asynchronous destination whose expected route has been superseded", async () => {
    const app = createApp();
    const expected = capture(app);
    writeRoute({ ...readRoute(), projectId: "newer" });
    const result = await invoke(app, "navigateToProjectFromController", project, { expected });
    expect(result).toBe(false);
    expect(readRoute().projectId).toBe("newer");
    expect(Reflect.get(window.history, "pushState")).toHaveBeenCalledOnce();
  });

  it("a creation handoff changes only its token and preserves the newer tool and query", async () => {
    const app = createApp();
    writeRoute({ ...readRoute(), sessionId: "creating:token" });
    const expected = capture(app);
    writeRoute({ ...readRoute(), tool: "third-party", view: "workspace" });
    const url = new URL(window.location.href);
    url.searchParams.set("third-party.panel--file", "new.txt");
    window.history.replaceState({}, "", url);
    Reflect.set(app, "restoreRouteFor", () => Promise.resolve());
    const result = await invoke(app, "commitAndRestoreNavigation", { machineId: "local", sessionId: "real-session", surface: {} }, { expected, creationHandoff: true });
    expect(result).toBe(true);
    expect(readRoute()).toMatchObject({ sessionId: "real-session", tool: "third-party", view: "workspace" });
    expect(new URL(window.location.href).searchParams.get("third-party.panel--file")).toBe("new.txt");
  });
});

function createApp(): PiWebApp {
  const location = new URL("http://localhost/app");
  const publish = (_state: object, _title: string, next: string | URL) => {
    const url = new URL(next, location.href);
    location.href = url.href;
  };
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location, history: { pushState: vi.fn(publish), replaceState: vi.fn(publish) }, localStorage: storage });
  const app = new PiWebApp();
  Reflect.set(app, "state", { ...initialAppState(), projects: [project] });
  Reflect.set(app, "setState", (patch: object) => {
    const state: unknown = Reflect.get(app, "state");
    if (typeof state !== "object" || state === null) throw new Error("State missing");
    Reflect.set(app, "state", { ...state, ...patch });
  });
  return app;
}

function invoke(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  return Reflect.apply(method, app, args);
}

function begin(app: PiWebApp, scope: readonly NavigationScope[]): NavigationFreshness {
  // The coordinator is private; test its captured consumer contract rather than Lit templates.
  const token: unknown = invoke(app, "beginNavigationOperation", scope);
  if (!isNavigationFreshness(token)) throw new Error("Missing freshness token");
  return token;
}

function isNavigationFreshness(value: unknown): value is NavigationFreshness {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "isCurrent") === "function"
    && typeof Reflect.get(value, "generation") === "number" && Array.isArray(Reflect.get(value, "scope"));
}

function isWorkspacePanelContext(value: unknown): value is WorkspacePanelContext {
  return typeof value === "object" && value !== null && "files" in value && "terminal" in value;
}

function capture(app: PiWebApp): NavigationSelection {
  const route: ParsedAppRoute = readRoute();
  expect(invoke(app, "captureNavigation")).toEqual({ ...route, machineId: route.machineId ?? "local" });
  return { ...route, machineId: route.machineId ?? "local" };
}
