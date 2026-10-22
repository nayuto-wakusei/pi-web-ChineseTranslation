import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { OAuthFlowState } from "../../shared/apiTypes.js";
import { afterEach, expect, it, vi } from "vitest";
import { FEDERATED_HTTP_ROUTES } from "../../shared/federatedRoutes.js";
import fastifyWebsocket from "@fastify/websocket";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { McpAuthFlowService } from "./mcpAuthFlowService.js";
import { registerMcpAuthRoutes } from "./mcpAuthRoutes.js";

const apps: FastifyInstance[] = [];
const services: McpAuthFlowService[] = [];
afterEach(async () => { for (const service of services.splice(0)) service.dispose(); await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture() {
  const app = Fastify(); apps.push(app);
  const flows = new McpAuthFlowService(); services.push(flows);
  const startMcpAuth = vi.fn((ref: { id: string; cwd: string }, mode: "login" | "logout", _serverName?: string, context?: ManagementEmbedContext) => Promise.resolve(flows.start({
    owner: { scope: eventScopeFromManagementContext(context), sessionId: ref.id, cwd: ref.cwd }, identity: {}, isCurrent: () => true,
    run: async () => { await required(McpAuthFlowService.current()).input(`Pi ${mode}`); },
  })));
  const mcpAuthServers = vi.fn(() => Promise.resolve({ servers: [{ name: "alpha", description: "verbatim" }] }));
  registerMcpAuthRoutes(app, {
    startMcpAuth, mcpAuthServers,
    mcpAuthFlow: (id, context) => Promise.resolve(flows.get(id, flows.owner(id, eventScopeFromManagementContext(context)))),
    respondToMcpAuthFlow: (id, requestId, value, context) => Promise.resolve(flows.respond(id, requestId, value, flows.owner(id, eventScopeFromManagementContext(context)))),
    cancelMcpAuthFlow: (id, context) => Promise.resolve(flows.cancel(id, flows.owner(id, eventScopeFromManagementContext(context)))),
  }, "/api");
  return { app, flows, startMcpAuth, mcpAuthServers };
}

it("wires session start, poll, response and cancel through the machine-owned MCP transport", async () => {
  const { app, flows, startMcpAuth } = fixture();
  const response = await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", payload: { cwd: "/workspace", mode: "login" } });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  const flow = response.json<OAuthFlowState>();
  expect(flow).toMatchObject({ target: "mcp", providerId: "mcp", status: "running", prompt: { message: "Pi login" } });
  expect(startMcpAuth).toHaveBeenCalledWith({ id: "session-1", cwd: resolve("/workspace") }, "login", undefined, undefined);
  const poll = await app.inject(`/api/auth/mcp/${flow.flowId}`);
  expect(poll.headers["cache-control"]).toBe("no-store");
  expect(poll.json()).toEqual(flow);
  const answer = await app.inject({ method: "POST", url: `/api/auth/mcp/${flow.flowId}/respond`, payload: { requestId: required(flow.prompt).requestId, value: "redirect" } });
  expect(answer.statusCode).toBe(200);
  await vi.waitFor(() => { expect(flows.get(flow.flowId, flows.owner(flow.flowId, "normal")).status).toBe("complete"); });
  const logout = await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", payload: { cwd: "/workspace", mode: "logout" } });
  const cancel = await app.inject({ method: "POST", url: `/api/auth/mcp/${logout.json<OAuthFlowState>().flowId}/cancel` });
  expect(cancel.json()).toMatchObject({ status: "running", cancelRequested: true });
  expect((await app.inject("/api/auth/mcp/unknown")).statusCode).toBe(404);
  expect((await app.inject({ method: "POST", url: "/api/auth/mcp/unknown/respond", payload: { requestId: "old", value: "x" } })).statusCode).toBe(400);
});

it.each([
  {}, { cwd: "", mode: "login" }, { cwd: "/workspace", mode: "arbitrary" },
  { cwd: "/workspace", mode: "login", url: "https://untrusted.test" },
  { cwd: "/workspace", mode: "login", config: {} },
])("rejects invalid starts and client-supplied configuration: %j", async (payload) => {
  const { app, startMcpAuth } = fixture();
  expect((await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", payload })).statusCode).toBe(400);
  expect(startMcpAuth).not.toHaveBeenCalled();
});

it("allowlists all MCP flow routes for federation", () => {
  for (const route of [
    { method: "GET", path: "/sessions/:sessionId/mcp/auth/servers" },
    { method: "POST", path: "/sessions/:sessionId/mcp/auth" },
    { method: "GET", path: "/auth/mcp/:flowId" },
    { method: "POST", path: "/auth/mcp/:flowId/respond" },
    { method: "POST", path: "/auth/mcp/:flowId/cancel" },
  ]) expect(FEDERATED_HTTP_ROUTES).toContainEqual(route);
});

it("passes explicit targets and list workspace through federation-compatible routes", async () => {
  const { app, startMcpAuth, mcpAuthServers } = fixture();
  const list = await app.inject("/api/sessions/session-1/mcp/auth/servers?cwd=%2Fworkspace");
  expect(list.statusCode).toBe(200);
  expect(list.headers["cache-control"]).toBe("no-store");
  expect(list.json()).toEqual({ servers: [{ name: "alpha", description: "verbatim" }] });
  expect(mcpAuthServers).toHaveBeenCalledWith({ id: "session-1", cwd: resolve("/workspace") }, undefined);
  expect((await app.inject("/api/sessions/session-1/mcp/auth/servers")).statusCode).toBe(400);
  const auth = await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", payload: { cwd: "/workspace", mode: "logout", serverName: "alpha" } });
  expect(auth.statusCode).toBe(200);
  expect(startMcpAuth).toHaveBeenCalledWith({ id: "session-1", cwd: resolve("/workspace") }, "logout", "alpha", undefined);
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}

it.each(["/api", "/api/machines/local"])("preserves authenticated management flow scope through the Web proxy at %s", async (prefix) => {
  const { app: daemon, flows, startMcpAuth, mcpAuthServers } = fixture();
  const web = Fastify({ logger: false }); apps.push(web);
  await web.register(fastifyWebsocket);
  const cwd = process.cwd();
  const context: ManagementEmbedContext = {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
    projects: [{ id: "p1", name: "Project", root: cwd }],
  };
  registerSessionProxyRoutes(web, {
    request: async (method, path, body, headers) => {
      if (method !== "GET" && method !== "POST") throw new Error("Unexpected MCP request method");
      const response = await daemon.inject({
        method, url: `/api${path}`,
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      });
      return { statusCode: response.statusCode, headers: { "content-type": String(response.headers["content-type"]) }, body: response.body };
    },
    requestStream: () => Promise.reject(new Error("No binary request expected")),
    connectWebSocket: () => { throw new Error("No WebSocket expected"); },
  }, prefix, {
    enabled: true, projectRoot: cwd,
    authenticate: () => Promise.resolve(context),
  }, () => Promise.resolve([cwd]));
  const transport = "embed=management&token=local-fixture-token";
  const list = await web.inject(`${prefix}/sessions/session-1/mcp/auth/servers?cwd=${encodeURIComponent(cwd)}&${transport}`);
  expect(list.statusCode).toBe(200);
  expect(mcpAuthServers).toHaveBeenCalledWith({ id: "session-1", cwd }, context);
  const start = await web.inject({ method: "POST", url: `${prefix}/sessions/session-1/mcp/auth?${transport}`, payload: { cwd, mode: "login" } });
  expect(start.statusCode).toBe(200);
  expect(start.headers["cache-control"]).toBe("no-store");
  expect(startMcpAuth).toHaveBeenCalledWith({ id: "session-1", cwd }, "login", undefined, context);
  const flow = start.json<OAuthFlowState>();
  const scope = eventScopeFromManagementContext(context);
  expect(flows.owner(flow.flowId, scope).scope).toBe(scope);
  const poll = await web.inject(`${prefix}/auth/mcp/${flow.flowId}?${transport}`);
  expect(poll.headers["cache-control"]).toBe("no-store");
  expect(poll.json()).toEqual(flow);
  const respond = await web.inject({ method: "POST", url: `${prefix}/auth/mcp/${flow.flowId}/respond?${transport}`, payload: { requestId: required(flow.prompt).requestId, value: "local-fixture-redirect" } });
  expect(respond.statusCode).toBe(200);
  expect(respond.headers["cache-control"]).toBe("no-store");
  await vi.waitFor(() => { expect(flows.get(flow.flowId, flows.owner(flow.flowId, scope)).status).toBe("complete"); });
  const next = await web.inject({ method: "POST", url: `${prefix}/sessions/session-1/mcp/auth?${transport}`, payload: { cwd, mode: "logout" } });
  const nextFlow = next.json<OAuthFlowState>();
  const cancel = await web.inject({ method: "POST", url: `${prefix}/auth/mcp/${nextFlow.flowId}/cancel?${transport}` });
  expect(cancel.statusCode).toBe(200);
  expect(cancel.headers["cache-control"]).toBe("no-store");
  expect(cancel.json()).toMatchObject({ status: "running", cancelRequested: true });
  const unauthorized = await daemon.inject(`/api/auth/mcp/${nextFlow.flowId}?${transport}`);
  expect(unauthorized.statusCode).toBe(404);
  expect(unauthorized.headers["cache-control"]).toBe("no-store");
});

it("does not accept query ownership, malformed management context or another management identity", async () => {
  const { app, startMcpAuth } = fixture();
  const context: ManagementEmbedContext = {
    user: { id: "user-a", rootUserId: "root", roles: [], permissions: [] }, projects: [],
  };
  const headers = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
  const start = await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", headers, payload: { cwd: process.cwd(), mode: "login" } });
  const flow = start.json<OAuthFlowState>();
  const other = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext({ ...context, user: { ...context.user, id: "user-b" } }) };
  expect((await app.inject({ url: `/api/auth/mcp/${flow.flowId}`, headers: other })).statusCode).toBe(404);
  expect((await app.inject({ method: "POST", url: `/api/auth/mcp/${flow.flowId}/respond`, headers: other, payload: { requestId: required(flow.prompt).requestId, value: "stolen-redirect" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: `/api/auth/mcp/${flow.flowId}/cancel`, headers: other })).statusCode).toBe(400);
  expect((await app.inject(`/api/auth/mcp/${flow.flowId}?scope=${encodeURIComponent(eventScopeFromManagementContext(context))}`)).statusCode).toBe(404);
  expect((await app.inject({ method: "POST", url: "/api/sessions/session-1/mcp/auth", headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: "invalid" }, payload: { cwd: process.cwd(), mode: "login" } })).statusCode).toBe(400);
  expect(startMcpAuth).toHaveBeenCalledTimes(1);
});

it("rejects unexpected query and cancellation body fields while accepting inert embed transport", async () => {
  const { app, startMcpAuth, mcpAuthServers } = fixture();
  expect((await app.inject("/api/sessions/s/mcp/auth/servers?cwd=%2Fworkspace&scope=forged")).statusCode).toBe(400);
  expect(mcpAuthServers).not.toHaveBeenCalled();
  expect((await app.inject({ method: "POST", url: "/api/sessions/s/mcp/auth?projectPath=forged", payload: { cwd: "/workspace", mode: "login" } })).statusCode).toBe(400);
  expect(startMcpAuth).not.toHaveBeenCalled();
  const start = await app.inject({ method: "POST", url: "/api/sessions/s/mcp/auth?embed=management&token=inert", payload: { cwd: "/workspace", mode: "login" } });
  const flow = start.json<OAuthFlowState>();
  expect((await app.inject(`/api/auth/mcp/${flow.flowId}?embed=management&token=inert`)).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `/api/auth/mcp/${flow.flowId}/cancel`, payload: { scope: "forged" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: `/api/auth/mcp/${flow.flowId}/respond?cwd=%2Fother`, payload: { requestId: required(flow.prompt).requestId, value: "redirect" } })).statusCode).toBe(400);
});
