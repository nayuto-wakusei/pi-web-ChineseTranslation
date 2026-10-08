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
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue({ plugins: [
      { id: "captains-log", module: "./captains-log/index.js", source: "optional", scope: "user", machineSpecific: true, enabled: false },
      { id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true, enabled: true },
    ] });
    const coordinator = new MachinePluginLoadCoordinator(async (_label, load) => {
      await load();
      return true;
    }, () => true);
    await coordinator.ensureGatewayLoaded();
    expect(loadExternalPlugins).toHaveBeenCalledWith("pi-web-plugins/manifest.json", { plugins: [{
      id: "pi-web.terminal", module: "./terminal/plugin.js", source: "bundled", scope: "bundled", machineSpecific: true,
    }] });
  });
});
