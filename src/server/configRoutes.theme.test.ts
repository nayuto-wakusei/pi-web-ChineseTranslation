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

it("rejects malformed theme defaults before writing", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/config", payload: { config: { defaultTheme: { themeId: "themes:pi-web-dark", auto: "yes" } } } });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("defaultTheme");
    expect(service.write).not.toHaveBeenCalled();
  });

it("keeps theme defaults gateway-only in selected-machine reads and writes", async () => {
    savedConfig.defaultTheme = { themeId: "themes:pi-web-light", auto: true };
    const read = await app.inject({ method: "GET", url: "/api/machines/local/config" });
    expect(read.json<PiWebConfigResponse>().config).not.toHaveProperty("defaultTheme");
    const write = await app.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { defaultTheme: { themeId: "themes:classic", auto: false } } } });
    expect(write.statusCode).toBe(400);
    expect(service.write).not.toHaveBeenCalled();
    expect(savedConfig.defaultTheme.themeId).toBe("themes:pi-web-light");
  });
