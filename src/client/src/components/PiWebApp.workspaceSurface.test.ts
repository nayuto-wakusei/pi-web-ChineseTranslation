// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Workspace } from "../api";
import type { WorkspacePanelContext } from "../plugins/types";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import { WorkspacePanel } from "./WorkspacePanel";

const workspace: Workspace = { id: "w", projectId: "p", path: "/repo", label: "main", effectiveConfig: {}, isMain: true, isGitRepo: true, isGitWorktree: false };

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

it("keeps panel contexts and navigation callbacks stable across transcript deltas, but honors explicit invalidation", async () => {
  const { app, container, panel, navigation, getState, getContext, setState } = await harness();
  const context = panel.panels;
  if (context.length === 0) throw new Error("Missing panel context");
  const labelItems = navigation.workspaceLabelItems;
  const selectWorkspace = navigation.onSelectWorkspace;
  const renameSession = navigation.onRenameSession;
  setState({ messages: [...getState().messages] });
  render(app.render(), container);
  await panel.updateComplete;
  await navigation.updateComplete;
  expect(panel.panels).toBe(context);
  expect(navigation.workspaceLabelItems).toBe(labelItems);
  expect(navigation.onSelectWorkspace).toBe(selectWorkspace);
  expect(navigation.onRenameSession).toBe(renameSession);
  getContext().host.requestRender();
  render(app.render(), container);
  await panel.updateComplete;
  expect(panel.panels).not.toBe(context);
  expect(navigation.workspaceLabelItems).not.toBe(labelItems);
  expect(navigation.onSelectWorkspace).toBe(selectWorkspace);
});

it("refreshes contexts for config, selected-session and query without coupling to retired core file state", async () => {
  const { app, container, panel, setState } = await harness();
  const update = async (patch: Partial<AppState>) => {
    const previous = panel.panels;
    setState(patch);
    render(app.render(), container);
    await panel.updateComplete;
    expect(panel.panels).not.toBe(previous);
  };
  await update({ selectedWorkspace: { ...workspace, label: "new branch" } });
  await update({ selectedSession: { id: "session", cwd: workspace.path, path: "/private/session", created: "now", modified: "now", messageCount: 0, firstMessage: "" } });
  const beforeFileState = panel.panels;
  expect(initialAppState()).not.toHaveProperty("selectedFilePath");
  render(app.render(), container);
  await panel.updateComplete;
  expect(panel.panels).toBe(beforeFileState);
  const previous = panel.panels;
  window.history.replaceState({}, "", `${window.location.href}&example.panel--file=next.txt`);
  render(app.render(), container);
  await panel.updateComplete;
  expect(panel.panels).not.toBe(previous);
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
  window.history.replaceState({}, "", `/?${management ? "embed=management&" : ""}project=p&workspace=w&tool=example%3Apanel&view=workspace`);
  const app = new PiWebApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
  let state: AppState = { ...initialAppState(), selectedProject: { id: "p", path: workspace.path, name: "Project", createdAt: "now" }, selectedWorkspace: workspace, workspaceTool: "example:panel", mainView: "workspace" };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; Reflect.set(app, "state", state); };
  setState({});
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Missing registry");
  let context: WorkspacePanelContext | undefined;
  await registry.register({ id: "example", plugin: { apiVersion: 4, name: "Example", activate: () => ({ contributions: { workspacePanels: [{ id: "panel", title: "Panel", render: (value) => { context = value; return html`<p>Plugin panel</p>`; } }] } }) } });
  const container = document.createElement("div");
  document.body.append(container);
  render(app.render(), container);
  const panel = container.querySelector("workspace-panel");
  const navigation = container.querySelector("app-navigation-panel");
  if (!(panel instanceof WorkspacePanel) || !(navigation instanceof AppNavigationPanel)) throw new Error("Missing rendered surfaces");
  await panel.updateComplete;
  await navigation.updateComplete;
  return { app, container, panel, navigation, getState: () => state, getContext: () => { if (context === undefined) throw new Error("Missing panel context"); return context; }, setState };
}
