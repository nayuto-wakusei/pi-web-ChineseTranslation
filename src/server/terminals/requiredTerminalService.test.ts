import { describe, expect, it, vi } from "vitest";
import { REQUIRED_TERMINAL_PLUGIN_ID } from "../../shared/requiredTerminalPlugin.js";
import { REQUIRED_TERMINAL_SERVICE_CAPABILITY, snapshotRequiredTerminalService } from "./requiredTerminalService.js";

describe("required terminal service snapshot", () => {
  it("freezes the host composition methods without taking PTY ownership", () => {
    const closeForCwd = vi.fn();
    const runCommand = vi.fn(() => commandRun());
    const bindActivitySink = vi.fn();
    const service = snapshotRequiredTerminalService({ closeForCwd, runCommand, bindActivitySink, extra: true });

    expect(REQUIRED_TERMINAL_SERVICE_CAPABILITY).toMatchObject({
      pluginId: REQUIRED_TERMINAL_PLUGIN_ID,
      id: "service",
      version: 1,
    });
    service.closeForCwd("/repo");
    expect(service.runCommand({ command: "echo hi" })).toMatchObject({ id: "run-1", status: "succeeded" });
    const sink = { updateTerminal: vi.fn(), removeTerminal: vi.fn() };
    service.bindActivitySink(sink);

    expect(closeForCwd).toHaveBeenCalledWith("/repo");
    expect(runCommand).toHaveBeenCalledWith({ command: "echo hi" });
    expect(bindActivitySink).toHaveBeenCalledOnce();
    expect(Object.isFrozen(service)).toBe(true);
  });

  it("rejects a server entry that does not provide the composition service", () => {
    expect(() => snapshotRequiredTerminalService({ closeForCwd() { return undefined; } })).toThrow(/composition service/);
    expect(() => snapshotRequiredTerminalService({
      closeForCwd() { return undefined; },
      runCommand: () => ({ id: "run-1" }),
      bindActivitySink() { return undefined; },
    }).runCommand({})).toThrow(/invalid command run/);
  });
});

function commandRun() {
  return {
    id: "run-1",
    origin: "test",
    projectId: "project-1",
    workspaceId: "workspace-1",
    terminalId: "terminal-1",
    title: "Echo",
    command: "echo hi",
    status: "succeeded",
    exitCode: 0,
    createdAt: "2026-09-28T00:00:00.000Z",
    metadata: { source: "test" },
  };
}
