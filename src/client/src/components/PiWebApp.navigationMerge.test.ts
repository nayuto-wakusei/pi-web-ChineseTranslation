// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Project, SessionInfo, Workspace } from "../api";
import { navigationOrderPort } from "../api/navigationOrder";
import { NavigationOrderController, type NavigationOrderPort } from "../controllers/navigationOrderController";
import { AppShellController } from "../appShell/appShellController";
import { PanelCollapseController } from "../appShell/panelCollapseController";
import { PiWebApp } from "./PiWebApp";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

class NavigationMergeApp extends PiWebApp {
  override connectedCallback(): void { LitElement.prototype.connectedCallback.call(this); }
}
customElements.define("navigation-merge-test-app", NavigationMergeApp);

const project: Project = { id: "p", name: "Project", path: "/repo", createdAt: "now" };
const workspace: Workspace = { id: "w", projectId: project.id, path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
const session = (id: string, parentSessionPath?: string): SessionInfo => ({
  id, path: `/sessions/${id}.jsonl`, cwd: workspace.path, created: "now", modified: "now", messageCount: 1, firstMessage: "",
  ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
});
const roots = [session("root-a"), session("root-b")];
const child = session("child", "/sessions/root-a.jsonl");
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Unexpected request")));
const loadOrder = vi.fn<NavigationOrderPort["load"]>();
const saveOrder = vi.fn<NavigationOrderPort["save"]>();

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  unexpectedRequest.mockClear();
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  loadOrder.mockReset().mockResolvedValue({ ids: ["child", "root-b"], revision: 0 });
  saveOrder.mockReset().mockImplementation((_scope, ids, revision) => Promise.resolve({ ids: [...ids], revision: revision + 1 }));
  vi.spyOn(navigationOrderPort, "load").mockImplementation(loadOrder);
  vi.spyOn(navigationOrderPort, "save").mockImplementation(saveOrder);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

it("orders pinned roots without replacing the canonical child pin membership", async () => {
  const app = await mount();
  const panel = navigationPanel(app);
  panel.onMoveSessionPin?.(session("root-b"), -1);
  await vi.waitFor(() => { expect(saveOrder).toHaveBeenCalledOnce(); });
  expect(saveOrder).toHaveBeenCalledWith({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" }, ["root-b", "child"], 0);
  await app.updateComplete;
  expect(panel.pinnedSessionIds).toEqual(["root-b", "child"]);
  expect(panel.pinnedRootIds).toEqual(["root-b", "root-a"]);
  panel.onMoveSessionPin?.(session("root-b"), 1);
  await vi.waitFor(() => { expect(saveOrder).toHaveBeenCalledTimes(2); });
  expect(saveOrder).toHaveBeenLastCalledWith({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" }, ["child", "root-b"], 1);
});

it("loads management pins without enabling ordinary project or workspace ordering", async () => {
  window.history.replaceState(null, "", "/?embed=management&token=test-entry");
  const app = await mount();
  Reflect.set(app, "authenticatedAppRunning", true);
  call(app, "syncNavigationOrder");
  const panel = navigationPanel(app);
  expect(panel.onMoveSessionPin).toBeDefined();
  expect(panel.onMoveProject).toBeUndefined();
  expect(panel.onMoveWorkspace).toBeUndefined();
  expect(loadOrder).toHaveBeenCalledExactlyOnceWith({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" });
  expect(saveOrder).not.toHaveBeenCalled();
  expect(panel.pinnedSessionIds).toEqual(["child", "root-b"]);
});

it.each(["normal", "management"])("toggles %s pins using the acknowledged navigation revision and recovers failed writes", async (mode) => {
  if (mode === "management") window.history.replaceState(null, "", "/?embed=management");
  const app = await mount();
  const panel = navigationPanel(app);
  void panel.onToggleSessionPin?.(child);
  await vi.waitFor(() => { expect(saveOrder).toHaveBeenCalledOnce(); });
  expect(saveOrder).toHaveBeenLastCalledWith({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" }, ["root-b"], 0);
  await vi.waitFor(() => { expect(panel.pinnedSessionIds).toEqual(["root-b"]); });
  saveOrder.mockRejectedValueOnce(new Error("pin unavailable"));
  loadOrder.mockResolvedValue({ ids: ["root-b", "external"], revision: 2 });
  void panel.onToggleSessionPin?.(child);
  await vi.waitFor(() => { expect(loadOrder).toHaveBeenCalledTimes(2); });
  await vi.waitFor(() => { expect(panel.pinnedSessionIds).toEqual(["root-b", "external"]); });
});


it("restores tabbed two-column navigation when the wide workspace panel is collapsed", async () => {
  const app = await mount();
  const shell: unknown = Reflect.get(app, "appShell");
  const collapse: unknown = Reflect.get(app, "panelCollapse");
  if (!(shell instanceof AppShellController) || !(collapse instanceof PanelCollapseController)) throw new Error("Missing shell controllers");
  shell.isMobileNavigationLayout = false;
  shell.isDesktopSideBySideLayout = true;
  call(app, "setState", { mainView: "chat" });
  app.requestUpdate();
  await app.updateComplete;
  expect(app.shadowRoot?.querySelector(".shell.two-column-layout")).toBeNull();
  collapse.toggleWorkspacePanel();
  await app.updateComplete;
  expect(app.shadowRoot?.querySelector(".shell.two-column-layout.workspace-panel-collapsed")).not.toBeNull();
  const tabs = app.shadowRoot?.querySelector("app-mobile-main-tabs");
  if (!(tabs instanceof LitElement)) throw new Error("Missing tabs");
  await tabs.updateComplete;
  const chat = [...tabs.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((button) => button.title === "Chat");
  expect(chat).toBeDefined();
  collapse.expandWorkspacePanel();
  await app.updateComplete;
  expect(app.shadowRoot?.querySelector(".shell.two-column-layout")).toBeNull();
});

async function mount(): Promise<NavigationMergeApp> {
  const app = new NavigationMergeApp();
  Reflect.set(app, "normalAuthLoading", false);
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "state", { ...initialAppState(),
    selectedMachine: { id: "remote-a", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" },
    projects: [project], selectedProject: project, workspaces: [workspace], selectedWorkspace: workspace,
    sessions: [...roots, child],
  } satisfies AppState);
  const order: unknown = Reflect.get(app, "navigationOrder");
  if (!(order instanceof NavigationOrderController)) throw new Error("Missing navigation controller");
  await order.ensure({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" });
  document.body.append(app);
  await app.updateComplete;
  return app;
}

function navigationPanel(app: PiWebApp): AppNavigationPanel {
  const panel = app.shadowRoot?.querySelector("app-navigation-panel");
  if (!(panel instanceof AppNavigationPanel)) throw new Error("Missing navigation panel");
  return panel;
}

function call(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing app method ${name}`);
  return Reflect.apply(method, app, args);
}
