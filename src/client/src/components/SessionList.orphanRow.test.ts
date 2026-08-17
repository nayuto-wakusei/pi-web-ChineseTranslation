// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("orphan child row indicator", () => {
  it("marks a session whose parent is missing as a child rather than a root row", async () => {
    const list = await renderList([orphan()]);
    const marker = row(list).querySelector(".tree-marker.orphan-marker");

    expect(marker?.textContent).toBe("↳");
    expect(marker?.getAttribute("aria-label")).toBe("当前工作区中没有可用的父会话");
    expect(marker?.getAttribute("title")).toBe("当前工作区中没有可用的父会话");
  });

  it("uses the same child glyph for orphan and nested children", async () => {
    const parent = session("parent");
    const list = await renderList([parent, session("nested", { parentSessionPath: parent.path }), orphan()]);
    const markers = [...list.shadowRoot?.querySelectorAll(".tree-marker") ?? []];

    expect(markers.map((marker) => marker.textContent)).toEqual(["↳", "↳"]);
    expect(markers.filter((marker) => marker.classList.contains("orphan-marker"))).toHaveLength(1);
  });

  it("does not expose parent whereabouts or navigation", async () => {
    const list = await renderList([orphan()]);

    expect(row(list).querySelector("small")?.textContent).toBe("3 条消息");
    row(list).querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    const labels = [...list.shadowRoot?.querySelectorAll(".action-menu-panel button") ?? []]
      .map((button) => button.textContent.trim());
    expect(labels).not.toContain("前往父会话");
  });

  it("keeps ordinary roots and present children unchanged", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList([parent, child]);
    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];

    expect(rows[0]?.querySelector(".orphan-marker")).toBeNull();
    expect(rows[1]?.querySelector(".tree-marker")?.textContent).toBe("↳");
    expect(rows[1]?.querySelector(".orphan-marker")).toBeNull();
  });
});

async function renderList(sessions: SessionInfo[]): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function row(list: SessionList): Element {
  const found = list.shadowRoot?.querySelector(".action-row");
  if (found === null || found === undefined) throw new Error("No session row");
  return found;
}

function orphan(): SessionInfo {
  return session("child", { parentSessionPath: "/sessions/other-workspace/parent.jsonl" });
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/srv/dev/pi-web",
    created: "2026-07-28T00:00:00.000Z",
    modified: "2026-07-28T00:00:00.000Z",
    messageCount: 3,
    firstMessage: id,
    ...overrides,
  };
}
