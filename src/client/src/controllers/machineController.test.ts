import { browserErrorScopeKey, machineBrowserErrorScope, reportBrowserError } from "../browserErrors";
import { machineStatusSnapshot } from "../machineStatus.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type Machine, type MachineHealth } from "../api";
import { initialAppState, type AppState } from "../appState";
import { MachineController } from "./machineController";
import { deferred } from "./sessionController.testSupport";
import { localization } from "../localization/browser";
import { machineMessages } from "../machineMessages";

const localMachine: Machine = {
  id: "local",
  name: "Local",
  kind: "local",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const remoteMachine: Machine = {
  id: "remote-1",
  name: "Remote",
  kind: "remote",
  baseUrl: "http://remote.example.test:8504",
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

const addedMachine: Machine = {
  id: "remote-2",
  name: "New Remote",
  kind: "remote",
  baseUrl: "https://new-remote.example.test",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

const offlineHealth: MachineHealth = {
  machineId: remoteMachine.id,
  ok: false,
  checkedAt: "2026-05-26T00:00:01.000Z",
  status: "offline",
  error: "Remote machine request timed out",
};

describe("MachineController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the initiating route to the navigator after an add completion", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const creation = deferred<Machine>();
    const expected = { machineId: "local", projectId: "p1", workspaceId: "w1", sessionId: "s1", view: "chat" };
    const navigateToMachine = vi.fn().mockResolvedValue(false);
    vi.spyOn(api, "addMachine").mockReturnValue(creation.promise);
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() }, {
      captureNavigation: () => expected, navigateToMachine,
    });
    const adding = controller.addMachine({ name: addedMachine.name, baseUrl: addedMachine.baseUrl ?? "" });
    state = { ...state, selectedMachine: remoteMachine };
    creation.resolve(addedMachine);
    await adding;
    expect(navigateToMachine).toHaveBeenCalledWith(addedMachine, { expected });
    expect(state.selectedMachine?.id).toBe(remoteMachine.id);
    expect(state.machines).toContainEqual(addedMachine);
  });

  it("does not take fallback navigation after the user leaves a machine being deleted", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine, addedMachine], selectedMachine: remoteMachine };
    const deletion = deferred<{ removed: boolean }>();
    const navigateToMachine = vi.fn();
    vi.spyOn(api, "deleteMachine").mockReturnValue(deletion.promise);
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() }, { navigateToMachine });
    const deleting = controller.deleteMachine();
    state = { ...state, selectedMachine: addedMachine };
    deletion.resolve({ removed: true });
    expect(await deleting).toBeUndefined();
    expect(navigateToMachine).not.toHaveBeenCalled();
    expect(state.selectedMachine?.id).toBe(addedMachine.id);
    expect(state.machines).toEqual([localMachine, addedMachine]);
  });

  it("retains localized machine notices with unchanged remote details and stable dismissal identity", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const controller = new MachineController(() => state, (next) => { state = { ...state, ...next }; }, vi.fn(), { loadProjects: vi.fn() });
    vi.spyOn(api, "machine").mockRejectedValue(new Error("Unchanged remote detail"));
    await controller.refreshMachineIdentity(remoteMachine.id);
    const scope = machineBrowserErrorScope(remoteMachine.id);
    const notice = state.browserErrors[browserErrorScopeKey(scope)];
    expect(notice?.message).toContain("Unchanged remote detail");
    const identity = notice?.message;
    try {
      await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
      expect(notice?.displayMessage?.()).toBe(machineMessages.t("refreshFailed", { error: "Error: Unchanged remote detail" }));
      expect(notice?.message).toBe(identity);
      await controller.deleteMachine(localMachine);
      const blocked = state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope(localMachine.id))];
      await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
      expect(blocked?.displayMessage?.()).toBe(machineMessages.t("cannotRemove"));
    } finally {
      await localization.setPreferences({ language: "en", formatLocale: "en" });
    }
  });

  it("updates or clears a name override without resetting navigation", async () => {
    const aliased = { ...remoteMachine, nameOverride: "Alias", reportedName: "Old report" };
    let state: AppState = { ...initialAppState(), machines: [localMachine, aliased], selectedMachine: aliased };
    const projects = { loadProjects: vi.fn() };
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), projects);
    const updated = { ...remoteMachine, name: "Reported name" };
    const response = { ...updated, baseUrl: "https://changed-elsewhere.test", updatedAt: "newer registry revision" };
    const update = vi.spyOn(api, "updateMachine").mockResolvedValue(response);
    expect(await controller.updateMachine(remoteMachine.id, "")).toEqual(response);
    expect(update).toHaveBeenCalledWith(remoteMachine.id, { name: "" });
    expect(state.selectedMachine).toEqual(updated);
    expect(state.machines).toEqual([localMachine, updated]);
    expect(projects.loadProjects).not.toHaveBeenCalled();
    update.mockRejectedValue(new Error("Could not save"));
    expect(await controller.updateMachine(remoteMachine.id, "Alias")).toBeUndefined();
    expect(state.error).toContain("Could not save");
    expect(state.selectedMachine).toEqual(updated);
  });

  it("refreshes only the saved machine's identity without navigating", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: localMachine };
    const renamed = { ...localMachine, name: "Studio" };
    const read = vi.spyOn(api, "machine").mockResolvedValue(renamed);
    const projects = { loadProjects: vi.fn() };
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), projects);
    await controller.refreshMachineIdentity(localMachine.id);
    expect(read).toHaveBeenCalledExactlyOnceWith(localMachine.id);
    expect(state.selectedMachine).toEqual(renamed);
    expect(state.machines).toEqual([renamed, remoteMachine]);
    expect(projects.loadProjects).not.toHaveBeenCalled();
  });

  it("refreshes only existing identities and preserves the current selection and connection data", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: localMachine };
    let resolve!: (machine: Machine) => void;
    vi.spyOn(api, "machine").mockReturnValue(new Promise((done) => { resolve = done; }));
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() });
    const refresh = controller.refreshMachineIdentity(remoteMachine.id);
    state = { ...state, machines: [localMachine, remoteMachine, addedMachine], selectedMachine: addedMachine };
    resolve({ ...remoteMachine, name: "Lab", baseUrl: "http://stale.test", updatedAt: "newer registry revision" });
    await refresh;
    expect(state.machines).toEqual([localMachine, { ...remoteMachine, name: "Lab" }, addedMachine]);
    expect(state.selectedMachine).toBe(addedMachine);
  });

  it("ignores older refresh results and refreshes that overlap a name edit", async () => {
    let state: AppState = { ...initialAppState(), machines: [remoteMachine], selectedMachine: remoteMachine };
    let resolveFirst!: (machine: Machine) => void;
    let resolveSecond!: (machine: Machine) => void;
    const read = vi.spyOn(api, "machine")
      .mockReturnValueOnce(new Promise((done) => { resolveFirst = done; }))
      .mockReturnValueOnce(new Promise((done) => { resolveSecond = done; }));
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() });
    const first = controller.refreshMachineIdentity(remoteMachine.id);
    const second = controller.refreshMachineIdentity(remoteMachine.id);
    const newer = { ...remoteMachine, name: "Newer" };
    resolveSecond(newer);
    await second;
    resolveFirst(remoteMachine);
    await first;
    expect(state.selectedMachine?.name).toBe("Newer");

    let resolveEdit!: (machine: Machine) => void;
    vi.spyOn(api, "updateMachine").mockReturnValue(new Promise((done) => { resolveEdit = done; }));
    const edit = controller.updateMachine(remoteMachine.id, "Override");
    await controller.refreshMachineIdentity(remoteMachine.id);
    expect(read).toHaveBeenCalledTimes(2);
    resolveEdit({ ...remoteMachine, name: "Override", nameOverride: "Override" });
    await edit;
    expect(state.selectedMachine?.name).toBe("Override");
  });

  it.each(["response", "failure"])("ignores an older edit %s after a newer edit", async (outcome) => {
    let state: AppState = { ...initialAppState(), machines: [remoteMachine], selectedMachine: remoteMachine };
    let rejectFirst!: (error: Error) => void;
    let resolveFirst!: (machine: Machine) => void;
    let resolveSecond!: (machine: Machine) => void;
    vi.spyOn(api, "updateMachine")
      .mockReturnValueOnce(new Promise((done, reject) => { resolveFirst = done; rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise((done) => { resolveSecond = done; }));
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() });
    const first = controller.updateMachine(remoteMachine.id, "Old");
    const second = controller.updateMachine(remoteMachine.id, "New");
    resolveSecond({ ...remoteMachine, name: "New" });
    await second;
    if (outcome === "failure") rejectFirst(new Error("stale failure"));
    else resolveFirst({ ...remoteMachine, name: "Old" });
    expect(await first).toBeUndefined();
    expect(state.selectedMachine?.name).toBe("New");
    expect(state.error).toBe("");
  });

  it("does not resurrect a deleted machine from an outstanding refresh or edit", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: localMachine };
    let resolveRefresh!: (machine: Machine) => void;
    let resolveEdit!: (machine: Machine) => void;
    vi.spyOn(api, "machine").mockReturnValue(new Promise((done) => { resolveRefresh = done; }));
    vi.spyOn(api, "updateMachine").mockReturnValue(new Promise((done) => { resolveEdit = done; }));
    vi.spyOn(api, "deleteMachine").mockResolvedValue({ ok: true });
    const controller = new MachineController(() => state, (patch) => { state = { ...state, ...patch }; }, vi.fn(), { loadProjects: vi.fn() });
    const refresh = controller.refreshMachineIdentity(remoteMachine.id);
    const edit = controller.updateMachine(remoteMachine.id, "Old");
    await controller.deleteMachine(remoteMachine);
    resolveRefresh(remoteMachine);
    resolveEdit({ ...remoteMachine, name: "Old" });
    await refresh;
    expect(await edit).toBeUndefined();
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(localMachine);
  });

  it("selects a newly added machine and clears stale workspace state", async () => {
    const project = { id: "p1", name: "Project", path: "/repo", createdAt: "now" };
    const workspace = { id: "w1", projectId: project.id, path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
    const session = { id: "s1", cwd: "/repo", path: "/repo/.pi/sessions/s1.json", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      projects: [project],
      workspaces: [workspace],
      sessions: [session],
      selectedProject: project,
      selectedWorkspace: workspace,
      selectedSession: session,
      workspaceTool: "example:panel",
      error: "stale error",
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test", token: "secret-token" };

    const addMachine = vi.spyOn(api, "addMachine").mockResolvedValue(addedMachine);
    const health = vi.spyOn(api, "health").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:01.000Z", status: "online" });
    const runtime = vi.spyOn(api, "runtime").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toEqual(addedMachine);
    expect(addMachine).toHaveBeenCalledWith(input);
    expect(state.machines).toEqual([localMachine, remoteMachine, addedMachine]);
    expect(state.selectedMachine).toEqual(addedMachine);
    expect(state.projects).toEqual([]);
    expect(state.workspaces).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.selectedProject).toBeUndefined();
    expect(state.selectedWorkspace).toBeUndefined();
    expect(state.selectedSession).toBeUndefined();
    // The root's route/machine-memory owner restores plugin surface state.
    expect(state.workspaceTool).toBe("example:panel");
    expect(state.error).toBe("");
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
    expect(health).toHaveBeenCalledWith(addedMachine.id);
    expect(runtime).toHaveBeenCalledWith(addedMachine.id, true);
  });

  it("preserves the current machine state when adding a machine fails", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test" };

    vi.spyOn(api, "addMachine").mockRejectedValue(new Error("Remote rejected"));
    const health = vi.spyOn(api, "health");
    const runtime = vi.spyOn(api, "runtime");

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toBeUndefined();
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("Error: Remote rejected");
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  });

  it("keeps the routed remote machine selected while its health is offline", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockImplementation((machineId: string) => Promise.resolve(
      machineId === remoteMachine.id
        ? offlineHealth
        : { machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" },
    ));

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatuses[remoteMachine.id]).toEqual(offlineHealth);
    expect(Object.values(state.browserErrors).map((error) => error.message).join("\n")).toContain("Remote 暂不可用");
  });

  it("records offline health without falling back when the routed remote health request rejects", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockRejectedValue(new Error("Internal Server Error"));

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatuses[remoteMachine.id]).toMatchObject({ machineId: remoteMachine.id, ok: false, status: "offline", error: "Internal Server Error" });
    expect(Object.values(state.browserErrors).map((error) => error.message).join("\n")).toContain("Remote 暂不可用");
  });

  it("falls back to local when the routed machine is no longer configured", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("");
  });

  it("returns the fallback machine without selecting it when requested", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine, { selectFallback: false });

    expect(fallback).toEqual(localMachine);
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it("does not let an older runtime response overwrite a newer capability negotiation", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    let resolveOlder: ((runtime: Awaited<ReturnType<typeof api.runtime>>) => void) | undefined;
    const older = new Promise<Awaited<ReturnType<typeof api.runtime>>>((resolve) => { resolveOlder = resolve; });
    vi.spyOn(api, "runtime")
      .mockImplementationOnce(() => older)
      .mockResolvedValueOnce({ machineId: "local", ok: true, checkedAt: "new", capabilities: [] });
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    const first = controller.refreshMachineRuntime("local");
    const second = controller.refreshMachineRuntime("local");
    await second;
    resolveOlder?.({ machineId: "local", ok: true, checkedAt: "old", capabilities: ["sessions.unread"] });
    await first;

    expect(state.machineRuntimes["local"]).toMatchObject({ checkedAt: "new", capabilities: [] });
  });

  it("selects the fallback machine after deleting the selected machine by default", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine, selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" } };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine);

    expect(fallback).toEqual(localMachine);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.selectedProject).toBeUndefined();
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
  });
});


describe("Upstream transport and navigation contracts", () => {
  it("keeps machine status snapshots when switching machines", async () => {
    // Machine rows and their project rows now read the same snapshot, so
    // selecting a machine can no longer leave a lit machine dot standing over
    // descendant state that selection cleared.
    const snapshot = machineStatusSnapshot({ machine: { "core:working": true }, projects: { p1: { "core:working": true } } });
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      machineStatusSnapshots: { local: snapshot },
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "health").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-27T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-27T00:00:02.000Z" });
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.selectMachine(remoteMachine, { updateUrl: false });

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatusSnapshots).toEqual({ local: snapshot });
  });

  it("publishes a newly added machine through the injected navigation boundary", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const selectedAtNavigation: string[] = [];
    const projects = { loadProjects: vi.fn() };
    const controller = new MachineController(
      () => state,
      setState,
      vi.fn(),
      projects,
      {
        navigateToMachine: (machine, options) => {
          selectedAtNavigation.push(state.selectedMachine?.id ?? "missing");
          expect(options?.expected).toEqual({ machineId: "local", projectId: undefined, workspaceId: undefined, sessionId: undefined });
          state = { ...state, selectedMachine: machine };
          return Promise.resolve(true);
        },
      },
    );
    vi.spyOn(api, "addMachine").mockResolvedValue(addedMachine);

    await controller.addMachine({ name: addedMachine.name, baseUrl: addedMachine.baseUrl ?? "" });

    expect(selectedAtNavigation).toEqual([localMachine.id]);
    expect(state.selectedMachine).toEqual(addedMachine);
    expect(projects.loadProjects).not.toHaveBeenCalled();
  });

  it("publishes a fallback machine through the injected navigation boundary after removal", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const selectedAtNavigation: string[] = [];
    const projects = { loadProjects: vi.fn() };
    const controller = new MachineController(
      () => state,
      setState,
      vi.fn(),
      projects,
      {
        navigateToMachine: (machine, options) => {
          selectedAtNavigation.push(state.selectedMachine?.id ?? "missing");
          expect(options?.expected?.machineId).toBe(remoteMachine.id);
          state = { ...state, selectedMachine: machine };
          return Promise.resolve(true);
        },
      },
    );
    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    await controller.deleteMachine(remoteMachine);

    expect(selectedAtNavigation).toEqual([remoteMachine.id]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.machines).toEqual([localMachine]);
    expect(projects.loadProjects).not.toHaveBeenCalled();
  });

  it("follows a deletion when the user selects the removed machine while the request is pending", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    let resolveDelete: (() => void) | undefined;
    const deleteRequest = new Promise<{ deleted: true }>((resolve) => { resolveDelete = () => { resolve({ deleted: true }); }; });
    const navigationExpected: { machineId: string | undefined; selectedMachineId: string | undefined }[] = [];
    const controller = new MachineController(
      () => state,
      setState,
      vi.fn(),
      { loadProjects: vi.fn() },
      {
        navigateToMachine: (machine, options) => {
          navigationExpected.push({ machineId: options?.expected?.machineId, selectedMachineId: state.selectedMachine?.id });
          state = { ...state, selectedMachine: machine };
          return Promise.resolve(true);
        },
      },
    );
    vi.spyOn(api, "deleteMachine").mockReturnValue(deleteRequest);

    const deletion = controller.deleteMachine(remoteMachine);
    state = { ...state, selectedMachine: remoteMachine };
    resolveDelete?.();
    await deletion;

    expect(navigationExpected).toEqual([{ machineId: remoteMachine.id, selectedMachineId: remoteMachine.id }]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.machines).toEqual([localMachine]);
  });

  it("reports the local-machine removal restriction under the local machine", async () => {
    let state: AppState = { ...initialAppState(), selectedMachine: localMachine, error: "A global failure" };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.deleteMachine(localMachine);

    expect(state.error).toBe("A global failure");
    expect(state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope(localMachine.id))]?.message).toBe("The local machine cannot be removed.");
  });

  it("reports refresh failures under the affected machine without overwriting a global error", async () => {
    let state: AppState = { ...initialAppState(), selectedMachine: remoteMachine, error: "A global failure" };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "health").mockRejectedValue(new Error("Remote health failed"));
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.refreshMachineHealth(remoteMachine.id);

    expect(state.error).toBe("A global failure");
    expect(state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope(remoteMachine.id))]?.message).toBe("Error: Remote health failed");
  });

  it("drops the status snapshot of a machine that is no longer configured", async () => {
    // A machine removed from another tab or device must not keep lighting rows
    // from its previous daemon's tree if its id is ever reused.
    const localSnapshot = machineStatusSnapshot({ machine: { "core:working": true } });
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      machineStatusSnapshots: { local: localSnapshot, [remoteMachine.id]: machineStatusSnapshot() },
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.loadMachines();

    expect(state.machineStatusSnapshots).toEqual({ local: localSnapshot });
  });

  it("discards scoped errors for machines no longer configured", async () => {
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      browserErrors: reportBrowserError({}, machineBrowserErrorScope(remoteMachine.id), "Remote failure"),
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: localMachine.id, ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: localMachine.id, ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.loadMachines();

    expect(state.browserErrors).toEqual({});
  });
});
