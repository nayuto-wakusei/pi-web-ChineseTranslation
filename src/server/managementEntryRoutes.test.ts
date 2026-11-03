import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createManagementEmbedRuntime, managementContextForRequest, managementHeaders, decodeManagementContext, type ManagementEmbedContext } from "./managementEmbed.js";
import { registerManagementEntryRoutes } from "./managementEntryRoutes.js";
import { ManagementEntryTickets } from "./managementEntryTickets.js";
import { NormalModeAuthService, registerNormalModeAuthGate } from "./normalAuth.js";
import { requestLoggerOptions } from "./requestLogging.js";
import { SESSIOND_MAX_HEADER_SIZE } from "./managementTransportLimits.js";
import type { ManagementEntryTicketResponse } from "../shared/apiTypes.js";

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const context: ManagementEmbedContext = {
  user: { id: "alice", rootUserId: "root", roles: [], permissions: [] },
  projects: [{ id: "p1", name: "Project", agentsInstructions: "long signed instructions\n".repeat(4000) }],
  privileged: { bash: true, network: true },
};

function signedToken(value = context, exp = Math.floor(Date.now() / 1000) + 300): string {
  const payload = Buffer.from(JSON.stringify({ ...value, iss: "telecom-portal", aud: "dify-external-portal", iat: Math.floor(Date.now() / 1000), exp, jti: "test" })).toString("base64url");
  return `${payload}.${createHmac("sha256", "test-secret").update(payload).digest("base64url")}`;
}

function fixture(enabled = true, tickets = new ManagementEntryTickets()) {
  const logs: string[] = [];
  const app = Fastify({ logger: requestLoggerOptions({ write: (line) => { logs.push(line); } }) });
  apps.push(app);
  const runtime = createManagementEmbedRuntime({ enabled }, { PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN: "test-secret" });
  // The real auth gate must allow ticket exchange without a normal-mode login.
  const config = {
    path: "/unused", exists: false, config: {}, effectiveConfig: {},
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, sessionMessages: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
  const auth = new NormalModeAuthService({ read: () => config, write: () => config });
  registerNormalModeAuthGate(app, auth, runtime);
  registerManagementEntryRoutes(app, runtime, undefined, tickets);
  app.get("/api/projects", async (request, reply) => managementContextForRequest(request, runtime, reply));
  return { app, runtime, logs };
}

describe("short management entry", () => {
  it("exchanges a long signed token, consumes once, and keeps context and credentials scoped", async () => {
    const { app, logs } = fixture();
    const token = signedToken();
    const minted = await app.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token } });
    expect(minted.statusCode).toBe(201);
    expect(minted.headers["set-cookie"]).toBeUndefined();
    expect(minted.headers["cache-control"]).toBe("no-store");
    const { entryPath } = minted.json<ManagementEntryTicketResponse>();
    expect(entryPath.length).toBeLessThan(100);
    const redemption = await app.inject({ url: `/${entryPath}`, headers: { "x-forwarded-proto": "https" } });
    expect(redemption.statusCode).toBe(303);
    expect(redemption.headers.location).toBe("./?embed=management");
    expect(new URL(String(redemption.headers.location), `https://example.test/pi-web/${entryPath}`).pathname).toBe("/pi-web/");
    expect(redemption.headers["referrer-policy"]).toBe("no-referrer");
    const cookieHeader = String(redemption.headers["set-cookie"]);
    expect(cookieHeader).toContain("HttpOnly; Secure; SameSite=None");
    const cookie = cookieHeader.split(";")[0] ?? "";
    expect((await app.inject(`/${entryPath}`)).statusCode).toBe(401);
    const authorized = await app.inject({ url: "/api/projects?embed=management", headers: { cookie } });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject(context);
    expect((await app.inject({ url: "/api/projects", headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/management-entry-tickets", headers: { cookie }, payload: {} })).statusCode).toBe(400);
    expect(logs.join("")).not.toContain(token);
    expect(logs.join("")).not.toContain(entryPath.split("ticket=")[1]);
  });

  it("rejects invalid signatures and expired tokens regardless of cookies", async () => {
    const { app } = fixture();
    for (const token of [signedToken() + "x", signedToken(context, Math.floor(Date.now() / 1000) - 1)]) {
      const response = await app.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token }, headers: { cookie: "pi_web_management_session=old" } });
      expect(response.statusCode).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect((await app.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token: "x".repeat(1024 * 1024) } })).statusCode).toBe(413);
  });

  it("fails closed when disabled and keeps legacy signed entry working", async () => {
    const disabled = fixture(false).app;
    expect((await disabled.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token: signedToken() } })).statusCode).toBe(503);
    const { app } = fixture();
    expect((await app.inject(`/api/projects?embed=management&token=${signedToken()}`)).statusCode).toBe(200);
  });

  it("does not consume on HEAD and permits only one concurrent redemption", async () => {
    const { app } = fixture();
    const minted = await app.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token: signedToken() } });
    const url = `/${minted.json<ManagementEntryTicketResponse>().entryPath}`;
    await app.inject({ method: "HEAD", url });
    const first = app.inject(url);
    const second = app.inject(url);
    expect([(await first).statusCode, (await second).statusCode].sort()).toEqual([303, 401]);
  });

  it("consumes failed preparations without creating a session or falling back to an old cookie", async () => {
    const { app, runtime } = fixture();
    if (runtime === undefined) throw new Error("Expected management runtime");
    runtime.prepareContext = () => Promise.reject(new Error("upstream unavailable"));
    const minted = await app.inject({ method: "POST", url: "/api/management-entry-tickets", payload: { token: signedToken() } });
    const url = `/${minted.json<ManagementEntryTicketResponse>().entryPath}`;
    const failed = await app.inject({ url, headers: { cookie: "pi_web_management_session=old" } });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers["set-cookie"]).toBeUndefined();
    expect((await app.inject(url)).statusCode).toBe(401);
  });

  it("forwards long instructions over a real HTTP daemon connection", async () => {
    const daemon = Fastify({ http: { maxHeaderSize: SESSIOND_MAX_HEADER_SIZE } });
    apps.push(daemon);
    daemon.get("/context", (request) => decodeManagementContext(String(request.headers["x-pi-web-management-context"])));
    const address = await daemon.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/context`, { headers: managementHeaders(context, undefined) ?? {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
  });
});

describe("entry ticket lifetime and capacity", () => {
  it("expires at the earlier of 60 seconds and signed expiry; capacity is reclaimed", () => {
    let now = 0;
    const tickets = new ManagementEntryTickets(() => now);
    const short = tickets.create({ ...context, expiresAt: new Date(1000).toISOString() });
    const normal = tickets.create(context);
    if (short === undefined || normal === undefined) throw new Error("Expected tickets");
    now = 1000;
    expect(tickets.take(short.ticket)).toBeUndefined();
    now = 60_000;
    expect(tickets.take(normal.ticket)).toBeUndefined();
    const small = { ...context, projects: [] };
    for (let i = 0; i < 256; i++) expect(tickets.create(small)).toBeDefined();
    expect(tickets.create(small)).toBeUndefined();
    tickets.clear();
    expect(tickets.create(small)).toBeDefined();
    tickets.clear();
    const large = { ...context, projects: [{ id: "p1", name: "Project", agentsInstructions: "a".repeat(1024 * 1024) }] };
    for (let i = 0; i < 7; i++) expect(tickets.create(large)).toBeDefined();
    expect(tickets.create(large)).toBeUndefined();
    now += 60_000;
    expect(tickets.create(large)).toBeDefined();
  });
});
