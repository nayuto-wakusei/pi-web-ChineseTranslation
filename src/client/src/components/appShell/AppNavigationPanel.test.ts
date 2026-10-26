// @vitest-environment happy-dom
import { installPopoverFake } from "../anchoredPopup.testSupport";
installPopoverFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { UiPresentationRuntime } from "../../plugins/uiPresentationRuntime";
import type { UiPresentationSurface } from "../../plugins/uiPresentation";
import type { UiPresentationRenderContextV1 } from "../../../../plugin-api";
import type { Machine, Project, SessionInfo, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import { machineStatusSnapshot } from "../../machineStatus.testSupport";
import { SessionList } from "../SessionList";
import type { UnreadPresence } from "../../unreadPresence";
import type { WorkspaceLabelItem } from "../../plugins/types";
import { MachineList } from "../MachineList";
import { MachineSwitcher } from "../MachineSwitcher";
import { ProjectList } from "../ProjectList";
import { WorkspaceList } from "../WorkspaceList";
import { AppNavigationPanel, shouldShowMachinesSection } from "./AppNavigationPanel";
import { NavigationSectionsController } from "../../appShell/navigationState";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("shouldShowMachinesSection", () => {
  it("hides machine navigation when there is no machine choice", () => {
    expect(shouldShowMachinesSection([])).toBe(false);
    expect(shouldShowMachinesSection([machine("local")])).toBe(false);
  });

  it("shows machine navigation when there are multiple machines", () => {
    expect(shouldShowMachinesSection([machine("local"), machine("remote-a")])).toBe(true);
  });
});

describe("brand visibility", () => {
  it("leaves single-machine identity to the upstream switcher before machines load", async () => {
    const panel = new AppNavigationPanel();
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("header strong")).toBeNull();
    const switcher = section(panel, "machine-switcher", MachineSwitcher);
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-label")?.textContent).toBe("PI-WEB");
  });

  it.each([false, true])("does not duplicate the single-machine identity (locationIndicator=%s)", async (locationIndicator) => {
    const panel = new AppNavigationPanel();
    panel.machines = [machine("local")];
    panel.locationIndicator = locationIndicator;
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("header strong")).toBeNull();
    expect(panel.shadowRoot?.querySelector(".brand-icon")).toBeNull();
    expect(panel.shadowRoot?.querySelector(".brand-domain")).toBeNull();
    expect(section(panel, "machine-switcher", MachineSwitcher).locationIndicator).toBe(locationIndicator);
  });

  it("hides the PI WEB brand when disabled", async () => {
    const panel = new AppNavigationPanel();
    panel.showBrand = false;
    panel.managementMode = true;
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("header")).toBeNull();
  });

  it("shows the actions button only when its action is available", async () => {
    const onShowActions = vi.fn();
    const panel = new AppNavigationPanel();
    panel.onShowActions = onShowActions;
    document.body.append(panel);
    await panel.updateComplete;

    const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="显示操作"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(onShowActions).toHaveBeenCalledOnce();
  });

  it("shows and configures the single-machine identity only in PWA mode", async () => {
    const panel = new AppNavigationPanel();
    panel.showBrand = false;
    panel.locationIndicator = true;
    panel.machines = [machine("local")];
    document.body.append(panel);
    await panel.updateComplete;

    const switcher = panel.shadowRoot?.querySelector("machine-switcher");
    expect(switcher).toBeInstanceOf(MachineSwitcher);
    if (!(switcher instanceof MachineSwitcher)) throw new Error("expected machine switcher");
    expect(switcher.locationIndicator).toBe(true);
  });
});

describe("section sizing", () => {
  it("caps desktop sections, shares compact height equally, and keeps collapsed headings intrinsic", () => {
    const styles = AppNavigationPanel.elementStyles.map((style) => "cssText" in style ? style.cssText : "").join("\n");

    expect(styles).toMatch(/machine-list, project-list, workspace-list, session-list \{[^}]*flex: 1 1 0px;/u);
    expect(styles).toContain("project-list:not([collapsed]), workspace-list:not([collapsed]) { flex: 0 1 auto; max-height: calc(100% / 3); min-height: 44px;");
    expect(styles).toContain("project-list[data-manual-size]:not([collapsed]), workspace-list[data-manual-size]:not([collapsed]) { flex-basis: var(--navigation-section-height); max-height: none;");
    expect(styles).toContain(":host([compact]) project-list:not([collapsed]), :host([compact]) workspace-list:not([collapsed]) { flex: 1 1 0px; max-height: none;");
    expect(styles).toContain("session-list[collapsed] { flex: 0 0 auto; min-height: auto;");
    expect(styles).not.toContain("max-height: 26%");
  });
});

describe("stable child inputs", () => {
  it("keeps callback identity while delegating to the latest parent action and refreshing labels", async () => {
    const panel = new AppNavigationPanel();
    const original = vi.fn();
    const replacement = vi.fn();
    panel.onSelectProject = original;
    document.body.append(panel);
    await panel.updateComplete;
    const projects = panel.shadowRoot?.querySelector("project-list");
    const workspaces = panel.shadowRoot?.querySelector("workspace-list");
    if (!(projects instanceof ProjectList) || !(workspaces instanceof WorkspaceList)) throw new Error("Missing child lists");
    const selectProject = projects.onSelect;
    const oldLabelItems = workspaces.workspaceLabelItems;
    const labelItems = (): WorkspaceLabelItem[] => [{ type: "text", text: "New label" }];
    panel.onSelectProject = replacement;
    panel.workspaceLabelItems = labelItems;
    await panel.updateComplete;
    expect(projects.onSelect).toBe(selectProject);
    expect(workspaces.workspaceLabelItems).toBe(labelItems);
    expect(workspaces.workspaceLabelItems).not.toBe(oldLabelItems);
    const target: Project = { id: "p", path: "/repo", name: "Project", createdAt: "now" };
    if (selectProject === undefined) throw new Error("Missing select callback");
    selectProject(target);
    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith(target);
  });
});

describe("unread presence wiring", () => {
  it("feeds each unread presence slice to the matching navigation section", async () => {
    const unreadPresence: UnreadPresence = {
      machines: new Set(["remote-a"]),
      projects: new Set(["project-1"]),
      workspaces: new Set(["ws-1"]),
    };
    const panel = new AppNavigationPanel();
    panel.compact = true;
    panel.managementMode = true;
    panel.machines = [machine("local"), machine("remote-a")];
    panel.selectedMachine = machine("local");
    panel.projects = [project("project-1")];
    panel.workspaces = [workspace("ws-1", "project-1")];
    panel.unreadPresence = unreadPresence;
    document.body.append(panel);
    await panel.updateComplete;

    const switcher = panel.shadowRoot?.querySelector("machine-switcher");
    const machineList = panel.shadowRoot?.querySelector("machine-list");
    const projectList = panel.shadowRoot?.querySelector("project-list");
    const workspaceList = panel.shadowRoot?.querySelector("workspace-list");
    if (!(switcher instanceof MachineSwitcher)) throw new Error("Expected machine-switcher section");
    if (!(machineList instanceof MachineList)) throw new Error("Expected machine-list section");
    if (!(projectList instanceof ProjectList)) throw new Error("Expected project-list section");
    if (!(workspaceList instanceof WorkspaceList)) throw new Error("Expected workspace-list section");

    expect(switcher.unreadMachineIds).toBe(unreadPresence.machines);
    expect(machineList.unreadMachineIds).toBe(unreadPresence.machines);
    expect(projectList.unreadProjectIds).toBe(unreadPresence.projects);
    expect(projectList.managementMode).toBe(panel.managementMode);
    expect(workspaceList.unreadWorkspaceIds).toBe(unreadPresence.workspaces);
  });
});

describe("machine status wiring", () => {
  it("switches complete session flags with machine selection and preserves older-daemon absence", async () => {
    const local = machineStatusSnapshot({ sessions: { same: { "core:working": true } } });
    const remote = machineStatusSnapshot({ sessions: {} });
    const panel = await mountPanel({ local, "remote-a": remote }, machine("local"));
    expect(section(panel, "session-list", SessionList).sessionFlags).toBe(local.sessions);
    panel.selectedMachine = machine("remote-a");
    await panel.updateComplete;
    expect(section(panel, "session-list", SessionList).sessionFlags).toEqual({});
    panel.machineStatusSnapshots = { local };
    await panel.updateComplete;
    expect(section(panel, "session-list", SessionList).sessionFlags).toBeUndefined();
  });

  it("gives machine sections every snapshot and project and workspace sections the selected machine's", async () => {
    const local = machineStatusSnapshot({ machine: { "core:working": true }, sessions: { "child-1": { "core:working": true } } });
    const remote = machineStatusSnapshot({ machine: { "core:unread": true } });
    const panel = await mountPanel({ local, "remote-a": remote }, machine("local"));

    expect(section(panel, "machine-switcher", MachineSwitcher).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "machine-list", MachineList).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBe(local);
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBe(local);
    expect(section(panel, "session-list", SessionList).sessionFlags).toBe(local.sessions);

    panel.selectedMachine = machine("remote-a");
    await panel.updateComplete;
    expect(section(panel, "session-list", SessionList).sessionFlags).toBe(remote.sessions);
  });

  it("reads the local machine's snapshot before a machine has been selected", async () => {
    // `selectedMachine` is undefined until machines load, and can stay undefined
    // if that load fails, while local project rows already render. The app keys
    // snapshots by `selectedMachine?.id ?? LOCAL_MACHINE_ID`, so this panel must
    // resolve the same id instead of blanking every indicator.
    const local = machineStatusSnapshot({ projects: { "project-1": { "core:working": true } } });
    const panel = await mountPanel({ local }, undefined);

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBe(local);
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBe(local);
  });

  it("leaves project and workspace sections without a snapshot when the selected machine has none", async () => {
    const panel = await mountPanel({ "remote-a": machineStatusSnapshot() }, machine("local"));

    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBeUndefined();
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBeUndefined();
    expect(section(panel, "session-list", SessionList).sessionFlags).toBeUndefined();
  });
});

describe("stable list inputs", () => {
  it("skips unchanged lists on panel updates while invoking the latest callbacks", async () => {
    const panel = await mountPanel({}, machine("local"));
    const currentSession = session("session-1");
    panel.sessions = [currentSession];
    const oldSelect = vi.fn();
    panel.onSelectProject = oldSelect;
    panel.onSelectWorkspace = oldSelect;
    panel.onSelectSession = oldSelect;
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = section(panel, "workspace-list", WorkspaceList);
    const sessions = section(panel, "session-list", SessionList);
    const lists = [projects, workspaces, sessions];
    const settle = async () => {
      await panel.updateComplete;
      await Promise.all(lists.map((list) => list.updateComplete));
    };
    await settle();
    // Render counts are the regression contract, not a proxy for visible output.
    const renders = lists.map((list) => vi.spyOn(list, "render"));
    const panelRender = vi.spyOn(panel, "render");
    panel.locationIndicator = true;
    await settle();
    expect(panelRender).toHaveBeenCalledOnce();
    for (const render of renders) expect(render).not.toHaveBeenCalled();

    const selectProject = vi.fn();
    const selectWorkspace = vi.fn();
    const selectSession = vi.fn();
    const focus = vi.fn();
    panel.onSelectProject = selectProject;
    panel.onSelectWorkspace = selectWorkspace;
    panel.onSelectSession = selectSession;
    panel.onFocusNavigationTarget = focus;
    panel.machines = [machine("local")];
    await settle();
    for (const render of renders) expect(render).not.toHaveBeenCalled();
    for (const list of lists) control(list, ".action-row").click();
    expect(selectProject).toHaveBeenCalledWith(panel.projects[0]);
    expect(selectWorkspace).toHaveBeenCalledWith(panel.workspaces[0]);
    expect(selectSession).toHaveBeenCalledWith(currentSession);
    expect(oldSelect).not.toHaveBeenCalled();

    control(projects, ".action-row").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
    panel.machines = [machine("local"), machine("remote-a")];
    await settle();
    control(projects, ".action-row").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(focus).toHaveBeenCalledWith("machines");
  });

  it("still renders changed list data and workspace label providers", async () => {
    const panel = await mountPanel({}, machine("local"));
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = section(panel, "workspace-list", WorkspaceList);
    const sessions = section(panel, "session-list", SessionList);
    await Promise.all([projects.updateComplete, workspaces.updateComplete, sessions.updateComplete]);
    panel.projects = [project("latest-project")];
    panel.workspaces = [workspace("latest-workspace", "latest-project")];
    panel.sessions = [session("latest-session")];
    await panel.updateComplete;
    await Promise.all([projects.updateComplete, workspaces.updateComplete, sessions.updateComplete]);
    expect(projects.shadowRoot?.textContent).toContain("latest-project");
    expect(workspaces.shadowRoot?.textContent).toContain("latest-workspace");
    expect(sessions.shadowRoot?.textContent).toContain("latest-session");

    panel.workspaceLabelItems = (workspace) => [{ type: "text", text: `Label for ${workspace.id}` }];
    await panel.updateComplete;
    await workspaces.updateComplete;
    expect(workspaces.shadowRoot?.textContent).toContain("Label for latest-workspace");
  });
});

describe("host-owned navigation tree", () => {
  it.each([false, true])("keeps nested lists visible with the real mobile accordion flags (workspaces=%s)", async (workspaceSelectionVisible) => {
    const panel = await mountTreePanel(workspaceSelectionVisible);
    panel.compact = true;
    panel.collapsible = true;
    const sections = new NavigationSectionsController(panel, () => ({
      selectedProject: panel.selectedProject,
      selectedWorkspace: panel.selectedWorkspace,
      workspaceSelectionVisible,
    }), () => true);
    const applyCollapsed = () => {
      panel.projectsCollapsed = sections.isCollapsed("projects");
      panel.workspacesCollapsed = sections.isCollapsed("workspaces");
      panel.sessionsCollapsed = sections.isCollapsed("sessions");
    };
    applyCollapsed();
    expect(panel.projectsCollapsed).toBe(true);
    await settleTree(panel);
    const projects = section(panel, "project-list", ProjectList);
    expect(projects.collapsed).toBe(false);
    expect(projects.collapsible).toBe(false);
    const workspaces = projects.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
    const sessions = workspaceSelectionVisible ? workspaces?.shadowRoot?.querySelector<SessionList>("session-list") : projects.shadowRoot?.querySelector<SessionList>("session-list");
    if (!(sessions instanceof SessionList)) throw new Error("Missing mobile nested sessions");
    await sessions.updateComplete;
    expect(sessions.collapsed).toBe(false);
    expect(sessions.shadowRoot?.querySelectorAll(".action-row")).toHaveLength(1);
    sections.expand("projects");
    applyCollapsed();
    expect(panel.sessionsCollapsed).toBe(true);
    await settleTree(panel);
    await sessions.updateComplete;
    expect(sessions.collapsed).toBe(false);
    expect(panel.automaticSessionCandidates(panel.sessions).map(({ id }) => id)).toContain("session-1");
    panel.presentationRuntime = undefined;
    await panel.updateComplete;
    await section(panel, "project-list", ProjectList).updateComplete;
    if (workspaceSelectionVisible) await section(panel, "workspace-list", WorkspaceList).updateComplete;
    await section(panel, "session-list", SessionList).updateComplete;
    expect(section(panel, "project-list", ProjectList).collapsed).toBe(panel.projectsCollapsed);
    if (workspaceSelectionVisible) expect(section(panel, "workspace-list", WorkspaceList).collapsed).toBe(panel.workspacesCollapsed);
    expect(section(panel, "session-list", SessionList).collapsed).toBe(panel.sessionsCollapsed);
  });

  it.each([false, true])("reveals folded ancestors before focusing nested sessions (workspaces=%s)", async (workspaceSelectionVisible) => {
    const panel = await mountTreePanel(workspaceSelectionVisible);
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = projects.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
    if (workspaces !== null && workspaces !== undefined) {
      control(workspaces, ".tree-disclosure").click();
      await workspaces.updateComplete;
    }
    control(projects, ".tree-disclosure").click();
    await projects.updateComplete;
    expect(projects.shadowRoot?.querySelector("session-list, workspace-list")).toBeNull();
    const projectSelect = vi.fn();
    const workspaceSelect = vi.fn();
    panel.onSelectProject = projectSelect;
    panel.onSelectWorkspace = workspaceSelect;
    if (workspaceSelectionVisible) expect(await panel.focusSection("workspaces")).toBe(true);
    expect(await panel.focusSection("sessions")).toBe(true);
    expect(projects.shadowRoot?.querySelector(".tree-disclosure")?.getAttribute("aria-expanded")).toBe("true");
    const revealedWorkspaces = projects.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
    if (revealedWorkspaces !== null && revealedWorkspaces !== undefined) expect(revealedWorkspaces.shadowRoot?.querySelector(".tree-disclosure")?.getAttribute("aria-expanded")).toBe("true");
    const sessions = workspaceSelectionVisible ? revealedWorkspaces?.shadowRoot?.querySelector<SessionList>("session-list") : projects.shadowRoot?.querySelector<SessionList>("session-list");
    if (!(sessions instanceof SessionList)) throw new Error("Missing revealed session list");
    expect(sessions.shadowRoot?.activeElement).toBe(sessions.shadowRoot?.querySelector(".action-row.selected") ?? sessions.shadowRoot?.querySelector(".action-row"));
    expect(projectSelect).not.toHaveBeenCalled();
    expect(workspaceSelect).not.toHaveBeenCalled();
  });

  it("reveals a folded workspace without recreating its project branch", async () => {
    const panel = await mountTreePanel(true);
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = projects.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
    if (!(workspaces instanceof WorkspaceList)) throw new Error("Missing selected workspace branch");
    control(workspaces, ".tree-disclosure").click();
    await workspaces.updateComplete;
    expect(workspaces.shadowRoot?.querySelector("session-list")).toBeNull();
    expect(await panel.focusSection("sessions")).toBe(true);
    expect(projects.shadowRoot?.querySelector("workspace-list")).toBe(workspaces);
    expect(workspaces.shadowRoot?.querySelector(".tree-disclosure")?.getAttribute("aria-expanded")).toBe("true");
  });

  it.each([false, true])("nests the selected branch using the existing controls (workspaces=%s)", async (workspaceSelectionVisible) => {
    const panel = await mountTreePanel(workspaceSelectionVisible);
    const projects = section(panel, "project-list", ProjectList);
    const branch = projects.shadowRoot?.querySelector(".project-branch:has(.action-row.selected)");
    if (branch === undefined || branch === null) throw new Error("Missing selected project branch");
    const workspaces = branch.querySelector("workspace-list");
    expect(workspaces instanceof WorkspaceList).toBe(workspaceSelectionVisible);
    if (workspaces instanceof WorkspaceList) await workspaces.updateComplete;
    const sessions = workspaceSelectionVisible ? workspaces?.shadowRoot?.querySelector("session-list") : branch.querySelector("session-list");
    if (!(sessions instanceof SessionList)) throw new Error("Missing nested sessions");
    await sessions.updateComplete;
    expect(sessions.sessions.map(({ id }) => id)).toEqual(["session-1"]);
    expect(panel.shadowRoot?.querySelector("session-list")).toBeNull();
    expect(panel.shadowRoot?.querySelector("navigation-section-resize-handle")).toBeNull();
    expect(panel.getAttribute("data-navigation-layout")).toBe("tree");
    const selectSession = vi.fn();
    const selectProject = vi.fn();
    const selectWorkspace = vi.fn();
    panel.onSelectSession = selectSession;
    panel.onSelectProject = selectProject;
    panel.onSelectWorkspace = selectWorkspace;
    control(sessions, ".action-row").click();
    expect(selectSession).toHaveBeenCalledWith(panel.sessions[0]);
    expect(selectProject).not.toHaveBeenCalled();
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(await panel.focusSection("sessions")).toBe(true);
  });

  it("collapses branches without changing selection and selects another project through the controller", async () => {
    const panel = await mountTreePanel(false);
    const projects = section(panel, "project-list", ProjectList);
    const selectedRow = control(projects, ".action-row.selected");
    const selectProject = vi.fn();
    panel.onSelectProject = selectProject;
    selectedRow.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await projects.updateComplete;
    expect(projects.shadowRoot?.querySelector("session-list")).toBeNull();
    expect(projects.shadowRoot?.querySelector(".tree-disclosure")?.getAttribute("aria-expanded")).toBe("false");
    expect(selectProject).not.toHaveBeenCalled();
    selectedRow.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await projects.updateComplete;
    expect(projects.shadowRoot?.querySelector("session-list")).toBeInstanceOf(SessionList);
    projects.shadowRoot?.querySelectorAll<HTMLElement>(".action-row")[1]?.click();
    expect(selectProject).toHaveBeenCalledWith(panel.projects[1]);
    panel.selectedProject = project("project-2");
    await settleTree(panel);
    expect(projects.shadowRoot?.querySelector("session-list")).toBeNull();
  });

  it("returns to separate upstream lists when the presentation fails or is disabled", async () => {
    const panel = await mountTreePanel(true);
    panel.presentationRuntime?.fail("navigation", new Error("Intentional presentation failure"));
    await panel.updateComplete;
    expect(panel.hasAttribute("data-navigation-layout")).toBe(false);
    expect(section(panel, "project-list", ProjectList).treeLayout).toBe(false);
    expect(section(panel, "workspace-list", WorkspaceList).treeLayout).toBe(false);
    expect(section(panel, "session-list", SessionList).sessions).toBe(panel.sessions);
    panel.presentationRuntime = undefined;
    await panel.updateComplete;
    expect(section(panel, "session-list", SessionList).sessions).toBe(panel.sessions);
  });

  it("retains tree data and skips unchanged lists during unrelated header updates", async () => {
    const panel = await mountTreePanel(true);
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = projects.shadowRoot?.querySelector("workspace-list");
    const sessions = workspaces?.shadowRoot?.querySelector("session-list");
    if (!(workspaces instanceof WorkspaceList) || !(sessions instanceof SessionList)) throw new Error("Missing nested branch");
    await sessions.updateComplete;
    const visibleWorkspaces = workspaces.workspaces;
    const visibleSessions = sessions.sessions;
    const renders = [vi.spyOn(projects, "render"), vi.spyOn(workspaces, "render"), vi.spyOn(sessions, "render")];
    panel.locationIndicator = true;
    await settleTree(panel);
    for (const render of renders) expect(render).not.toHaveBeenCalled();
    panel.sessionStatuses = {};
    await settleTree(panel);
    await sessions.updateComplete;
    expect(workspaces.workspaces).toBe(visibleWorkspaces);
    expect(sessions.sessions).toBe(visibleSessions);
  });

  it("exposes only available host actions, invalidates old identity callbacks, and preserves snapshot identity", async () => {
    const contexts: UiPresentationRenderContextV1[] = [];
    const runtime = new UiPresentationRuntime();
    runtime.register([{ id: "test", pluginId: "test", region: "navigation", navigationLayout: "tree", active: () => true, render: (context) => {
      contexts.push(context);
      return html`<slot name="projects"></slot>`;
    } }]);
    const panel = await mountTreePanel(false);
    const start = vi.fn();
    const add = vi.fn();
    panel.presentationRuntime = runtime;
    panel.canStartSession = true;
    panel.onStartSession = start;
    panel.onAddProject = add;
    panel.onSearchSessions = vi.fn();
    panel.onShowSettings = vi.fn();
    panel.presentationContext = { mode: "normal", machine: { id: "local", name: "Local" } };
    await settleTree(panel);
    const context = contexts.at(-1);
    expect(context?.actions?.map(({ id }) => id)).toEqual(["new-task", "search", "add-project", "settings"]);
    const oldStart = context?.actions?.find(({ id }) => id === "new-task");
    await oldStart?.run();
    expect(start).toHaveBeenCalledOnce();
    const source = panel.shadowRoot?.querySelector("pi-web-ui-presentation");
    const sourceContext = source !== null && source !== undefined && "context" in source ? source.context : undefined;
    panel.locationIndicator = !panel.locationIndicator;
    await settleTree(panel);
    expect(source !== null && source !== undefined && "context" in source ? source.context : undefined).toBe(sourceContext);
    panel.managementMode = true;
    panel.presentationContext = { mode: "management", machine: { id: "remote", name: "Remote" } };
    await settleTree(panel);
    await oldStart?.run();
    expect(start).toHaveBeenCalledOnce();
    expect(contexts.at(-1)?.actions?.map(({ id }) => id)).not.toContain("add-project");
  });
});

async function mountTreePanel(workspaceSelectionVisible: boolean): Promise<AppNavigationPanel> {
  const runtime = new UiPresentationRuntime(() => undefined);
  runtime.register([{ id: "tree", pluginId: "test", region: "navigation", navigationLayout: "tree", active: () => true, render: () => html`<slot name="projects"></slot>` }]);
  const panel = new AppNavigationPanel();
  const selectedProject = project("project-1");
  const selectedWorkspace = workspace("ws-1", "project-1");
  panel.presentationRuntime = runtime;
  panel.projects = [selectedProject, project("project-2")];
  panel.selectedProject = selectedProject;
  panel.workspaces = [selectedWorkspace, workspace("ws-2", "project-1")];
  panel.selectedWorkspace = selectedWorkspace;
  panel.workspaceSelectionVisible = workspaceSelectionVisible;
  panel.sessions = [{ ...session("session-1"), cwd: selectedWorkspace.path }, session("other-workspace")];
  document.body.append(panel);
  await settleTree(panel);
  return panel;
}

async function settleTree(panel: AppNavigationPanel): Promise<void> {
  await panel.updateComplete;
  await panel.shadowRoot?.querySelector<ProjectList>("project-list")?.updateComplete;
  const projects = panel.shadowRoot?.querySelector<ProjectList>("project-list");
  await projects?.shadowRoot?.querySelector<WorkspaceList>("workspace-list")?.updateComplete;
  await panel.shadowRoot?.querySelector<UiPresentationSurface>("pi-web-ui-presentation")?.updateComplete;
}

function control(list: ProjectList | WorkspaceList | SessionList, selector: string): HTMLElement {
  const element = list.shadowRoot?.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return element;
}

function session(id: string): SessionInfo {
  return {
    id, path: `/sessions/${id}.jsonl`, cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z", modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1, firstMessage: id,
  };
}

async function mountPanel(machineStatusSnapshots: Record<string, MachineStatusSnapshot>, selectedMachine: Machine | undefined): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = true;
  panel.machines = [machine("local"), machine("remote-a")];
  if (selectedMachine !== undefined) panel.selectedMachine = selectedMachine;
  panel.projects = [project("project-1")];
  panel.workspaces = [workspace("ws-1", "project-1")];
  panel.machineStatusSnapshots = machineStatusSnapshots;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function section<T>(panel: AppNavigationPanel, selector: string, type: abstract new (...args: never) => T): T {
  const element = panel.shadowRoot?.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected a ${selector} section`);
  return element;
}


function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}

function workspace(id: string, projectId: string): Workspace {
  return { id, projectId, path: `/repo/${id}`, label: id, effectiveConfig: {}, isMain: true, isGitRepo: true, isGitWorktree: false };
}
