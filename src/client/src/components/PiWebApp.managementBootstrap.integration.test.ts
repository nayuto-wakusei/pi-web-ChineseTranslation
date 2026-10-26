// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiScope, type Project, type SessionInfo, type Workspace } from "../api";
import { loadCachedNewSessions, rememberCachedNewSession } from "../cachedNewSessions";
import { SessionController } from "../controllers/sessionController";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { PANEL_COLLAPSE_STORAGE_KEY, PanelCollapseController } from "../appShell/panelCollapseController";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { clearStagedAttachments, loadStagedAttachments, saveStagedAttachments } from "../promptAttachmentStaging";
import { readRoute } from "../route";
import { PiWebApp } from "./PiWebApp";

const project: Project = { id: "managed", name: "Managed", path: "/managed", createdAt: "now" };
const workspace: Workspace = { id: "main", projectId: project.id, path: project.path, label: "Main", isMain: true, effectiveConfig: {} };

afterEach(() => {
  clearStagedAttachments(machineSessionKey("local", "browser-only"));
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  setApiScope("normal");
  vi.restoreAllMocks();
});

describe("management entry hierarchy integration", () => {
  it.each(["persisted", "active", "empty"] as const)("does not automatically restore a browser-only session over an authorized %s list", async (listing) => {
    const empty = listing === "empty";
    const app = createApp();
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    const stale: SessionInfo = {
      id: "browser-only", path: "/sessions/browser-only.jsonl", cwd: workspace.path,
      created: "2026-10-20", modified: "2026-10-20", messageCount: 0, firstMessage: "",
    };
    const available: SessionInfo = { ...stale, id: "authorized", path: "/sessions/authorized.jsonl", persisted: listing === "persisted", messageCount: listing === "persisted" ? 2 : 0 };
    rememberCachedNewSession(stale);
    new SessionStorageSessionSelectionMemory().rememberSession({ ...stale, cwd: `local:${workspace.path}` });
    saveDraft(machineSessionKey("local", stale.id), "unsent draft");
    saveStagedAttachments(machineSessionKey("local", stale.id), [{ id: "staged", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "aGk=", size: 2 }]);
    vi.mocked(api.sessions).mockResolvedValue(empty ? [] : [available]);
    const start = vi.spyOn(api, "startSession");

    await invoke(app, "loadProjectsAndRestoreRoute");

    expect(state(app)).toMatchObject({ selectedSession: empty ? undefined : available });
    expect(readRoute().sessionId).toBe(empty ? undefined : available.id);
    expect(start).not.toHaveBeenCalled();
    expect(loadCachedNewSessions().map((session) => session.id)).toContain(stale.id);
    expect(loadDraft(machineSessionKey("local", stale.id))).toBe("unsent draft");
    expect(loadStagedAttachments(machineSessionKey("local", stale.id)).map((attachment) => attachment.id)).toEqual(["staged"]);
  });

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
