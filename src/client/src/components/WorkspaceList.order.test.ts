// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../i18n";
import { trustApi, type Workspace } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { installPopoverFake } from "./anchoredPopup.testSupport";
import { WorkspaceList } from "./WorkspaceList";
installPopoverFake();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { setClientTranslations("en", {}); });
beforeEach(() => { vi.spyOn(trustApi, "workspaceTrust").mockImplementation((_projectId, workspaceId) => Promise.resolve({ path: `/repo/${workspaceId}`, decision: true, trusted: true })); });
describe("workspace move actions", () => {
  it("does not offer order writes in management mode even with a callback", async () => {
    const list = await mountWorkspaceList([workspace("a"), workspace("b")]);
    list.managementMode = true;
    list.onMove = vi.fn();
    await list.updateComplete;
    openMenu(list, "a");
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector("[data-move]")).toBeNull();
    expect(list.onMove).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("disables only boundary moves for row %i in parent order", async (index) => {
    const workspaces = [workspace("z"), workspace("a"), workspace("m")];
    const item = workspaces[index];
    if (item === undefined) throw new Error("Expected a workspace");
    const list = await mountWorkspaceList(workspaces);
    const onMove = vi.fn();
    list.onMove = onMove;
    openMenu(list, item.label);
    await list.updateComplete;

    const up = moveButton(list, "Move up");
    const down = moveButton(list, "Move down");
    expect(up.disabled).toBe(index === 0);
    expect(down.disabled).toBe(index === 2);
    (index === 0 ? up : index === 2 ? down : undefined)?.click();
    expect(onMove).not.toHaveBeenCalled();
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
  });

  it("disables both directions for a single workspace", async () => {
    const list = await mountWorkspaceList([workspace("only")]);
    list.onMove = vi.fn();
    openMenu(list, "only");
    await list.updateComplete;
    expect(moveButton(list, "Move up").disabled).toBe(true);
    expect(moveButton(list, "Move down").disabled).toBe(true);
  });

  it.each([-1, 1] as const)("keeps the menu open for repeated moves with direction %i without selecting", async (direction) => {
    const workspaces: [Workspace, Workspace, Workspace] = [workspace("z"), workspace("a"), workspace("m")];
    const list = await mountWorkspaceList(workspaces);
    const onSelect = vi.fn();
    const onMove = vi.fn((item: Workspace, delta: -1 | 1) => {
      const reordered = [...list.workspaces];
      const index = reordered.indexOf(item);
      reordered.splice(index, 1);
      reordered.splice(index + delta, 0, item);
      list.workspaces = reordered;
    });
    list.onSelect = onSelect;
    list.onMove = onMove;
    list.selected = workspaces[0];
    const row = rowFor(list, "a");
    openMenu(list, "a");
    await list.updateComplete;
    const action = moveButton(list, direction === -1 ? "Move up" : "Move down");
    action.focus();
    action.click();
    await list.updateComplete;

    expect(onMove).toHaveBeenCalledExactlyOnceWith(workspaces[1], direction);
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.selected).toBe(workspaces[0]);
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
    expect(rowFor(list, "a")).toBe(row);
    expect([...(list.shadowRoot?.querySelectorAll(".action-row") ?? [])].indexOf(row)).toBe(1 + direction);
    expect(action.disabled).toBe(true);
    const reverse = moveButton(list, direction === -1 ? "Move down" : "Move up");
    expect(list.shadowRoot?.activeElement).toBe(reverse);
    reverse.click();
    await list.updateComplete;
    expect(onMove).toHaveBeenLastCalledWith(workspaces[1], -direction);
    expect(list.workspaces).toEqual(workspaces);
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
    expect(action.disabled).toBe(false);
    document.body.click();
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).toBeNull();
  });

  it("leaves ordering unchanged when the parent only receives the callback", async () => {
    const workspaces = [workspace("z"), workspace("a")];
    const list = await mountWorkspaceList(workspaces);
    list.onMove = vi.fn();
    openMenu(list, "z");
    await list.updateComplete;
    moveButton(list, "Move down").click();
    await list.updateComplete;
    expect(list.workspaces).toBe(workspaces);
    expect(list.workspaces.map((item) => item.id)).toEqual(["z", "a"]);
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
  });
});

function moveButton(list: WorkspaceList, label: string): HTMLButtonElement {
  const button = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".workspace-menu-actions button") ?? [])]
    .find((candidate) => candidate.textContent === label);
  if (button === undefined) throw new Error(`Expected ${label}`);
  return button;
}

function openMenu(list: WorkspaceList, workspaceLabel: string): void {
  const toggle = rowFor(list, workspaceLabel).querySelector<HTMLButtonElement>(".action-menu-toggle");
  if (toggle === null) throw new Error(`Expected a menu toggle for ${workspaceLabel}`);
  toggle.click();
}

async function mountWorkspaceList(workspaces: Workspace[], statusSnapshot?: MachineStatusSnapshot): Promise<WorkspaceList> {
  const list = new WorkspaceList();
  list.workspaces = workspaces;
  list.statusSnapshot = statusSnapshot;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: WorkspaceList, workspaceLabel: string): Element {
  const rows = [...(list.shadowRoot?.querySelectorAll(".workspace-row") ?? [])];
  const row = rows.find((candidate) => {
    const label = candidate.querySelector(".workspace-primary-label")?.textContent;
    return label === workspaceLabel || label === `${workspaceLabel} · main`;
  });
  if (row === undefined) throw new Error(`Expected a workspace row for ${workspaceLabel}`);
  return row;
}

function workspace(id: string, patch: Partial<Workspace> = {}): Workspace {
  return { id, projectId: "project-1", path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {}, ...patch };
}
