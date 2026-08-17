// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot } from "../../../shared/machineStatus";
import type { Project, WorkspaceActivity } from "../api";
import { ProjectList } from "./ProjectList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("project unread indicator", () => {
  it("does not show unread-only dots on idle projects", async () => {
    const list = await mountProjectList([project("project-a"), project("project-b")], new Set(["project-b"]));

    expect(unreadDot(rowFor(list, "project-a"))).toBeNull();
    expect(unreadDot(rowFor(list, "project-b"))).toBeNull();
  });

  it("does not show an unread-only project from the status tree", async () => {
    const list = await mountProjectList([project("project-a")], new Set());
    list.statusSnapshot = statusSnapshot({ projects: { "project-a": { [CORE_STATUS_FLAGS.unread]: true } } });
    await list.updateComplete;

    expect(rowFor(list, "project-a").querySelector(".activity-indicator, .unread-ring")).toBeNull();
  });

  it("removes the unread ring without hiding real project activity", async () => {
    const list = await mountProjectList([project("project-a")], new Set(["project-a"]));
    list.activities = { "/repo/project-a": workspaceActivity("/repo/project-a", true, false) };
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".unread-ring .activity-indicator.session")).not.toBeNull();

    list.unreadProjectIds = new Set();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".unread-ring")).toBeNull();
    expect(list.shadowRoot?.querySelector(".activity-indicator.session")).not.toBeNull();
  });

  it("wraps the work dot in an unread ring when the project is busy and unread", async () => {
    const list = await mountProjectList([project("project-a")], new Set(["project-a"]));
    list.activities = { "/repo/project-a": workspaceActivity("/repo/project-a", true, false) };
    await list.updateComplete;

    const row = rowFor(list, "project-a");
    const ring = row.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("此项目中有未读会话 · 项目活动中");
    expect(row.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("keeps real project activity visible from the status tree", async () => {
    const list = await mountProjectList([project("project-a")], new Set(["project-a"]));
    list.statusSnapshot = statusSnapshot({ projects: { "project-a": { [CORE_STATUS_FLAGS.working]: true, [CORE_STATUS_FLAGS.unread]: true } } });
    await list.updateComplete;

    expect(rowFor(list, "project-a").querySelector(".unread-ring .activity-indicator.session")).not.toBeNull();
  });
});

async function mountProjectList(projects: Project[], unreadProjectIds: ReadonlySet<string>): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = projects;
  list.unreadProjectIds = unreadProjectIds;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: ProjectList, projectName: string): Element {
  const rows = [...(list.shadowRoot?.querySelectorAll(".action-row") ?? [])];
  const row = rows.find((candidate) => candidate.textContent.includes(projectName));
  if (row === undefined) throw new Error(`Expected a project row for ${projectName}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
}

function workspaceActivity(cwd: string, hasSessionActivity: boolean, hasTerminalActivity: boolean): WorkspaceActivity {
  return { cwd, hasSessionActivity, hasTerminalActivity, updatedAt: "2026-06-04T00:00:00.000Z" };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}

function statusSnapshot(patch: Partial<Pick<MachineStatusSnapshot, "projects" | "workspaces">>): MachineStatusSnapshot {
  return {
    epochId: "epoch",
    revision: 1,
    machine: {},
    projects: patch.projects ?? {},
    workspaces: patch.workspaces ?? {},
    unattributed: {},
    generatedAt: "2026-06-04T00:00:00.000Z",
  };
}
