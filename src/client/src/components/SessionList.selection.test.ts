// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("SessionList bulk selection toolbar", () => {
  it("offers Select visible with an empty selection and no Clear or Done buttons", async () => {
    const list = await renderSessionList([session("a"), session("b"), session("c")]);

    currentSelectionToggle(list).click();
    await list.updateComplete;

    expect(toolbarButton(list, "选择可见")).not.toBeNull();
    expect(toolbarButton(list, "清除所选")).toBeNull();
    expect(toolbarButton(list, "清除")).toBeNull();
    expect(toolbarButton(list, "完成")).toBeNull();
    expect(selectionCount(list)?.textContent.trim()).toBe("已选 0");
  });

  it("selects every visible session via Select visible, then clears them via Clear selected", async () => {
    const list = await renderSessionList([session("a"), session("b"), session("c")]);
    currentSelectionToggle(list).click();
    await list.updateComplete;

    toolbarButton(list, "选择可见")?.click();
    await list.updateComplete;

    expect(checkedBoxes(list)).toHaveLength(3);
    expect(selectionCount(list)?.textContent.trim()).toBe("已选 3");
    expect(toolbarButton(list, "选择可见")).toBeNull();

    toolbarButton(list, "清除所选")?.click();
    await list.updateComplete;

    expect(checkedBoxes(list)).toHaveLength(0);
    expect(selectionCount(list)?.textContent.trim()).toBe("已选 0");
    // Clearing keeps selection mode open so the visible set can be re-selected.
    expect(toolbarButton(list, "选择可见")).not.toBeNull();
  });

  it("clears a partial manual selection via Clear selected", async () => {
    const list = await renderSessionList([session("a"), session("b"), session("c")]);
    currentSelectionToggle(list).click();
    await list.updateComplete;

    checkboxes(list)[0]?.click();
    await list.updateComplete;

    expect(selectionCount(list)?.textContent.trim()).toBe("已选 1");
    expect(toolbarButton(list, "选择可见")).toBeNull();

    toolbarButton(list, "清除所选")?.click();
    await list.updateComplete;

    expect(checkedBoxes(list)).toHaveLength(0);
    expect(toolbarButton(list, "选择可见")).not.toBeNull();
  });

  it("closes selection mode, discarding the selection, from the same heading toggle that opened it", async () => {
    const list = await renderSessionList([session("a"), session("b"), session("c")]);
    currentSelectionToggle(list).click();
    await list.updateComplete;
    toolbarButton(list, "选择可见")?.click();
    await list.updateComplete;
    expect(checkedBoxes(list)).toHaveLength(3);

    currentSelectionToggle(list).click();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".bulk-row.selecting")).toBeNull();
    expect(checkboxes(list)).toHaveLength(0);
  });

  it("offers the same toggle in the archived scope", async () => {
    const archivedA = session("archived-a", { archived: true, archivedAt: "2026-06-09T00:00:00.000Z" });
    const archivedB = session("archived-b", { archived: true, archivedAt: "2026-06-09T00:00:00.000Z" });
    const list = await renderSessionList([session("current"), archivedA, archivedB]);

    archivedSectionToggle(list)?.click();
    await list.updateComplete;
    archivedSelectionToggle(list).click();
    await list.updateComplete;

    toolbarButton(list, "选择可见")?.click();
    await list.updateComplete;
    expect(checkedBoxes(list)).toHaveLength(2);
    expect(selectionCount(list)?.textContent.trim()).toBe("已选 2");

    toolbarButton(list, "清除所选")?.click();
    await list.updateComplete;
    expect(checkedBoxes(list)).toHaveLength(0);
    expect(toolbarButton(list, "选择可见")).not.toBeNull();
  });
});

async function renderSessionList(sessions: SessionInfo[]): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function currentSelectionToggle(list: SessionList): HTMLButtonElement {
  const button = list.shadowRoot?.querySelector<HTMLButtonElement>("h2:not(.subheading) .bulk-select-entry");
  if (button === null || button === undefined) throw new Error("Expected the current selection toggle");
  return button;
}

function archivedSelectionToggle(list: SessionList): HTMLButtonElement {
  const button = list.shadowRoot?.querySelector<HTMLButtonElement>("h2.subheading .bulk-select-entry");
  if (button === null || button === undefined) throw new Error("Expected the archived selection toggle");
  return button;
}

function archivedSectionToggle(list: SessionList): HTMLButtonElement | null {
  return list.shadowRoot?.querySelector<HTMLButtonElement>("h2.subheading .section-toggle") ?? null;
}

function toolbarButton(list: SessionList, text: string): HTMLButtonElement | null {
  const buttons = list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".bulk-row.selecting button") ?? [];
  for (const button of buttons) {
    if (button.textContent.trim() === text) return button;
  }
  return null;
}

function selectionCount(list: SessionList): HTMLElement | null {
  return list.shadowRoot?.querySelector<HTMLElement>(".bulk-row.selecting small") ?? null;
}

function checkboxes(list: SessionList): HTMLInputElement[] {
  return [...(list.shadowRoot?.querySelectorAll<HTMLInputElement>("input.session-checkbox") ?? [])];
}

function checkedBoxes(list: SessionList): HTMLInputElement[] {
  return checkboxes(list).filter((checkbox) => checkbox.checked);
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z",
    modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    ...overrides,
  };
}
