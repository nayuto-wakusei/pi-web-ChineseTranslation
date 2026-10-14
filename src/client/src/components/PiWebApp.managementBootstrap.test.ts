// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, setApiScope } from "../api";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { MachinePluginLoadCoordinator } from "../plugins/machinePluginLoadCoordinator";
import type { ExternalPluginLoadResult } from "../plugins/external";
import { PiWebApp } from "./PiWebApp";

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

async function invoke(app: PiWebApp, name: string, ...args: unknown[]): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing app method: ${name}`);
  await Reflect.apply(method, app, args);
}
