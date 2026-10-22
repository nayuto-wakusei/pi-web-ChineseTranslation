import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePiWebConfigResponseBody, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";

let app: FastifyInstance;
let savedConfig: PiWebConfigValues;
let service: PiWebConfigService;
beforeEach(async () => {
  savedConfig = { host: "127.0.0.1", port: 8504, allowedHosts: [] };
  service = {
    read: vi.fn(() => responseFor(savedConfig, true)),
    write: vi.fn((config: PiWebConfigValues) => {
      savedConfig = config;
      return responseFor(savedConfig, true);
    }),
  };
  app = Fastify({ logger: false });
  registerConfigRoutes(app, service);
  registerLocalMachineConfigRoutes(app, service);
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe("session override config routes", () => {
  it.each(["/api/config", "/api/machines/local/config"])("saves and resets session naming through %s", async (url) => {
    const sessionNaming = { model: "provider/org/model", maxTokens: 64, thinkingLevel: "off" as const, timeoutMs: 2147483647 };
    const saved = await app.inject({ method: "PUT", url, payload: { config: { sessionNaming } } });
    expect(saved.statusCode).toBe(200);
    expect(parsePiWebConfigResponseBody(saved.json()).config.sessionNaming).toEqual(sessionNaming);
    expect(parsePiWebConfigResponseBody(saved.json()).effectiveConfig.sessionNaming).toEqual(sessionNaming);
    const reset = await app.inject({ method: "PUT", url, payload: { config: { sessionNaming: {} } } });
    expect(reset.statusCode).toBe(200);
    expect(savedConfig.sessionNaming).toEqual({});
  });

  it("preserves session naming on unrelated selected-machine saves", async () => {
    const sessionNaming = { model: "provider/model", maxTokens: 48, thinkingLevel: "high" as const, timeoutMs: 15000 };
    savedConfig.sessionNaming = sessionNaming;
    const response = await app.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { spawnSessions: false } } });
    expect(response.statusCode).toBe(200);
    expect(response.json<PiWebConfigResponse>().config.sessionNaming).toEqual(sessionNaming);
    expect(savedConfig.sessionNaming).toEqual(sessionNaming);
  });

  it.each(["/api/config", "/api/machines/local/config"])("validates session naming before writing through %s", async (url) => {
    const response = await app.inject({ method: "PUT", url, payload: { config: { sessionNaming: { maxTokens: 0 } } } });
    expect(response.statusCode).toBe(400);
    expect(service.write).not.toHaveBeenCalled();
  });

  it.each(["", "ultra", null, false, 42, {}, []])("rejects invalid naming thinking level %j before writing and in remote responses", async (thinkingLevel) => {
    const config = { sessionNaming: { thinkingLevel } };
    for (const url of ["/api/config", "/api/machines/local/config"]) {
      const result = await app.inject({ method: "PUT", url, payload: { config } });
      expect(result.statusCode).toBe(400);
      expect(result.json<{ error: string }>().error).toContain("sessionNaming.thinkingLevel");
    }
    expect(service.write).not.toHaveBeenCalled();
    const response = responseFor({}, true);
    for (const field of ["config", "effectiveConfig"]) {
      expect(() => parsePiWebConfigResponseBody({ ...response, [field]: config })).toThrow("sessionNaming.thinkingLevel");
    }
  });

  it.each([0, -1, 1.5, 2147483648, "10000", null, false, {}, []])("rejects invalid naming timeout %j before writing and in remote responses", async (timeoutMs) => {
    const config = { sessionNaming: { timeoutMs } };
    for (const url of ["/api/config", "/api/machines/local/config"]) {
      const result = await app.inject({ method: "PUT", url, payload: { config } });
      expect(result.statusCode).toBe(400);
      expect(result.json<{ error: string }>().error).toContain("sessionNaming.timeoutMs");
    }
    expect(service.write).not.toHaveBeenCalled();
    const response = responseFor({}, true);
    for (const field of ["config", "effectiveConfig"]) {
      expect(() => parsePiWebConfigResponseBody({ ...response, [field]: config })).toThrow("sessionNaming.timeoutMs");
    }
  });

  it("rejects invalid session naming in remote config responses", () => {
    const response = responseFor({}, true);
    for (const field of ["config", "effectiveConfig"]) {
      expect(() => parsePiWebConfigResponseBody({ ...response, [field]: { sessionNaming: { model: "/missing" } } })).toThrow("sessionNaming.model");
    }
  });


});

it("keeps archive destinations global while unrelated selected-machine writes preserve them", async () => {
  const sessionArchive = { directory: "external-archives" };
  const saved = await app.inject({ method: "PUT", url: "/api/config", payload: { config: { sessionArchive } } });
  expect(saved.statusCode).toBe(200);
  expect(parsePiWebConfigResponseBody(saved.json()).config.sessionArchive).toEqual(sessionArchive);
  const read = await app.inject("/api/machines/local/config");
  expect(read.json<PiWebConfigResponse>().config).not.toHaveProperty("sessionArchive");
  expect(read.json<PiWebConfigResponse>().effectiveConfig).not.toHaveProperty("sessionArchive");
  const write = await app.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { spawnSessions: false } } });
  expect(write.statusCode).toBe(200);
  expect(savedConfig.sessionArchive).toEqual(sessionArchive);
  vi.mocked(service.write).mockClear();
  const rejected = await app.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { sessionArchive: { directory: "forged" } } } });
  expect(rejected.statusCode).toBe(400);
  expect(service.write).not.toHaveBeenCalled();
  expect(savedConfig.sessionArchive).toEqual(sessionArchive);
});

it.each([null, [], { directory: "" }, { directory: "a\u0000b" }, { unknown: true }])("rejects invalid archive destinations %j before global writes or remote reads", async (sessionArchive) => {
  const config = { sessionArchive };
  expect((await app.inject({ method: "PUT", url: "/api/config", payload: { config } })).statusCode).toBe(400);
  expect(service.write).not.toHaveBeenCalled();
  const response = responseFor({}, true);
  for (const field of ["config", "effectiveConfig"]) expect(() => parsePiWebConfigResponseBody({ ...response, [field]: config })).toThrow("sessionArchive");
});

function responseFor(config: PiWebConfigValues, exists: boolean): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json", exists, config, effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
