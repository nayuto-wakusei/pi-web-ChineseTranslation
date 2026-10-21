// @vitest-environment happy-dom
import { installPopoverFake } from "../anchoredPopup.testSupport";
installPopoverFake();

import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("shows the PI WEB brand by default", async () => {
    const panel = new AppNavigationPanel();
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("header strong")?.textContent).toBe("PI WEB");
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
  it("shares available height equally and keeps collapsed sections at heading height", () => {
    const styles = AppNavigationPanel.styles.cssText;

    expect(styles).toContain("machine-list, project-list, workspace-list, session-list { flex: 1 1 0px;");
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
  it("gives machine sections every snapshot and project and workspace sections the selected machine's", async () => {
    const local = machineStatusSnapshot({ machine: { "core:working": true } });
    const remote = machineStatusSnapshot({ machine: { "core:unread": true } });
    const panel = await mountPanel({ local, "remote-a": remote }, machine("local"));

    expect(section(panel, "machine-switcher", MachineSwitcher).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "machine-list", MachineList).statusSnapshots).toEqual({ local, "remote-a": remote });
    expect(section(panel, "project-list", ProjectList).statusSnapshot).toBe(local);
    expect(section(panel, "workspace-list", WorkspaceList).statusSnapshot).toBe(local);
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
