// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiScope, type Project, type Workspace } from "../api";
import { SessionController } from "../controllers/sessionController";
import { PANEL_COLLAPSE_STORAGE_KEY, PanelCollapseController } from "../appShell/panelCollapseController";
import { readRoute } from "../route";
import { PiWebApp } from "./PiWebApp";

const project: Project = { id: "managed", name: "Managed", path: "/managed", createdAt: "now" };
const workspace: Workspace = { id: "main", projectId: project.id, path: project.path, label: "Main", isMain: true, effectiveConfig: {} };

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  setApiScope("normal");
  vi.restoreAllMocks();
});

describe("management entry hierarchy integration", () => {
  it.each([false, true])("loads the sole authorized project's workspace without an entry project ID when navigation collapsed is %s", async (collapsed) => {
    localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify({ version: 1, navigationPanelCollapsed: collapsed, workspacePanelCollapsed: false }));
    const app = createApp();
    vi.spyOn(api, "projects").mockResolvedValue([project]);

    await invoke(app, "loadProjectsAndRestoreRoute");

    expect(state(app)).toMatchObject({ selectedProject: project, selectedWorkspace: workspace, isLoadingWorkspaces: false });
    expect(readRoute()).toMatchObject({ projectId: project.id, workspaceId: workspace.id });
    expect(new URL(location.href).searchParams.get("embed")).toBe("management");
    expect(api.workspaceResolution).toHaveBeenCalledWith(project.id, "local");
    expect(api.sessions).toHaveBeenCalledWith(workspace.path, "local");
    const panels: unknown = Reflect.get(app, "panelCollapse");
    expect(panels).toBeInstanceOf(PanelCollapseController);
    expect(panels).toMatchObject({ navigationPanelCollapsed: collapsed });
    expect(JSON.parse(localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY) ?? "null")).toMatchObject({ navigationPanelCollapsed: collapsed });
  });

  it("restores a newer explicit workspace instead of auto-selecting after a delayed project response", async () => {
    const app = createApp();
    const chosen: Workspace = { ...workspace, id: "chosen", label: "Chosen", path: "/managed/chosen", isMain: false };
    let finish!: (projects: Project[]) => void;
    const projectsRequested = vi.spyOn(api, "projects").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.workspaceResolution).mockResolvedValue({ projectId: project.id, status: "folder", diagnostics: [], workspaces: [workspace, chosen] });
    const loading = invoke(app, "loadProjectsAndRestoreRoute");
    await vi.waitFor(() => { expect(projectsRequested).toHaveBeenCalledOnce(); });
    history.replaceState({}, "", "/?embed=management&project=managed&workspace=chosen");
    finish([project]);
    await loading;

    expect(state(app)).toMatchObject({ selectedProject: project, selectedWorkspace: chosen });
    expect(readRoute()).toMatchObject({ projectId: project.id, workspaceId: chosen.id });
    expect(api.sessions).toHaveBeenCalledWith(chosen.path, "local");
    expect(api.sessions).not.toHaveBeenCalledWith(workspace.path, "local");
  });

  it("does not replace a newer workspace route when entry workspace discovery finishes late", async () => {
    const app = createApp();
    const chosen: Workspace = { ...workspace, id: "chosen", label: "Chosen", path: "/managed/chosen", isMain: false };
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    let finish!: (resolution: Awaited<ReturnType<typeof api.workspaceResolution>>) => void;
    vi.mocked(api.workspaceResolution)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ projectId: project.id, status: "folder", diagnostics: [], workspaces: [workspace, chosen] });
    const loading = invoke(app, "loadProjectsAndRestoreRoute");
    await vi.waitFor(() => { expect(api.workspaceResolution).toHaveBeenCalledOnce(); });
    history.replaceState({}, "", "/?embed=management&project=managed&workspace=chosen");
    const navigation = invoke(app, "restoreRoute");
    finish({ projectId: project.id, status: "folder", diagnostics: [], workspaces: [workspace, chosen] });
    await loading;
    await navigation;

    expect(state(app)).toMatchObject({ selectedProject: project, selectedWorkspace: chosen });
    expect(readRoute()).toMatchObject({ projectId: project.id, workspaceId: chosen.id });
    expect(api.sessions).toHaveBeenCalledWith(chosen.path, "local");
    expect(api.sessions).not.toHaveBeenCalledWith(workspace.path, "local");
  });
});

function createApp(): PiWebApp {
  history.replaceState({}, "", "/?embed=management");
  vi.spyOn(api, "machines").mockResolvedValue([{ id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" }]);
  vi.spyOn(api, "workspaceResolution").mockResolvedValue({ projectId: project.id, status: "folder", diagnostics: [], workspaces: [workspace] });
  vi.spyOn(api, "sessions").mockResolvedValue([]);
  vi.spyOn(SessionController.prototype, "updatePolling").mockImplementation(() => undefined);
  vi.spyOn(SessionController.prototype, "refreshPinnedSessions").mockResolvedValue();
  vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now" });
  vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now" });
  const app = new PiWebApp();
  // Keep the real hierarchy controllers and route reconciliation. The unattached
  // component only omits visual transitions, plugin IO and background polling.
  Reflect.set(app, "withChatScrollTransition", (action: () => Promise<void>) => action());
  Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve());
  Reflect.set(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
  Reflect.set(app, "refreshRestoredWorkspaceTool", () => Promise.resolve());
  Reflect.set(app, "refreshWorkspaceDeletionRuns", () => Promise.resolve());
  return app;
}

function state(app: PiWebApp): unknown {
  return Reflect.get(app, "state");
}

async function invoke(app: PiWebApp, name: string): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing app method: ${name}`);
  await Reflect.apply(method, app, []);
}
