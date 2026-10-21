// @vitest-environment happy-dom
import { installPopoverFake } from "./anchoredPopup.testSupport";
installPopoverFake();

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("orphan child row indicator", () => {
  it("marks a session whose parent is missing as a child rather than a root row", async () => {
    const list = await renderList({ sessions: [orphan()] });

    const marker = row(list).querySelector(".tree-marker.orphan-marker");
    // Same glyph as an ordinary child: the left marker answers "is this a child",
    // not "where is the parent".
    expect(marker?.textContent).toBe("↳");
    expect(marker?.getAttribute("aria-label")).toBe("当前工作区中没有可用的父会话");
    expect(marker?.getAttribute("title")).toBe("当前工作区中没有可用的父会话");
  });

  it("uses the same child glyph for orphan and nested children, distinguished only by styling", async () => {
    const parent = session("parent");
    const list = await renderList({ sessions: [parent, session("nested", { parentSessionPath: parent.path }), orphan()] });

    const markers = [...list.shadowRoot?.querySelectorAll(".tree-marker") ?? []];
    expect(markers.map((marker) => marker.textContent)).toEqual(["↳", "↳"]);
    expect(markers.filter((marker) => marker.classList.contains("orphan-marker"))).toHaveLength(1);
  });

  it("leaves the meta line free of parent whereabouts, which are no longer resolvable", async () => {
    // Session trees are worktree-scoped, so an orphan row has no location to
    // offer and must not claim one.
    const list = await renderList({ sessions: [orphan()] });

    expect(row(list).querySelector("small")?.textContent).toBe("3 条消息");
    expect(row(list).querySelectorAll(".row-badges")).toHaveLength(0);
  });

  it("offers no navigation to the missing parent in the row menu", async () => {
    const list = await renderList({ sessions: [orphan()] });

    await openMenu(list);
    const labels = [...list.shadowRoot?.querySelectorAll(".action-menu-panel button") ?? []]
      .map((button) => button.textContent.trim());
    expect(labels).not.toContain("前往父会话");
  });

  it("adds no orphan marker to an ordinary root session", async () => {
    const list = await renderList({ sessions: [session("root")] });

    expect(row(list).querySelector(".orphan-marker")).toBeNull();
    expect(row(list).querySelector(".row-badges")).toBeNull();
    expect(row(list).querySelector("small")?.textContent).toBe("3 条消息");
  });

  it("shows a nested child under a present parent with the ordinary child marker", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList({ sessions: [parent, child] });

    const childRow = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][1];
    expect(childRow?.querySelector(".tree-marker")?.textContent).toBe("↳");
    expect(childRow?.querySelector(".orphan-marker")).toBeNull();
  });

  it("keeps the transient-session prefix on the meta line", async () => {
    const list = await renderList({ sessions: [session("new", { persisted: false })] });

    expect(row(list).querySelector("small")?.textContent).toBe("新会话 · 3 条消息");
  });
});

async function renderList(options: { sessions: SessionInfo[] }): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = options.sessions;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function row(list: SessionList, index = 0): Element {
  const found = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][index];
  if (found === undefined) throw new Error(`No session row at index ${String(index)}`);
  return found;
}

async function openMenu(list: SessionList, index = 0): Promise<void> {
  row(list, index).querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
  await list.updateComplete;
}

function orphan(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return session("child", {
    parentSessionPath: "/sessions/--srv-dev-pi-web-feature--/parent.jsonl",
    ...overrides,
  });
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
