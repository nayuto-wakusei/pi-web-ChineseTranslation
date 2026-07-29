import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket, type RawData } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes";
import { NORMAL_AUTH_COOKIE, NormalModeAuthService, registerNormalAuthRoutes, registerNormalModeAuthGate } from "./normalAuth";

let app: FastifyInstance;
let piWebConfig: PiWebConfigValues;
let nowMs: number;

beforeEach(async () => {
  piWebConfig = {};
  nowMs = 0;
  await initializeApp();
});

async function initializeApp(rateLimit = { maxFailures: 2, windowMs: 5_000, maxTrackedAddresses: 100 }): Promise<void> {
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
  registerNormalModeAuthGate(app, auth, undefined, loginAttempts);
  app.get("/api/protected", () => ({ ok: true }));
  app.get("/api/test-socket", { websocket: true }, (socket) => {
    socket.send("ready");
  });
}

afterEach(async () => {
  await app.close();
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
