import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { markCachedNewSessionInfo } from "../cachedNewSessions";
import { corePlugin } from "./core";
import { PluginRegistry } from "./registry";
import { themePackPlugin } from "./themes";
import type { PluginRuntimeContext, ThemeTokens } from "./types";

function createContext(statePatch: Partial<AppState> = {}) {
  const calls: string[] = [];
  const context: PluginRuntimeContext = {
    state: { ...initialAppState(), ...statePatch },
    piWebUnstable: {
      terminalCommandRuns: {
        runCommand: vi.fn(),
        listCommandRuns: vi.fn(),
        getCommandRun: vi.fn(),
        open: vi.fn((options?: { terminalId?: string | undefined }) => { calls.push(`terminal.open:${options?.terminalId ?? ""}`); }),
      },
      openSettings: vi.fn(() => { calls.push("openSettings"); }),
    },
    openActionPalette: vi.fn(() => { calls.push("openActionPalette"); }),
    focusPrompt: vi.fn(() => { calls.push("focusPrompt"); }),
    addProject: vi.fn(() => { calls.push("addProject"); }),
    addMachine: vi.fn(() => { calls.push("addMachine"); }),
    refreshSelectedMachine: vi.fn(() => { calls.push("refreshSelectedMachine"); }),
    removeSelectedMachine: vi.fn(() => { calls.push("removeSelectedMachine"); }),
    openSelectedMachine: vi.fn(() => { calls.push("openSelectedMachine"); }),
    configureAuth: vi.fn(() => { calls.push("configureAuth"); }),
    logoutAuth: vi.fn(() => { calls.push("logoutAuth"); }),
    openThemePicker: vi.fn(() => { calls.push("openThemePicker"); }),
    selectMainView: vi.fn((view: AppState["mainView"]) => { calls.push(`selectMainView:${view}`); }),
    selectWorkspaceTool: vi.fn((tool: AppState["workspaceTool"]) => { calls.push(`selectWorkspaceTool:${tool}`); }),
    openTerminal: vi.fn((options?: { terminalId?: string | undefined }) => { calls.push(`openTerminal:${options?.terminalId ?? ""}`); }),
    refreshFiles: vi.fn(() => { calls.push("refreshFiles"); }),
    refreshGit: vi.fn(() => { calls.push("refreshGit"); }),
    refreshAppData: vi.fn(() => { calls.push("refreshAppData"); }),
    reloadPage: vi.fn(() => { calls.push("reloadPage"); }),
    deleteWorkspace: vi.fn(() => { calls.push("deleteWorkspace"); }),
    startSession: vi.fn(() => { calls.push("startSession"); }),
    archiveSession: vi.fn(() => { calls.push("archiveSession"); }),
    deleteCachedNewSession: vi.fn(() => { calls.push("deleteCachedNewSession"); }),
    stopActiveWork: vi.fn(() => { calls.push("stopActiveWork"); }),
  };
  return { context, calls };
}

describe("PluginRegistry", () => {
  it("namespaces contribution ids with the owning plugin id", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });

    expect(registry.getActions(createContext().context).some((action) => action.id === "core:actions.show")).toBe(true);
    expect(registry.getWorkspacePanels().map((panel) => panel.id)).toEqual(["core:workspace.files", "core:workspace.git", "core:workspace.terminal"]);
  });

  it("provides html and svg helpers to plugin activation", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "example",
      plugin: {
        apiVersion: 1,
        name: "Example",
        activate: ({ html, svg }) => ({
          contributions: {
            workspacePanels: [
              {
                id: "workspace.logs",
                title: "Logs",
                icon: svg`<svg viewBox="0 0 24 24"><path d="M4 6h16"></path></svg>`,
                render: () => html`<p>Logs</p>`,
              },
            ],
          },
        }),
      },
    });

    expect(registry.getWorkspacePanels()[0]?.icon).toBeDefined();
  });

  it("exposes Chinese display labels for the core plugin", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });

    expect(corePlugin.name).toBe("PI WEB 核心");
    expect(registry.getWorkspacePanels().map((panel) => panel.title)).toEqual(["文件", "Git", "终端"]);

    const actions = registry.getActions(createContext({ selectedWorkspace: testWorkspace() }).context);
    expect(actions.find((action) => action.id === "core:actions.show")).toMatchObject({ title: "显示操作", group: "通用" });
    expect(actions.find((action) => action.id === "core:workspace.refresh-files")).toMatchObject({ title: "刷新文件", group: "工作区" });
    expect(actions.find((action) => action.id === "core:session.start")).toMatchObject({ title: "启动会话", group: "会话" });
  });

  it("rejects duplicate ids within the same namespace", () => {
    const registry = new PluginRegistry();

    expect(() => {
      registry.register({
        id: "example",
        plugin: {
          apiVersion: 1,
          name: "Example",
          activate: () => ({
            contributions: {
              actions: [
                { id: "duplicate", title: "One", run: () => undefined },
                { id: "duplicate", title: "Two", run: () => undefined },
              ],
            },
          }),
        },
      });
    }).toThrow("Duplicate contribution id: example:duplicate");
  });

  it("evaluates core action enablement against runtime state", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });

    const inactive = registry.getActions(createContext().context);
    const active = registry.getActions(createContext({ selectedWorkspace: testWorkspace() }).context);

    expect(inactive.find((action) => action.id === "core:view.files")?.enabled).toBe(false);
    expect(inactive.find((action) => action.id === "core:view.terminal")?.enabled).toBe(false);
    expect(active.find((action) => action.id === "core:view.files")?.enabled).toBe(true);
    expect(active.find((action) => action.id === "core:view.terminal")?.enabled).toBe(true);
    expect(active.find((action) => action.id === "core:workspace.delete")?.enabled).toBe(false);

    const deletable = registry.getActions(createContext({ selectedWorkspace: testWorkspace({ isMain: false, isGitWorktree: true }) }).context);
    expect(deletable.find((action) => action.id === "core:workspace.delete")?.enabled).toBe(true);
  });

  it("routes workspace delete through the runtime context", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const { context, calls } = createContext({ selectedWorkspace: testWorkspace({ isMain: false, isGitWorktree: true }) });
    const action = registry.getActions(context).find((candidate) => candidate.id === "core:workspace.delete");

    if (action !== undefined) void action.run();

    expect(calls).toEqual(["deleteWorkspace"]);
  });

  it("offers archive only for persisted sessions and delete only for browser-cached new sessions", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });

    const persistedActions = registry.getActions(createContext({ selectedSession: testSession() }).context);
    expect(persistedActions.find((action) => action.id === "core:session.archive")?.enabled).toBe(true);
    expect(persistedActions.find((action) => action.id === "core:session.delete")?.enabled).toBe(false);

    const cachedActions = registry.getActions(createContext({ selectedSession: markCachedNewSessionInfo(testSession()) }).context);
    expect(cachedActions.find((action) => action.id === "core:session.archive")?.enabled).toBe(false);
    expect(cachedActions.find((action) => action.id === "core:session.delete")?.enabled).toBe(true);

    const archivedActions = registry.getActions(createContext({ selectedSession: { ...testSession(), archived: true, archivedAt: "2026-05-20T00:00:00.000Z" } }).context);
    expect(archivedActions.find((action) => action.id === "core:session.archive")?.enabled).toBe(false);
    expect(archivedActions.find((action) => action.id === "core:session.delete")?.enabled).toBe(false);
  });

  it("routes browser-cached new session delete through the runtime context", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const { context, calls } = createContext({ selectedSession: markCachedNewSessionInfo(testSession()) });
    const action = registry.getActions(context).find((candidate) => candidate.id === "core:session.delete");

    if (action !== undefined) void action.run();

    expect(calls).toEqual(["deleteCachedNewSession"]);
  });

  it("routes refresh current to the active core workspace panel", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const { context, calls } = createContext({
      selectedWorkspace: testWorkspace(),
      workspaceTool: "core:workspace.git",
    });
    const action = registry.getActions(context).find((candidate) => candidate.id === "core:workspace.refresh-current");

    if (action !== undefined) void action.run();

    expect(calls).toEqual(["refreshGit"]);
  });

  it("routes app refresh, reload, and settings actions through the runtime context", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const { context, calls } = createContext();
    const actions = registry.getActions(context);

    void actions.find((candidate) => candidate.id === "core:app.refresh-data")?.run();
    void actions.find((candidate) => candidate.id === "core:app.reload-page")?.run();
    void actions.find((candidate) => candidate.id === "core:settings.open")?.run();

    expect(calls).toEqual(["refreshAppData", "reloadPage", "openSettings"]);
  });

  it("exposes terminal navigation as a shortcut-backed action", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const { context, calls } = createContext({ selectedWorkspace: testWorkspace() });
    const action = registry.getActions(context).find((candidate) => candidate.id === "core:view.terminal");

    expect(action?.shortcut).toBe("mod+4");
    if (action !== undefined) void action.run();

    expect(calls).toEqual(["selectMainView:core:workspace.terminal"]);
  });

  it("keeps built-in keyboard shortcuts unique and action-backed", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "core", plugin: corePlugin });
    const shortcuts = registry.getActions(createContext({ selectedWorkspace: testWorkspace() }).context)
      .filter((action) => action.shortcut !== undefined)
      .map((action) => [action.id, action.shortcut]);

    expect(shortcuts).toEqual([
      ["core:actions.show", "mod+k"],
      ["core:settings.open", "mod+,"],
      ["core:view.chat", "mod+1"],
      ["core:view.files", "mod+2"],
      ["core:view.git", "mod+3"],
      ["core:view.terminal", "mod+4"],
      ["core:workspace.refresh-files", "mod+shift+f"],
      ["core:workspace.refresh-git", "mod+shift+g"],
      ["core:workspace.refresh-current", "mod+shift+r"],
      ["core:session.start", "mod+enter"],
      ["core:session.stop", "mod+."],
    ]);
    expect(new Set(shortcuts.map(([, shortcut]) => shortcut)).size).toBe(shortcuts.length);
  });

  it("collects built-in PI WEB themes from an in-app plugin", () => {
    const registry = new PluginRegistry();
    registry.register({ id: "themes", plugin: themePackPlugin });

    expect(registry.getThemes().map((theme) => ({ id: theme.id, name: theme.name, description: theme.description, colorScheme: theme.colorScheme }))).toEqual([
      { id: "themes:pi-web-dark", name: "PI WEB 深色", description: "PI WEB 深色配色。", colorScheme: "dark" },
      { id: "themes:pi-web-light", name: "PI WEB 浅色", description: "PI WEB 浅色配色。", colorScheme: "light" },
      { id: "themes:classic", name: "PI WEB 经典", description: "原始 PI WEB 深色配色。", colorScheme: "dark" },
    ]);
    expect(registry.getThemePairs().map((pair) => ({ id: pair.id, name: pair.name, description: pair.description, light: pair.light, dark: pair.dark }))).toEqual([
      { id: "themes:pi-web", name: "PI WEB", description: "跟随系统浅色/深色偏好使用 PI WEB 主题。", light: "themes:pi-web-light", dark: "themes:pi-web-dark" },
    ]);
  });

  it("collects theme contributions in contribution order", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "example",
      plugin: {
        apiVersion: 1,
        name: "Example",
        activate: () => ({
          contributions: {
            themes: [
              { id: "last", name: "Last", order: 20, colorScheme: "dark", tokens: testThemeTokens() },
              { id: "first", name: "First", order: 10, colorScheme: "light", tokens: testThemeTokens() },
            ],
            themePairs: [
              { id: "pair", name: "Pair", light: "first", dark: "last" },
            ],
          },
        }),
      },
    });

    expect(registry.getThemes().map((theme) => ({ id: theme.id, pluginId: theme.pluginId, localId: theme.localId, name: theme.name }))).toEqual([
      { id: "example:first", pluginId: "example", localId: "first", name: "First" },
      { id: "example:last", pluginId: "example", localId: "last", name: "Last" },
    ]);
    expect(registry.getThemePairs().map((pair) => ({ id: pair.id, pluginId: pair.pluginId, localId: pair.localId, light: pair.light, dark: pair.dark }))).toEqual([
      { id: "example:pair", pluginId: "example", localId: "pair", light: "example:first", dark: "example:last" },
    ]);
  });

  it("collects workspace label items in contribution order", () => {
    const registry = new PluginRegistry();
    const workspace = testWorkspace();
    registry.register({
      id: "example",
      plugin: {
        apiVersion: 1,
        name: "Example",
        activate: () => ({
          contributions: {
            workspaceLabels: [
              { id: "last", order: 20, items: () => [{ type: "text", text: "last" }] },
              { id: "hidden", order: 5, visible: () => false, items: () => [{ type: "text", text: "hidden" }] },
              { id: "first", order: 10, items: () => [{ type: "link", text: "web", href: "http://localhost:5173" }] },
            ],
          },
        }),
      },
    });

    expect(registry.getWorkspaceLabelItems(initialAppState(), workspace)).toEqual([
      { type: "link", text: "web", href: "http://localhost:5173" },
      { type: "text", text: "last" },
    ]);
  });
});

function testWorkspace(patch: Partial<Workspace> = {}): Workspace {
  return { id: "w1", projectId: "p1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, ...patch };
}

function testSession(patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    path: "/tmp/s1.jsonl",
    cwd: "/tmp/project",
    created: "2026-05-20T00:00:00.000Z",
    modified: "2026-05-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Hello",
    ...patch,
  };
}

function testThemeTokens(): ThemeTokens {
  return {
    "--pi-bg": "#000000",
    "--pi-surface": "#000000",
    "--pi-surface-hover": "#000000",
    "--pi-terminal-bg": "#000000",
    "--pi-terminal-text": "#000000",
    "--pi-border": "#000000",
    "--pi-border-muted": "#000000",
    "--pi-text": "#000000",
    "--pi-text-secondary": "#000000",
    "--pi-text-bright": "#000000",
    "--pi-muted": "#000000",
    "--pi-dim": "#000000",
    "--pi-accent": "#000000",
    "--pi-accent-border": "#000000",
    "--pi-selection-bg": "#000000",
    "--pi-success": "#000000",
    "--pi-success-border": "#000000",
    "--pi-success-bg": "#000000",
    "--pi-success-surface": "#000000",
    "--pi-success-ring": "#000000",
    "--pi-warning": "#000000",
    "--pi-warning-border": "#000000",
    "--pi-warning-surface": "#000000",
    "--pi-danger": "#000000",
    "--pi-purple": "#000000",
    "--pi-purple-border": "#000000",
    "--pi-purple-surface": "#000000",
    "--pi-overlay": "#000000",
    "--pi-shadow-soft": "#000000",
    "--pi-shadow": "#000000",
    "--pi-shadow-strong": "#000000",
    "--pi-bg-overlay-soft": "#000000",
    "--pi-bg-overlay": "#000000",
    "--pi-success-bg-overlay": "#000000",
    "--pi-terminal-selection": "#000000",
  };
}
