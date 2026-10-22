import { parsePiWebConfigResponse as parsePiWebConfigResponseBody } from "../client/src/api/parsers.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";

let app: FastifyInstance;
let savedConfig: PiWebConfigValues;
let service: PiWebConfigService;
beforeEach(async () => {
  savedConfig = { host: "127.0.0.1", port: 8504, allowedHosts: [] };
  service = {
    read: vi.fn(() => responseFor(savedConfig)),
    write: vi.fn((config: PiWebConfigValues) => { savedConfig = config; return responseFor(config); }),
  };
  app = Fastify({ logger: false });
  registerConfigRoutes(app, service);
  registerLocalMachineConfigRoutes(app, service);
  await app.ready();
});
afterEach(async () => { await app.close(); });
function responseFor(config: PiWebConfigValues): PiWebConfigResponse {
  return { path: "/tmp/config.json", exists: true, config, effectiveConfig: config, envOverrides: {
    host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false,
  } };
}

it.each(["steer", "followUp"] as const)("accepts defaultStreamingBehavior %s through config routes and response parsing", async (defaultStreamingBehavior) => {
    const config = { defaultStreamingBehavior };
    const response = await app.inject({ method: "PUT", url: "/api/config", payload: { config } });
    expect(response.statusCode).toBe(200);
    expect(savedConfig).toEqual(config);
    expect(parsePiWebConfigResponseBody(response.json())).toMatchObject({ config, effectiveConfig: config });
  });

it.each(["", "followup", "queue", null, false, 42, {}, []])("rejects invalid defaultStreamingBehavior %j before writing and in responses", async (defaultStreamingBehavior) => {
    const config = { defaultStreamingBehavior };
    const response = await app.inject({ method: "PUT", url: "/api/config", payload: { config } });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("defaultStreamingBehavior");
    expect(service.write).not.toHaveBeenCalled();
    const valid = responseFor({});
    for (const field of ["config", "effectiveConfig"]) {
      expect(() => parsePiWebConfigResponseBody({ ...valid, [field]: config })).toThrow("defaultStreamingBehavior");
    }
  });

it("keeps defaultStreamingBehavior gateway-only", async () => {
    savedConfig.defaultStreamingBehavior = "steer";
    const read = await app.inject({ method: "GET", url: "/api/machines/local/config" });
    expect(read.json<PiWebConfigResponse>().config).not.toHaveProperty("defaultStreamingBehavior");
    expect(read.json<PiWebConfigResponse>().effectiveConfig).not.toHaveProperty("defaultStreamingBehavior");
    const write = await app.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { defaultStreamingBehavior: "followUp" } } });
    expect(write.statusCode).toBe(400);
    expect(service.write).not.toHaveBeenCalled();
    expect(savedConfig.defaultStreamingBehavior).toBe("steer");
  });
