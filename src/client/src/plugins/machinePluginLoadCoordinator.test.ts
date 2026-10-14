import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginsApi } from "../api";
import { loadExternalPlugins } from "./external";
import { MachinePluginLoadCoordinator } from "./machinePluginLoadCoordinator";

vi.mock("./external", () => ({ loadExternalPlugins: vi.fn(() => Promise.resolve({ registrations: [], failures: [] })) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("management plugin loading", () => {
  it("loads usable plugins even when the excluded Terminal backend is unhealthy", async () => {
    vi.stubGlobal("window", { location: new URL("https://pi.example.test/?embed=management&token=test") });
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue({ lifecycleVersion: 2, diagnostics: [], serverRuntime: {
      status: "available", terminalMode: "required", restartRequired: false,
      recovery: { showSafeStart: "show", bundledOnly: "bundled", noServerPlugins: "none", clearSafeStart: "off" },
    }, plugins: [
      { id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true, enabled: true, discovered: true, conflict: false,
        backendRevision: "revision", pairedRequestVersion: 1, pairedChannelVersion: 1,
        server: { state: "active", staleRevision: false, restartRequired: false, disableCommand: "disable", health: { status: "unhealthy" } } },
      { id: "info", module: "./info/plugin.js", source: "user", scope: "user", machineSpecific: false, enabled: true, discovered: true, conflict: false },
    ] });
    const actual = await vi.importActual<typeof import("./external")>("./external");
    const moduleLoader = vi.fn(() => Promise.resolve({ default: { apiVersion: 4, name: "Info", activate: () => ({ contributions: {} }) } }));
    vi.mocked(loadExternalPlugins).mockImplementationOnce((url, options) => actual.loadExternalPlugins(url, { ...options, moduleLoader }));
    const coordinator = new MachinePluginLoadCoordinator(async (_label, load) => {
      const result = await load();
      expect(result.failures).toEqual([]);
      expect(result.registrations.map((registration) => registration.id)).toEqual(["info"]);
      return true;
    }, () => true);

    await expect(coordinator.ensureGatewayLoaded()).resolves.toBe(true);
    expect(moduleLoader).toHaveBeenCalledOnce();
  });

  it("does not import disabled optional packages and retains trusted bundled source metadata", async () => {
    vi.stubGlobal("window", { location: new URL("https://pi.example.test/?embed=management&token=test") });
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue({ lifecycleVersion: 2, diagnostics: [], serverRuntime: {
      status: "available", terminalMode: "required", restartRequired: false,
      recovery: { showSafeStart: "show", bundledOnly: "bundled", noServerPlugins: "none", clearSafeStart: "off" },
    }, plugins: [
      { id: "captains-log", module: "./captains-log/index.js", source: "optional", scope: "user", machineSpecific: true, enabled: false, discovered: true, conflict: false },
      { id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true, enabled: true, discovered: true, conflict: false,
        backendRevision: "revision", pairedRequestVersion: 1, pairedChannelVersion: 1 },
    ] });
    const coordinator = new MachinePluginLoadCoordinator(async (_label, load) => {
      await load();
      return true;
    }, () => true);
    await coordinator.ensureGatewayLoaded();
    const shouldLoad = vi.mocked(loadExternalPlugins).mock.calls[0]?.[1]?.shouldLoadPlugin;
    expect(typeof shouldLoad).toBe("function");
    expect(loadExternalPlugins).toHaveBeenCalledWith("pi-web-plugins/manifest.json", { shouldLoadPlugin: shouldLoad, manifest: { lifecycleVersion: 2, terminalMode: "required", plugins: [{
      id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true,
      backendRevision: "revision", pairedRequestVersion: 1, pairedChannelVersion: 1,
    }] } });
    expect(shouldLoad?.({ id: "pi-web.terminal", module: "./terminal/plugin.js", machineSpecific: true })).toBe(false);
  });

  it("publishes only usable active server-backed modules from the diagnostic list", async () => {
    vi.stubGlobal("window", { location: new URL("https://pi.example.test/?embed=management&token=test") });
    const browser = { id: "browser", module: "./browser/index.js", source: "user", scope: "user", machineSpecific: true, enabled: true, discovered: true, conflict: false } as const;
    const server = { state: "active", staleRevision: false, restartRequired: false, disableCommand: "disable" } as const;
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue({ lifecycleVersion: 2, diagnostics: [], serverRuntime: {
      status: "available", terminalMode: "recovery-disabled", restartRequired: false,
      recovery: { showSafeStart: "show", bundledOnly: "bundled", noServerPlugins: "none", clearSafeStart: "off" },
    }, plugins: [
      browser,
      { ...browser, id: "healthy", server: { ...server, health: { status: "healthy" } } },
      { ...browser, id: "degraded", server: { ...server, health: { status: "degraded" } } },
      { ...browser, id: "stale", server: { ...server, staleRevision: true } },
      { ...browser, id: "unhealthy", server: { ...server, health: { status: "unhealthy" } } },
      ...(["failed", "incompatible", "disabled", "missing", "unknown"] as const).map((state) => ({ ...browser, id: state, server: { ...server, state } })),
    ] });
    const coordinator = new MachinePluginLoadCoordinator(async (_label, load) => {
      await load();
      return true;
    }, () => true);
    await coordinator.ensureGatewayLoaded();
    const manifest = vi.mocked(loadExternalPlugins).mock.lastCall?.[1]?.manifest;
    expect(manifest).toMatchObject({ plugins: [{ id: "browser" }, { id: "healthy" }, { id: "degraded" }] });
  });
});
