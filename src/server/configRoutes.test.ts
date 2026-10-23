import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePiWebConfigResponseBody, parseSelectedMachineConfigRequest, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import { createTranslator } from "../shared/i18n.js";
import configMessages from "../../pi-web-plugins/zh-cn/config-errors.json";

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

afterEach(async () => {
  await app.close();
});

describe("config routes", () => {
  it("localizes owned validation while preserving response status, field names and raw failures", async () => {
    const localized = Fastify({ logger: false });
    const translate = createTranslator("zh-CN", configMessages);
    registerConfigRoutes(localized, service, translate);
    registerLocalMachineConfigRoutes(localized, service, translate);
    try {
      const invalidPort = await localized.inject({ method: "PUT", url: "/api/config", payload: { config: { port: "invalid" } } });
      expect(invalidPort.statusCode).toBe(400);
      expect(invalidPort.json()).toEqual({ error: "PI WEB 配置 port 必须是数字" });
      const invalidPlugin = await localized.inject({ method: "PUT", url: "/api/machines/local/config", payload: { config: { plugins: [] } } });
      expect(invalidPlugin.statusCode).toBe(400);
      expect(invalidPlugin.json()).toEqual({ error: "PI WEB 所选机器配置 plugins 必须是对象" });
      vi.mocked(service.read).mockRejectedValue(new Error("filesystem: preserve original"));
      const failure = await localized.inject({ method: "GET", url: "/api/config" });
      expect(failure.statusCode).toBe(500);
      expect(failure.json()).toEqual({ error: "filesystem: preserve original" });
    } finally {
      await localized.close();
    }
  });

  it("returns the PI WEB config contract", async () => {
    const response = await app.inject({ method: "GET", url: "/api/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json<PiWebConfigResponse>()).toEqual(responseFor(savedConfig, true));
  });

  it("updates config through the service", async () => {
    const requestedConfig: PiWebConfigValues = {
      host: "0.0.0.0",
      port: 9000,
      allowedHosts: true,
      spawnSessions: true,
      subsessions: true,
      shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null },
      defaultTheme: { themeId: "themes:pi-web-light", auto: false },
      plugins: { info: { enabled: false, settings: { note: "hidden" } } },
      pathAccess: { allowedPaths: ["/tmp"] },
      uploads: { defaultFolder: "uploads\\manual" },
      attachments: { defaultFolder: "attachments\\saved" },
      maxUploadBytes: 1234,
      sessionArchive: { directory: "/external/archives" },
      agent: { command: "agent-lab", dir: "~/agent-profiles/lab" },
    };
    const expectedConfig: PiWebConfigValues = {
      ...requestedConfig,
      uploads: { defaultFolder: "uploads/manual" },
      attachments: { defaultFolder: "attachments/saved" },
    };

    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: requestedConfig },
    });

    expect(response.statusCode).toBe(200);
    expect(savedConfig).toEqual(expectedConfig);
    expect(response.json<PiWebConfigResponse>().config).toEqual(expectedConfig);
    expect(parsePiWebConfigResponseBody(response.json()).config).toEqual(expectedConfig);
  });

  it("accepts local management embed auth config", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        config: {
          managementEmbed: {
            enabled: true,
            projectRoot: "/root/PiWeb",
            auth: {
              sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
              issuer: "telecom-portal",
              audience: "dify-external-portal",
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(savedConfig.managementEmbed?.auth).toEqual({
      sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      issuer: "telecom-portal",
      audience: "dify-external-portal",
    });
  });

  it("rejects old management embed introspection auth config", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        config: {
          managementEmbed: {
            enabled: true,
            auth: {
              introspectionUrl: "http://localhost:30032/console/api/auth/external-portal/pi-web/introspect",
              serviceSecretEnv: "PI_WEB_EMBED_SHARED_SECRET",
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error", expect.stringContaining("only supports local signed tokens"));
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid config payloads before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { host: 42 } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid path access payloads before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { pathAccess: { allowedPaths: [""] } } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid max upload bytes before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { maxUploadBytes: 0 } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid upload defaults before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { uploads: { defaultFolder: "/tmp" } } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid attachment defaults before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { attachments: { defaultFolder: "../outside" } } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("attachments.defaultFolder");
    expect(service.write).not.toHaveBeenCalled();
  });

  it.each([
    { agent: { command: "agent", dir: "relative/agent" }, error: "agent.dir must be a host-absolute path" },
    { agent: { command: "agent", dir: "/srv/agent", futureSetting: true }, error: 'agent contains unknown key "futureSetting"' },
  ])("rejects unsafe agent profile payloads before writing", async ({ agent, error }) => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { config: { agent } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain(error);
    expect(service.write).not.toHaveBeenCalled();
  });

  it("filters local machine config reads to selected-machine-safe keys", async () => {
    savedConfig = fullConfig();

    const response = await app.inject({ method: "GET", url: "/api/machines/local/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json<PiWebConfigResponse>()).toEqual({
      ...responseFor(savedConfig, true),
      config: selectedMachineConfig(),
      effectiveConfig: selectedMachineConfig(),
    });
  });

  it("merges local selected-machine config updates without dropping gateway-only keys", async () => {
    savedConfig = fullConfig();
    const selectedMachinePatch: PiWebConfigValues = {
      plugins: { info: { enabled: false } },
      uploads: { defaultFolder: "uploads\\manual" },
      attachments: { defaultFolder: "attachments\\saved" },
      spawnSessions: true,
      agent: { command: "alternate-agent", dir: "/srv/alternate-agent" },
    };

    const response = await app.inject({
      method: "PUT",
      url: "/api/machines/local/config",
      payload: { config: selectedMachinePatch },
    });

    const expectedConfig: PiWebConfigValues = {
      ...fullConfig(),
      plugins: { info: { enabled: false } },
      uploads: { defaultFolder: "uploads/manual" },
      attachments: { defaultFolder: "attachments/saved" },
      spawnSessions: true,
      agent: { command: "alternate-agent", dir: "/srv/alternate-agent" },
    };
    expect(response.statusCode).toBe(200);
    expect(savedConfig).toEqual(expectedConfig);
    expect(service.write).toHaveBeenCalledWith(expectedConfig);
    expect(response.json<PiWebConfigResponse>().config).toEqual({
      plugins: { info: { enabled: false } },
      pathAccess: { allowedPaths: ["/srv/repos"] },
      uploads: { defaultFolder: "uploads/manual" },
      attachments: { defaultFolder: "attachments/saved" },
      maxUploadBytes: 1024,
      spawnSessions: true,
      subsessions: false,
      agent: { command: "alternate-agent", dir: "/srv/alternate-agent" },
    });
  });

  it("keeps foreign-platform agent paths portable at federation transport boundaries", () => {
    const agent = { command: "C:\\tools\\pi.exe", dir: "C:\\pi-profiles\\work" };
    const response = {
      ...responseFor({ agent }, true),
      effectiveConfig: { agent },
    };

    expect(parsePiWebConfigResponseBody(response).config.agent).toEqual(agent);
    expect(parseSelectedMachineConfigRequest({ agent }, "portable").agent).toEqual(agent);
    if (process.platform !== "win32") {
      expect(() => parseSelectedMachineConfigRequest({ agent: { command: agent.command } })).toThrow("agent.command must be a safe bare executable name or host-absolute executable path");
      expect(() => parseSelectedMachineConfigRequest({ agent: { dir: agent.dir } })).toThrow("agent.dir must be a host-absolute path");
    }
  });

  it("rejects config responses missing a required override flag", () => {
    for (const flag of ["host", "port", "allowedHosts", "spawnSessions", "subsessions", "askUser"] as const) {
      const envOverrides = Object.fromEntries(Object.entries(responseFor({}, false).envOverrides).filter(([key]) => key !== flag));
      expect(() => parsePiWebConfigResponseBody({ ...responseFor({}, false), envOverrides })).toThrow(`field must be a boolean: ${flag}`);
    }
  });

  it("rejects unsafe local selected-machine config keys before writing", async () => {
    savedConfig = fullConfig();

    const response = await app.inject({
      method: "PUT",
      url: "/api/machines/local/config",
      payload: { config: { host: "0.0.0.0", spawnSessions: true } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("PI WEB selected-machine config key is not allowed: host");
    expect(savedConfig).toEqual(fullConfig());
    expect(service.write).not.toHaveBeenCalled();
  });

  it("rejects invalid local selected-machine config values before writing", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/machines/local/config",
      payload: { config: { spawnSessions: "yes" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("PI WEB selected-machine config spawnSessions must be a boolean");
    expect(service.write).not.toHaveBeenCalled();
  });
});

function fullConfig(): PiWebConfigValues {
  return {
    host: "127.0.0.1",
    port: 8504,
    allowedHosts: ["gateway.example.test"],
    shortcuts: { "core:view.chat": "mod+1" },
    plugins: { info: { enabled: true, settings: { note: "visible" } } },
    pathAccess: { allowedPaths: ["/srv/repos"] },
    uploads: { defaultFolder: "uploads" },
    attachments: { defaultFolder: "attachments" },
    maxUploadBytes: 1024,
    spawnSessions: false,
    subsessions: false,
    agent: { command: "agent-lab", dir: "/srv/agent-lab" },
  };
}

function selectedMachineConfig(): PiWebConfigValues {
  return {
    plugins: { info: { enabled: true, settings: { note: "visible" } } },
    pathAccess: { allowedPaths: ["/srv/repos"] },
    uploads: { defaultFolder: "uploads" },
    attachments: { defaultFolder: "attachments" },
    maxUploadBytes: 1024,
    spawnSessions: false,
    subsessions: false,
    agent: { command: "agent-lab", dir: "/srv/agent-lab" },
  };
}

function responseFor(config: PiWebConfigValues, exists: boolean): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
