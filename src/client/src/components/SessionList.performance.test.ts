// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessionPaths from "../sessionPaths";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { SESSION_LIST_BATCH_SIZE, SessionList, sessionRowsForCurrentTree } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
  TestIntersectionObserver.latest = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SessionList incremental rendering", () => {
  it("retains row elements across ordering and pin changes", async () => {
    const all = sessions(3);
    const list = await renderList(all);
    const original = new Map(rows(list).map((row) => [row.getAttribute("title"), row]));
    list.sessions = all.map((session, index) => ({ ...session, modified: `2030-01-0${String(index + 1)}T00:00:00.000Z` }));
    await list.updateComplete;
    for (const row of rows(list)) expect(row).toBe(original.get(row.getAttribute("title")));

    list.pinnedSessionIds = [all[0]?.id ?? ""];
    await list.updateComplete;
    expect(rows(list)[0]?.getAttribute("title")).toBe(all[0]?.path);
    for (const row of rows(list)) expect(row).toBe(original.get(row.getAttribute("title")));
  });

  it("disables row paint containment while an action menu is open", async () => {
    const list = await renderList(sessions(1));
    const toggle = list.shadowRoot?.querySelector<HTMLButtonElement>(".action-menu-toggle");
    if (toggle === null || toggle === undefined) throw new Error("Missing session action menu toggle");

    toggle.click();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".action-row.menu-open .action-menu-panel")).not.toBeNull();
    expect(SessionList.elementStyles.some((style) => "cssText" in style && style.cssText.includes(".action-row.menu-open { content-visibility: visible; }"))).toBe(true);
  });

  it("renders current sessions in batches and resets the batch on scope changes", async () => {
    const list = await renderList(sessions(120));

    expect(rows(list)).toHaveLength(SESSION_LIST_BATCH_SIZE);
    loadButton(list, "current").click();
    await list.updateComplete;
    expect(rows(list)).toHaveLength(100);

    list.scopeKey = "remote:other-workspace";
    await list.updateComplete;
    expect(rows(list)).toHaveLength(SESSION_LIST_BATCH_SIZE);
  });

  it("reveals a selected session outside the current batch", async () => {
    const all = sessions(120);
    const list = await renderList(all);
    const selected = sessionRowsForCurrentTree(all)[109]?.session;
    if (selected === undefined) throw new Error("Missing selected session fixture");

    list.selected = selected;
    await list.updateComplete;

    expect(rows(list)).toHaveLength(110);
    expect(list.shadowRoot?.querySelector(".action-row.selected")?.getAttribute("title")).toBe(selected.path);
  });

  it("keeps a stable selected session mounted when session ordering changes", async () => {
    const all = sessions(120);
    const selected = sessionRowsForCurrentTree(all)[0]?.session;
    if (selected === undefined) throw new Error("Missing selected session fixture");
    const list = await renderList(all);
    list.selected = selected;
    await list.updateComplete;

    list.sessions = all.map((session) => ({
      ...session,
      modified: session.id === selected.id ? "2000-01-01T00:00:00.000Z" : "2030-01-01T00:00:00.000Z",
    }));
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".action-row.selected")?.getAttribute("title")).toBe(selected.path);
  });

  it("loads archived sessions independently after current sessions are complete", async () => {
    const current = sessions(60);
    const archived = sessions(70, "archived-").map((session) => ({ ...session, archived: true, archivedAt: "2026-08-01T00:00:00.000Z" }));
    const list = await renderList([...current, ...archived]);

    loadButton(list, "current").click();
    await list.updateComplete;
    archivedToggle(list).click();
    await list.updateComplete;

    expect(rows(list, ".action-row.archived")).toHaveLength(SESSION_LIST_BATCH_SIZE);
    loadButton(list, "archived").click();
    await list.updateComplete;
    expect(rows(list, ".action-row.archived")).toHaveLength(70);
  });

  it("uses an intersection observer rooted at the list body to load the next batch", async () => {
    let callback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    vi.stubGlobal("IntersectionObserver", class extends TestIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        super(next, observe);
        callback = next;
        TestIntersectionObserver.latest = this;
      }
    });
    const list = await renderList(sessions(120));
    const sentinel = loadButton(list, "current");

    expect(observe).toHaveBeenCalledWith(sentinel);
    const observer = TestIntersectionObserver.latest;
    if (callback === undefined || observer === undefined) throw new Error("Intersection observer was not created");
    callback([new TestIntersectionObserverEntry(sentinel)], observer);
    await list.updateComplete;

    expect(rows(list)).toHaveLength(100);
  });
});

describe("SessionList render suppression", () => {
  it("skips token-only status, callback identity, and equivalent polling updates", async () => {
    const all = sessions(5);
    const list = await renderList(all);
    const render = vi.spyOn(list, "render");

    list.statuses = { [all[0]?.id ?? ""]: status(all[0]?.id ?? "", { cost: 1, tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } }) };
    await list.updateComplete;
    list.onSelect = () => undefined;
    await list.updateComplete;
    list.sessions = all.map((session) => ({ ...session }));
    await list.updateComplete;

    expect(render).not.toHaveBeenCalled();

    list.statuses = { [all[0]?.id ?? ""]: status(all[0]?.id ?? "", { isStreaming: true }) };
    await list.updateComplete;
    expect(render).toHaveBeenCalledOnce();
  });

  it("renders when an activity changes the visible row state", async () => {
    const all = sessions(5);
    const list = await renderList(all);
    const render = vi.spyOn(list, "render");

    list.activities = { [all[0]?.id ?? ""]: activity(all[0]?.id ?? "", "active") };
    await list.updateComplete;

    expect(render).toHaveBeenCalledOnce();
  });
});

async function renderList(all: SessionInfo[]): Promise<SessionList> {
  const list = new SessionList();
  list.scopeKey = "local:workspace";
  list.sessions = all;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rows(list: SessionList, selector = ".action-row"): Element[] {
  return Array.from(list.shadowRoot?.querySelectorAll(selector) ?? []);
}

function loadButton(list: SessionList, scope: "current" | "archived"): HTMLButtonElement {
  const button = list.shadowRoot?.querySelector<HTMLButtonElement>(`[data-load-scope="${scope}"]`);
  if (button === null || button === undefined) throw new Error(`Missing ${scope} load button`);
  return button;
}

function archivedToggle(list: SessionList): HTMLButtonElement {
  const button = list.shadowRoot?.querySelector<HTMLButtonElement>("h2.subheading .section-toggle");
  if (button === null || button === undefined) throw new Error("Missing archived toggle");
  return button;
}

function sessions(count: number, prefix = "session-"): SessionInfo[] {
  return Array.from({ length: count }, (_, index) => session(`${prefix}${String(index)}`, index));
}

function session(id: string, index: number): SessionInfo {
  const order = String(index).padStart(4, "0");
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace",
    created: `2026-08-01T00:00:${order.slice(-2)}.000Z`,
    modified: `2026-08-01T00:${order.slice(0, 2)}:${order.slice(-2)}.000Z`,
    messageCount: 1,
    firstMessage: id,
  };
}

function status(sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function activity(sessionId: string, phase: SessionActivity["phase"]): SessionActivity {
  return { sessionId, phase, label: "agent running", at: "2026-08-04T00:00:00.000Z" };
}

class TestIntersectionObserver implements IntersectionObserver {
  static latest: TestIntersectionObserver | undefined;
  readonly root: Element | Document | null = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  readonly unobserve = vi.fn<(target: Element) => void>();
  readonly disconnect = vi.fn<() => void>();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly observe: (target: Element) => void,
  ) {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

class TestIntersectionObserverEntry implements IntersectionObserverEntry {
  readonly boundingClientRect = new DOMRectReadOnly();
  readonly intersectionRatio = 1;
  readonly intersectionRect = new DOMRectReadOnly();
  readonly isIntersecting = true;
  readonly rootBounds = null;
  readonly time = 0;

  constructor(readonly target: Element) {}
}

describe("upstream hierarchy and stable row contracts", () => {
function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id, path: `/sessions/${id}.jsonl`, cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z", modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1, firstMessage: id, persisted: true, ...overrides,
  };
}

async function mount(sessions: SessionInfo[], collapsed = false): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  list.collapsible = true;
  list.collapsed = collapsed;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function row(list: SessionList, id: string): HTMLElement {
  const element = list.shadowRoot?.querySelector<HTMLElement>(`.action-row[title="/sessions/${id}.jsonl"]`);
  if (!element) throw new Error(`Missing session row: ${id}`);
  return element;
}

function button(root: ParentNode | null, selector: string): HTMLButtonElement {
  const element = root?.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing button: ${selector}`);
  return element;
}

describe("SessionList row identity and derived data", () => {
  it.each([false, true])("preserves row and focused action identity across prepend/removal (archived=%s)", async (archived) => {
    const a = session("a", { archived });
    const b = session("b", { archived });
    const list = await mount([a, b]);
    if (archived) {
      button(list.shadowRoot, ".subheading .section-toggle").click();
      await list.updateComplete;
    }
    const originalRow = row(list, "b");
    const action = button(originalRow, ".action-menu-toggle");
    action.focus();
    const prepended = session("new", { archived });
    const renamed = { ...b, name: "Renamed" };
    list.sessions = [prepended, a, renamed];
    await list.updateComplete;
    expect(row(list, "b")).toBe(originalRow);
    expect(list.shadowRoot?.activeElement).toBe(action);
    expect(originalRow.textContent).toContain("Renamed");

    list.sessions = [prepended, renamed];
    await list.updateComplete;
    expect(row(list, "b")).toBe(originalRow);
    expect(list.shadowRoot?.activeElement).toBe(action);
    const select = vi.fn();
    list.onSelect = select;
    originalRow.click();
    expect(select).toHaveBeenCalledWith(list.sessions[1]);
  });

  it("reuses hierarchy and descendant work across UI updates, invalidating on array replacement", async () => {
    // Path normalization is the shared computational boundary of both tree builders
    // and descendant counting, not row rendering. Measure work, not private cache fields.
    const normalize = vi.spyOn(sessionPaths, "normalizeSessionPath");
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await mount([parent, child]);
    expect(normalize).toHaveBeenCalled();
    normalize.mockClear();

    button(row(list, "parent"), ".action-menu-toggle").click();
    await list.updateComplete;
    expect(row(list, "parent").textContent).toContain("连同后代归档（1）");
    list.unreadSessionIds = new Set([child.id]);
    list.sending = { child: true };
    list.activities = {};
    list.statuses = {};
    await list.updateComplete;
    expect(row(list, "child").classList.contains("unread")).toBe(true);
    expect(row(list, "child").querySelector(".activity-indicator.sending")).not.toBeNull();
    list.collapsed = true;
    await list.updateComplete;
    list.collapsed = false;
    await list.updateComplete;
    expect(normalize).not.toHaveBeenCalled();

    list.sessions = [parent, session("child", { archived: true })];
    await list.updateComplete;
    expect(normalize).toHaveBeenCalled();
    expect(list.shadowRoot?.querySelectorAll(".action-row")).toHaveLength(1);
    button(row(list, "parent"), ".action-menu-toggle").click();
    await list.updateComplete;
    expect(row(list, "parent").textContent).not.toContain("连同后代归档");
    button(list.shadowRoot, ".subheading .section-toggle").click();
    await list.updateComplete;
    expect(row(list, "child").style.getPropertyValue("--depth")).toBe("0");
  });

  it("defers descendant work until expansion and uses the latest collapsed sessions", async () => {
    const normalize = vi.spyOn(sessionPaths, "normalizeSessionPath");
    const parent = session("parent");
    const list = await mount([parent], true);
    list.sessions = [parent, session("child", { parentSessionPath: parent.path })];
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".section-count")?.textContent).toBe("2");
    expect(list.shadowRoot?.querySelector(".action-row")).toBeNull();
    normalize.mockClear();
    list.sending = { parent: true };
    await list.updateComplete;
    expect(normalize).not.toHaveBeenCalled();
    list.collapsed = false;
    await list.updateComplete;
    expect(normalize).toHaveBeenCalled();
    expect(row(list, "child").style.getPropertyValue("--depth")).toBe("1");
    button(row(list, "parent"), ".action-menu-toggle").click();
    await list.updateComplete;
    expect(row(list, "parent").textContent).toContain("连同后代归档（1）");
  });
});
});
