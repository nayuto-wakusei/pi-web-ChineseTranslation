// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../i18n";
import type { Project } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { installPopoverFake } from "./anchoredPopup.testSupport";
import { ProjectList } from "./ProjectList";
installPopoverFake();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { setClientTranslations("en", {}); });
describe("project move actions", () => {
  it("does not offer order writes in management mode even with a callback", async () => {
    const list = await mountProjectList([project("a"), project("b")], undefined);
    list.managementMode = true;
    list.onMove = vi.fn();
    openMenu(list, "a");
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector("[data-move]")).toBeNull();
    expect(list.onMove).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("disables only boundary moves for row %i in parent order", async (index) => {
    const projects = [project("z"), project("a"), project("m")];
    const item = projects[index];
    if (item === undefined) throw new Error("Expected a project");
    const list = await mountProjectList(projects, undefined);
    const onMove = vi.fn();
    list.onMove = onMove;
    openMenu(list, item.name);
    await list.updateComplete;

    const up = moveButton(list, "Move up");
    const down = moveButton(list, "Move down");
    expect(up.disabled).toBe(index === 0);
    expect(down.disabled).toBe(index === 2);
    (index === 0 ? up : index === 2 ? down : undefined)?.click();
    expect(onMove).not.toHaveBeenCalled();
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).not.toBeNull();
  });

  it("disables both directions for a single project", async () => {
    const list = await mountProjectList([project("only")], undefined);
    list.onMove = vi.fn();
    openMenu(list, "only");
    await list.updateComplete;
    expect(moveButton(list, "Move up").disabled).toBe(true);
    expect(moveButton(list, "Move down").disabled).toBe(true);
  });

  it.each([-1, 1] as const)("keeps the menu open for repeated moves with direction %i without selecting", async (direction) => {
    const projects: [Project, Project, Project] = [project("z"), project("a"), project("m")];
    const list = await mountProjectList(projects, undefined);
    const onSelect = vi.fn();
    const onMove = vi.fn((item: Project, delta: -1 | 1) => {
      const reordered = [...list.projects];
      const index = reordered.indexOf(item);
      reordered.splice(index, 1);
      reordered.splice(index + delta, 0, item);
      list.projects = reordered;
    });
    list.onSelect = onSelect;
    list.onMove = onMove;
    list.selected = projects[0];
    const row = rowFor(list, "a");
    openMenu(list, "a");
    await list.updateComplete;
    const action = moveButton(list, direction === -1 ? "Move up" : "Move down");
    action.focus();
    action.click();
    await list.updateComplete;

    expect(onMove).toHaveBeenCalledExactlyOnceWith(projects[1], direction);
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.selected).toBe(projects[0]);
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).not.toBeNull();
    expect(rowFor(list, "a")).toBe(row);
    expect([...(list.shadowRoot?.querySelectorAll(".action-row") ?? [])].indexOf(row)).toBe(1 + direction);
    expect(action.disabled).toBe(true);
    const reverse = moveButton(list, direction === -1 ? "Move down" : "Move up");
    expect(list.shadowRoot?.activeElement).toBe(reverse);
    reverse.click();
    await list.updateComplete;
    expect(onMove).toHaveBeenLastCalledWith(projects[1], -direction);
    expect(list.projects).toEqual(projects);
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).not.toBeNull();
    expect(action.disabled).toBe(false);
    document.body.click();
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).toBeNull();
  });

  it("leaves ordering unchanged when the parent only receives the callback", async () => {
    const projects = [project("z"), project("a")];
    const list = await mountProjectList(projects, undefined);
    list.onMove = vi.fn();
    openMenu(list, "z");
    await list.updateComplete;
    moveButton(list, "Move down").click();
    await list.updateComplete;
    expect(list.projects).toBe(projects);
    expect(list.projects.map((item) => item.id)).toEqual(["z", "a"]);
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).not.toBeNull();
  });
});

function openMenu(list: ProjectList, name: string): void {
  const toggle = rowFor(list, name).querySelector<HTMLButtonElement>(".action-menu-toggle");
  if (toggle === null) throw new Error(`Expected a menu toggle for ${name}`);
  toggle.click();
}

function moveButton(list: ProjectList, label: string): HTMLButtonElement {
  const button = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".action-menu-panel button") ?? [])]
    .find((candidate) => candidate.textContent === label);
  if (button === undefined) throw new Error(`Expected ${label}`);
  return button;
}

async function mountProjectList(projects: Project[], statusSnapshot: MachineStatusSnapshot | undefined): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = projects;
  list.statusSnapshot = statusSnapshot;
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

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}
