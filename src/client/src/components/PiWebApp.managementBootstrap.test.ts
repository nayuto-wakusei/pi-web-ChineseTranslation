// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, setApiScope } from "../api";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { MachinePluginLoadCoordinator } from "../plugins/machinePluginLoadCoordinator";
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
  it("does not load normal-mode configuration, runtime status or browser plugins", async () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/?embed=management");
    const app = new PiWebApp();
    const config = vi.spyOn(configApi, "config");
    const status = vi.spyOn(PiWebStatusController.prototype, "refresh");
    const gatewayPlugins = vi.spyOn(MachinePluginLoadCoordinator.prototype, "ensureGatewayLoaded");
    const machinePlugins = vi.spyOn(MachinePluginLoadCoordinator.prototype, "loadForMachine");

    await invoke(app, "loadClientConfig");
    await invoke(app, "ensureGatewayPluginsLoaded");
    await invoke(app, "loadPluginsForMachine", { id: "remote", kind: "remote" });
    await invoke(app, "schedulePiWebStatusRefresh", 1);
    await vi.advanceTimersByTimeAsync(10);

    expect(config).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(gatewayPlugins).not.toHaveBeenCalled();
    expect(machinePlugins).not.toHaveBeenCalled();
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
