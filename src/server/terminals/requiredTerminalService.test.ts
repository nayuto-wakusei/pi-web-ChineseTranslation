import { describe, expect, it, vi } from "vitest";
import {
  REQUIRED_TERMINAL_SERVICE_CAPABILITY,
  snapshotRequiredTerminalService,
  unavailableRequiredTerminalService,
} from "./requiredTerminalService.js";

const run = {
  id: "run-1",
  origin: "core",
  projectId: "project-1",
  workspaceId: "workspace-1",
  terminalId: "terminal-1",
  title: "Remove workspace",
  command: "true",
  status: "running" as const,
  createdAt: "now",
  metadata: {},
};

describe("required Terminal server composition port", () => {
  it("snapshots only close, command-run, and activity binding operations", () => {
    const closeForCwd = vi.fn();
    const runCommand = vi.fn(() => run);
    const bindActivitySink = vi.fn();
    expect(REQUIRED_TERMINAL_SERVICE_CAPABILITY).toMatchObject({
      pluginId: "pi-web.terminal",
      id: "service",
      version: 1,
    });
    const service = REQUIRED_TERMINAL_SERVICE_CAPABILITY.parse({ closeForCwd, runCommand, bindActivitySink, extra: vi.fn() });

    service.closeForCwd("/repo");
    const options = {
      projectId: "project-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      origin: "core",
      title: "Remove workspace",
      command: "true",
      failureNotice: {
        message: "Workspace removal failed. See terminal output.",
        context: { targetWorkspaceId: "workspace-2" },
      },
    };
    expect(service.runCommand(options)).toEqual(run);
    service.bindActivitySink({ updateTerminal: vi.fn(), removeTerminal: vi.fn() });

    expect(closeForCwd).toHaveBeenCalledWith("/repo");
    expect(runCommand).toHaveBeenCalledWith(options);
    expect(bindActivitySink).toHaveBeenCalledOnce();
    expect(service).not.toHaveProperty("legacyRoutes");
  });

  it("snapshots optional generated title provenance while preserving raw fallback", () => {
    let titlePresentation: unknown = { kind: "workspaceRemoval", label: "feature" };
    const service = snapshotRequiredTerminalService({
      closeForCwd: vi.fn(), runCommand: () => ({ ...run, titlePresentation }), bindActivitySink: vi.fn(),
    });
    const options = { projectId: run.projectId, workspaceId: run.workspaceId, cwd: "/repo", origin: "core", title: run.title, command: "true" };
    expect(service.runCommand(options).titlePresentation).toEqual(titlePresentation);
    titlePresentation = { kind: "future" };
    expect(service.runCommand(options)).toEqual(run);
  });

  it("keeps the host command port workspace-only and rejects maintenance or unknown scopes", () => {
    const maintenance = { ...run, scope: "maintenance", projectId: undefined, workspaceId: undefined };
    let result: unknown = { ...run, scope: "workspace" };
    const service = snapshotRequiredTerminalService({
      closeForCwd: vi.fn(), runCommand: () => result, bindActivitySink: vi.fn(),
    });
    const options = { projectId: "project-1", workspaceId: "workspace-1", cwd: "/repo", origin: "core", title: "Command", command: "true" };
    const snapshot = service.runCommand(options);
    expect(snapshot).toMatchObject({ scope: "workspace", projectId: run.projectId, workspaceId: run.workspaceId });
    for (const invalid of [
      maintenance,
      { ...maintenance, projectId: "project-1" },
      { ...maintenance, workspaceId: "workspace-1" },
      { ...run, scope: "unknown" },
    ]) {
      result = invalid;
      expect(() => service.runCommand(options)).toThrow("invalid command run");
    }
  });

  it("rejects malformed service and command-run contributions", () => {
    expect(() => snapshotRequiredTerminalService({})).toThrow("did not provide its composition service");
    const service = snapshotRequiredTerminalService({
      closeForCwd: vi.fn(),
      runCommand: () => ({ id: "incomplete" }),
      bindActivitySink: vi.fn(),
    });
    expect(() => service.runCommand({
      projectId: "project-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      origin: "core",
      title: "Remove workspace",
      command: "true",
    })).toThrow("invalid command run");
  });

  it("fails recovery commands before callers can report success", () => {
    const service = unavailableRequiredTerminalService();
    expect(() => { service.closeForCwd("/repo"); }).toThrow("unavailable in recovery safe start");
    expect(() => service.runCommand({
      projectId: "project-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      origin: "core",
      title: "Remove workspace",
      command: "true",
    })).toThrow("unavailable in recovery safe start");
  });
});
