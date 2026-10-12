import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { registerManagementTerminalProxyRoutes } from "./managementTerminalProxyRoutes.js";

let app: FastifyInstance;
let root: string;
let context: ManagementEmbedContext;
let response: unknown;
let daemonRequest: ReturnType<typeof vi.fn<SessionProxyDaemon["request"]>>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-managed-terminal-proxy-"));
  app = Fastify({ logger: false });
  context = { user: { id: "user", rootUserId: "owner", roles: [], permissions: [] }, projects: [{ id: "managed", name: "Managed" }], tools: { allow: ["terminal-command-runs"] } };
  response = { id: "run", projectId: "managed", status: "running" };
  daemonRequest = vi.fn<SessionProxyDaemon["request"]>(() => Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(response) }));
  const daemon: SessionProxyDaemon = { request: daemonRequest, connectWebSocket: () => { throw new Error("Interactive terminal must not be opened"); } };
  const runtime: ManagementEmbedRuntime = { enabled: true, projectRoot: root, authenticate: () => Promise.resolve(context), resourceHandle: () => "private-handle" };
  const workspaces = { list: (project: { id: string; path: string }) => Promise.resolve([{ id: "workspace", projectId: project.id, path: project.path, label: "Main", isMain: true }]) };
  registerManagementTerminalProxyRoutes(app, workspaces, daemon, "/api", runtime);
  registerManagementTerminalProxyRoutes(app, workspaces, daemon, "/api/machines/local", runtime);
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const query = "?embed=management&token=test-entry";

describe("management terminal gateway", () => {
  it("forwards all controlled endpoints with captured context, access handle and cancellation", async () => {
    const created = await app.inject({ method: "POST", url: `/api/machines/local/projects/managed/workspaces/workspace/terminal-command-runs${query}`, payload: { origin: "task", title: "Test", command: "true" } });
    expect(created.statusCode).toBe(200);
    expect(daemonRequest.mock.calls[0]?.slice(0, 3)).toEqual(["POST", "/terminal-command-runs", { origin: "task", projectId: "managed", workspaceId: "workspace", cwd: join(root, "owner", "managed"), title: "Test", command: "true", metadata: {} }]);
    const detail = await app.inject({ method: "GET", url: `/api/terminal-command-runs/run${query}` });
    expect(detail.statusCode).toBe(200);
    response = [response, { id: "foreign", projectId: "other" }];
    const listed = await app.inject({ method: "GET", url: `/api/terminal-command-runs${query}&statuses=running&metadata=${encodeURIComponent(JSON.stringify({ task: "build" }))}` });
    expect(listed.json()).toEqual([{ id: "run", projectId: "managed", status: "running" }]);
    const cancelled = await app.inject({ method: "POST", url: `/api/terminal-command-runs/run/cancel${query}` });
    expect(cancelled.statusCode).toBe(200);
    expect(daemonRequest.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ["POST", "/terminal-command-runs"], ["GET", "/terminal-command-runs/run"],
      ["GET", `/terminal-command-runs?statuses=running&metadata=${encodeURIComponent(JSON.stringify({ task: "build" }))}`], ["POST", "/terminal-command-runs/run/cancel"],
    ]);
    for (const call of daemonRequest.mock.calls) {
      expect(decodeManagementContext(call[3]?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
      expect(call[3]?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe("private-handle");
      expect(call[4]).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps ordinary tombstones and management interactive denial without daemon fallback", async () => {
    for (const prefix of ["/api", "/api/machines/local"]) {
      expect((await app.inject({ method: "GET", url: `${prefix}/terminal-command-runs` })).statusCode).toBe(410);
      expect((await app.inject({ method: "GET", url: `${prefix}/projects/managed/workspaces/workspace/terminals` })).statusCode).toBe(410);
      expect((await app.inject({ method: "POST", url: `${prefix}/projects/managed/workspaces/workspace/terminals/terminal/continue${query}` })).statusCode).toBe(403);
    }
    expect(daemonRequest).not.toHaveBeenCalled();
  });

  it("honors explicit denies even with an allow entry and hides foreign command run details", async () => {
    response = { id: "foreign", projectId: "other" };
    expect((await app.inject({ method: "GET", url: `/api/terminal-command-runs/foreign${query}` })).statusCode).toBe(404);
    context = { ...context, tools: { allow: ["terminal-command-runs"], deny: ["terminal-command-runs"] } };
    daemonRequest.mockClear();
    for (const endpoint of ["/terminal-command-runs", "/terminal-command-runs/run"]) {
      expect((await app.inject({ method: "GET", url: `/api${endpoint}${query}` })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: `/api/terminal-command-runs/run/cancel${query}` })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/projects/managed/workspaces/workspace/terminal-command-runs${query}`, payload: { origin: "task", title: "Test", command: "true" } })).statusCode).toBe(403);
    expect(daemonRequest).not.toHaveBeenCalled();
  });
});
