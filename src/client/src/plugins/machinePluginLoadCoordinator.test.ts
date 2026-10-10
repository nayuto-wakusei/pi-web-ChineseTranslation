import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginsApi } from "../api";
import { loadExternalPlugins } from "./external";
import { MachinePluginLoadCoordinator } from "./machinePluginLoadCoordinator";

vi.mock("./external", () => ({ loadExternalPlugins: vi.fn(() => Promise.resolve({ registrations: [], failures: [] })) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("management plugin loading", () => {
  it("does not import disabled optional packages and retains trusted bundled source metadata", async () => {
    vi.stubGlobal("window", { location: new URL("https://pi.example.test/?embed=management&token=test") });
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue({ lifecycleVersion: 2, diagnostics: [], serverRuntime: {
      status: "available", terminalMode: "required", restartRequired: false,
      recovery: { showSafeStart: "show", bundledOnly: "bundled", noServerPlugins: "none", clearSafeStart: "off" },
    }, plugins: [
      { id: "captains-log", module: "./captains-log/index.js", source: "optional", scope: "user", machineSpecific: true, enabled: false },
      { id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true, enabled: true,
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
});
