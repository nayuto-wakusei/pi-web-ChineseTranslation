import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionServices, CreateAgentSessionServicesOptions } from "../../piSdk.js";
import { expect, it, vi } from "vitest";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { mcpOAuthStorageDirectory, type ScopedMcpOptions } from "./mcpOAuthCredentialAdapter.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime, testManagementContext } from "./piSessionService.testSupport.js";
import { projectSettingsScopeDirectory } from "./projectSettingsScope.js";

const { captureServices, captureScope } = vi.hoisted(() => ({
  captureServices: vi.fn<(options: CreateAgentSessionServicesOptions) => Promise<AgentSessionServices>>(),
  captureScope: vi.fn<(scope: ScopedMcpOptions) => Promise<[]>>(),
}));
vi.mock("../../piSdk.js", async (importOriginal) => ({ ...await importOriginal<typeof import("../../piSdk.js")>(), createAgentSessionServices: captureServices }));
vi.mock("./builtinExtensionFactories.js", () => ({ getBuiltinExtensionFactories: captureScope }));

it("always scopes builtins by registered project across worktrees, mode and full management identity while excluding restricted runtimes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-runtime-scopes-"));
  const agent = join(root, "agent");
  const data = join(root, "data");
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  const worktrees = [join(projectA, "main"), join(projectA, "feature"), projectB];
  await Promise.all(worktrees.map((path) => mkdir(path, { recursive: true })));
  captureServices.mockRejectedValue(new Error("capture MCP scoped runtime"));
  captureScope.mockResolvedValue([]);
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: agent, dataDir: data, modelRuntime: await createTestModelRuntime(),
    sessionManager: createPiSessionManagerGateway({ agentDir: agent, env: {} }),
    projectPathForCwd: (cwd) => Promise.resolve(cwd === projectB ? projectB : projectA), managementAllowPrivileged: true,
  });
  try {
    for (const cwd of worktrees) await expect(service.start(cwd)).rejects.toThrow("capture MCP scoped runtime");
    const normal = mcpOAuthStorageDirectory(projectSettingsScopeDirectory(data, projectA, "normal"));
    expect(captureScope.mock.calls.slice(0, 3).map(([scope]) => scope)).toEqual([
      { directory: normal }, { directory: normal },
      { directory: mcpOAuthStorageDirectory(projectSettingsScopeDirectory(data, projectB, "normal")) },
    ]);
    const first = { ...testManagementContext(), privileged: { bash: true, network: true } };
    const second = { ...first, user: { ...first.user, id: "different-account" } };
    const changedPermissions = { ...first, user: { ...first.user, permissions: [...first.user.permissions, "extra-permission"] } };
    for (const context of [first, second, changedPermissions]) await expect(service.start(required(worktrees[0]), { managementContext: context })).rejects.toThrow("capture MCP scoped runtime");
    const managed = [first, second, changedPermissions].map((context) => {
      const directory = mcpOAuthStorageDirectory(projectSettingsScopeDirectory(data, projectA, "management"), eventScopeFromManagementContext(context));
      return { directory, configAgentDir: directory };
    });
    expect(captureScope.mock.calls.slice(3).map(([scope]) => scope)).toEqual(managed);
    expect(new Set([normal, ...managed.map(({ directory }) => directory)]).size).toBe(4);
    expect(JSON.stringify(managed)).not.toContain("different-account");
    await expect(service.start(required(worktrees[0]), { managementContext: testManagementContext() })).rejects.toThrow("capture MCP scoped runtime");
    expect(captureScope).toHaveBeenCalledTimes(6);
    expect(captureServices.mock.calls.at(-1)?.[0].resourceLoaderOptions?.extensionFactories).toEqual([]);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test value");
  return value;
}
