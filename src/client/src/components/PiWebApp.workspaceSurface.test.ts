// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Workspace } from "../api";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import { WorkspacePanel } from "./WorkspacePanel";

const workspace: Workspace = { id: "w", projectId: "p", path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

it("keeps panel contexts and navigation callbacks stable across transcript deltas, but honors explicit invalidation", async () => {
  const { app, container, panel, navigation, getState, setState } = await harness();
  const context = panel.panelContext;
  if (context === undefined) throw new Error("Missing panel context");
  const labelItems = navigation.workspaceLabelItems;
  const selectWorkspace = navigation.onSelectWorkspace;
  const renameSession = navigation.onRenameSession;
  setState({ messages: [...getState().messages] });
  render(app.render(), container);
  await panel.updateComplete;
  await navigation.updateComplete;
  expect(panel.panelContext).toBe(context);
  expect(navigation.workspaceLabelItems).toBe(labelItems);
  expect(navigation.onSelectWorkspace).toBe(selectWorkspace);
  expect(navigation.onRenameSession).toBe(renameSession);
  context.host.requestRender();
  render(app.render(), container);
  await panel.updateComplete;
  expect(panel.panelContext).not.toBe(context);
  expect(navigation.workspaceLabelItems).not.toBe(labelItems);
  expect(navigation.onSelectWorkspace).toBe(selectWorkspace);
});

it("refreshes contexts for config, selected-session, query and retained local file state changes", async () => {
  const { app, container, panel, setState } = await harness();
  const update = async (patch: Partial<AppState>) => {
    const previous = panel.panelContext;
    setState(patch);
    render(app.render(), container);
    await panel.updateComplete;
    expect(panel.panelContext).not.toBe(previous);
  };
  await update({ selectedWorkspace: { ...workspace, label: "new branch" } });
  await update({ selectedSession: { id: "session", cwd: workspace.path, path: "/private/session", created: "now", modified: "now", messageCount: 0, firstMessage: "" } });
  await update({ selectedFilePath: "file.txt" });
  expect(panel.panelContext?.selectedFilePath).toBe("file.txt");
  const previous = panel.panelContext;
  window.history.replaceState({}, "", `${window.location.href}&example.panel--file=next.txt`);
  render(app.render(), container);
  await panel.updateComplete;
  expect(panel.panelContext).not.toBe(previous);
});

it("keeps management action controls hidden with stable callbacks", async () => {
  const { app, container, navigation, setState } = await harness(true);
  expect(navigation.onShowActions).toBeUndefined();
  setState({ messages: [] });
  render(app.render(), container);
  await navigation.updateComplete;
  expect(navigation.onShowActions).toBeUndefined();
  expect(navigation.managementMode).toBe(true);
});

async function harness(management = false) {
  window.history.replaceState({}, "", `/?${management ? "embed=management&" : ""}project=p&workspace=w&tool=example%3Apanel&view=example%3Apanel`);
  const app = new PiWebApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
  let state: AppState = { ...initialAppState(), selectedProject: { id: "p", path: workspace.path, name: "Project", createdAt: "now" }, selectedWorkspace: workspace, workspaceTool: "example:panel", mainView: "example:panel" };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; Reflect.set(app, "state", state); };
  setState({});
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Missing registry");
  await registry.register({ id: "example", plugin: { apiVersion: 4, name: "Example", activate: () => ({ contributions: { workspacePanels: [{ id: "panel", title: "Panel", render: () => html`<p>Plugin panel</p>` }] } }) } });
  const container = document.createElement("div");
  document.body.append(container);
  render(app.render(), container);
  const panel = container.querySelector("workspace-panel");
  const navigation = container.querySelector("app-navigation-panel");
  if (!(panel instanceof WorkspacePanel) || !(navigation instanceof AppNavigationPanel)) throw new Error("Missing rendered surfaces");
  await panel.updateComplete;
  await navigation.updateComplete;
  return { app, container, panel, navigation, getState: () => state, setState };
}
