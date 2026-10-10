import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { Project, Workspace } from "../api";
import { ProjectController } from "./projectController";
import { deferred } from "./sessionController.testSupport";

function project(id: string, path: string): Project {
  return { id, name: id, path, createdAt: "now" };
}

function workspace(projectId: string, path: string): Workspace {
  return { id: path, projectId, path, label: path, isMain: true, isGitRepo: true, isGitWorktree: true };
}

describe("ProjectController", () => {
  it("keeps trust persistence owned by creation but passes the original route to navigation", async () => {
    const added = project("added", "/added");
    const main = workspace(added.id, added.path);
    let state: AppState = initialAppState();
    const creation = deferred<Project>();
    const expected = { machineId: "local", projectId: "original", workspaceId: "original-main", view: "chat" };
    const navigateToProject = vi.fn().mockResolvedValue(false);
    const setWorkspaceTrust = vi.fn().mockResolvedValue({ path: main.path, trusted: true, decision: true });
    const selectProject = vi.fn();
    const controller = new ProjectController(() => state, (patch) => { state = { ...state, ...patch }; }, { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() }, {
      api: { projects: vi.fn(), addProject: () => creation.promise, closeProject: vi.fn(), workspaces: vi.fn().mockResolvedValue([main]), setWorkspaceTrust },
      captureNavigation: () => expected, navigateToProject,
    });
    const adding = controller.addProject(added.path, false, { trusted: true, changed: true });
    state = { ...state, selectedProject: project("newer", "/newer") };
    creation.resolve(added);
    await adding;
    expect(setWorkspaceTrust).toHaveBeenCalledWith(added.id, main.id, true, "local");
    expect(navigateToProject).toHaveBeenCalledWith(added, { expected });
    expect(selectProject).not.toHaveBeenCalled();
    expect(state.selectedProject?.id).toBe("newer");
  });

  it("does not clear a newer selection when closing the former project completes", async () => {
    const closed = project("closed", "/closed");
    const newer = project("newer", "/newer");
    let state: AppState = { ...initialAppState(), projects: [closed, newer], selectedProject: closed };
    const deletion = deferred<{ closed: true }>();
    const navigateToProject = vi.fn();
    const forgetProject = vi.fn();
    const controller = new ProjectController(() => state, (patch) => { state = { ...state, ...patch }; }, { selectProject: vi.fn(), forgetProject, clearSelection: vi.fn() }, {
      api: { projects: vi.fn(), addProject: vi.fn(), closeProject: () => deletion.promise }, navigateToProject,
    });
    const closing = controller.closeProject(closed.id);
    state = { ...state, selectedProject: newer };
    deletion.resolve({ closed: true });
    await closing;
    expect(forgetProject).toHaveBeenCalledWith(closed.id);
    expect(navigateToProject).not.toHaveBeenCalled();
    expect(state.selectedProject?.id).toBe(newer.id);
  });

  it.each([true, false])("persists an explicit trust choice %s before session selection", async (trusted) => {
    const addedProject = project("added", "/added");
    const mainWorkspace = workspace(addedProject.id, addedProject.path);
    let state: AppState = initialAppState();
    const setWorkspaceTrust = vi.fn().mockResolvedValue({ path: mainWorkspace.path, decision: trusted, trusted });
    const selectProject = vi.fn(() => { expect(setWorkspaceTrust).toHaveBeenCalledWith(addedProject.id, mainWorkspace.id, trusted, "local"); return Promise.resolve(undefined); });
    const controller = new ProjectController(() => state, (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() }, {
        api: { projects: vi.fn(), closeProject: vi.fn(), addProject: vi.fn().mockResolvedValue(addedProject), workspaces: vi.fn().mockResolvedValue([mainWorkspace]), setWorkspaceTrust },
      });
    await controller.addProject("/added", false, { trusted, changed: true });
    expect(selectProject).toHaveBeenCalledOnce();
  });

  it("does not pin an untouched trust default", async () => {
    let state: AppState = initialAppState();
    const setWorkspaceTrust = vi.fn();
    const workspaces = vi.fn();
    const controller = new ProjectController(() => state, (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() }, {
        api: { projects: vi.fn(), closeProject: vi.fn(), addProject: vi.fn().mockResolvedValue(project("added", "/added")), workspaces, setWorkspaceTrust },
      });
    await controller.addProject("/added", false, { trusted: true, changed: false });
    expect(setWorkspaceTrust).not.toHaveBeenCalled();
    expect(workspaces).not.toHaveBeenCalled();
  });

  it("does not start a session when persisting explicit trust fails", async () => {
    const addedProject = project("added", "/added");
    let state: AppState = initialAppState();
    const selectProject = vi.fn();
    const controller = new ProjectController(() => state, (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() }, {
        api: { projects: vi.fn(), closeProject: vi.fn(), addProject: vi.fn().mockResolvedValue(addedProject), workspaces: vi.fn().mockResolvedValue([workspace(addedProject.id, addedProject.path)]), setWorkspaceTrust: vi.fn().mockRejectedValue(new Error("write denied")) },
      });
    await controller.addProject("/added", false, { trusted: true, changed: true });
    expect(selectProject).not.toHaveBeenCalled();
    expect(Object.values(state.browserErrors).some((error) => error.message.includes("write denied"))).toBe(true);
    expect(state.projects).toContainEqual(addedProject);
  });
  it("notifies ownership discovery after an applied project reload", async () => {
    const currentProject = project("current", "/current");
    const removedProject = project("removed", "/removed");
    let state: AppState = {
      ...initialAppState(),
      projects: [removedProject],
      workspacesByProjectId: {
        [currentProject.id]: [workspace(currentProject.id, currentProject.path)],
        [removedProject.id]: [workspace(removedProject.id, removedProject.path)],
      },
    };
    const onProjectsApplied = vi.fn((machineId: string) => {
      expect(machineId).toBe("local");
      expect(state.projects).toEqual([currentProject]);
      expect(state.workspacesByProjectId).toEqual({
        [currentProject.id]: [workspace(currentProject.id, currentProject.path)],
      });
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn().mockResolvedValue([currentProject]),
          addProject: vi.fn(),
          closeProject: vi.fn(),
        },
        onProjectsApplied,
      },
    );

    await controller.loadProjects();

    expect(onProjectsApplied).toHaveBeenCalledOnce();
  });

  it("notifies after adding a project and preserves the existing selection flow", async () => {
    const addedProject = project("added", "/added");
    let state: AppState = { ...initialAppState(), projectDialogOpen: true };
    const events: string[] = [];
    const selectProject = vi.fn((selected: Project): Promise<undefined> => {
      events.push("select");
      expect(selected).toBe(addedProject);
      return Promise.resolve(undefined);
    });
    const onProjectsApplied = vi.fn((machineId: string) => {
      events.push("applied");
      expect(machineId).toBe("local");
      expect(state.projects).toEqual([addedProject]);
      expect(state.projectDialogOpen).toBe(false);
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn().mockResolvedValue(addedProject),
          closeProject: vi.fn(),
        },
        onProjectsApplied,
      },
    );

    await controller.addProject(" /added ");

    expect(events).toEqual(["applied", "select"]);
    expect(onProjectsApplied).toHaveBeenCalledOnce();
    expect(selectProject).toHaveBeenCalledOnce();
  });

  it("notifies after closing a project without changing the existing clear-selection flow", async () => {
    const closedProject = project("closed", "/closed");
    const remainingProject = project("remaining", "/remaining");
    let state: AppState = {
      ...initialAppState(),
      projects: [closedProject, remainingProject],
      selectedProject: closedProject,
      workspacesByProjectId: {
        [closedProject.id]: [workspace(closedProject.id, closedProject.path)],
        [remainingProject.id]: [workspace(remainingProject.id, remainingProject.path)],
      },
    };
    const events: string[] = [];
    const forgetProject = vi.fn((projectId: string) => {
      events.push("forget");
      state = {
        ...state,
        workspacesByProjectId: Object.fromEntries(Object.entries(state.workspacesByProjectId).filter(([id]) => id !== projectId)),
      };
    });
    const clearSelection = vi.fn(() => { events.push("clear"); });
    const onProjectsApplied = vi.fn((machineId: string) => {
      events.push("applied");
      expect(machineId).toBe("local");
      expect(state.projects).toEqual([remainingProject]);
      expect(state.workspacesByProjectId[closedProject.id]).toBeUndefined();
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject, clearSelection },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn(),
          closeProject: vi.fn().mockResolvedValue(undefined),
        },
        onProjectsApplied,
      },
    );

    await controller.closeProject(closedProject.id);

    expect(events).toEqual(["forget", "applied", "clear"]);
    expect(onProjectsApplied).toHaveBeenCalledOnce();
    expect(clearSelection).toHaveBeenCalledOnce();
  });
});
