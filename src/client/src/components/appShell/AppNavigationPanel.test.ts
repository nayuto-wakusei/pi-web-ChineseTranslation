// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, Workspace } from "../../api";
import type { UnreadPresence } from "../../unreadPresence";
import { MachineList } from "../MachineList";
import { MachineSwitcher } from "../MachineSwitcher";
import { ProjectList } from "../ProjectList";
import { WorkspaceList } from "../WorkspaceList";
import { AppNavigationPanel, shouldShowMachinesSection } from "./AppNavigationPanel";

afterEach(() => {
  document.body.replaceChildren();
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
    expect(workspaceList.unreadWorkspaceIds).toBe(unreadPresence.workspaces);
  });
});

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
  return { id, projectId, path: `/repo/${id}`, label: id, isMain: true, isGitRepo: true, isGitWorktree: false };
}
