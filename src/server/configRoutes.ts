import type { FastifyInstance } from "fastify";
import { effectivePiWebConfig, loadPiWebConfig, savePiWebConfig, type LoadOptions, type PiWebConfig } from "../config.js";
import type { PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import { isPiWebPluginId } from "../shared/pluginIds.js";

export interface PiWebConfigService {
  read: () => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  write: (config: PiWebConfigValues) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
}

export function createFilePiWebConfigService(options: LoadOptions = {}): PiWebConfigService {
  return {
    read: () => currentPiWebConfigResponse(options),
    write: (config) => {
      savePiWebConfig(config, options);
      return currentPiWebConfigResponse(options);
    },
  };
}

export function currentPiWebConfigResponse(options: LoadOptions = {}): PiWebConfigResponse {
  const loaded = loadPiWebConfig(options);
  const effective = effectivePiWebConfig(options);
  const env = options.env ?? process.env;
  return {
    path: loaded.path,
    exists: loaded.exists,
    config: loaded.config,
    effectiveConfig: effective.config,
    envOverrides: piWebConfigEnvOverrides(env),
  };
}

export function registerConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService()): void {
  app.get("/api/config", async (_request, reply) => {
    try {
      return await service.read();
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } | undefined }>("/api/config", async (request, reply) => {
    try {
      return await service.write(parseConfigRequest(request.body?.config));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: errorMessage(error) });
    }
  });
}

function parseConfigRequest(value: unknown): PiWebConfig {
  if (!isRecord(value)) throw new Error("PI WEB config update must include a config object");
  const config: PiWebConfig = {};
  const host = value["host"];
  const port = value["port"];
  const allowedHosts = value["allowedHosts"];
  const shortcuts = value["shortcuts"];
  const plugins = value["plugins"];
  const managementEmbed = value["managementEmbed"];
  if (host !== undefined) {
    if (typeof host !== "string") throw new Error("PI WEB config host must be a string");
    config.host = host;
  }
  if (port !== undefined) {
    if (typeof port !== "number") throw new Error("PI WEB config port must be a number");
    config.port = port;
  }
  if (allowedHosts !== undefined) config.allowedHosts = parseAllowedHostsRequest(allowedHosts);
  if (shortcuts !== undefined) config.shortcuts = parseShortcutsRequest(shortcuts);
  if (plugins !== undefined) config.plugins = parsePluginsRequest(plugins);
  if (managementEmbed !== undefined) config.managementEmbed = parseManagementEmbedRequest(managementEmbed);
  return config;
}

function parseAllowedHostsRequest(value: unknown): string[] | true {
  if (value === true) return true;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("PI WEB config allowedHosts must be true or an array of strings");
  }
  return value;
}

function parseShortcutsRequest(value: unknown): Record<string, string | null> {
  if (!isRecord(value)) throw new Error("PI WEB config shortcuts must be an object");
  return Object.fromEntries(Object.entries(value).map(([actionId, shortcut]) => {
    if (shortcut !== null && (typeof shortcut !== "string" || shortcut === "")) throw new Error("PI WEB config shortcut values must be non-empty strings or null");
    return [actionId, shortcut];
  }));
}

function parsePluginsRequest(value: unknown): NonNullable<PiWebConfig["plugins"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error("PI WEB config plugins must be an object");
  return Object.fromEntries(Object.entries(value).map(([pluginId, config]) => {
    if (!isPiWebPluginId(pluginId)) throw new Error("PI WEB config plugin ids are invalid");
    if (!isRecord(config) || Array.isArray(config)) throw new Error("PI WEB config plugin entries must be objects");
    const enabled = config["enabled"];
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("PI WEB config plugin enabled values must be booleans");
    const settings = config["settings"];
    if (settings !== undefined && (!isRecord(settings) || Array.isArray(settings))) throw new Error("PI WEB config plugin settings must be objects");
    return [pluginId, config];
  }));
}

function parseManagementEmbedRequest(value: unknown): NonNullable<PiWebConfig["managementEmbed"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error("PI WEB config managementEmbed must be an object");
  const enabled = value["enabled"];
  const projectRoot = value["projectRoot"];
  const auth = value["auth"];
  const sandbox = value["sandbox"];
  const tools = value["tools"];
  return {
    ...(enabled === undefined ? {} : { enabled: parseBooleanRequest(enabled, "managementEmbed.enabled") }),
    ...(projectRoot === undefined ? {} : { projectRoot: parseStringRequest(projectRoot, "managementEmbed.projectRoot") }),
    ...(auth === undefined ? {} : { auth: parseAuthRequest(auth) }),
    ...(sandbox === undefined ? {} : { sandbox: parseSandboxRequest(sandbox) }),
    ...(tools === undefined ? {} : { tools: parseToolsRequest(tools) }),
  };
}

function parseAuthRequest(value: unknown): NonNullable<NonNullable<PiWebConfig["managementEmbed"]>["auth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error("PI WEB config managementEmbed.auth must be an object");
  return {
    ...(value["introspectionUrl"] === undefined ? {} : { introspectionUrl: parseStringRequest(value["introspectionUrl"], "managementEmbed.auth.introspectionUrl") }),
    ...(value["serviceSecretEnv"] === undefined ? {} : { serviceSecretEnv: parseStringRequest(value["serviceSecretEnv"], "managementEmbed.auth.serviceSecretEnv") }),
  };
}

function parseSandboxRequest(value: unknown): NonNullable<NonNullable<PiWebConfig["managementEmbed"]>["sandbox"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error("PI WEB config managementEmbed.sandbox must be an object");
  return {
    ...(value["pythonExecutable"] === undefined ? {} : { pythonExecutable: parseStringRequest(value["pythonExecutable"], "managementEmbed.sandbox.pythonExecutable") }),
    ...(value["env"] === undefined ? {} : { env: parseStringRecordRequest(value["env"], "managementEmbed.sandbox.env") }),
  };
}

function parseToolsRequest(value: unknown): NonNullable<NonNullable<PiWebConfig["managementEmbed"]>["tools"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error("PI WEB config managementEmbed.tools must be an object");
  return {
    ...(value["allow"] === undefined ? {} : { allow: parseStringArrayRequest(value["allow"], "managementEmbed.tools.allow") }),
    ...(value["deny"] === undefined ? {} : { deny: parseStringArrayRequest(value["deny"], "managementEmbed.tools.deny") }),
    ...(value["permissions"] === undefined ? {} : { permissions: parseBooleanRecordRequest(value["permissions"], "managementEmbed.tools.permissions") }),
  };
}

function parseStringRequest(value: unknown, key: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`PI WEB config ${key} must be a non-empty string`);
  return value;
}

function parseBooleanRequest(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new Error(`PI WEB config ${key} must be a boolean`);
  return value;
}

function parseStringArrayRequest(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item !== "")) throw new Error(`PI WEB config ${key} must be an array of non-empty strings`);
  return value.map((item) => String(item));
}

function parseStringRecordRequest(value: unknown, key: string): Record<string, string> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`PI WEB config ${key} must be an object`);
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "string") throw new Error(`PI WEB config ${key} values must be strings`);
    return [recordKey, recordValue];
  }));
}

function parseBooleanRecordRequest(value: unknown, key: string): Record<string, boolean> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`PI WEB config ${key} must be an object`);
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "boolean") throw new Error(`PI WEB config ${key} values must be booleans`);
    return [recordKey, recordValue];
  }));
}

function piWebConfigEnvOverrides(env: NodeJS.ProcessEnv): PiWebConfigEnvOverrides {
  return {
    host: isEnvSet(env["PI_WEB_HOST"]),
    port: isEnvSet(env["PI_WEB_PORT"]) || isEnvSet(env["PORT"]),
    allowedHosts: isEnvSet(env["PI_WEB_ALLOWED_HOSTS"]),
  };
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function isConfigValidationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("PI WEB config");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
