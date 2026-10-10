import { describe, expect, it } from "vitest";
import { parsePiWebPluginsResponse } from "./parsers";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS } from "../../../shared/pluginRecoveryCommands";

function lifecycleResponse() {
  return { lifecycleVersion: 2, plugins: [{ id: "pi-web.terminal", required: true, source: "bundled", scope: "bundled", machineSpecific: true, enabled: true, discovered: true, conflict: false, backendRevision: "server-rev", pairedRequestVersion: 1, pairedChannelVersion: 1, server: { state: "active", activeRevision: "server-rev", staleRevision: false, restartRequired: false, disableCommand: "pi-web plugins disable pi-web.terminal --restart" } }], diagnostics: [], serverRuntime: { status: "available", terminalMode: "required", restartRequired: false, recovery: { ...PI_WEB_PLUGIN_RECOVERY_COMMANDS } } };
}

describe("plugin lifecycle wire contract", () => {
  it("retains authoritative Terminal mode, required marker, server diagnostics, and management pairing", () => {
    const value = lifecycleResponse();
    expect(parsePiWebPluginsResponse(value)).toEqual(value);
  });

  it.each([1, 3, "2", null])("rejects lifecycle version %s", (lifecycleVersion) => {
    expect(() => parsePiWebPluginsResponse({ ...lifecycleResponse(), lifecycleVersion })).toThrow("Unsupported PI WEB plugin lifecycle version");
  });

  it.each([
    { status: "available", terminalMode: "recovery-disabled" },
    { status: "available", terminalMode: "required", safeStart: "none" },
    { status: "unavailable", terminalMode: "recovery-disabled", safeStart: "none" },
    { status: "available", terminalMode: undefined },
  ])("rejects contradictory or missing Terminal mode: %j", (runtime) => {
    const value = lifecycleResponse();
    expect(() => parsePiWebPluginsResponse({ ...value, serverRuntime: { ...value.serverRuntime, ...runtime } })).toThrow();
  });

  it("accepts only active safe-start-none Terminal recovery", () => {
    const value = lifecycleResponse();
    const parsed = parsePiWebPluginsResponse({ ...value, plugins: [], serverRuntime: { ...value.serverRuntime, terminalMode: "recovery-disabled", safeStart: "none" } });
    expect(parsed.serverRuntime).toMatchObject({ terminalMode: "recovery-disabled", safeStart: "none" });
  });

  it("rejects a false required marker and fabricated offline commands", () => {
    const value = lifecycleResponse();
    expect(() => parsePiWebPluginsResponse({ ...value, plugins: [{ ...value.plugins[0], required: false }] })).toThrow("Invalid PI WEB required plugin marker");
    expect(() => parsePiWebPluginsResponse({ ...value, serverRuntime: { ...value.serverRuntime, recovery: { ...value.serverRuntime.recovery, noServerPlugins: "do something else" } } })).toThrow("Invalid PI WEB server plugin recovery commands");
  });
});
