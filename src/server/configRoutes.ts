import { UserFacingError, createTranslator, userFacingErrorMessage, type Translator } from "../shared/i18n.js";
import type { FastifyInstance } from "fastify";
import { loadPiWebConfig, overlayPiWebConfig, piWebConfigEnforcedSettings, piWebConfigSources, parsePiWebConfig, resolveEffectivePiWebConfig, savePiWebConfig, type AgentPathHost, type LoadOptions, type PiWebConfig } from "../config.js";
import { CONFIG_KEYS, parseConfigPointer, preserveEnforcedConfigOverrides, removeConfigOverrides, validateConfigUpdate, type PiWebConfigUpdate } from "./configUpdates.js";
import type { PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import type { PiWebAgentDirEnvSource } from "../shared/apiTypes.js";
import { agentDirEnvSource, hasAgentDirEnvOverride, hasAgentSessionDirEnvOverride } from "../config.js";
import { parsePiWebConfigRequest } from "../shared/piWebConfigParsing.js";

export interface PiWebConfigService {
  read: () => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  write: (config: PiWebConfigValues) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  replace?: (config: PiWebConfigValues, selectedMachine: boolean) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  update?: (update: PiWebConfigUpdate) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
}

export const SELECTED_MACHINE_CONFIG_KEYS = [
  "installationName",
  "plugins",
  "pathAccess",
  "basePaths",
  "uploads",
  "attachments",
  "maxUploadBytes",
  "spawnSessions",
  "sessionMessages",
  "subsessions",
  "askUser",
  "environmentFacts",
  "extensionDialogsTimeoutMs",
  "sessionArchive",
  "agent",
] as const satisfies readonly (keyof PiWebConfigValues)[];

const SELECTED_MACHINE_CONFIG_KEY_SET = new Set<string>(SELECTED_MACHINE_CONFIG_KEYS);

export function createFilePiWebConfigService(options: LoadOptions = {}): PiWebConfigService {
  return {
    read: () => currentPiWebConfigResponse(options),
    write: (config) => {
      savePiWebConfig(config, options);
      return currentPiWebConfigResponse(options);
    },
    replace: (config, selectedMachine) => {
      const current = currentPiWebConfigResponse(options);
      const replacement = selectedMachine ? mergeSelectedMachineConfig(current.config, config) : config;
      savePiWebConfig(preserveEnforcedConfigOverrides(current.config, replacement, current.enforcedSettings), options);
      return currentPiWebConfigResponse(options);
    },
    update: (update) => {
      const current = currentPiWebConfigResponse(options);
      const next = applyPiWebConfigUpdate(current, update);
      savePiWebConfig(next, options);
      return currentPiWebConfigResponse(options);
    },
  };
}

export function currentPiWebConfigResponse(options: LoadOptions = {}): PiWebConfigResponse {
  const loaded = loadPiWebConfig(options);
  const effective = resolveEffectivePiWebConfig(loaded, options);
  const env = options.env ?? process.env;
  return {
    path: loaded.path,
    exists: loaded.exists,
    config: loaded.config,
    effectiveConfig: effective.config,
    envOverrides: piWebConfigEnvOverrides(env),
    enforcedSettings: piWebConfigEnforcedSettings(env),
    configSources: piWebConfigSources(loaded, options),
    ...(loaded.defaultsPath === undefined ? {} : { defaultsPath: loaded.defaultsPath, defaultsConfig: loaded.defaultsConfig }),
  };
}

export function registerConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService(), translate: Translator = createTranslator("en", {})): void {
  app.get("/api/config", async (_request, reply) => {
    try {
      return await service.read();
    } catch (error) {
      return reply.code(500).send({ error: userFacingErrorMessage(error, translate) });
    }
  });

  app.patch<{ Body: unknown }>("/api/config", async (request, reply) => {
    try {
      return await updateConfigService(service, parsePiWebConfigUpdate(request.body));
    } catch (error) {
      return reply.code(isConfigValidationError(error) ? 400 : 500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } | undefined }>("/api/config", async (request, reply) => {
    try {
      return await replaceConfigService(service, parseConfigRequest(request.body?.config));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: userFacingErrorMessage(error, translate) });
    }
  });
}

export function registerLocalMachineConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService(), translate: Translator = createTranslator("en", {})): void {
  app.get("/api/machines/local/config", async (_request, reply) => {
    try {
      return selectedMachineConfigResponse(await service.read());
    } catch (error) {
      return reply.code(500).send({ error: userFacingErrorMessage(error, translate) });
    }
  });

  app.patch<{ Body: unknown }>("/api/machines/local/config", async (request, reply) => {
    try {
      return selectedMachineConfigResponse(await updateConfigService(service, parsePiWebConfigUpdate(request.body, true)));
    } catch (error) {
      return reply.code(isConfigValidationError(error) ? 400 : 500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } | undefined }>("/api/machines/local/config", async (request, reply) => {
    try {
      const patch = parseSelectedMachineConfigRequest(request.body?.config);
      return selectedMachineConfigResponse(await replaceConfigService(service, patch, true));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: userFacingErrorMessage(error, translate) });
    }
  });
}

export function parsePiWebConfigUpdate(value: unknown, selectedMachine = false, pathHost: AgentPathHost = "current"): PiWebConfigUpdate {
  const prefix = selectedMachine ? "PI WEB selected-machine config" : "PI WEB config";
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "set" && key !== "unset")) throw new Error(`${prefix} update must contain only set and unset`);
  const setValue = value["set"];
  if (setValue !== undefined && (!isRecord(setValue) || Object.keys(setValue).some((key) => !CONFIG_KEYS.some((known) => known === key)))) throw new Error(`${prefix} update contains unknown settings`);
  const set = setValue === undefined ? {} : selectedMachine ? parseSelectedMachineConfigRequest(setValue, pathHost) : parseConfigRequest(setValue, pathHost);
  const unset = value["unset"] === undefined ? [] : value["unset"];
  if (!Array.isArray(unset) || !unset.every((pointer): pointer is string => typeof pointer === "string")) throw new Error(`${prefix} unset must be an array of JSON pointers`);
  for (const pointer of unset) {
    const root = parseConfigPointer(pointer)[0];
    if (selectedMachine && (root === undefined || !SELECTED_MACHINE_CONFIG_KEY_SET.has(root))) throw new Error(`${prefix} key is not allowed: ${root ?? pointer}`);
  }
  const update = { set, unset };
  validateConfigUpdate(update);
  return update;
}

export function applyPiWebConfigUpdate(current: PiWebConfigResponse, update: PiWebConfigUpdate): PiWebConfig {
  validateConfigUpdate(update, current.enforcedSettings);
  return parseConfigRequest(removeConfigOverrides(overlayPiWebConfig(current.config, update.set ?? {}), update.unset ?? []));
}

async function replaceConfigService(service: PiWebConfigService, config: PiWebConfigValues, selectedMachine = false): Promise<PiWebConfigResponse> {
  if (service.replace !== undefined) return service.replace(config, selectedMachine);
  const current = await service.read();
  const replacement = selectedMachine ? mergeSelectedMachineConfig(current.config, config) : config;
  return service.write(preserveEnforcedConfigOverrides(current.config, replacement, current.enforcedSettings));
}

async function updateConfigService(service: PiWebConfigService, update: PiWebConfigUpdate): Promise<PiWebConfigResponse> {
  if (service.update !== undefined) return service.update(update);
  return service.write(applyPiWebConfigUpdate(await service.read(), update));
}

function selectedMachineSources(sources: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(sources).filter(([pointer]) => {
    const root = sourcePointerRoot(pointer);
    return SELECTED_MACHINE_CONFIG_KEY_SET.has(root);
  }));
}

function parseSourceMap(value: unknown, source: string): Record<string, string> {
  if (!isRecord(value) || !Object.values(value).every((entry) => typeof entry === "string")) throw new Error(`${source} configuration sources must map settings to strings`);
  return Object.fromEntries(Object.entries(value).map(([pointer, entry]) => {
    sourcePointerRoot(pointer);
    return [pointer, String(entry)];
  }));
}

function sourcePointerRoot(pointer: string): string {
  if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) throw new Error("PI WEB config source identifiers must be JSON pointers");
  return pointer.slice(1).split("/")[0]?.replaceAll("~1", "/").replaceAll("~0", "~") ?? "";
}

export function parseSelectedMachineConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new UserFacingError("configError.pi.web.selected.machine.config.update.must.include.a.config.object.14b6bb", "PI WEB selected-machine config update must include a config object");
  for (const key of Object.keys(value)) {
    if (!SELECTED_MACHINE_CONFIG_KEY_SET.has(key)) throw new UserFacingError("configError.pi.web.selected.machine.config.key.is.not.allowed.field.f05005", "PI WEB selected-machine config key is not allowed: {value1}", { value1: key });
  }
  try {
    return pickSelectedMachineConfig(parseConfigRequest(value, agentPathHost));
  } catch (error) {
    if (error instanceof UserFacingError) {
      const fallback = error.fallback.startsWith("PI WEB config ")
        ? `PI WEB selected-machine config ${error.fallback.slice("PI WEB config ".length)}`
        : `PI WEB selected-machine config ${error.fallback}`;
      const wrapped = new UserFacingError(`${error.messageKey}.selectedMachine`, fallback, error.parameters);
      Object.defineProperty(wrapped, "cause", { value: error, configurable: true, writable: true });
      throw wrapped;
    }
    throw new Error(selectedMachineConfigErrorMessage(error), { cause: error });
  }
}

export function mergeSelectedMachineConfig(current: PiWebConfigValues, patch: PiWebConfigValues): PiWebConfig {
  return { ...current, ...pickSelectedMachineConfig(patch) };
}

export function selectedMachineConfigResponse(response: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...response,
    config: pickSelectedMachineConfig(response.config),
    effectiveConfig: pickSelectedMachineConfig(response.effectiveConfig),
    ...(response.defaultsConfig === undefined ? {} : { defaultsConfig: pickSelectedMachineConfig(response.defaultsConfig) }),
    ...(response.enforcedSettings === undefined ? {} : { enforcedSettings: selectedMachineSources(response.enforcedSettings) }),
    ...(response.configSources === undefined ? {} : { configSources: selectedMachineSources(response.configSources) }),
  };
}

export function parsePiWebConfigResponseBody(value: unknown, source = "PI WEB config response"): PiWebConfigResponse {
  const record = requireResponseRecord(value, source);
  return {
    path: requireResponseString(record, "path", source),
    exists: requireResponseBoolean(record, "exists", source),
    config: parseConfigRequest(record["config"], "portable"),
    effectiveConfig: parseConfigRequest(record["effectiveConfig"], "portable"),
    envOverrides: parsePiWebConfigEnvOverridesResponse(record["envOverrides"], source),
    ...(record["enforcedSettings"] === undefined ? {} : { enforcedSettings: parseSourceMap(record["enforcedSettings"], source) }),
    ...(record["configSources"] === undefined ? {} : { configSources: parseSourceMap(record["configSources"], source) }),
    ...(record["defaultsPath"] === undefined ? {} : { defaultsPath: requireResponseString(record, "defaultsPath", source) }),
    ...(record["defaultsConfig"] === undefined ? {} : { defaultsConfig: parseConfigRequest(record["defaultsConfig"], "portable") }),
  };
}

function parseConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new Error("PI WEB config update must include a config object");
  // JSON API inputs stay typed; numeric environment/file parsing is shared below.
  for (const key of ["port", "maxUploadBytes"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "number") {
      if (key === "port") throw new UserFacingError("configError.pi.web.config.port.must.be.a.number.8ac8cd", "PI WEB config port must be a number");
      throw new Error(`PI WEB config ${key} must be a number`);
    }
  }
  parsePiWebConfigRequest(value);
  return parsePiWebConfig(value, "request", agentPathHost);
}

function pickSelectedMachineConfig(config: PiWebConfigValues): PiWebConfig {
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => value !== undefined && SELECTED_MACHINE_CONFIG_KEY_SET.has(key)));
}

function selectedMachineConfigErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.startsWith("PI WEB config ")) return `PI WEB selected-machine config ${message.slice("PI WEB config ".length)}`;
  return `PI WEB selected-machine config ${message}`;
}

function parsePiWebConfigEnvOverridesResponse(value: unknown, source: string): PiWebConfigEnvOverrides {
  const record = requireResponseRecord(value, `${source} envOverrides`);
  return {
    host: requireResponseBoolean(record, "host", source),
    port: requireResponseBoolean(record, "port", source),
    allowedHosts: requireResponseBoolean(record, "allowedHosts", source),
    spawnSessions: requireResponseBoolean(record, "spawnSessions", source),
    sessionMessages: record["sessionMessages"] === undefined ? false : requireResponseBoolean(record, "sessionMessages", source),
    subsessions: requireResponseBoolean(record, "subsessions", source),
    askUser: requireResponseBoolean(record, "askUser", source),
    agentCommand: optionalResponseBoolean(record, "agentCommand", source) ?? false,
    agentDir: optionalResponseBoolean(record, "agentDir", source) ?? false,
    ...optionalAgentDirSource(record, source),
    agentSessionDir: optionalResponseBoolean(record, "agentSessionDir", source) ?? false,
  };
}

function requireResponseRecord(value: unknown, source: string): Record<string, unknown> {
  if (!isRecord(value)) throw new UserFacingError("configError.field.must.be.an.object.bab512", "{value1} must be an object", { value1: source });
  return value;
}

function requireResponseString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new UserFacingError("configError.field.field.must.be.a.string.field.6e7ac7", "{value1} field must be a string: {value2}", { value1: source, value2: key });
  return value;
}

function requireResponseBoolean(record: Record<string, unknown>, key: string, source: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new UserFacingError("configError.field.field.must.be.a.boolean.field.be00df", "{value1} field must be a boolean: {value2}", { value1: source, value2: key });
  return value;
}

function optionalResponseBoolean(record: Record<string, unknown>, key: string, source: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new UserFacingError("configError.field.field.must.be.a.boolean.field.be00df", "{value1} field must be a boolean: {value2}", { value1: source, value2: key });
  return value;
}

function optionalAgentDirSource(record: Record<string, unknown>, source: string): { agentDirSource?: PiWebAgentDirEnvSource } {
  const value = record["agentDirSource"];
  if (value === undefined) return {};
  if (value !== "pi-web" && value !== "pi-compatibility") throw new UserFacingError("configError.field.field.must.be.a.valid.agent.directory.source.agentdirsource.934d85", "{value1} field must be a valid agent directory source: agentDirSource", { value1: source });
  return { agentDirSource: value };
}

function piWebConfigEnvOverrides(env: NodeJS.ProcessEnv): PiWebConfigEnvOverrides {
  const dirEnvSource = agentDirEnvSource(env);
  return {
    host: isEnvSet(env["PI_WEB_HOST"]),
    port: isEnvSet(env["PI_WEB_PORT"]) || isEnvSet(env["PORT"]),
    allowedHosts: isEnvSet(env["PI_WEB_ALLOWED_HOSTS"]),
    spawnSessions: isEnvSet(env["PI_WEB_SPAWN_SESSIONS"]),
    sessionMessages: isEnvSet(env["PI_WEB_SESSION_MESSAGES"]),
    subsessions: isEnvSet(env["PI_WEB_SUBSESSIONS"]),
    askUser: isEnvSet(env["PI_WEB_ASK_USER"]),
    agentCommand: isEnvSet(env["PI_WEB_AGENT_COMMAND"]),
    agentDir: hasAgentDirEnvOverride(env),
    ...(dirEnvSource === undefined ? {} : { agentDirSource: dirEnvSource }),
    agentSessionDir: hasAgentSessionDirEnvOverride(env),
  };
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function isConfigValidationError(error: unknown): boolean {
  return error instanceof Error && (error.message.startsWith("PI WEB config") || error.message.startsWith("PI WEB selected-machine config"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
