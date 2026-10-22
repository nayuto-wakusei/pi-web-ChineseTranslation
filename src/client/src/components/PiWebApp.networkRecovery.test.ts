import "./nodeThemePlugin.testSupport";
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, Workspace } from "../api";
import { browserErrorScopeKey, type BrowserError } from "../browserErrors";
import { SessionController } from "../controllers/sessionController";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";

const workspace: Workspace = { id: "w", projectId: "p", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };
const session: SessionInfo = { id: "s", cwd: "/repo", path: "/repo/s.jsonl", created: "now", modified: "now", firstMessage: "", messageCount: 0 };
const apps: PiWebApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    controller(app).dispose();
    const plugins: unknown = Reflect.get(app, "plugins");
    if (plugins instanceof PluginRegistry) {
      await plugins.registerBatch([]);
      await plugins.dispose();
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search: "?project=p&workspace=w&session=s" }, localStorage: storage, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  const app = new PiWebApp();
  apps.push(app);
  const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: session };
  Reflect.set(app, "state", state);
  const selected = vi.spyOn(controller(app), "refreshSelectedSession").mockResolvedValue();
  const listed = vi.spyOn(controller(app), "refreshCurrentWorkspaceSessions").mockResolvedValue();
  return { app, state, selected, listed };
}

function controller(app: PiWebApp): SessionController {
  const value: unknown = Reflect.get(app, "sessions");
  if (!(value instanceof SessionController)) throw new Error("Session controller missing");
  return value;
}

function call(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing shell boundary ${name}`);
  return Reflect.apply(method, app, args);
}

function retain(state: AppState, error: BrowserError): void {
  state.browserErrors = { [browserErrorScopeKey(error.scope)]: error };
}

it("opts browser-resume reads into recovery without dropping the other refresh owners", async () => {
  const { app, selected, listed } = fixture();
  const names = ["renegotiateUnreadMachines", "refreshMachineActivities", "refreshMachineStatusSnapshots", "refreshWorkspaceDeletionRuns", "refreshCurrentWorkspaceSurface"];
  const otherRefreshes = names.map((name) => {
    const refresh = vi.fn(() => Promise.resolve());
    Reflect.set(app, name, refresh);
    return refresh;
  });
  const workspaces: unknown = Reflect.get(app, "workspaces");
  if (typeof workspaces !== "object" || workspaces === null) throw new Error("Workspace controller missing");
  const topology = vi.fn(() => Promise.resolve());
  Reflect.set(workspaces, "refreshSelectedProjectTopology", topology);
  Reflect.set(app, "navigationOrderScopes", () => []);
  await call(app, "refreshAfterBrowserResume");
  expect(selected).toHaveBeenCalledExactlyOnceWith(undefined, { recoverNetwork: true });
  expect(listed).toHaveBeenCalledExactlyOnceWith("local", { recoverNetwork: true });
  for (const refresh of [...otherRefreshes, topology]) expect(refresh).toHaveBeenCalledOnce();
});

it("retries only the current retained recoverable session error", () => {
  const { app, state, selected, listed } = fixture();
  const error: BrowserError = { scope: { kind: "session", machineId: "local", sessionId: "s", cwd: "/repo", projectId: "p", workspaceId: "w" }, message: "Offline", recovery: "session-refresh" };
  retain(state, error);
  call(app, "retryBrowserError", error);
  expect(selected).toHaveBeenCalledExactlyOnceWith("s", { recoverNetwork: true });
  expect(listed).not.toHaveBeenCalled();
});

it("does not retry a replaced error with identical text", () => {
  const { app, state, selected } = fixture();
  const old: BrowserError = { scope: { kind: "session", machineId: "local", sessionId: "s", cwd: "/repo" }, message: "Offline", recovery: "session-refresh" };
  retain(state, { ...old });
  call(app, "retryBrowserError", old);
  expect(selected).not.toHaveBeenCalled();
});

it.each(["machine", "cwd", "session", "project", "workspace"])("rejects a retired %s owner even if its banner callback survives", (field) => {
  const { app, state, selected, listed } = fixture();
  const scope = { kind: "session" as const, machineId: "local", sessionId: "s", cwd: "/repo", projectId: "p", workspaceId: "w" };
  if (field === "machine") scope.machineId = "other";
  if (field === "cwd") scope.cwd = "/other";
  if (field === "session") scope.sessionId = "other";
  if (field === "project") scope.projectId = "other";
  if (field === "workspace") scope.workspaceId = "other";
  const error: BrowserError = { scope, message: "Offline", recovery: "session-refresh" };
  retain(state, error);
  call(app, "retryBrowserError", error);
  expect(selected).not.toHaveBeenCalled();
  expect(listed).not.toHaveBeenCalled();
});

it("retries the selected workspace list, never an arbitrary mutation failure", () => {
  const { app, state, selected, listed } = fixture();
  const scope = { kind: "workspace" as const, machineId: "local", projectId: "p", workspaceId: "w" };
  const error: BrowserError = { scope, message: "Offline", recovery: "workspace-sessions-refresh" };
  retain(state, error);
  call(app, "retryBrowserError", error);
  expect(listed).toHaveBeenCalledExactlyOnceWith("local", { recoverNetwork: true });
  const mutation: BrowserError = { scope, message: "Failed to remove session" };
  retain(state, mutation);
  call(app, "retryBrowserError", mutation);
  expect(listed).toHaveBeenCalledOnce();
  expect(selected).not.toHaveBeenCalled();
});

it("retires read recoveries with the exact navigation fields even on same-route navigation", () => {
  const { app } = fixture();
  const retire = vi.spyOn(controller(app), "retireReadRecoveries");
  Reflect.set(app, "syncNavigationFreshness", vi.fn());
  Reflect.set(app, "invalidateWorkspaceSurface", vi.fn());
  call(app, "retireNavigationScope", ["session"]);
  expect(retire).toHaveBeenCalledExactlyOnceWith(["session"]);
});
