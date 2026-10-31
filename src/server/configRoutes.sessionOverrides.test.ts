import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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


it("exposes machine archive destinations and preserves them during unrelated patches", async () => {
  const sessionArchive = { directory: "external-archives" };
  const saved = await app.inject({ method: "PUT", url: "/api/config", payload: { config: { sessionArchive } } });
  expect(saved.statusCode).toBe(200);
  expect(parsePiWebConfigResponseBody(saved.json()).config.sessionArchive).toEqual(sessionArchive);
  const read = await app.inject("/api/machines/local/config");
  expect(read.json<PiWebConfigResponse>().config.sessionArchive).toEqual(sessionArchive);
  expect(read.json<PiWebConfigResponse>().effectiveConfig.sessionArchive).toEqual(sessionArchive);
  const write = await app.inject({ method: "PATCH", url: "/api/machines/local/config", payload: { set: { spawnSessions: false } } });
  expect(write.statusCode).toBe(200);
  expect(savedConfig.sessionArchive).toEqual(sessionArchive);
  vi.mocked(service.write).mockClear();
  const updated = await app.inject({ method: "PATCH", url: "/api/machines/local/config", payload: { set: { sessionArchive: { directory: "machine-archives" } } } });
  expect(updated.statusCode).toBe(200);
  expect(savedConfig.sessionArchive).toEqual({ directory: "machine-archives" });
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
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, sessionMessages: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
