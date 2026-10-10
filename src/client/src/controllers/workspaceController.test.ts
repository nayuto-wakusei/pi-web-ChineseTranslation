import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { browserErrorScopeKey, projectBrowserErrorScope, workspaceBrowserErrorScope } from "../browserErrors";
import type { SessionController } from "./sessionController";
import { WorkspaceController, type WorkspaceControllerDependencies } from "./workspaceController";

function machine(id: string): Machine {
  return { id, name: id, kind: id === "local" ? "local" : "remote", createdAt: "now", updatedAt: "now" };
}

function project(id: string, path: string): Project {
  return { id, name: id, path, createdAt: "now" };
}

function workspace(projectId: string, path: string, options: { isMain?: boolean } = {}): Workspace {
  return { id: path, projectId, path, label: path, isMain: options.isMain ?? false, isGitRepo: true, isGitWorktree: true };
}

function session(cwd: string, id = "s1"): SessionInfo {
  return { id, cwd, path: `${cwd}/.sessions/${id}`, created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
}

type LoadWorkspaces = (projectId: string, machineId?: string) => Promise<Workspace[]>;
type LoadSessions = (path: string, machineId?: string) => Promise<SessionInfo[]>;

interface Harness {
  controller: WorkspaceController;
  state: () => AppState;
  clearActiveSession: ReturnType<typeof vi.fn>;
  updateUrl: ReturnType<typeof vi.fn>;
  backgroundErrors: { message: string; error: unknown }[];
  setState: (patch: Partial<AppState>) => void;
}

function harness(initial: Partial<AppState>, loadWorkspaces: LoadWorkspaces, loadSessions: LoadSessions = () => Promise.resolve([]), deps: Omit<WorkspaceControllerDependencies, "api"> = {}): Harness {
  let state: AppState = { ...initialAppState(), ...initial };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const clearActiveSession = vi.fn();
  const sessions: Pick<SessionController, "clearActiveSession" | "preferredSession" | "selectSession"> = {
    clearActiveSession,
    preferredSession: vi.fn(),
    selectSession: vi.fn(),
  };
  const updateUrl = vi.fn();
  const backgroundErrors: { message: string; error: unknown }[] = [];
  const controller = new WorkspaceController(
    () => state,
    setState,
    updateUrl,
    sessions,
    undefined,
    {
      api: { workspaces: loadWorkspaces, sessions: vi.fn<(path: string, machineId?: string) => Promise<SessionInfo[]>>().mockImplementation(loadSessions) },
      onBackgroundError: (message, error) => { backgroundErrors.push({ message, error }); },
      ...deps,
    },
  );
  return { controller, state: () => state, clearActiveSession, updateUrl, backgroundErrors, setState };
}

describe("WorkspaceController.refreshSelectedProjectTopology", () => {
  it("surfaces a worktree created outside PI WEB in both the selected list and the per-project cache", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, created]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).toHaveBeenCalledWith(repo.id, "local");
    expect(test.state().workspaces).toEqual([main, created]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main, created]);
  });

  it("preserves the selection and workspace-scoped state when the selected workspace still exists", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, selected, workspace(repo.id, "/repo-other")]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
        sessions: [session(selected.path)],
        selectedFilePath: "src/index.ts",
        expandedDirs: { src: [] },
        selectedTerminalId: "t1",
      },
      loadWorkspaces,
    );
    const before = test.state();

    await test.controller.refreshSelectedProjectTopology();

    const after = test.state();
    expect(after.selectedWorkspace).toBe(selected);
    expect(after.selectedSession).toBe(before.selectedSession);
    expect(after.sessions).toBe(before.sessions);
    expect(after.selectedFilePath).toBe("src/index.ts");
    expect(after.expandedDirs).toBe(before.expandedDirs);
    expect(after.selectedTerminalId).toBe("t1");
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("leaves the selection alone when the selected workspace disappeared", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const removed = workspace(repo.id, "/repo-gone");
    const loadWorkspaces = vi.fn().mockResolvedValue([main]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: removed,
        workspaces: [main, removed],
        workspacesByProjectId: { [repo.id]: [main, removed] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toBe(removed);
    expect(test.state().workspaces).toEqual([main]);
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("discards a response for a project the user has since left", async () => {
    const repo = project("p1", "/repo");
    const other = project("p2", "/other");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo, other],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedProject: other, selectedWorkspace: undefined, workspaces: [] });
    resolveWorkspaces?.([main, created]);
    await pending;

    expect(test.state().workspaces).toEqual([]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("discards a response after the selected machine changed", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedMachine: machine("remote") });
    resolveWorkspaces?.([main, workspace(repo.id, "/repo-feature")]);
    await pending;

    expect(test.state().workspaces).toEqual([main]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("reports a failed refresh to the background error sink without painting an error banner", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const failure = new Error("git worktree list failed");
    const loadWorkspaces = vi.fn().mockRejectedValue(failure);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().error).toBe("");
    expect(test.state().workspaces).toEqual([main]);
    expect(test.backgroundErrors).toEqual([{ message: `Failed to refresh workspaces for project ${repo.id} on local`, error: failure }]);
  });

  it("re-points the selected workspace at refreshed metadata when its branch changed outside PI WEB", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = { ...workspace(repo.id, "/repo-feature"), label: "feature-a", branch: "feature-a" };
    const switched = { ...selected, label: "feature-b", branch: "feature-b" };
    const loadWorkspaces = vi.fn().mockResolvedValue([main, switched]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Same workspace (same id/path), so the session must survive; only the stale label moves.
    expect(test.state().selectedWorkspace).toEqual(switched);
    expect(test.state().selectedWorkspace?.id).toBe(selected.id);
    expect(test.state().selectedSession).toBeDefined();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("leaves the selected workspace object untouched when the refresh returns identical metadata", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature");
    // A fresh, equal object, exactly what a real HTTP response produces every resume.
    const loadWorkspaces = vi.fn().mockResolvedValue([{ ...main }, { ...selected }]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Identity preserved: an unchanged resume must not churn selected-workspace identity
    // into state, or every focus would re-render surfaces keyed on this object.
    expect(test.state().selectedWorkspace).toBe(selected);
  });

  it("refreshes nested provider metadata without tearing down the selected session", async () => {
    const repo = project("p1", "/repo");
    const provider = { pluginId: "test:workspaces", capabilities: { request: true, remove: false }, metadata: { owners: ["first"] } };
    const selected: Workspace = { ...workspace(repo.id, repo.path), provider };
    const refreshed: Workspace = { ...selected, provider: { ...provider, metadata: { owners: ["second"] } } };
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: selected, selectedSession: session(selected.path) }, () => Promise.resolve([refreshed]));
    const before = test.state().selectedSession;

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toBe(refreshed);
    expect(test.state().selectedSession).toBe(before);
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("serializes overlapping refreshes so an earlier response cannot overwrite a newer list", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const gates: ((workspaces: Workspace[]) => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const loadWorkspaces = vi.fn(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Workspace[]>((resolve) => {
        gates.push((workspaces) => { inFlight -= 1; resolve(workspaces); });
      });
    });
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const resumeRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();
    const appDataRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();

    // The second caller does not open its own request while the first is in flight; it gets
    // one trailing pass afterwards. Without this, two responses race and the slower-but-older
    // one can land last, making a just-created worktree disappear again.
    expect(maxInFlight).toBe(1);
    gates[0]?.([main]);
    await vi.waitFor(() => { expect(gates).toHaveLength(2); });
    gates[1]?.([main, created]);
    await Promise.all([resumeRefresh, appDataRefresh]);

    // The last response wins, so the newly created worktree stays visible.
    expect(test.state().workspaces).toEqual([main, created]);
  });

  it("does not request anything when no project is selected", async () => {
    const loadWorkspaces = vi.fn();
    const test = harness({ selectedMachine: machine("local") }, loadWorkspaces);

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).not.toHaveBeenCalled();
  });
});

describe("WorkspaceController navigation ownership", () => {
  it("does not apply an old project response after navigation leaves and returns to the same identity", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let finish: ((value: Workspace[]) => void) | undefined;
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, () => new Promise((resolve) => { finish = resolve; }));
    let current = true;
    const pending = test.controller.selectProject(repo, { navigation: { generation: 0, scope: ["project"], isCurrent: () => current } });

    current = false;
    finish?.([main]);
    await pending;

    expect(test.state().workspaces).toEqual([]);
    expect(test.state().selectedWorkspace).toBeUndefined();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("does not start selection for an already retired navigation token", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path);
    const loadSessions = vi.fn().mockResolvedValue([]);
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo }, () => Promise.resolve([main]), loadSessions);

    await test.controller.selectWorkspace(main, { navigation: { generation: 0, scope: ["workspace"], isCurrent: () => false } });

    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(loadSessions).not.toHaveBeenCalled();
    expect(test.state().selectedWorkspace).toBeUndefined();
  });

  it("keeps the selection operation current when only an unrelated surface changes", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path);
    const available = session(main.path);
    let finish: ((value: SessionInfo[]) => void) | undefined;
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo }, () => Promise.resolve([main]), () => new Promise((resolve) => { finish = resolve; }));
    const navigation = { generation: 0, scope: ["workspace"] as const, isCurrent: () => true };
    const pending = test.controller.selectWorkspace(main, { navigation });

    test.setState({ workspaceTool: "core:workspace.files" });
    finish?.([available]);
    await pending;

    expect(test.state().sessions).toEqual([available]);
    expect(test.state().workspaceTool).toBe("core:workspace.files");
    expect(test.updateUrl).toHaveBeenCalledOnce();
  });

  it("propagates abort signals to session loading without displaying cancellation as an error", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path);
    let reject: ((reason: unknown) => void) | undefined;
    const loadSessions = vi.fn().mockImplementation(() => new Promise<SessionInfo[]>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo }, () => Promise.resolve([main]), loadSessions);
    const abort = new AbortController();
    const pending = test.controller.selectWorkspace(main, { signal: abort.signal });
    abort.abort();
    reject?.(abort.signal.reason);
    await pending;

    expect(loadSessions).toHaveBeenCalledWith(main.path, "local", { signal: abort.signal });
    expect(test.state().browserErrors).toEqual({});
    expect(test.updateUrl).not.toHaveBeenCalled();
  });
});

describe("WorkspaceController deletion reconciliation", () => {
  it("does not request or select anything for an already retired mutation scope", async () => {
    const repo = project("p1", "/repo");
    const removed = workspace(repo.id, "/removed");
    const loadWorkspaces = vi.fn();
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, loadWorkspaces);

    await test.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id, "local", { isCurrent: () => false });

    expect(loadWorkspaces).not.toHaveBeenCalled();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("passes cancellation through the refresh and discards an aborted response", async () => {
    const repo = project("p1", "/repo");
    const removed = workspace(repo.id, "/removed");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let finish: ((value: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockImplementation(() => new Promise<Workspace[]>((resolve) => { finish = resolve; }));
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed, workspaces: [removed] }, loadWorkspaces);
    const abort = new AbortController();
    const pending = test.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id, "local", { signal: abort.signal });

    abort.abort();
    finish?.([main]);
    await pending;

    expect(loadWorkspaces).toHaveBeenCalledWith(repo.id, "local", { signal: abort.signal });
    expect(test.state().workspaces).toEqual([removed]);
    expect(test.state().selectedWorkspace).toBe(removed);
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("publishes the fallback destination through the route coordinator with expected ownership", async () => {
    const repo = project("p1", "/repo");
    const removed = workspace(repo.id, "/removed");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const expected = { machineId: "local", projectId: repo.id, workspaceId: removed.id, tool: "core:workspace.files", view: "workspace" };
    const navigateToWorkspace = vi.fn().mockResolvedValue(true);
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, () => Promise.resolve([main]), undefined, { navigateToWorkspace, captureNavigation: () => expected });

    await test.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id, "local");

    expect(navigateToWorkspace).toHaveBeenCalledWith(main, { expected });
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("does not apply a refresh from a machine the user has since left", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let finish: ((value: Workspace[]) => void) | undefined;
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo }, () => new Promise((resolve) => { finish = resolve; }));
    const pending = test.controller.refreshProjectWorkspaces(repo.id, "local");
    test.setState({ selectedMachine: machine("remote"), workspaces: [] });
    finish?.([main]);
    await pending;

    expect(test.state().workspaces).toEqual([]);
    expect(test.state().workspacesByProjectId).toEqual({});
  });

  it("does not steal selection when the route freshness retires during reconciliation", async () => {
    const repo = project("p1", "/repo");
    const removed = workspace(repo.id, "/removed");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let finish: ((value: Workspace[]) => void) | undefined;
    let current = true;
    const navigateToWorkspace = vi.fn().mockResolvedValue(true);
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, () => new Promise((resolve) => { finish = resolve; }), undefined, {
      navigateToWorkspace,
      beginNavigationOperation: () => ({ generation: 0, scope: ["workspace"], isCurrent: () => current }),
    });
    const pending = test.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id);
    current = false;
    finish?.([main]);
    await pending;

    expect(navigateToWorkspace).not.toHaveBeenCalled();
    expect(test.state().selectedWorkspace).toBe(removed);
  });
});

describe("WorkspaceController route targets", () => {
  it("keeps a missing workspace target instead of selecting the main workspace", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, () => Promise.resolve([main]));

    await test.controller.selectProject(repo, { workspaceId: "missing-workspace", updateUrl: false });

    expect(test.state().selectedProject?.id).toBe(repo.id);
    expect(test.state().selectedWorkspace).toBeUndefined();
    expect(test.clearActiveSession).toHaveBeenCalledOnce();
    expect(test.updateUrl).not.toHaveBeenCalled();
    expect(test.state().browserErrors[browserErrorScopeKey(projectBrowserErrorScope("local", repo.id))]?.message).toBe("找不到工作区：missing-workspace");
  });

  it("keeps a missing session target instead of selecting another session", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const available = session(main.path, "available-session");
    const test = harness(
      { selectedMachine: machine("local"), selectedProject: repo, projects: [repo] },
      () => Promise.resolve([main]),
      () => Promise.resolve([available]),
    );

    await test.controller.selectWorkspace(main, { sessionId: "missing-session", updateUrl: false });

    expect(test.state().selectedWorkspace?.id).toBe(main.id);
    expect(test.state().sessions.map((item) => item.id)).toEqual([available.id]);
    expect(test.state().selectedSession).toBeUndefined();
    expect(test.updateUrl).not.toHaveBeenCalled();
    expect(test.state().browserErrors[browserErrorScopeKey(workspaceBrowserErrorScope("local", repo.id, main.id))]?.message).toBe("找不到会话：missing-session");
  });
});
