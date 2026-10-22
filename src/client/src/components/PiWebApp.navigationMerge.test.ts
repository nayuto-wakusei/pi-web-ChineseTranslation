// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Project, SessionInfo, Workspace } from "../api";
import { navigationOrderPort } from "../api/navigationOrder";
import { NavigationOrderController, type NavigationOrderPort } from "../controllers/navigationOrderController";
import { WorkspaceController } from "../controllers/workspaceController";
import { AppShellController } from "../appShell/appShellController";
import { PanelCollapseController } from "../appShell/panelCollapseController";
import { t } from "../i18n";
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
  loadOrder.mockReset().mockResolvedValue({ ids: [], revision: 0 });
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
  expect(saveOrder).toHaveBeenCalledWith({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" }, ["root-b", "root-a"], 0);
  expect(appPinnedIds(app)).toEqual(["child", "root-b"]);
});

it("keeps management navigation off the ordinary preference API while retaining old pins", async () => {
  window.history.replaceState(null, "", "/?embed=management&token=test-entry");
  const app = await mount();
  Reflect.set(app, "authenticatedAppRunning", true);
  call(app, "syncNavigationOrder");
  const panel = navigationPanel(app);
  expect(panel.onMoveSessionPin).toBeUndefined();
  expect(panel.onMoveProject).toBeUndefined();
  expect(loadOrder).not.toHaveBeenCalled();
  expect(saveOrder).not.toHaveBeenCalled();
  expect(panel.pinnedSessionIds).toEqual(["child", "root-b"]);
});

it("refreshes topology hints only for the selected machine and project", async () => {
  const app = await mount();
  const controller: unknown = Reflect.get(app, "workspaces");
  if (!(controller instanceof WorkspaceController)) throw new Error("Missing workspace controller");
  const refresh = vi.spyOn(controller, "refreshSelectedProjectTopology").mockResolvedValue();
  call(app, "handleRealtimeEvent", "remote-b", { type: "workspaces.changed", projectId: "p" });
  call(app, "handleRealtimeEvent", "remote-a", { type: "workspaces.changed", projectId: "other" });
  expect(refresh).not.toHaveBeenCalled();
  call(app, "handleRealtimeEvent", "remote-a", { type: "workspaces.changed", projectId: "p" });
  expect(refresh).toHaveBeenCalledOnce();
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
  const chat = [...tabs.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((button) => button.title === t("ui.piWebApp.chat", "Chat"));
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
    sessions: [...roots, child], pinnedSessionIds: ["child", "root-b"],
  } satisfies AppState);
  const order: unknown = Reflect.get(app, "navigationOrder");
  if (!(order instanceof NavigationOrderController)) throw new Error("Missing navigation controller");
  if (Reflect.get(app, "apiScope") === "normal") await order.ensure({ kind: "sessionPins", machineId: "remote-a", projectId: "p", workspaceId: "w" });
  document.body.append(app);
  await app.updateComplete;
  return app;
}

function appPinnedIds(app: PiWebApp): unknown {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("Missing app state");
  return Reflect.get(state, "pinnedSessionIds");
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
