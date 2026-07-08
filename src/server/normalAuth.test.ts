import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket, type RawData } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes";
import { NormalModeAuthService, registerNormalAuthRoutes, registerNormalModeAuthGate } from "./normalAuth";

let app: FastifyInstance;
let piWebConfig: PiWebConfigValues;

beforeEach(async () => {
  piWebConfig = {};
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const auth = new NormalModeAuthService({
    read: () => piWebConfigResponse(piWebConfig),
    write: (config) => {
      piWebConfig = config;
      return piWebConfigResponse(piWebConfig);
    },
  });
  registerNormalAuthRoutes(app, auth);
  registerNormalModeAuthGate(app, auth, undefined);
  app.get("/api/test-socket", { websocket: true }, (socket) => {
    socket.send("ready");
  });
});

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
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false },
  };
}

function authCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = typeof header === "string" ? header : Array.isArray(header) && typeof header[0] === "string" ? header[0] : undefined;
  if (value === undefined) throw new Error("Expected auth cookie");
  return value.split(";")[0] ?? value;
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
