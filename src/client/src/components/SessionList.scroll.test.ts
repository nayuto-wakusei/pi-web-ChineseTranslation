// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

let scrollIntoView: MockInstance;

beforeEach(() => {
  scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("SessionList selection reveal scrolling", () => {
  it("scrolls the selected row into view on the first render that has a selection", async () => {
    await renderSessionList({ sessions: [session("a"), session("b")], selected: session("a") });

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("scrolls when the selection changes to a different row", async () => {
    const a = session("a");
    const b = session("b");
    const list = await renderSessionList({ sessions: [a, b], selected: a });
    scrollIntoView.mockClear();

    list.selected = b;
    await settled(list);

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("does not scroll when a status refresh bumps the selected session's messageCount", async () => {
    // sessionMessageCountPatch replaces the sessions array and the selected
    // object with same-id copies on every messageCount change.
    const a = session("a");
    const b = session("b");
    const list = await renderSessionList({ sessions: [a, b], selected: a });
    scrollIntoView.mockClear();

    const bumped = { ...a, messageCount: a.messageCount + 1 };
    list.sessions = [bumped, b];
    list.selected = bumped;
    await settled(list);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(list.shadowRoot?.querySelector(".action-row.selected")).not.toBeNull();
  });

  it("does not scroll when the sessions array is replaced while the selection object stays put", async () => {
    const a = session("a");
    const b = session("b");
    const list = await renderSessionList({ sessions: [a, b], selected: a });
    scrollIntoView.mockClear();

    list.sessions = [{ ...a }, { ...b }];
    await settled(list);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(list.shadowRoot?.querySelector(".action-row.selected")).not.toBeNull();
  });

  it("scrolls when the section expands, and not when it collapses", async () => {
    const a = session("a");
    const list = await renderSessionList({ sessions: [a], selected: a, collapsed: true });
    expect(scrollIntoView).not.toHaveBeenCalled();

    list.collapsed = false;
    await settled(list);
    expect(scrollIntoView).toHaveBeenCalledOnce();

    scrollIntoView.mockClear();
    list.collapsed = true;
    await settled(list);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

async function renderSessionList(options: { sessions: SessionInfo[]; selected?: SessionInfo; collapsed?: boolean }): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = options.sessions;
  if (options.selected !== undefined) list.selected = options.selected;
  list.collapsed = options.collapsed ?? false;
  document.body.append(list);
  await settled(list);
  return list;
}

async function settled(list: SessionList): Promise<void> {
  // These tests check settled reveal behavior; first-commit guarantees are
  // covered separately in SessionList.lifecycle.test.ts.
  await list.updateComplete;
  await list.updateComplete;
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
