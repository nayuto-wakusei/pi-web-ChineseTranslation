// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, setApiScope } from "../api";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { MachinePluginLoadCoordinator } from "../plugins/machinePluginLoadCoordinator";
import type { ExternalPluginLoadResult } from "../plugins/external";
import { PiWebApp } from "./PiWebApp";
import { initialAppState } from "../appState";
import { readRoute, type ParsedAppRoute } from "../route";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  setApiScope("normal");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("management app bootstrap boundaries", () => {
  it.each(["management", "normal"])("selects the sole authorized entry project only in %s scope", async (scope) => {
    history.replaceState({}, "", scope === "management" ? "/?embed=management" : "/");
    const { app, navigate, restore } = entryHarness();
    await invoke(app, "loadProjectsAndRestoreRoute");
    if (scope === "management") {
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ id: "managed" }), {
        expected: { ...readRoute(), machineId: "local" },
      });
      expect(restore).not.toHaveBeenCalled();
    } else {
      expect(navigate).not.toHaveBeenCalled();
      expect(restore).toHaveBeenCalled();
    }
  });

  it("does not replace an explicit project route with the sole authorized project", async () => {
    history.replaceState({}, "", "/?embed=management&project=requested");
    const { app, navigate, restore } = entryHarness();
    await invoke(app, "loadProjectsAndRestoreRoute");
    expect(navigate).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ projectId: "requested" }), false);
  });

  it("does not let a delayed entry load overwrite newer navigation", async () => {
    history.replaceState({}, "", "/?embed=management");
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const { app, navigate, restore } = entryHarness(() => pending);
    const loading = invoke(app, "loadProjectsAndRestoreRoute");
    await Promise.resolve();
    history.replaceState({}, "", "/?embed=management&project=newer&workspace=chosen");
    finish();
    await loading;
    expect(navigate).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ projectId: "newer", workspaceId: "chosen" }), false);
  });

  it("exposes management plugin import errors and clears them after a successful retry", async () => {
    history.replaceState({}, "", "/?embed=management");
    const app = new PiWebApp();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failed: ExternalPluginLoadResult = {
      terminalMode: "required",
      declarations: [{ id: "example", machineSpecific: false }],
      registrations: [],
      failures: [{ entry: { id: "example", module: "./example.js", machineSpecific: false }, error: new Error("plugin import failed") }],
    };
    await invoke(app, "registerExternalPlugins", "plugins", () => Promise.resolve(failed));
    const errors: unknown = Reflect.get(app, "pluginLoadErrors");
    expect(errors).toEqual(new Map([["local", "plugin import failed"]]));

    await invoke(app, "registerExternalPlugins", "plugins", () => Promise.resolve({ ...failed, declarations: [], failures: [] }));
    expect(errors).toEqual(new Map());
  });

  it("loads browser plugins without loading normal-mode configuration or runtime status", async () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/?embed=management");
    const app = new PiWebApp();
    const config = vi.spyOn(configApi, "config");
    const status = vi.spyOn(PiWebStatusController.prototype, "refresh");
    const gatewayPlugins = vi.spyOn(MachinePluginLoadCoordinator.prototype, "ensureGatewayLoaded").mockResolvedValue(true);
    const machinePlugins = vi.spyOn(MachinePluginLoadCoordinator.prototype, "loadForMachine").mockResolvedValue();

    await invoke(app, "loadClientConfig");
    await invoke(app, "ensureGatewayPluginsLoaded");
    await invoke(app, "loadPluginsForMachine", { id: "remote", kind: "remote" });
    await invoke(app, "schedulePiWebStatusRefresh", 1);
    await vi.advanceTimersByTimeAsync(10);

    expect(config).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(gatewayPlugins).toHaveBeenCalled();
    expect(machinePlugins).toHaveBeenCalledOnce();
  });

  it("retains normal-mode gateway plugin loading and runtime refresh", async () => {
    vi.useFakeTimers();
    const app = new PiWebApp();
    const gatewayPlugins = vi.spyOn(MachinePluginLoadCoordinator.prototype, "ensureGatewayLoaded").mockResolvedValue(true);
    const status = vi.spyOn(PiWebStatusController.prototype, "refresh").mockResolvedValue(undefined);

    await invoke(app, "ensureGatewayPluginsLoaded");
    await invoke(app, "schedulePiWebStatusRefresh", 1);
    await vi.advanceTimersByTimeAsync(10);

    expect(gatewayPlugins).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
  });
});

function entryHarness(waitForProjects = () => Promise.resolve()) {
  const app = new PiWebApp();
  const project = { id: "managed", name: "Managed", path: "/managed", createdAt: "now" };
  Reflect.set(app, "state", { ...initialAppState(), projects: [project] });
  const machines: unknown = Reflect.get(app, "machines");
  const projects: unknown = Reflect.get(app, "projects");
  if (typeof machines !== "object" || machines === null || typeof projects !== "object" || projects === null) throw new Error("Missing controllers");
  Reflect.set(machines, "loadMachines", () => Promise.resolve(true));
  Reflect.set(projects, "loadProjects", waitForProjects);
  const navigate = vi.fn().mockResolvedValue(true);
  const restore = vi.fn<(route: ParsedAppRoute, updateUrl: boolean) => Promise<void>>().mockResolvedValue(undefined);
  Reflect.set(app, "navigateToProjectFromController", navigate);
  Reflect.set(app, "restoreRouteFor", restore);
  Reflect.set(app, "restoreRoute", () => restore(readRoute(), false));
  Reflect.set(app, "withChatScrollTransition", (action: () => Promise<void>) => action());
  Reflect.set(app, "refreshWorkspaceDeletionRuns", () => Promise.resolve());
  return { app, navigate, restore };
}

async function invoke(app: PiWebApp, name: string, ...args: unknown[]): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing app method: ${name}`);
  await Reflect.apply(method, app, args);
}
