// @vitest-environment happy-dom
import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { workspacesApi, type Workspace } from "../api";
import { SessionStorageMachineNavigationMemory } from "../controllers/machineNavigationMemory";
import { PluginRegistry } from "../plugins/registry";
import type { WorkspacePanelContext } from "../plugins/types";
import { PiWebApp } from "./PiWebApp";

const workspace: Workspace = { id: "w1", projectId: "p1", path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

function createApp(): PiWebApp {
  window.history.replaceState({}, "", "/?project=p1&workspace=w1&tool=example%3Apanel&view=example%3Apanel&legacy.panel--file=old");
  const app = new PiWebApp();
  Reflect.set(app, "state", { ...initialAppState(), selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" }, selectedWorkspace: workspace, workspaceTool: "example:panel", mainView: "example:panel" });
  return app;
}

function hostContext(app: PiWebApp): WorkspacePanelContext {
  const method: unknown = Reflect.get(app, "createWorkspacePanelContext");
  if (typeof method !== "function") throw new Error("Missing workspace context factory");
  const context: unknown = method.call(app, workspace);
  if (!isPanelContext(context)) throw new Error("Missing workspace context");
  return context;
}

function isPanelContext(value: unknown): value is WorkspacePanelContext {
  return typeof value === "object" && value !== null && "navigate" in value && "files" in value;
}

async function captureContext(app: PiWebApp): Promise<WorkspacePanelContext> {
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Missing plugin registry");
  let captured: WorkspacePanelContext | undefined;
  await registry.register({ id: "example", plugin: { apiVersion: 4, name: "Example", activate: () => ({ contributions: { workspacePanels: [{
    id: "panel", title: "Panel", navigationAliases: ["legacy:panel"], render: (context) => { captured = context; return html``; },
  }] } }) } });
  registry.getWorkspacePanels()[0]?.render(hostContext(app));
  if (captured === undefined) throw new Error("Plugin did not receive a context");
  return captured;
}

describe("PiWebApp plugin context ownership", () => {
  it("does not carry plugin query state into a different machine and can restore its saved record", () => {
    const app = createApp();
    const remember: unknown = Reflect.get(app, "rememberCurrentMachineNavigation");
    const update: unknown = Reflect.get(app, "updateUrl");
    const restore: unknown = Reflect.get(app, "writeMachineNavigationSnapshotToUrl");
    const memory: unknown = Reflect.get(app, "machineNavigation");
    if (typeof remember !== "function" || typeof update !== "function" || typeof restore !== "function" || !(memory instanceof SessionStorageMachineNavigationMemory)) throw new Error("Missing navigation memory boundary");
    remember.call(app);
    Reflect.set(app, "state", { ...initialAppState(), selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" }, selectedWorkspace: workspace, selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" } });
    update.call(app);
    expect(new URL(window.location.href).searchParams.get("machine")).toBe("remote");
    expect(new URL(window.location.href).searchParams.has("legacy.panel--file")).toBe(false);
    const saved = memory.latest("local");
    expect(saved?.surface.contributionQuery).toEqual({ "legacy.panel--file": "old" });
    restore.call(app, saved);
    expect(new URL(window.location.href).searchParams.get("legacy.panel--file")).toBe("old");
    expect(new URL(window.location.href).searchParams.has("machine")).toBe(false);
  });

  it("invalidates the original resource without refreshing another machine when a retained write finishes", async () => {
    const app = createApp();
    const context = hostContext(app);
    const registry: unknown = Reflect.get(app, "plugins");
    const files: unknown = Reflect.get(app, "files");
    if (!(registry instanceof PluginRegistry) || typeof files !== "object" || files === null) throw new Error("Missing host collaborators");
    const invalidate = vi.spyOn(registry, "invalidateWorkspaceResources").mockResolvedValue(undefined);
    const refresh = vi.fn();
    Reflect.set(files, "refreshFiles", refresh);
    let complete!: (value: { path: string; size: number; modifiedAt: string; created: boolean }) => void;
    vi.spyOn(workspacesApi, "writeWorkspaceFile").mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = context.files.writeFile("a.txt", "hi");
    Reflect.set(app, "state", { ...initialAppState(), selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" }, selectedWorkspace: workspace });
    complete({ path: "a.txt", size: 2, modifiedAt: "now", created: true });
    await pending;
    expect(refresh).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate.mock.calls[0]?.[0].machine.id).toBe("local");
    expect(invalidate.mock.calls[0]?.[1]).toEqual({ reason: "mutation", resources: ["workspace.files"] });
  });

  it("supplies panel navigation through the actual registry and host", async () => {
    const app = createApp();
    const context = await captureContext(app);
    expect(typeof context.navigate).toBe("function");
    expect(context.navigation?.contributionId).toBe("example:panel");
    expect(context.navigation?.query).toEqual({ file: "old" });
    context.navigation?.set("file", "new");
    expect(new URL(window.location.href).searchParams.get("example.panel--file")).toBe("new");
    expect(new URL(window.location.href).searchParams.has("legacy.panel--file")).toBe(false);
  });

  it("does not let a retained context mutate a different machine with matching resource IDs", async () => {
    const app = createApp();
    const context = await captureContext(app);
    Reflect.set(app, "state", { ...initialAppState(), selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" }, selectedWorkspace: workspace });
    window.history.replaceState({}, "", "/?machine=remote&project=p1&workspace=w1");
    const open = vi.fn();
    Reflect.set(app, "openRuntimeTerminal", open);
    context.navigation?.set("file", "stale");
    context.terminal.open();
    expect(window.location.search).toBe("?machine=remote&project=p1&workspace=w1");
    expect(open).not.toHaveBeenCalled();
  });

  it("retires contexts when the surface changes away and returns", async () => {
    const app = createApp();
    const context = await captureContext(app);
    const setState: unknown = Reflect.get(app, "setState");
    if (typeof setState !== "function") throw new Error("Missing state coordinator");
    setState.call(app, { mainView: "chat" });
    setState.call(app, { mainView: "example:panel" });
    context.navigation?.set("file", "stale");
    expect(new URL(window.location.href).searchParams.get("legacy.panel--file")).toBe("old");
  });
});
