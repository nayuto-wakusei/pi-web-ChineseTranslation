// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../../i18n";
import { trustApi, type Machine, type Project, type SessionInfo, type Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import { installPopoverFake } from "../anchoredPopup.testSupport";
import { ProjectList } from "../ProjectList";
import { WorkspaceList } from "../WorkspaceList";
import { SessionList } from "../SessionList";
import { AppNavigationPanel } from "./AppNavigationPanel";
import type { NavigationSectionResizeHandle } from "./NavigationSectionResizeHandle";
import { NAVIGATION_SECTION_SIZE_STORAGE_KEY } from "../../appShell/navigationSectionResizeController";
installPopoverFake();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { setClientTranslations("en", {}); });
describe("folder workspace navigation", () => {
  it.each([false, true])("skips hidden workspace controls in both keyboard directions (compact=%s)", async (compact) => {
    const panel = await mountPanel({}, machine("local"));
    panel.compact = compact;
    panel.workspaceSelectionVisible = false;
    panel.sessions = [session("root")];
    panel.onFocusNavigationTarget = vi.fn();
    await panel.updateComplete;
    const projects = section(panel, "project-list", ProjectList);
    const sessions = section(panel, "session-list", SessionList);
    await Promise.all([projects.updateComplete, sessions.updateComplete]);

    expect(panel.shadowRoot?.querySelector("workspace-list")).toBeNull();
    expect(await panel.focusSection("workspaces")).toBe(false);
    control(projects, ".action-row").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(panel.onFocusNavigationTarget).toHaveBeenLastCalledWith("sessions");
    control(sessions, ".action-row").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(panel.onFocusNavigationTarget).toHaveBeenLastCalledWith("projects");
  });
});

describe("section resize boundaries", () => {
  it("disables resizing in one-column navigation without discarding saved desktop heights", async () => {
    const saved = JSON.stringify({ version: 1, projects: 180, workspaces: 220 });
    localStorage.setItem(NAVIGATION_SECTION_SIZE_STORAGE_KEY, saved);
    const panel = await mountPanel({}, machine("local"), false);
    const root = panel.shadowRoot;
    if (root === null) throw new Error("Missing navigation panel root");
    expect(root.querySelectorAll("[data-manual-size]")).toHaveLength(2);
    panel.compact = true;
    await panel.updateComplete;
    expect(root.querySelector("navigation-section-resize-handle")).toBeNull();
    expect(root.querySelector("[data-manual-size]")).toBeNull();
    expect(localStorage.getItem(NAVIGATION_SECTION_SIZE_STORAGE_KEY)).toBe(saved);
    panel.compact = false;
    await panel.updateComplete;
    expect(root.querySelectorAll("navigation-section-resize-handle")).toHaveLength(2);
    expect(root.querySelectorAll("[data-manual-size]")).toHaveLength(2);
    expect(localStorage.getItem(NAVIGATION_SECTION_SIZE_STORAGE_KEY)).toBe(saved);
  });

  it("owns layout observation, supplies measurements, and tracks replaced sections and reconnection", async () => {
    const observers: LayoutObserver[] = [];
    class LayoutObserver implements ResizeObserver {
      readonly targets = new Set<Element>();
      constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
      observe(target: Element): void { this.targets.add(target); }
      unobserve(target: Element): void { this.targets.delete(target); }
      disconnect(): void { this.targets.clear(); }
      notify(): void { this.callback([], this); }
    }
    vi.stubGlobal("ResizeObserver", LayoutObserver);
    const panel = await mountPanel({}, machine("local"), false);
    const observer = observers.find((item) => item.targets.has(panel));
    if (observer === undefined) throw new Error("Panel did not observe its layout");
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = section(panel, "workspace-list", WorkspaceList);
    const sessions = section(panel, "session-list", SessionList);
    // Geometry is an injected browser boundary here, not a happy-dom layout assertion.
    vi.spyOn(projects, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 120));
    vi.spyOn(workspaces, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 80));
    vi.spyOn(sessions, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
    observer.notify();
    await panel.updateComplete;
    const handles = panel.shadowRoot?.querySelectorAll<NavigationSectionResizeHandle>("navigation-section-resize-handle");
    expect(handles?.[0]?.measurement).toEqual({ height: 120, maxHeight: 376 });
    expect(handles?.[1]?.measurement).toEqual({ height: 80, maxHeight: 336 });

    panel.workspaceSelectionVisible = false;
    await panel.updateComplete;
    expect(observer.targets.has(workspaces)).toBe(false);
    panel.workspaceSelectionVisible = true;
    await panel.updateComplete;
    const replacement = section(panel, "workspace-list", WorkspaceList);
    expect(replacement).not.toBe(workspaces);
    expect(observer.targets.has(replacement)).toBe(true);
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 140));
    observer.notify();
    await panel.updateComplete;
    const workspaceHandle = panel.shadowRoot?.querySelectorAll<NavigationSectionResizeHandle>("navigation-section-resize-handle")[1];
    expect(workspaceHandle?.measurement).toEqual({ height: 140, maxHeight: 396 });

    panel.remove();
    expect(observer.targets.size).toBe(0);
    document.body.append(panel);
    await panel.updateComplete;
    const reconnected = observers.find((item) => item.targets.has(panel));
    expect(reconnected).toBeDefined();
    expect(reconnected).not.toBe(observer);
  });

  it("assigns each divider to the expanded section above, including when workspaces are hidden", async () => {
    const panel = await mountPanel({}, machine("local"), false);
    const root = panel.shadowRoot;
    if (root === null) throw new Error("Missing navigation panel root");
    const controls = () => [...root.querySelectorAll<NavigationSectionResizeHandle>("navigation-section-resize-handle")]
      .map((handle) => handle.controls);
    expect(controls()).toEqual(["navigation-projects", "navigation-workspaces"]);

    panel.workspaceSelectionVisible = false;
    await panel.updateComplete;
    expect(controls()).toEqual(["navigation-projects"]);

    panel.workspaceSelectionVisible = true;
    panel.projectsCollapsed = true;
    await panel.updateComplete;
    expect(controls()).toEqual(["navigation-workspaces"]);

    panel.workspacesCollapsed = true;
    await panel.updateComplete;
    expect(controls()).toEqual([]);
  });
});

describe("navigation order controls", () => {
  it("keeps ordering disabled in management while preserving canonical session pins", async () => {
    const panel = await mountPanel({}, machine("local"));
    panel.managementMode = true;
    panel.sessions = [session("root")];
    panel.pinnedSessionIds = ["root"];
    panel.pinnedRootIds = ["root"];
    panel.onMoveProject = vi.fn();
    panel.onMoveWorkspace = vi.fn();
    panel.onMoveSessionPin = vi.fn();
    panel.onToggleSessionPin = vi.fn();
    await panel.updateComplete;
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = section(panel, "workspace-list", WorkspaceList);
    const sessions = section(panel, "session-list", SessionList);
    await Promise.all([projects.updateComplete, workspaces.updateComplete, sessions.updateComplete]);
    expect(projects.onMove).toBeUndefined();
    expect(workspaces.onMove).toBeUndefined();
    expect(sessions.onMovePin).toBeUndefined();
    expect(sessions.pinnedSessionIds).toEqual(["root"]);
    control(sessions, ".action-menu-toggle").click();
    await sessions.updateComplete;
    menuButton(sessions, "Unpin").click();
    expect(panel.onToggleSessionPin).toHaveBeenCalledWith(panel.sessions[0]);
  });

  it("provides a top-bar collapse action while keeping hidden session lists out of automatic navigation", async () => {
    const panel = await mountPanel({}, machine("local"), false);
    panel.onTogglePanel = vi.fn();
    const parent = session("parent");
    const agent = { ...session("agent"), parentSessionPath: parent.path, agentSubsession: true };
    panel.sessions = [parent, agent];
    await panel.updateComplete;
    const sessions = section(panel, "session-list", SessionList);
    await sessions.updateComplete;
    const toggle = panel.shadowRoot?.querySelector<HTMLButtonElement>(".panel-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse navigation panel");
    toggle?.click();
    expect(panel.onTogglePanel).toHaveBeenCalledOnce();
    expect(panel.automaticSessionCandidates(panel.sessions)).toEqual([parent]);
    panel.sessionsCollapsed = true;
    await panel.updateComplete;
    expect(panel.automaticSessionCandidates(panel.sessions)).toEqual([]);
  });

  it("forwards moves and root-session pins without selecting an item", async () => {
    vi.spyOn(trustApi, "workspaceTrust").mockResolvedValue({ path: "/repo/first", decision: null, trusted: false });
    const panel = await mountPanel({}, machine("local"));
    panel.projects = [project("first"), project("second")];
    panel.workspaces = [workspace("first", "first"), workspace("second", "first")];
    panel.sessions = [session("root")];
    panel.onMoveProject = vi.fn();
    panel.onMoveWorkspace = vi.fn();
    panel.onToggleSessionPin = vi.fn();
    panel.onSelectSession = vi.fn();
    await panel.updateComplete;
    const projects = section(panel, "project-list", ProjectList);
    const workspaces = section(panel, "workspace-list", WorkspaceList);
    const sessions = section(panel, "session-list", SessionList);
    await Promise.all([projects.updateComplete, workspaces.updateComplete, sessions.updateComplete]);
    for (const list of [projects, workspaces]) {
      control(list, ".action-menu-toggle").click();
      await list.updateComplete;
      menuButton(list, "Move down").click();
    }
    expect(panel.onMoveProject).toHaveBeenCalledWith(panel.projects[0], 1);
    expect(panel.onMoveWorkspace).toHaveBeenCalledWith(panel.workspaces[0], 1);
    control(sessions, ".action-menu-toggle").click();
    await sessions.updateComplete;
    menuButton(sessions, "Pin").click();
    expect(panel.onToggleSessionPin).toHaveBeenCalledWith(panel.sessions[0]);
    expect(panel.onSelectSession).not.toHaveBeenCalled();

    panel.pinnedRootIds = ["root"];
    await panel.updateComplete;
    await sessions.updateComplete;
    expect(sessions.pinnedRootIds).toEqual(["root"]);
    expect(panel.shadowRoot?.textContent).not.toContain("Saving navigation order");
    expect(panel.shadowRoot?.querySelector(".order-status")).toBeNull();
  });
});

function menuButton(list: ProjectList | WorkspaceList | SessionList, text: string): HTMLButtonElement {
  const button = [...(list.shadowRoot?.querySelectorAll("button") ?? [])].find((item) => item.textContent.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing ${text}`);
  return button;
}

function control(list: ProjectList | WorkspaceList | SessionList, selector: string): HTMLElement {
  const element = list.shadowRoot?.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return element;
}

function session(id: string): SessionInfo {
  return {
    id, path: `/sessions/${id}.jsonl`, cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z", modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1, firstMessage: id,
  };
}

async function mountPanel(machineStatusSnapshots: Record<string, MachineStatusSnapshot>, selectedMachine: Machine | undefined, compact = true): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = compact;
  panel.machines = [machine("local"), machine("remote-a")];
  if (selectedMachine !== undefined) panel.selectedMachine = selectedMachine;
  panel.projects = [project("project-1")];
  panel.workspaces = [workspace("ws-1", "project-1")];
  panel.machineStatusSnapshots = machineStatusSnapshots;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function section<T>(panel: AppNavigationPanel, selector: string, type: abstract new (...args: never) => T): T {
  const element = panel.shadowRoot?.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected a ${selector} section`);
  return element;
}

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
  return { id, projectId, path: `/repo/${id}`, label: id, isMain: true, effectiveConfig: {} };
}
