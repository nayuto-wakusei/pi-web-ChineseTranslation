import { html, svg } from "lit";
import { expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { adaptPublicPlugin, publicPluginState, publicPluginSession } from "./publicContext";
import type { SessionLabelContext, WorkspacePanelContext } from "./types";

const session = {
  id: "session", cwd: "/workspace", name: "Conversation", path: "/private/session.jsonl",
  created: "2026-01-01", modified: "2026-01-01", messageCount: 1, firstMessage: "Private message",
  clientPendingStart: true,
};

it("retains published workspace flags while excluding host-only selection state", () => {
  const workspace = {
    id: "workspace", projectId: "project", path: "/workspace", label: "branch", isMain: false,
    branch: "feature", isGitRepo: true, isGitWorktree: true, effectiveConfig: {},
    provider: { pluginId: "provider", capabilities: { remove: false }, metadata: { public: true } },
    removal: { actionLabel: "Remove", confirmation: "Remove?", precondition: "private-token" },
  };
  const projected = publicPluginState({ ...initialAppState(), selectedWorkspace: workspace });
  expect(projected.selectedWorkspace).toMatchObject({ branch: "feature", isGitRepo: true, isGitWorktree: true });
  expect(projected.selectedWorkspace).not.toHaveProperty("effectiveConfig");
  expect(projected.selectedWorkspace).not.toBe(workspace);
  expect(projected.selectedWorkspace?.removal).toEqual({ actionLabel: "Remove", confirmation: "Remove?" });
  expect(projected.selectedWorkspace?.provider).not.toBe(workspace.provider);
});

it("projects only documented session fields and does not share the internal session object", () => {
  const state = { ...initialAppState(), selectedSession: session };
  const projected = publicPluginState(state);
  expect(projected.selectedSession).toEqual({ id: "session", cwd: "/workspace", name: "Conversation", archived: false, pending: true });
  expect(projected).not.toHaveProperty("sessions");
  expect(projected.selectedSession).not.toBe(session);
  if (projected.selectedSession) projected.selectedSession.name = "Plugin mutation";
  expect(session.name).toBe("Conversation");
  expect(publicPluginState(initialAppState())).not.toHaveProperty("selectedSession");
  const archived = { ...session, archived: true, clientPendingStart: false };
  expect(publicPluginState({ ...state, selectedSession: archived }).selectedSession)
    .toMatchObject({ archived: true, pending: false });
});

it("preserves lifecycle callback receivers while adapting contributions", async () => {
  class Activation {
    contributions = {};
    started = false;
    start() { this.started = true; }
    dispose() { this.started = false; }
  }
  const source = new Activation();
  const plugin = adaptPublicPlugin({ apiVersion: 4, name: "Lifecycle", activate: () => source });
  const signal = new AbortController().signal;
  const activation = await plugin.activate({ apiVersion: 4, pluginId: "lifecycle", runtimePluginId: "lifecycle", html, svg,
    signal, lifetimeSignal: signal });
  await activation.start?.({ signal, capabilities: { resolve() { throw new Error("Unexpected dependency"); } } });
  expect(source.started).toBe(true);
  await activation.dispose?.(signal);
  expect(source.started).toBe(false);
});

it.each([4, 5] as const)("projects state for API v%s external workspace callbacks without changing the host context", async (apiVersion) => {
  const visible = vi.fn(() => true);
  const badge = vi.fn(() => "badge");
  const onInvalidate = vi.fn();
  const render = vi.fn(() => html`panel`);
  const fileOpenQuery = vi.fn(() => ({ file: "example.txt" }));
  const items = vi.fn(() => []);
  const plugin = adaptPublicPlugin({ apiVersion, name: "External", activate: () => ({ contributions: {
    workspacePanels: [{ id: "panel", title: "Panel", visible, badge, onInvalidate, fileOpenQuery, render }],
    workspaceLabels: [{ id: "label", visible, items }],
    sessionLabels: [{ id: "session-label", visible, items }],
  } }) });
  const activation = await plugin.activate({ apiVersion, pluginId: "external", runtimePluginId: "external", html, svg,
    signal: new AbortController().signal, lifetimeSignal: new AbortController().signal });
  const unused = () => { throw new Error("Unexpected host call"); };
  const context: WorkspacePanelContext = {
    navigate: () => Promise.resolve(),
    state: { ...initialAppState(), selectedSession: session },
    machine: { id: "remote", name: "Remote", kind: "remote" },
    workspace: { id: "workspace", projectId: "project", path: "/workspace", label: "Workspace", isMain: true, effectiveConfig: {} },
    files: { readFile: unused, listFiles: unused, writeFile: unused, deleteFile: unused, moveFile: unused },
    prompt: { insertText: unused, getText: unused, getSelection: unused },
    terminal: { open: unused, runCommand: unused }, host: { requestRender: unused },
  };
  const panel = activation.contributions.workspacePanels?.[0];
  const label = activation.contributions.workspaceLabels?.[0];
  expect(panel?.visible?.(context)).toBe(true);
  expect(panel?.badge?.(context)).toBe("badge");
  await panel?.onInvalidate?.(context, { reason: "manual", resources: ["workspace.files"] });
  panel?.render(context);
  panel?.fileOpenQuery?.(context, "example.txt");
  label?.visible?.(context);
  label?.items(context);
  const rowContext: SessionLabelContext = { ...context, session: publicPluginSession({ ...session, id: "row" }) };
  activation.contributions.sessionLabels?.[0]?.visible?.(rowContext);
  activation.contributions.sessionLabels?.[0]?.items(rowContext);
  expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ session: { id: "row", cwd: "/workspace", name: "Conversation", archived: false, pending: true } }));
  for (const callback of [visible, badge, onInvalidate, fileOpenQuery, render, items]) {
    expect(callback).toHaveBeenCalled();
    for (const call of callback.mock.calls) {
      expect(call).toEqual([expect.objectContaining({ state: publicPluginState(context.state) }),
        ...(callback === onInvalidate ? [{ reason: "manual", resources: ["workspace.files"] }] : callback === fileOpenQuery ? ["example.txt"] : [])]);
    }
  }
  expect(context.state.selectedSession).toBe(session);
});

it("maps local panel views to the public workspace view without exposing machine transport", () => {
  const state: AppState = { ...initialAppState(), mainView: "workspace", workspaceTool: "files:files", selectedMachine: {
    id: "remote", name: "Remote", kind: "remote" as const, baseUrl: "https://private.example",
    createdAt: "now", updatedAt: "now",
  } };
  expect(publicPluginState(state)).toMatchObject({ mainView: "workspace", selectedMachine: {
    id: "remote", name: "Remote", kind: "remote",
  } });
  expect(publicPluginState(state).selectedMachine).not.toHaveProperty("baseUrl");
  expect(publicPluginState({ ...state, mainView: "chat" }).mainView).toBe("chat");
  expect(publicPluginState({ ...state, mainView: "navigation" }).mainView).toBe("navigation");
});
