// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_BROWSER_FACADE_CAPABILITY, TerminalFacade } from "../../../../pi-web-plugins/terminal/TerminalFacade";
import { initialAppState } from "../appState";
import { terminalsApi, type Workspace } from "../api";
import { requestPairedPluginBackend } from "../api/pluginBackends";
import { machineScopedBundledPluginId } from "../../../shared/machinePluginIds";
import { queryNamespace } from "../namespacedQueryArgs";
import type { ExternalPluginLoadResult } from "../plugins/external";
import { PluginRegistry } from "../plugins/registry";
import type { PiWebPluginRegistration, WorkspacePanelContext } from "../plugins/types";
import { PiWebApp } from "./PiWebApp";

vi.mock("../api/pluginBackends", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/pluginBackends")>(),
  requestPairedPluginBackend: vi.fn(),
}));

const workspace: Workspace = { id: "w", projectId: "p", path: "/repo", label: "main", effectiveConfig: {}, isMain: true, isGitRepo: true, isGitWorktree: false };
const run = { id: "run", origin: "core", projectId: "p", workspaceId: "w", terminalId: "t", title: "Build", command: "true", status: "succeeded" as const, exitCode: 0, createdAt: "now", metadata: {} };

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function createApp(machineId = "local", management = false): PiWebApp {
  const query = new URLSearchParams({ project: "p", workspace: "w", tool: "terminal", view: "chat" });
  if (machineId !== "local") query.set("machine", machineId);
  if (management) query.set("embed", "management");
  window.history.replaceState({}, "", `/?${query.toString()}`);
  const app = new PiWebApp();
  Reflect.set(app, "state", { ...initialAppState(), selectedProject: { id: "p", path: "/repo", name: "Repo", createdAt: "now" }, selectedWorkspace: workspace, workspaces: [workspace],
    ...(machineId === "local" ? {} : { selectedMachine: { id: machineId, name: machineId, kind: "remote", createdAt: "now", updatedAt: "now" } }) });
  Reflect.set(app, "refreshSelectedWorkspaceTool", () => undefined);
  const git: unknown = Reflect.get(app, "git");
  if (typeof git === "object" && git !== null) Reflect.set(git, "updatePolling", () => undefined);
  return app;
}

function terminalRegistration(machineId = "local", facade = new TerminalFacade()): PiWebPluginRegistration {
  const id = machineId === "local" ? "pi-web.terminal" : machineScopedBundledPluginId(machineId, "pi-web.terminal");
  return { id, manifestSource: "bundled", manifestScope: "bundled", machineSpecific: true, backendRevision: "revision-1", pairedRequestVersion: 1, pairedChannelVersion: 1,
    ...(machineId === "local" ? {} : { machineId, sourcePluginId: "pi-web.terminal" }),
    plugin: { apiVersion: 4, name: "Terminal", activate: () => ({ provides: [{ capability: TERMINAL_BROWSER_FACADE_CAPABILITY, value: facade }], contributions: {
      workspacePanels: [{ id: "workspace.terminal", title: "Terminal", routeAliases: ["terminal", "core:workspace.terminal"], render: () => html`` }],
    } }) } };
}

function loadResult(registrations: PiWebPluginRegistration[], terminalMode: ExternalPluginLoadResult["terminalMode"] = "required"): ExternalPluginLoadResult {
  return { terminalMode, registrations, failures: [], declarations: registrations.map((registration) => ({
    id: registration.id,
    ...(registration.machineSpecific === undefined ? {} : { machineSpecific: registration.machineSpecific }),
    ...(registration.machineId === undefined ? {} : { machineId: registration.machineId }),
    ...(registration.sourcePluginId === undefined ? {} : { sourcePluginId: registration.sourcePluginId }),
    ...(registration.manifestSource === undefined ? {} : { manifestSource: registration.manifestSource }),
    ...(registration.manifestScope === undefined ? {} : { manifestScope: registration.manifestScope }),
  })) };
}

function call(app: PiWebApp, methodName: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, methodName);
  if (typeof method !== "function") throw new Error(`Missing ${methodName}`);
  return Reflect.apply(method, app, args);
}

function registry(app: PiWebApp): PluginRegistry {
  const value: unknown = Reflect.get(app, "plugins");
  if (!(value instanceof PluginRegistry)) throw new Error("Missing registry");
  return value;
}

describe("required Terminal host cutover", () => {
  it("registers Terminal before ordinary plugins and rejects a missing facade without activating them", async () => {
    const app = createApp();
    const terminal = terminalRegistration();
    terminal.plugin = { apiVersion: 4, name: "Invalid Terminal", activate: () => ({ contributions: {} }) };
    const ordinaryActivate = vi.fn(() => ({ contributions: {} }));
    const ordinary: PiWebPluginRegistration = { id: "example", plugin: { apiVersion: 4, name: "Example", activate: ordinaryActivate } };
    const result = await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([terminal, ordinary])));
    expect(result).toBe(false);
    expect(ordinaryActivate).not.toHaveBeenCalled();
    expect(registry(app).hasPlugin("pi-web.terminal")).toBe(false);
    expect(call(app, "displayedError")).toContain("必需的终端插件");
    await registry(app).dispose();
  });

  it.each(["local", "remote"])("runs and lists commands through the machine-scoped peer, never legacy HTTP (%s)", async (machineId) => {
    const app = createApp(machineId);
    const legacyRun = vi.spyOn(terminalsApi, "runTerminalCommand");
    const legacyList = vi.spyOn(terminalsApi, "listCommandRuns");
    vi.mocked(requestPairedPluginBackend).mockImplementation((_target, operation) => Promise.resolve(operation === "terminal.run" ? run : [run]));
    await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([terminalRegistration(machineId)])), machineId);
    const context: unknown = call(app, "createWorkspacePanelContext", workspace);
    if (!isContext(context)) throw new Error("Missing panel context");
    const handle = await context.terminal.runCommand({ title: "Build", command: "true" });
    expect(handle.run).toEqual(run);
    await expect(handle.completed).resolves.toEqual(run);
    await expect(call(app, "listTerminalCommandRuns", machineId)).resolves.toEqual([run]);
    const expectedSignal: unknown = expect.any(AbortSignal);
    expect(requestPairedPluginBackend).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "pi-web.terminal", backendRevision: "revision-1", projectId: "p", workspaceId: "w", machineId }), "terminal.run", expect.objectContaining({ title: "Build", command: "true" }), expect.objectContaining({ signal: expectedSignal }));
    expect(legacyRun).not.toHaveBeenCalled();
    expect(legacyList).not.toHaveBeenCalled();
    await registry(app).dispose();
  });

  it.each(["local", "remote"])("routes a Terminal panel click through the facade auto-start intent (%s)", async (machineId) => {
    const app = createApp(machineId);
    const registration = terminalRegistration(machineId);
    await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([registration])), machineId);
    const panelId = `${registration.id}:workspace.terminal` as const;
    call(app, "openWorkspaceTool", panelId);
    const query = new URL(window.location.href).searchParams;
    expect(query.get(`${queryNamespace(panelId)}--start`)).toBe("1");
    expect(query.get("tool")).toBe(panelId);
    expect(requestPairedPluginBackend).not.toHaveBeenCalled();
    await registry(app).dispose();
  });

  it("opens a known terminal with canonical query and clears its old alias without losing unrelated query", async () => {
    const app = createApp();
    await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([terminalRegistration()])));
    window.history.replaceState({}, "", `${window.location.href}&core.workspace.terminal--terminal=old&other.panel--tag=keep`);
    call(app, "openTerminal", { terminalId: "next" });
    const query = new URL(window.location.href).searchParams;
    expect(query.get("pi-web.terminal.workspace.terminal--terminal")).toBe("next");
    expect(query.has("core.workspace.terminal--terminal")).toBe(false);
    expect(query.get("other.panel--tag")).toBe("keep");
    expect(query.get("tool")).toBe("pi-web.terminal:workspace.terminal");
    await registry(app).dispose();
  });

  it.each(["navigation", "disconnect"])("keeps a retained command completion from moving an obsolete surface (%s)", async (obsolete) => {
    const app = createApp();
    let finish!: (value: typeof run) => void;
    vi.mocked(requestPairedPluginBackend).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([terminalRegistration()])));
    const context: unknown = call(app, "createWorkspacePanelContext", workspace);
    if (!isContext(context)) throw new Error("Missing panel context");
    const pending = context.terminal.runCommand({ title: "Build", command: "true", open: true });
    if (obsolete === "disconnect") app.disconnectedCallback();
    else window.history.replaceState({}, "", "/?project=p&workspace=w&view=chat&other.panel--tag=new");
    const latest = window.location.href;
    finish(run);
    await pending;
    expect(window.location.href).toBe(latest);
    await registry(app).dispose();
  });

  it("keeps management command runs on controlled HTTP and never activates the ordinary facade", async () => {
    const app = createApp("local", true);
    const registration = terminalRegistration();
    const activate = vi.spyOn(registration.plugin, "activate");
    const controlledRun = vi.spyOn(terminalsApi, "runTerminalCommand").mockResolvedValue(run);
    await call(app, "registerExternalPlugins", "test", () => Promise.resolve(loadResult([registration])));
    const context: unknown = call(app, "createWorkspacePanelContext", workspace);
    if (!isContext(context)) throw new Error("Missing panel context");
    await context.terminal.runCommand({ title: "Build", command: "true", open: true });
    context.terminal.open();
    expect(controlledRun).toHaveBeenCalledWith("core", { title: "Build", command: "true", open: true, workspace }, "local");
    expect(requestPairedPluginBackend).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(registry(app).hasPlugin("pi-web.terminal")).toBe(false);
    expect(new URL(window.location.href).searchParams.get("tool")).toBe("terminal");
    await registry(app).dispose();
  });
});

function isContext(value: unknown): value is WorkspacePanelContext {
  return typeof value === "object" && value !== null && "terminal" in value && "workspace" in value;
}
