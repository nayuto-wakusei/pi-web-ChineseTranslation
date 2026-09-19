import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket, type RawData } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes";
import { NORMAL_AUTH_COOKIE, NormalModeAuthService, registerNormalAuthRoutes, registerNormalModeAuthGate } from "./normalAuth";
import type { ManagementEmbedRuntime } from "./managementEmbed";

let app: FastifyInstance;
let piWebConfig: PiWebConfigValues;
let nowMs: number;

beforeEach(async () => {
  piWebConfig = {};
  nowMs = 0;
  await initializeApp();
});

async function initializeApp(rateLimit = { maxFailures: 2, windowMs: 5_000, maxTrackedAddresses: 100 }, managementEmbed?: ManagementEmbedRuntime): Promise<void> {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const auth = new NormalModeAuthService({
    read: () => piWebConfigResponse(piWebConfig),
    write: (config) => {
      piWebConfig = config;
      return piWebConfigResponse(piWebConfig);
    },
  });
  const loginAttempts = registerNormalAuthRoutes(app, auth, { now: () => nowMs, rateLimit });
  registerNormalModeAuthGate(app, auth, managementEmbed, loginAttempts);
  app.get("/api/protected", () => ({ ok: true }));
  app.get("/api/test-socket", { websocket: true }, (socket) => {
    socket.send("ready");
  });
}

afterEach(async () => {
  await app.close();
});

describe("management auth route boundary", () => {
  it("never uses management credentials or a concurrent normal login to authorize global APIs", async () => {
    await app.close();
    await initializeApp(undefined, {
      enabled: true,
      projectRoot: process.cwd(),
      authenticate: () => Promise.resolve({ user: { id: "limited-user", rootUserId: "root", roles: [], permissions: [] }, projects: [] }),
    });
    app.get("/api/config", () => ({ secret: "normal configuration" }));
    app.get("/api/machines/remote/projects", () => ({ secret: "remote projects" }));
    app.get("/pi-web-plugins/manifest.json", () => ({ plugins: [] }));
    expect((await app.inject({ method: "GET", url: "/pi-web-plugins/manifest.json" })).statusCode).toBe(401);
    const setup = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    const cookie = authCookie(setup);
    for (const url of ["/api/config", "/api/machines/remote/projects", "/pi-web-plugins/manifest.json"]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `${url}?embed=management&token=launch-token`, headers: { cookie } })).statusCode).toBe(403);
    }
  });

  it("keeps scoped management routes available through both local aliases", async () => {
    await app.close();
    await initializeApp(undefined, {
      enabled: true,
      projectRoot: process.cwd(),
      authenticate: () => Promise.resolve({ user: { id: "limited-user", rootUserId: "root", roles: [], permissions: [] }, projects: [] }),
    });
    for (const prefix of ["/api", "/api/machines/local"]) {
      for (const path of ["/sessions", "/auth/api-key", "/auth/oauth/start", "/auth/oauth/flow-1/input", "/projects/p/workspaces/w/file", "/projects/p/workspaces/w/terminals", "/terminal-command-runs/run-1/cancel", "/status", "/activity"]) {
        app.post(`${prefix}${path}`, () => ({ ok: true }));
      }
    }
    for (const prefix of ["/api", "/api/machines/local"]) {
      for (const path of ["/sessions", "/auth/api-key", "/auth/oauth/start", "/auth/oauth/flow-1/input", "/projects/p/workspaces/w/file", "/projects/p/workspaces/w/terminals", "/terminal-command-runs/run-1/cancel", "/status", "/activity"]) {
        const response = await app.inject({ method: "POST", url: `${prefix}${path}?embed=management&token=launch-token`, payload: {} });
        expect(response.statusCode, `${prefix}${path}`).toBe(200);
      }
    }
  });
});

describe("normal mode auth websocket gate", () => {
  it("rejects ordinary mode websocket clients before setup", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/test-socket`);

    await expect(waitForOpen(socket)).rejects.toThrow("Unexpected server response: 401");
  });

  it("allows ordinary mode websocket clients with a login cookie", async () => {
    const setupResponse = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/test-socket`, { headers: { cookie: authCookie(setupResponse) } });
    const ready = nextMessage(socket);

    await waitForOpen(socket);
    await expect(ready).resolves.toBe("ready");
    socket.close();
  });

  it("allows ordinary mode websocket clients with the configured password as a bearer token", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/test-socket`, { headers: { authorization: "Bearer secret-pass" } });
    const ready = nextMessage(socket);

    await waitForOpen(socket);
    await expect(ready).resolves.toBe("ready");
    socket.close();
  });
});

function piWebConfigResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "test-config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

describe("normal mode login rate limit", () => {
  it("blocks an address after repeated failures and advertises when to retry", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await login("wrong-pass", "203.0.113.10");
      expect(response.statusCode).toBe(401);
    }

    nowMs = 1_000;
    const limited = await login("secret-pass", "203.0.113.10");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("4");
    expect(limited.json()).toEqual({ error: "Too many failed ordinary mode login attempts", retryAfterSeconds: 4 });

    nowMs = 5_000;
    const retried = await login("secret-pass", "203.0.113.10");
    expect(retried.statusCode).toBe(200);
    expect(authCookie(retried)).toContain(`${NORMAL_AUTH_COOKIE}=`);
  });

  it("clears prior failures after a successful login", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    expect((await login("wrong-pass", "203.0.113.11")).statusCode).toBe(401);
    expect((await login("secret-pass", "203.0.113.11")).statusCode).toBe(200);

    expect((await login("wrong-pass", "203.0.113.11")).statusCode).toBe(401);
    expect((await login("wrong-pass", "203.0.113.11")).statusCode).toBe(401);
    expect((await login("secret-pass", "203.0.113.11")).statusCode).toBe(429);
  });

  it("tracks failures independently per remote address", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    await login("wrong-pass", "203.0.113.12");
    await login("wrong-pass", "203.0.113.12");

    expect((await login("secret-pass", "203.0.113.12")).statusCode).toBe(429);
    expect((await login("secret-pass", "203.0.113.13")).statusCode).toBe(200);
  });

  it("shares failed-attempt limits with bearer-password authentication", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });

    expect((await login("wrong-pass", "203.0.113.16")).statusCode).toBe(401);
    expect((await protectedRequest("wrong-pass", "203.0.113.16")).statusCode).toBe(401);

    const limited = await protectedRequest("secret-pass", "203.0.113.16");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("5");

    nowMs = 5_000;
    expect((await protectedRequest("secret-pass", "203.0.113.16")).statusCode).toBe(200);
  });

  it("bounds tracked addresses by evicting the oldest entry", async () => {
    await app.close();
    await initializeApp({ maxFailures: 1, windowMs: 5_000, maxTrackedAddresses: 1 });
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });

    expect((await login("wrong-pass", "203.0.113.14")).statusCode).toBe(401);
    expect((await login("wrong-pass", "203.0.113.15")).statusCode).toBe(401);
    expect((await login("wrong-pass", "203.0.113.14")).statusCode).toBe(401);
  });
});

describe("credential revision", () => {
  it("returns retryable overload instead of unbounded verification work", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "valid" } });
    const responses = await Promise.all(Array.from({ length: 64 }, (_, i) => protectedRequest(`wrong-${String(i)}`, `192.0.2.${String(i + 1)}`)));
    expect(responses.every(r => r.statusCode === 401 || r.statusCode === 503)).toBe(true);
    const busy = responses.filter(r => r.statusCode === 503);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every(r => r.headers["retry-after"] === "1")).toBe(true);
    expect((await protectedRequest("valid", "198.51.100.1")).statusCode).toBe(200);
  });

  it("applies the same Bearer verification and revocation to WebSocket handshakes", async () => {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "socket-pass" } });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/test-socket`, { headers: { authorization: "Bearer socket-pass" } });
    await waitForOpen(socket);
    socket.terminate();
    await new Promise<void>((resolve) => { socket.once("close", () => { resolve(); }); });
    piWebConfig = {};
    const rejected = new WebSocket(`${serverUrl(app)}/api/test-socket`, { headers: { authorization: "Bearer socket-pass" } });
    await expect(waitForOpen(rejected)).rejects.toThrow("401");
    rejected.terminate();
  });

  it("revokes a warm Bearer cache after the password change API", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "old-pass" } });
    expect((await protectedRequest("old-pass", "127.0.0.1")).statusCode).toBe(200);
    const changed = await app.inject({ method: "POST", url: "/api/normal-auth/change-password", headers: { cookie: authCookie(setup) }, payload: { currentPassword: "old-pass", newPassword: "new-pass" } });
    expect(changed.statusCode).toBe(200);
    expect((await protectedRequest("old-pass", "127.0.0.1")).statusCode).toBe(401);
    expect((await protectedRequest("new-pass", "127.0.0.1")).statusCode).toBe(200);
  });

  it("invalidates cached Bearer and browser cookies after external password replacement", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "old-pass" } });
    const cookie = authCookie(setup);
    expect((await protectedRequest("old-pass", "127.0.0.1")).statusCode).toBe(200);
    const other = new NormalModeAuthService({ read: () => piWebConfigResponse({}), write: (config) => { piWebConfig = config; return piWebConfigResponse(config); } });
    await other.setup("new-pass");
    expect((await app.inject({ method: "GET", url: "/api/protected", headers: { cookie } })).statusCode).toBe(401);
    expect((await protectedRequest("old-pass", "127.0.0.1")).statusCode).toBe(401);
    expect((await protectedRequest("new-pass", "127.0.0.1")).statusCode).toBe(200);
    piWebConfig = {};
    expect((await protectedRequest("new-pass", "127.0.0.1")).statusCode).toBe(401);
  });

  it("rejects a successful old verification when configuration changes during its await", async () => {
    let reads = 0;
    const auth = new NormalModeAuthService({
      read: () => { reads++; return piWebConfigResponse(reads >= 2 ? {} : piWebConfig); },
      write: (config) => piWebConfigResponse(config),
    });
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "old-pass" } });
    expect(await auth.authorize(undefined, "Bearer old-pass")).toBe("login-required");
  });
});

function authCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = typeof header === "string" ? header : Array.isArray(header) && typeof header[0] === "string" ? header[0] : undefined;
  if (value === undefined) throw new Error("Expected auth cookie");
  return value.split(";")[0] ?? value;
}

async function login(password: string, remoteAddress: string) {
  return await app.inject({
    method: "POST",
    url: "/api/normal-auth/login",
    payload: { password },
    remoteAddress,
  });
}

async function protectedRequest(password: string, remoteAddress: string) {
  return await app.inject({
    method: "GET",
    url: "/api/protected",
    headers: { authorization: `Bearer ${password}` },
    remoteAddress,
  });
}

function serverUrl(instance: FastifyInstance): string {
  const address = instance.server.address();
  if (address === null || typeof address === "string") throw new Error("Server is not listening on a TCP port");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", () => { resolve(); });
    socket.once("error", (error) => { reject(error); });
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("message", (data: RawData) => { resolve(rawDataToString(data)); });
  });
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}
