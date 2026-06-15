import { describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@chainingintention/pi-web-cn/plugin-api";
import { additionalCommands, formatVersion, installationLabel, messageCount, recommendedCommand, shouldShowUpdatesPanel } from "./updatesLogic";

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.202605.8",
    installedVersion: "1.202605.8",
    stale: false,
    available: true,
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt: "2026-06-14T00:00:00.000Z",
    components: {
      web: component({ component: "web", label: "Web/UI" }),
      sessiond: component({ component: "sessiond", label: "Session daemon" }),
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: false },
    commands: {},
    messages: [],
    ...overrides,
  };
}

function stateWith(value: PiWebStatusResponse | undefined): PluginRuntimeState {
  return value === undefined ? {} : { piWebStatus: value };
}

describe("recommendedCommand", () => {
  it("recommends update & restart when an update is available", () => {
    const result = recommendedCommand(status({
      release: { packageName: "@jmfederico/pi-web", updateAvailable: true },
      commands: { update: "pi-web update && pi-web restart", restart: "pi-web restart" },
    }));
    expect(result).toEqual({ label: "Update & restart everything", command: "pi-web update && pi-web restart" });
  });

  it("falls through to restart when an update is available but the update command is empty", () => {
    const result = recommendedCommand(status({
      release: { packageName: "@jmfederico/pi-web", updateAvailable: true },
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { update: "", restart: "pi-web restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "pi-web restart" });
  });

  it("recommends restart when the web component is stale", () => {
    const result = recommendedCommand(status({
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { restart: "pi-web restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "pi-web restart" });
  });

  it("recommends restart when the session daemon is unavailable", () => {
    const result = recommendedCommand(status({
      components: {
        web: component(),
        sessiond: component({ component: "sessiond", label: "Session daemon", available: false }),
      },
      commands: { restart: "pi-web restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "pi-web restart" });
  });

  it("returns nothing when everything is current and available", () => {
    expect(recommendedCommand(status({ commands: { restart: "pi-web restart" } }))).toBeUndefined();
  });

  it("does not fabricate a restart command when one is not configured", () => {
    const result = recommendedCommand(status({
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { restart: "" },
    }));
    expect(result).toBeUndefined();
  });
});

describe("additionalCommands", () => {
  it("drops empty commands and the recommended command, preserving order", () => {
    const value = status({
      commands: {
        update: "pi-web update",
        restart: "pi-web restart",
        restartWeb: "",
        restartSessiond: "pi-web restart sessiond",
        status: "pi-web status",
      },
    });
    const result = additionalCommands(value, { label: "Restart everything", command: "pi-web restart" });
    expect(result).toEqual([
      { label: "Update", command: "pi-web update" },
      { label: "Restart session daemon", command: "pi-web restart sessiond" },
      { label: "Status", command: "pi-web status" },
    ]);
  });

  it("keeps all commands when there is no recommended command", () => {
    const value = status({ commands: { update: "pi-web update", status: "pi-web status" } });
    expect(additionalCommands(value, undefined)).toEqual([
      { label: "Update", command: "pi-web update" },
      { label: "Status", command: "pi-web status" },
    ]);
  });
});

describe("shouldShowUpdatesPanel", () => {
  const messages: PiWebStatusMessage[] = [{ id: "x", severity: "warning", title: "t", body: "b" }];

  it("shows the panel whenever there are messages, even on a managed install", () => {
    const value = status({
      messages,
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(true);
  });

  it("hides the panel when status is unavailable", () => {
    expect(shouldShowUpdatesPanel(stateWith(undefined))).toBe(false);
    expect(shouldShowUpdatesPanel(undefined)).toBe(false);
  });

  it("shows the panel for local or unknown installs", () => {
    const local = status({
      components: {
        web: component({ installation: { kind: "local" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(local))).toBe(true);

    const unknown = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(unknown))).toBe(true);
  });

  it("hides the panel for fully managed installs with no messages", () => {
    const value = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "npm-global" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(false);
  });
});

describe("messageCount", () => {
  it("counts messages and tolerates missing status", () => {
    expect(messageCount(undefined)).toBe(0);
    expect(messageCount(stateWith(status()))).toBe(0);
    expect(messageCount(stateWith(status({ messages: [{ id: "a", severity: "info", title: "t", body: "b" }] })))).toBe(1);
  });
});

describe("formatVersion", () => {
  it("renders unknown for missing or empty versions", () => {
    expect(formatVersion(undefined)).toBe("unknown");
    expect(formatVersion("")).toBe("unknown");
    expect(formatVersion("1.202605.8")).toBe("1.202605.8");
  });
});

describe("installationLabel", () => {
  it("labels each installation kind", () => {
    expect(installationLabel(undefined)).toBe("installation unknown");
    expect(installationLabel({ kind: "unknown" })).toBe("installation unknown");
    expect(installationLabel({ kind: "npm-global" })).toBe("global npm package");
    expect(installationLabel({ kind: "local" })).toBe("local checkout");
  });

  it("includes source and scope for pi-package installs", () => {
    expect(installationLabel({ kind: "pi-package", source: "npm:@jmfederico/pi-web", scope: "user" }))
      .toBe("npm:@jmfederico/pi-web · user");
  });

  it("defaults the source and omits scope when absent", () => {
    expect(installationLabel({ kind: "pi-package" })).toBe("Pi package");
  });
});
