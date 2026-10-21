// @vitest-environment happy-dom
import { installPopoverFake } from "./anchoredPopup.testSupport";
installPopoverFake();

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { trustApi } from "../api";
import type { Workspace, WorkspaceActivity } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { machineStatusSnapshot } from "../machineStatus.testSupport";
import { WorkspaceList } from "./WorkspaceList";

beforeEach(() => { vi.spyOn(trustApi, "workspaceTrust").mockResolvedValue({ path: "/repo", decision: null, trusted: false }); });

let restoreClipboardStub: () => void = () => undefined;

afterEach(() => {
  vi.restoreAllMocks();
  restoreClipboardStub();
  restoreClipboardStub = () => undefined;
  document.body.replaceChildren();
});

describe("workspace-list removal actions", () => {
  it("shows provider wording for neutral removal metadata and no removal action without it", async () => {
    const removable = workspace("neutral", {
      isMain: false,
      removal: {
        actionLabel: "Disconnect view",
        confirmation: "Disconnect this view without deleting files?",
        precondition: "removal-v1",
      },
    });
    const withoutRemoval = workspace("plain");
    const onDelete = vi.fn();
    const list = new WorkspaceList();
    list.workspaces = [removable, withoutRemoval];
    list.onDelete = onDelete;
    document.body.append(list);
    await list.updateComplete;

    const toggles = list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".action-menu-toggle");
    toggles?.[0]?.click();
    await list.updateComplete;

    const action = list.shadowRoot?.querySelector<HTMLButtonElement>(".workspace-menu-actions .danger");
    expect(action?.textContent).toBe("Disconnect view");
    expect(action?.title).toBe("Disconnect view");
    action?.click();
    expect(onDelete).toHaveBeenCalledWith(removable);
    await list.updateComplete;

    list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".action-menu-toggle")[1]?.click();
    await list.updateComplete;
    // The actions block stays visible for the project-trust toggle, but it
    // must not offer a removal action without removal metadata.
    expect(list.shadowRoot?.querySelector(".workspace-menu-actions")).not.toBeNull();
    expect(list.shadowRoot?.querySelector(".workspace-menu-actions .danger")).toBeNull();
  });
});

describe("workspace status indicator", () => {
  it("reads workspace status by workspace id", async () => {
    const list = await mountWorkspaceList(
      [workspace("ws-a"), workspace("ws-b")],
      machineStatusSnapshot({ workspaces: { "ws-b": { "core:unread": true } } }),
    );

    expect(unreadDot(rowFor(list, "ws-a"))).toBeNull();
    const dot = unreadDot(rowFor(list, "ws-b"));
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("此工作区中有未读会话");
  });

  it("clears the dot once a newer snapshot reports nothing unread", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")], machineStatusSnapshot({ workspaces: { "ws-a": { "core:unread": true } } }));
    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).not.toBeNull();

    list.statusSnapshot = machineStatusSnapshot({ revision: 2 });
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("wraps the work dot in an unread ring when the workspace is busy and unread", async () => {
    const list = await mountWorkspaceList(
      [workspace("ws-a")],
      machineStatusSnapshot({ workspaces: { "ws-a": { "core:terminal": true, "core:unread": true } } }),
    );

    const row = rowFor(list, "ws-a");
    const ring = row.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.terminal")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("此工作区中有未读会话 · 工作区终端活动中");
    expect(row.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("shows no indicator when the machine publishes no snapshot", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")]);

    expect(rowFor(list, "ws-a").querySelector(".activity-indicator")).toBeNull();
  });

  it("still lights a row from a flag id this build does not know", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")], machineStatusSnapshot({ workspaces: { "ws-a": { "core:future": true } } }));

    expect(rowFor(list, "ws-a").querySelector(".activity-indicator.session")).not.toBeNull();
  });
});

describe("workspace detail copy buttons", () => {
  it("copies the workspace path from the menu details and keeps the menu open", async () => {
    const writeText = stubClipboardWriteText(() => Promise.resolve());
    const list = await mountWorkspaceList([workspace("ws-a")]);
    openMenu(list, "ws-a");
    await list.updateComplete;

    detailCopyButton(list, "复制路径").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith("/repo/ws-a"); });
    await vi.waitFor(() => { expect(detailCopyButton(list, "已复制").textContent).toContain("✓"); });

    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
  });

  it("copies the provider-authored workspace label without interpreting provider branch metadata", async () => {
    const writeText = stubClipboardWriteText(() => Promise.resolve());
    const listed = workspace("ws-a", {
      label: "review app",
      provider: {
        pluginId: "workspace-provider",
        capabilities: { remove: false },
        metadata: { branch: "feature-x" },
      },
    });
    const list = await mountWorkspaceList([listed]);
    openMenu(list, "review app");
    await list.updateComplete;

    detailCopyButton(list, "复制工作区标签").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith("review app"); });
    expect(list.shadowRoot?.querySelector(".workspace-detail-row dt")?.textContent).toBe("工作区");
    expect(list.shadowRoot?.querySelector("[aria-label='复制分支']")).toBeNull();
  });

  it("keeps the copy action unchanged when the clipboard write fails", async () => {
    const writeText = stubClipboardWriteText(() => Promise.reject(new Error("denied")));
    const list = await mountWorkspaceList([workspace("ws-a")]);
    openMenu(list, "ws-a");
    await list.updateComplete;

    detailCopyButton(list, "复制路径").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalled(); });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await list.updateComplete;

    expect(detailCopyButton(list, "复制路径")).toBeDefined();
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel .detail-copy[aria-label='已复制']")).toBeNull();
  });
});

describe("workspace trust toggle documentation link", () => {
  it("links to the project-trust docs from the toggle's label row instead of verbose text", async () => {
    vi.spyOn(trustApi, "workspaceTrust").mockResolvedValue({ path: "/repo/ws-a", decision: true, trusted: true });
    const list = await mountWorkspaceList([workspace("ws-a")]);
    openMenu(list, "ws-a");
    await list.updateComplete;

    const trust = list.shadowRoot?.querySelector(".workspace-menu-trust");
    const link = trust?.querySelector<HTMLAnchorElement>("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://pi.dev/docs/latest/security");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(link?.textContent).toBe("了解项目信任");
    // The verbose sentence is gone: the toggle row only labels the checkbox and links out.
    expect(trust?.textContent).not.toContain(".pi settings");
    // The obsolete Pi CLI / respectProjectTrust clause must not survive in any wording.
    expect(trust?.textContent).not.toMatch(/Pi CLI/i);
    expect(trust?.textContent).not.toMatch(/respectProjectTrust/);
  });
});

function openMenu(list: WorkspaceList, workspaceLabel: string): void {
  const toggle = rowFor(list, workspaceLabel).querySelector<HTMLButtonElement>(".action-menu-toggle");
  if (toggle === null) throw new Error(`Expected a menu toggle for ${workspaceLabel}`);
  toggle.click();
}

function detailCopyButton(list: WorkspaceList, label: string): HTMLButtonElement {
  const buttons = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".workspace-menu-panel .detail-copy") ?? [])];
  const button = buttons.find((candidate) => candidate.getAttribute("aria-label") === label);
  if (button === undefined) throw new Error(`Expected a detail copy button labeled ${label}`);
  return button;
}

function stubClipboardWriteText(writeText: (text: string) => Promise<void>): Mock<(text: string) => Promise<void>> {
  const mock = vi.fn<(text: string) => Promise<void>>(writeText);
  const secureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: mock }, configurable: true });
  restoreClipboardStub = () => {
    restoreStubbedProperty(window, "isSecureContext", secureContext);
    restoreStubbedProperty(window.navigator, "clipboard", clipboard);
  };
  return mock;
}

function restoreStubbedProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
    return;
  }
  Object.defineProperty(target, key, descriptor);
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
  const row = rows.find((candidate) => candidate.textContent.includes(workspaceLabel));
  if (row === undefined) throw new Error(`Expected a workspace row for ${workspaceLabel}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
}

function workspace(id: string, patch: Partial<Workspace> = {}): Workspace {
  return { id, projectId: "project-1", path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {}, ...patch };
}

describe("local activity and management compatibility", () => {
describe("workspace unread indicator", () => {
  it("shows an unread dot only on workspaces tracked as unread", async () => {
    const list = await mountWorkspaceList([workspace("ws-a"), workspace("ws-b")], new Set(["ws-b"]));

    expect(unreadDot(rowFor(list, "ws-a"))).toBeNull();
    const dot = unreadDot(rowFor(list, "ws-b"));
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("此工作区中有未读会话");
  });

  it("clears the dot once the workspace is no longer tracked as unread", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")], new Set(["ws-a"]));
    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).not.toBeNull();

    list.unreadWorkspaceIds = new Set();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("wraps the work dot in an unread ring when the workspace is busy and unread", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")], new Set(["ws-a"]));
    list.activities = { "/repo/ws-a": workspaceActivity("/repo/ws-a", false, true) };
    await list.updateComplete;

    const row = rowFor(list, "ws-a");
    const ring = row.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.terminal")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("此工作区中有未读会话 · 工作区终端活动中");
    expect(row.querySelector(".activity-indicator.unread")).toBeNull();
  });
});

describe("workspace detail copy buttons", () => {
  it("copies the workspace path from the menu details and keeps the menu open", async () => {
    const writeText = stubClipboardWriteText(() => Promise.resolve());
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    openMenu(list, "ws-a");
    await list.updateComplete;

    detailCopyButton(list, "复制路径").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith("/repo/ws-a"); });
    await vi.waitFor(() => { expect(detailCopyButton(list, "已复制").textContent).toContain("✓"); });

    expect(list.shadowRoot?.querySelector(".workspace-menu-panel")).not.toBeNull();
  });

  it("copies the bare branch name without the main suffix", async () => {
    const writeText = stubClipboardWriteText(() => Promise.resolve());
    const list = await mountWorkspaceList([{ ...workspace("ws-a"), branch: "feature-x" }], new Set());
    openMenu(list, "feature-x");
    await list.updateComplete;

    detailCopyButton(list, "复制分支").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith("feature-x"); });
  });

  it("offers to copy the workspace label when there is no branch", async () => {
    const writeText = stubClipboardWriteText(() => Promise.resolve());
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    openMenu(list, "ws-a");
    await list.updateComplete;

    detailCopyButton(list, "复制工作区标签").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith("ws-a"); });
  });

  it("keeps the copy action unchanged when the clipboard write fails", async () => {
    const writeText = stubClipboardWriteText(() => Promise.reject(new Error("denied")));
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    openMenu(list, "ws-a");
    await list.updateComplete;

    detailCopyButton(list, "复制路径").click();
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalled(); });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await list.updateComplete;

    expect(detailCopyButton(list, "复制路径")).toBeDefined();
    expect(list.shadowRoot?.querySelector(".workspace-menu-panel .detail-copy[aria-label='已复制']")).toBeNull();
  });
});

function openMenu(list: WorkspaceList, workspaceLabel: string): void {
  const toggle = rowFor(list, workspaceLabel).querySelector<HTMLButtonElement>(".action-menu-toggle");
  if (toggle === null) throw new Error(`Expected a menu toggle for ${workspaceLabel}`);
  toggle.click();
}

describe("workspace trust", () => {
  it("writes only an explicit checkbox change to the owning machine", async () => {
    const setTrust = vi.spyOn(trustApi, "setWorkspaceTrust").mockResolvedValue({ path: "/repo/ws-a", decision: true, trusted: true });
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    list.machineId = "remote-a";
    await list.updateComplete;
    openMenu(list, "ws-a");
    await vi.waitFor(() => { expect(list.shadowRoot?.querySelector<HTMLInputElement>(".workspace-menu-trust input")?.disabled).toBe(false); });
    expect(setTrust).not.toHaveBeenCalled();
    list.shadowRoot?.querySelector<HTMLInputElement>(".workspace-menu-trust input")?.click();
    await vi.waitFor(() => { expect(setTrust).toHaveBeenCalledWith("project-1", "ws-a", true, "remote-a"); });
  });

  it("drops a pending read when a reused workspace id belongs to another project", async () => {
    let resolveOld!: (result: { path: string; decision: boolean; trusted: boolean }) => void;
    vi.mocked(trustApi.workspaceTrust).mockImplementation((projectId) => projectId === "project-1"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ path: "/other", decision: false, trusted: false }));
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    openMenu(list, "ws-a");
    await list.updateComplete;
    list.workspaces = [{ ...workspace("ws-a"), projectId: "project-2", path: "/other" }];
    await list.updateComplete;
    openMenu(list, "ws-a");
    await vi.waitFor(() => { expect(list.shadowRoot?.querySelector<HTMLInputElement>(".workspace-menu-trust input")?.disabled).toBe(false); });
    resolveOld({ path: "/repo/ws-a", decision: true, trusted: true });
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector<HTMLInputElement>(".workspace-menu-trust input")?.checked).toBe(false);
  });

  it("hides trust and performs no normal-store requests in management mode", async () => {
    const list = await mountWorkspaceList([workspace("ws-a")], new Set());
    list.managementMode = true;
    await list.updateComplete;
    openMenu(list, "ws-a");
    await list.updateComplete;
    expect(trustApi.workspaceTrust).not.toHaveBeenCalled();
    expect(list.shadowRoot?.querySelector(".workspace-menu-trust")).toBeNull();
  });
});

function detailCopyButton(list: WorkspaceList, label: string): HTMLButtonElement {
  const buttons = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".workspace-menu-panel .detail-copy") ?? [])];
  const button = buttons.find((candidate) => candidate.getAttribute("aria-label") === label);
  if (button === undefined) throw new Error(`Expected a detail copy button labeled ${label}`);
  return button;
}

function stubClipboardWriteText(writeText: (text: string) => Promise<void>): Mock<(text: string) => Promise<void>> {
  const mock = vi.fn<(text: string) => Promise<void>>(writeText);
  const secureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: mock }, configurable: true });
  restoreClipboardStub = () => {
    restoreStubbedProperty(window, "isSecureContext", secureContext);
    restoreStubbedProperty(window.navigator, "clipboard", clipboard);
  };
  return mock;
}

function restoreStubbedProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
    return;
  }
  Object.defineProperty(target, key, descriptor);
}

async function mountWorkspaceList(workspaces: Workspace[], unreadWorkspaceIds: ReadonlySet<string>): Promise<WorkspaceList> {
  const list = new WorkspaceList();
  list.workspaces = workspaces;
  list.unreadWorkspaceIds = unreadWorkspaceIds;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: WorkspaceList, workspaceLabel: string): Element {
  const rows = [...(list.shadowRoot?.querySelectorAll(".workspace-row") ?? [])];
  const row = rows.find((candidate) => candidate.textContent.includes(workspaceLabel));
  if (row === undefined) throw new Error(`Expected a workspace row for ${workspaceLabel}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
}

function workspaceActivity(cwd: string, hasSessionActivity: boolean, hasTerminalActivity: boolean): WorkspaceActivity {
  return { cwd, hasSessionActivity, hasTerminalActivity, updatedAt: "2026-06-04T00:00:00.000Z" };
}

function workspace(id: string): Workspace {
  return { id, projectId: "project-1", path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {}, isGitRepo: true, isGitWorktree: false };
}
});
