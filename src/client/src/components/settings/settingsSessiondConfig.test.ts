import { describe, expect, it } from "vitest";
import type { ActiveAgentProfileDescriptor, PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { agentDirFieldOverridden, agentProfileActivationState, askUserConfigPatch, mergeSelectedMachineSessiondConfig, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

describe("session daemon settings config helpers", () => {
  it("builds daemon-only save patches for the sessiond toggles", () => {
    expect(spawnSessionsConfigPatch(false)).toEqual({ spawnSessions: false });
    expect(subsessionsConfigPatch(true)).toEqual({ subsessions: true });
    expect(askUserConfigPatch(false)).toEqual({ askUser: false });
  });

  it("compares the desired effective profile with the daemon-owned active profile", () => {
    const config = configResponse(
      { agent: { command: "configured-agent", dir: "/configured" } },
      {},
      { agent: { command: "effective-agent", dir: "/effective" } },
    );

    expect(agentProfileActivationState(config, activeProfile("/effective"))).toBe("active");
    expect(agentProfileActivationState(config, activeProfile("/other"))).toBe("restart-required");
    expect(agentProfileActivationState(configResponse({}, {}, { agent: { dir: "/effective" } }), activeProfile("/effective"))).toBe("active");
    expect(agentProfileActivationState(configResponse({}), activeProfile("/effective"))).toBe("unavailable");
    expect(agentProfileActivationState(config, undefined)).toBe("unavailable");
    expect(agentProfileActivationState(undefined, activeProfile("/effective"))).toBe("unavailable");
  });

  it("keeps canonical directory overrides active for every command", () => {
    const baseOverrides = configResponse({}).envOverrides;

    expect(agentDirFieldOverridden({ ...baseOverrides, agentDir: true, agentDirSource: "pi-compatibility" }, "pi")).toBe(true);
    expect(agentDirFieldOverridden({ ...baseOverrides, agentDir: true, agentDirSource: "pi-compatibility" }, "pi.exe")).toBe(true);
    expect(agentDirFieldOverridden({ ...baseOverrides, agentDir: true, agentDirSource: "pi-compatibility" }, "alternate-agent")).toBe(true);
    expect(agentDirFieldOverridden({ ...baseOverrides, agentDir: true, agentDirSource: "pi-web" }, "alternate-agent")).toBe(true);
    expect(agentDirFieldOverridden({ ...baseOverrides, agentDir: true }, "alternate-agent")).toBe(true);
  });

  it("does not leak the gateway agent directory source into a selected-machine response", () => {
    const gateway = configResponse({}, { agentDir: true, agentDirSource: "pi-web" });
    const selectedMachine = configResponse({}, { agentDir: false });

    expect(mergeSelectedMachineSessiondConfig(gateway, selectedMachine).envOverrides.agentDirSource).toBeUndefined();
  });

  it("merges local selected-machine daemon config into gateway config without dropping gateway-only values", () => {
    const gateway = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: true } },
      spawnSessions: false,
      subsessions: false,
      agent: { command: "gateway-agent", dir: "/srv/gateway-agent" },
    });
    const selectedMachine = configResponse(
      { spawnSessions: true, subsessions: true, agent: { command: "machine-agent", dir: "/srv/machine-agent" } },
      { spawnSessions: true, subsessions: false },
      { spawnSessions: true, subsessions: true, agent: { command: "env-agent", dir: "/srv/machine-agent" } },
    );

    expect(mergeSelectedMachineSessiondConfig(gateway, selectedMachine)).toEqual({
      ...gateway,
      config: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        spawnSessions: true,
        subsessions: true,
        agent: { command: "machine-agent", dir: "/srv/machine-agent" },
      },
      effectiveConfig: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        spawnSessions: true,
        subsessions: true,
        agent: { command: "env-agent", dir: "/srv/machine-agent" },
      },
      envOverrides: {
        host: false,
        port: false,
        allowedHosts: false,
        spawnSessions: true,
        subsessions: false,
        askUser: false,
        agentCommand: false,
        agentDir: false,
        agentSessionDir: false,
      },
    });
  });
});

function activeProfile(dir: string): ActiveAgentProfileDescriptor {
  return {
    schemaVersion: 2,
    dir,
  };
}

function configResponse(
  config: PiWebConfigValues,
  overrides: Partial<PiWebConfigResponse["envOverrides"]> = {},
  effectiveConfig: PiWebConfigValues = config,
): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig,
    envOverrides: {
      host: false,
      port: false,
      allowedHosts: false,
      spawnSessions: false,
      subsessions: false,
      askUser: false,
      agentCommand: false,
      agentDir: false,
      agentSessionDir: false,
      ...overrides,
    },
  };
}
