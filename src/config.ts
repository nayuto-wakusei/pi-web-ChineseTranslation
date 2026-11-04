import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { PiWebAgentDirEnvSource, PiWebConfigValues, PiWebDeprecatedAgentInput } from "./shared/apiTypes.js";
import { usesPiCodingAgentStateCompatibility } from "./shared/activeAgentProfile.js";
import { parsePiWebConfig as parseBasePiWebConfig } from "./shared/piWebConfigParsing.js";
import { parseSessionArchiveConfig } from "./shared/piWebConfigParsing.js";
import { migrateSessionNamingConfig } from "./configSessionNamingMigration.js";
import { PI_WEB_CONFIG_DEFINITIONS, overlayPiWebConfig, parsePiWebEnvBoolean, piWebConfigEnvName, piWebConfigNamespaceFields, piWebConfigSettingPointers } from "./shared/configResolution.js";
import { versionChecksDisabled } from "./shared/versionCheckPolicy.js";
export { overlayPiWebConfig } from "./shared/configResolution.js";

export type PiWebConfig = PiWebConfigValues;

export interface LoadedPiWebConfig {
  path: string;
  exists: boolean;
  config: PiWebConfig;
  /** Deployment-owned defaults, never included in writable config or saves. */
  defaultsConfig?: PiWebConfig;
  defaultsPath?: string;
  /** Deprecated agent-configuration inputs detected in `env` and the loaded file. */
  deprecatedAgentInputs: readonly DeprecatedAgentInput[];
}

export interface EffectivePiWebConfig extends Omit<PiWebConfig, "uploads" | "attachments" | "spawnSessions" | "sessionMessages" | "subsessions" | "askUser" | "environmentFacts" | "agent" | "extensionDialogsTimeoutMs"> {
  uploads: NonNullable<PiWebConfig["uploads"]>;
  attachments: NonNullable<PiWebConfig["attachments"]>;
  spawnSessions: boolean;
  sessionMessages: boolean;
  subsessions: boolean;
  askUser: boolean;
  environmentFacts: boolean;
  extensionDialogsTimeoutMs: number;
  agent: Required<NonNullable<PiWebConfig["agent"]>>;
}

export interface LoadedEffectivePiWebConfig extends Omit<LoadedPiWebConfig, "config"> {
  config: EffectivePiWebConfig;
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function defaultPiWebConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  return join(xdgConfigHome !== undefined && xdgConfigHome !== "" ? xdgConfigHome : join(homedir(), ".config"), "pi-web", "config.json");
}

export function defaultPiWebDataDir(): string {
  return join(homedir(), ".pi-web");
}

/**
 * Default maximum HTTP body size (bytes) for the web/API and session daemon.
 * Generous headroom for base64 image attachments (well above pi's 4.5MB
 * per-image inline limit so several images fit in one request).
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export const DEFAULT_UPLOADS_FOLDER = ".pi-web/uploads";

export const DEFAULT_ATTACHMENT_FOLDER = ".pi-web/attachments";

/**
 * Composer dictation defaults. Timeout covers one utterance round trip through
 * the speech service; the byte cap applies after base64 decoding and stays far
 * below the service-side per-file limit.
 */
export const DEFAULT_SPEECH_TIMEOUT_MS = 60_000;
export const DEFAULT_SPEECH_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * Default auto-cancel delay for extension dialogs whose extension set no
 * `timeout` of its own: five minutes. `extensionDialogsTimeoutMs: 0` waits
 * forever. Tunes the unattended-dialog safety valve only; dialogs are always
 * enabled.
 */
export const DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS = 300_000;
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_WORKBENCH_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_WORKBENCH_CAPABILITY_TIMEOUT_MS = 30_000;
export const DEFAULT_WORKBENCH_SKILL_BUNDLE_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_WORKBENCH_SKILL_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_WORKBENCH_SKILL_FILE_COUNT_MAX = 200;
export const DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS = 90;
export const DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS = 500_000;
export const DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX = "pi-web-management-audit";
export const DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS = 365;

export const DEFAULT_AGENT_COMMAND = "pi";
export const PI_WEB_AGENT_COMMAND_ENV = "PI_WEB_AGENT_COMMAND";
export const PI_WEB_AGENT_DIR_ENV = "PI_WEB_AGENT_DIR";
export const PI_WEB_AGENT_SESSION_DIR_ENV = "PI_WEB_AGENT_SESSION_DIR";
export const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
export const PI_CODING_AGENT_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/** Deprecated PI WEB override remains first during the compatibility window. */
export const AGENT_SESSION_DIR_ENV_KEYS = [PI_WEB_AGENT_SESSION_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV] as const;

export type DeprecatedAgentInput = PiWebDeprecatedAgentInput;

export function detectDeprecatedAgentInputs(env: Readonly<NodeJS.ProcessEnv>, config: Pick<PiWebConfig, "agent"> = {}): DeprecatedAgentInput[] {
  const inputs: DeprecatedAgentInput[] = [];
  if (isEnvSet(env[PI_WEB_AGENT_COMMAND_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_COMMAND_ENV });
  if (isEnvSet(env[PI_WEB_AGENT_DIR_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_DIR_ENV, replacement: PI_CODING_AGENT_DIR_ENV });
  if (isEnvSet(env[PI_WEB_AGENT_SESSION_DIR_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_SESSION_DIR_ENV, replacement: PI_CODING_AGENT_SESSION_DIR_ENV });
  if (config.agent?.command !== undefined) inputs.push({ source: "config", name: "agent.command" });
  if (config.agent?.dir !== undefined) inputs.push({ source: "config", name: "agent.dir", replacement: PI_CODING_AGENT_DIR_ENV });
  return inputs;
}

export interface EffectivePiWebAgentConfig {
  command: string;
  dir: string;
  sessionDirEnvKeys: string[];
}

export function effectiveAgentConfig(env: NodeJS.ProcessEnv = process.env, config: Pick<PiWebConfig, "agent"> = {}): EffectivePiWebAgentConfig {
  const command = parseAgentCommand(envValue(env, PI_WEB_AGENT_COMMAND_ENV) ?? config.agent?.command ?? DEFAULT_AGENT_COMMAND, "agent.command", "environment", "current");
  // Keep the deprecated PI WEB alias first for compatibility, then the
  // canonical Pi SDK variable, then the project config alias and SDK default.
  const sources: readonly (readonly [string, string | undefined])[] = [
    [PI_WEB_AGENT_DIR_ENV, envValue(env, PI_WEB_AGENT_DIR_ENV)],
    [PI_CODING_AGENT_DIR_ENV, envValue(env, PI_CODING_AGENT_DIR_ENV)],
    ["agent.dir", config.agent?.dir],
  ];
  const configured = sources.find((source): source is readonly [string, string] => source[1] !== undefined);
  const [sourceName, configuredDir] = configured ?? ["the agent directory default", defaultAgentDirForCommand(command, env)];
  return {
    command,
    dir: resolveAgentDirPath(configuredDir, env, sourceName, "environment"),
    sessionDirEnvKeys: agentSessionDirEnvKeys(command),
  };
}

export function agentSessionDirEnvKeys(command = DEFAULT_AGENT_COMMAND): string[] {
  void command;
  return [...AGENT_SESSION_DIR_ENV_KEYS];
}

/** Resolve the session store override using the same old-alias-first policy. */
export function agentSessionDirEnvOverride(env: Readonly<NodeJS.ProcessEnv>, command = DEFAULT_AGENT_COMMAND): string | undefined {
  for (const key of agentSessionDirEnvKeys(command)) {
    const value = env[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export function agentDirEnvSource(env: NodeJS.ProcessEnv): PiWebAgentDirEnvSource | undefined {
  if (isEnvSet(env[PI_WEB_AGENT_DIR_ENV])) return "pi-web";
  if (isEnvSet(env[PI_CODING_AGENT_DIR_ENV])) return "pi-compatibility";
  return undefined;
}

export function hasAgentDirEnvOverride(env: NodeJS.ProcessEnv): boolean {
  const source = agentDirEnvSource(env);
  return source !== undefined;
}

export function hasAgentSessionDirEnvOverride(env: NodeJS.ProcessEnv, command = DEFAULT_AGENT_COMMAND): boolean {
  return agentSessionDirEnvKeys(command).some((key) => isEnvSet(env[key]));
}

export function effectiveUploadsConfig(config: Pick<PiWebConfig, "uploads"> = {}): NonNullable<PiWebConfig["uploads"]> {
  return { defaultFolder: config.uploads?.defaultFolder ?? DEFAULT_UPLOADS_FOLDER };
}

export function effectiveAttachmentsConfig(config: Pick<PiWebConfig, "attachments"> = {}): NonNullable<PiWebConfig["attachments"]> {
  return { defaultFolder: config.attachments?.defaultFolder ?? DEFAULT_ATTACHMENT_FOLDER };
}

/** Fill dictation defaults without resolving the bearer token, which stays in the environment. */
export function effectiveSpeechConfig(configured: PiWebConfig["speech"]): PiWebConfig["speech"] {
  if (configured === undefined) return undefined;
  return {
    ...configured,
    api: configured.api ?? "transcriptions",
    timeoutMs: configured.timeoutMs ?? DEFAULT_SPEECH_TIMEOUT_MS,
    maxAudioBytes: configured.maxAudioBytes ?? DEFAULT_SPEECH_MAX_AUDIO_BYTES,
  };
}

export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): number {
  const fromEnv = env["PI_WEB_MAX_UPLOAD_BYTES"];
  if (fromEnv !== undefined && fromEnv !== "") return parseMaxUploadBytes(fromEnv, "PI_WEB_MAX_UPLOAD_BYTES");
  if (config.maxUploadBytes !== undefined) return config.maxUploadBytes;
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export function piWebDataDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_DATA_DIR"];
  if (configured === undefined || configured === "") return defaultPiWebDataDir();
  return resolve(cwd, configured);
}

/** Resolve new archive destinations without changing the archive index location. */
export function sessionArchiveDirectory(env: NodeJS.ProcessEnv = process.env, config: Pick<PiWebConfig, "sessionArchive"> = {}, cwd = process.cwd()): string {
  const fromEnv = env["PI_WEB_SESSION_ARCHIVE_DIR"];
  const configured = fromEnv !== undefined && fromEnv !== "" ? fromEnv : config.sessionArchive?.directory;
  return configured === undefined ? join(piWebDataDir(env, cwd), "archived-sessions") : resolve(cwd, configured);
}

export function piWebConfigPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_CONFIG"];
  if (configured === undefined || configured === "") return defaultPiWebConfigPath(env);
  return resolve(cwd, configured);
}

export function loadPiWebConfig(options: LoadOptions = {}): LoadedPiWebConfig {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const defaultsSelector = envValue(env, "PI_WEB_DEFAULTS_CONFIG");
  const defaultsPath = defaultsSelector === undefined ? undefined : resolve(options.cwd ?? process.cwd(), defaultsSelector);
  // A selected defaults file is deployment policy: a missing or corrupt file fails visibly.
  const defaultsRecord = defaultsPath === undefined ? undefined : readConfigObject(defaultsPath);
  const defaultsConfig = defaultsRecord === undefined ? undefined : parseFileConfig(defaultsRecord, defaultsPath ?? path);
  const exists = existsSync(path);
  const record = exists ? readConfigObject(path) : {};
  const config = parseFileConfig(record, path);
  if (Object.hasOwn(record, "sessionNaming") || (defaultsRecord !== undefined && Object.hasOwn(defaultsRecord, "sessionNaming"))) {
    migrateSessionNamingConfig({
      agentDir: effectiveAgentConfig(env, overlayPiWebConfig(defaultsConfig ?? {}, config)).dir,
      saved: { path, record },
      ...(defaultsPath !== undefined && defaultsRecord !== undefined ? { defaults: { path: defaultsPath, record: defaultsRecord } } : {}),
      cleanup: () => {
        if (defaultsPath !== undefined && realpathSync(path) === realpathSync(defaultsPath)) {
          throw new Error(`Writable config selects deployment defaults; remove obsolete sessionNaming manually: ${path}`);
        }
        const current = readConfigObject(path);
        if (JSON.stringify(current["sessionNaming"]) !== JSON.stringify(record["sessionNaming"])) {
          throw new Error(`sessionNaming changed during migration: ${path}`);
        }
        Reflect.deleteProperty(current, "sessionNaming");
        writeWritableConfig(path, current);
      },
    });
  }
  return {
    path, exists, config,
    ...(defaultsPath !== undefined && defaultsConfig !== undefined ? { defaultsPath, defaultsConfig } : {}),
    deprecatedAgentInputs: detectDeprecatedAgentInputs(env, overlayPiWebConfig(defaultsConfig ?? {}, config)),
  };
}

export function effectivePiWebConfig(options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  return resolveEffectivePiWebConfig(loadPiWebConfig(options), options);
}

export function resolveEffectivePiWebConfig(loaded: LoadedPiWebConfig, options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  const env = options.env ?? process.env;
  // These bootstrap policy aliases are not file settings, but invalid explicit
  // values must fail startup rather than be discovered during a background check.
  versionChecksDisabled(env);
  const config = applyPiWebConfigEnv(overlayPiWebConfig(loaded.defaultsConfig ?? {}, loaded.config), env);
  const agent = effectiveAgentConfig(env, config);
  const workbenchIntegration = effectiveWorkbenchIntegrationConfig(env, config.workbenchIntegration);
  const auditLog = effectiveAuditLogConfig(config.auditLog, env);
  const speech = effectiveSpeechConfig(config.speech);
  return {
    ...loaded,
    config: {
      ...config,
      ...(workbenchIntegration === undefined ? {} : { workbenchIntegration }),
      auditLog,
      uploads: effectiveUploadsConfig(config),
      attachments: effectiveAttachmentsConfig(config),
      // Absent speech config keeps dictation off; the daemon advertises its
      // capability only when an endpoint is configured.
      ...(speech === undefined ? {} : { speech }),
      // Always resolved (on by default) so the effective config is the single
      // source of truth for the runtime state and the settings UI toggle.
      spawnSessions: spawnSessionsEnabled({}, config),
      sessionMessages: sessionMessagesEnabled({}, config),
      // Resolved on by default like the other capabilities,
      // so the effective config is the single source of truth for the runtime
      // state and the settings UI toggle.
      subsessions: subsessionsEnabled({}, config),
      // Always resolved (on by default); the user is present for every ask.
      askUser: askUserEnabled({}, config),
      // Always resolved (on by default); inert outside Docker deployments.
      environmentFacts: environmentFactsEnabled({}, config),
      // Always resolved; the unattended-dialog safety valve, not a gate.
      extensionDialogsTimeoutMs: config.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS,
      agent: { command: agent.command, dir: agent.dir },
    },
  };
}

export function effectiveAuditLogConfig(configured?: PiWebConfig["auditLog"], env: NodeJS.ProcessEnv = process.env): NonNullable<PiWebConfig["auditLog"]> {
  const managementBaseUrl = envValue(env, "PI_WEB_AUDIT_ES_URL") ?? configured?.managementMode?.baseUrl;
  const managementEnabled = configured?.managementMode?.enabled ?? managementBaseUrl !== undefined;
  if (managementEnabled && managementBaseUrl === undefined) throw new Error("PI WEB management audit requires auditLog.managementMode.baseUrl or PI_WEB_AUDIT_ES_URL");
  return {
    normalMode: {
      enabled: configured?.normalMode?.enabled ?? true,
      retentionDays: configured?.normalMode?.retentionDays ?? DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS,
      maxRows: configured?.normalMode?.maxRows ?? DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS,
    },
    managementMode: {
      enabled: managementEnabled,
      ...(managementBaseUrl === undefined ? {} : { baseUrl: effectiveHttpUrl(managementBaseUrl, "PI_WEB_AUDIT_ES_URL/auditLog.managementMode.baseUrl") }),
      indexPrefix: configured?.managementMode?.indexPrefix ?? DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX,
      retentionDays: configured?.managementMode?.retentionDays ?? DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS,
    },
  };
}

export function effectiveWorkbenchIntegrationConfig(
  env: NodeJS.ProcessEnv = process.env,
  configured?: PiWebConfig["workbenchIntegration"],
): PiWebConfig["workbenchIntegration"] | undefined {
  const baseUrl = envValue(env, "PI_WEB_WORKBENCH_URL") ?? configured?.baseUrl;
  const mcpUrl = envValue(env, "PI_WEB_MCP_URL") ?? configured?.mcpUrl;
  if (baseUrl === undefined && mcpUrl === undefined && configured === undefined) return undefined;
  if (baseUrl === undefined || mcpUrl === undefined) throw new Error("PI WEB workbench integration requires both baseUrl and mcpUrl");
  return {
    baseUrl: effectiveHttpUrl(baseUrl, "PI_WEB_WORKBENCH_URL/workbenchIntegration.baseUrl"),
    mcpUrl: effectiveHttpUrl(mcpUrl, "PI_WEB_MCP_URL/workbenchIntegration.mcpUrl"),
    requestTimeoutMs: positiveIntegerEnv(env, "PI_WEB_WORKBENCH_TIMEOUT_MS") ?? configured?.requestTimeoutMs ?? DEFAULT_WORKBENCH_REQUEST_TIMEOUT_MS,
    capabilityTimeoutMs: positiveIntegerEnv(env, "PI_WEB_MCP_TIMEOUT_MS") ?? configured?.capabilityTimeoutMs ?? DEFAULT_WORKBENCH_CAPABILITY_TIMEOUT_MS,
    skillBundleMaxBytes: positiveIntegerEnv(env, "PI_WEB_SKILL_BUNDLE_MAX_BYTES") ?? configured?.skillBundleMaxBytes ?? DEFAULT_WORKBENCH_SKILL_BUNDLE_MAX_BYTES,
    skillFileMaxBytes: positiveIntegerEnv(env, "PI_WEB_SKILL_FILE_MAX_BYTES") ?? configured?.skillFileMaxBytes ?? DEFAULT_WORKBENCH_SKILL_FILE_MAX_BYTES,
    skillFileCountMax: positiveIntegerEnv(env, "PI_WEB_SKILL_FILE_COUNT_MAX") ?? configured?.skillFileCountMax ?? DEFAULT_WORKBENCH_SKILL_FILE_COUNT_MAX,
  };
}

function effectiveHttpUrl(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PI WEB config ${key} must be an absolute HTTP URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw new Error(`PI WEB config ${key} must be an absolute HTTP URL without credentials`);
  }
  return value;
}

function positiveIntegerEnv(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const value = envValue(env, key);
  if (value === undefined) return undefined;
  return parseMaxUploadBytes(value, key);
}

export function savePiWebConfig(config: PiWebConfig, options: LoadOptions = {}): LoadedPiWebConfig {
  rejectRetiredSessionNaming(config, "save request");
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const defaultsSelector = envValue(env, "PI_WEB_DEFAULTS_CONFIG");
  if (defaultsSelector !== undefined) {
    const defaultsPath = resolve(options.cwd ?? process.cwd(), defaultsSelector);
    const canonicalPath = (candidate: string): string => existsSync(candidate) ? realpathSync(candidate) : resolve(candidate);
    if (canonicalPath(path) === canonicalPath(defaultsPath)) throw new Error("PI_WEB_CONFIG must not select the PI_WEB_DEFAULTS_CONFIG file");
    // Validate deployment policy before touching the writable file.
    parseFileConfig(readConfigObject(defaultsPath), defaultsPath);
  }
  const normalized = parsePiWebConfig(piWebConfigRecord(config), path);
  effectiveAgentConfig(env, normalized);
  const existing = readExistingConfigObject(path);
  if (existing["agent"] !== undefined) parseAgentConfig(existing["agent"], path);
  for (const key of [...Object.keys(PI_WEB_CONFIG_DEFINITIONS), "agent", "respectProjectTrust"]) {
    if ((key === "normalAuth" || key === "auditLog" || key === "managementEmbed") && !Object.hasOwn(normalized, key)) continue;
    Reflect.deleteProperty(existing, key);
  }
  const merged = { ...existing, ...piWebConfigRecord(normalized) };
  writeWritableConfig(path, merged);
  return loadPiWebConfig(options);
}

/** Replace the resolved target atomically, preserving config symlinks and permissions. */
function writeWritableConfig(path: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const destination = existsSync(path) ? realpathSync(path) : path;
  const mode = existsSync(destination) ? statSync(destination).mode & 0o777 : 0o600;
  const temporary = join(dirname(destination), `.${basename(destination)}.${String(process.pid)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode, flag: "wx" });
    chmodSync(temporary, mode);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readConfigObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`PI WEB config must be a JSON object: ${path}`);
  return parsed;
}

function parseFileConfig(record: Record<string, unknown>, path: string): PiWebConfig {
  const sanitized = { ...record };
  Reflect.deleteProperty(sanitized, "sessionNaming");
  return parsePiWebConfig(sanitized, path);
}

function rejectRetiredSessionNaming(value: object, path: string): void {
  if (Object.hasOwn(value, "sessionNaming")) throw new Error(`PI WEB config sessionNaming is retired; use the Session naming Pi package config: ${path}`);
}

function parseEnvJson(value: string, source: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (error) {
    throw new Error(`${source} must contain valid JSON`, { cause: error });
  }
}

function piWebConfigEnvOverrides(env: NodeJS.ProcessEnv): { config: PiWebConfig; enforced: Record<string, string> } {
  let config: PiWebConfig = {};
  const enforced: Record<string, string> = {};
  for (const [key, kind] of Object.entries(PI_WEB_CONFIG_DEFINITIONS)) {
    const canonicalName = piWebConfigEnvName(key);
    const name = key === "port" && env[canonicalName] === undefined ? "PORT" : canonicalName;
    const value = env[name];
    if (value === undefined) continue;
    // Existing scalar overrides treat empty as unset; new strings (notably
    // installationName) retain meaningful empty values. Booleans are strict.
    if (value === "" && ["host", "port", "allowedHosts", "maxUploadBytes"].includes(key)) continue;
    let parsed: unknown;
    if (kind === "json") parsed = parseEnvJson(value, name);
    else if (kind === "boolean") parsed = parsePiWebEnvBoolean(value, name);
    else if (kind === "number") parsed = value === "" ? NaN : Number(value);
    else if (kind === "allowedHosts") parsed = parseAllowedHostsEnv(value);
    else parsed = value;
    if (key === "plugins" && isRecord(parsed)) {
      for (const [id, plugin] of Object.entries(parsed)) {
        if (isRecord(plugin)) requireKnownConfigKeys(plugin, ["enabled", "settings"], `plugins.${id}`, name);
      }
    }
    let override: PiWebConfig;
    try {
      override = parsePiWebConfig({ [key]: parsed }, name);
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    config = overlayPiWebConfig(config, override);
    for (const pointer of piWebConfigSettingPointers(override)) enforced[pointer] = name;
  }
  const archiveDir = envValue(env, "PI_WEB_SESSION_ARCHIVE_DIR");
  if (archiveDir !== undefined) {
    config = overlayPiWebConfig(config, { sessionArchive: parseSessionArchiveConfig({ directory: archiveDir }, "PI_WEB_SESSION_ARCHIVE_DIR") });
    enforced["/sessionArchive/directory"] = "PI_WEB_SESSION_ARCHIVE_DIR";
  }
  return { config, enforced };
}

/** Apply after project participation as well as machine overlays. Does not mutate inputs. */
export function applyPiWebConfigEnv(config: PiWebConfig, env: NodeJS.ProcessEnv): PiWebConfig {
  return overlayPiWebConfig(config, piWebConfigEnvOverrides(env).config);
}

/** JSON-pointer setting identifiers mapped to the controlling environment variable. */
export function piWebConfigEnforcedSettings(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return piWebConfigEnvOverrides(env).enforced;
}

/** Sources describe explicit settings only; omitted entries inherit built-in/feature defaults. */
export function piWebConfigSources(loaded: LoadedPiWebConfig, options: LoadOptions = {}): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const pointer of piWebConfigSettingPointers(loaded.defaultsConfig ?? {})) sources[pointer] = "defaults";
  for (const pointer of piWebConfigSettingPointers(loaded.config)) sources[pointer] = "config";
  Object.assign(sources, piWebConfigEnforcedSettings(options.env ?? process.env));
  return sources;
}

function readExistingConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`PI WEB config must be a JSON object: ${path}`);
  return parsed;
}

function piWebConfigRecord(config: PiWebConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => value !== undefined && (Object.hasOwn(PI_WEB_CONFIG_DEFINITIONS, key) || key === "agent")));
}

function requireKnownConfigKeys(value: Record<string, unknown>, allowed: readonly string[], key: string, path: string): void {
  const unknown = Object.keys(value).find((name) => !allowed.includes(name));
  if (unknown !== undefined) throw new Error(`PI WEB config ${key} has unknown key ${JSON.stringify(unknown)}: ${path}`);
}

function requireNamespaceKeys(value: Record<string, unknown>, key: string, path: string): void {
  requireKnownConfigKeys(value, piWebConfigNamespaceFields(key) ?? [], key, path);
}

export function parsePiWebConfig(value: Record<string, unknown>, path = "request", pathHost: AgentPathHost = "current"): PiWebConfig {
  rejectRetiredSessionNaming(value, path);
  for (const key of ["pathAccess", "uploads", "attachments"]) {
    const namespace = value[key];
    if (isRecord(namespace)) requireNamespaceKeys(namespace, key, path);
  }
  return {
    ...parseBasePiWebConfig(value, path),
    ...(value["askUser"] === undefined ? {} : { askUser: parseAskUser(value["askUser"], path) }),
    ...(value["environmentFacts"] === undefined ? {} : { environmentFacts: parseBooleanKey(value["environmentFacts"], "environmentFacts", path) }),
    ...(value["extensionDialogsTimeoutMs"] !== undefined ? { extensionDialogsTimeoutMs: parseExtensionDialogsTimeoutMs(value["extensionDialogsTimeoutMs"], path) } : {}),
    ...(value["agent"] !== undefined ? { agent: parseAgentConfig(value["agent"], path, pathHost) } : {}),
  };
}

function parseMaxUploadBytes(value: unknown, key: string, path = "environment"): number {
  const bytes = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error(`PI WEB config ${key} must be a positive integer: ${path}`);
  return bytes;
}

/**
 * Whether LLMs may start new sessions via the spawn_session tool. On by default
 * (spawned sessions appear in the session list, so humans notice them); set the
 * env var `PI_WEB_SPAWN_SESSIONS` or the `spawnSessions` config key to `false`
 * to disable. The env var takes precedence over the config file.
 */
export function spawnSessionsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_SPAWN_SESSIONS"];
  if (fromEnv !== undefined) return parsePiWebEnvBoolean(fromEnv, "PI_WEB_SPAWN_SESSIONS");
  return config.spawnSessions ?? true;
}

/** Whether LLMs may send messages to other sessions, independently of spawning. */
export function sessionMessagesEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_SESSION_MESSAGES"];
  if (fromEnv !== undefined) return parsePiWebEnvBoolean(fromEnv, "PI_WEB_SESSION_MESSAGES");
  return config.sessionMessages ?? true;
}

/**
 * Whether LLMs may start tracked child sessions via the spawn_subsession
 * family of tools. On by default; set the env var `PI_WEB_SUBSESSIONS` or the
 * `subsessions` config key to `false` to disable. The env var takes precedence
 * over the config file. Subsessions also require spawnSessions to be enabled
 * (they share the same project-scope resolver).
 */
export function subsessionsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_SUBSESSIONS"];
  if (fromEnv !== undefined) return parsePiWebEnvBoolean(fromEnv, "PI_WEB_SUBSESSIONS");
  return config.subsessions ?? true;
}

export function environmentFactsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_ENVIRONMENT_FACTS"];
  if (fromEnv !== undefined) return parsePiWebEnvBoolean(fromEnv, "PI_WEB_ENVIRONMENT_FACTS");
  return config.environmentFacts ?? true;
}

function parseBooleanKey(value: unknown, key: string, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`PI WEB config ${key} must be a boolean: ${path}`);
  return value;
}

function parseAskUser(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`PI WEB config askUser must be a boolean: ${path}`);
  return value;
}

function parseExtensionDialogsTimeoutMs(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TIMER_TIMEOUT_MS) {
    throw new Error(`PI WEB config extensionDialogsTimeoutMs must be a non-negative integer no greater than ${String(MAX_TIMER_TIMEOUT_MS)}: ${path}`);
  }
  return value;
}

/**
 * Whether LLMs may post a question set to the browser via the ask_user tool. On
 * by default: the questions land in the session the user is already watching and
 * nothing happens without them acting. Set the env var `PI_WEB_ASK_USER` or the
 * `askUser` config key to `false` to remove the tool. The env var takes
 * precedence over the config file.
 */
export function askUserEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_ASK_USER"];
  if (fromEnv !== undefined) return parsePiWebEnvBoolean(fromEnv, "PI_WEB_ASK_USER");
  return config.askUser ?? true;
}

const OFFLINE_ENV_KEYS = ["PI_WEB_OFFLINE", "PI_OFFLINE"] as const;

/**
 * Whether the operator asked PI WEB (or pi itself) to stay offline, meaning
 * background network access must be skipped. Both aliases use strict boolean
 * parsing; false/0 no longer enable offline mode.
 *
 * Deliberately narrower than `piWebStatus`'s update-check suppression: the
 * `*_SKIP_VERSION_CHECK` keys only silence release lookups, while these keys ask
 * for no background network at all.
 */
export function offlineModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Validate every supplied alias, even if another alias already enables offline mode.
  const values = OFFLINE_ENV_KEYS.map((key) => {
    const value = env[key];
    return value === undefined ? false : parsePiWebEnvBoolean(value, key);
  });
  return values.some(Boolean);
}

function parseString(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`PI WEB config ${key} must be a non-empty string: ${path}`);
  return value;
}

const AGENT_CONFIG_KEYS = new Set(["command", "dir"]);
const SAFE_BARE_AGENT_COMMAND_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/u;

export type AgentPathHost = "current" | "portable";

export function parseAgentConfig(value: unknown, path: string, pathHost: AgentPathHost = "current"): NonNullable<PiWebConfig["agent"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config agent must be an object: ${path}`);
  const unknownKey = Object.keys(value).find((key) => !AGENT_CONFIG_KEYS.has(key));
  if (unknownKey !== undefined) throw new Error(`PI WEB config agent contains unknown key ${JSON.stringify(unknownKey)}: ${path}`);
  const command = value["command"];
  const dir = value["dir"];
  return {
    ...(command !== undefined ? { command: parseAgentCommand(command, "agent.command", path, pathHost) } : {}),
    ...(dir !== undefined ? { dir: parseAgentDir(dir, "agent.dir", path, pathHost) } : {}),
  };
}

function parseAgentCommand(value: unknown, key: string, path: string, pathHost: AgentPathHost): string {
  const command = parseString(value, key, path).trim();
  if (!isSafeAgentCommand(command, pathHost)) {
    const absoluteLabel = pathHost === "current" ? "host-absolute" : "absolute";
    throw new Error(`PI WEB config ${key} must be a safe bare executable name or ${absoluteLabel} executable path: ${path}`);
  }
  return command;
}

function parseAgentDir(value: unknown, key: string, path: string, pathHost: AgentPathHost): string {
  const dir = parseString(value, key, path).trim();
  const isAbsoluteDir = pathHost === "current" ? isHostAbsoluteAgentDir(dir) : isPortableAbsoluteAgentPath(dir);
  if (!isAbsoluteDir && !isHomePath(dir, pathHost)) {
    const absoluteLabel = pathHost === "current" ? "a host-absolute" : "an absolute";
    throw new Error(`PI WEB config ${key} must be ${absoluteLabel} path or start with ~: ${path}`);
  }
  return dir;
}

function resolveAgentDirPath(value: string, env: NodeJS.ProcessEnv, key: string, path: string): string {
  const parsed = parseAgentDir(value, key, path, "current");
  const expanded = expandHomePath(parsed, env);
  if (!isHostAbsoluteAgentDir(expanded)) {
    throw new Error(`PI WEB config ${key} must resolve to a host-absolute path: ${path}`);
  }
  return normalize(expanded);
}

export function isSafeAgentCommandForHost(value: string): boolean {
  return isSafeAgentCommand(value, "current");
}

function isSafeAgentCommand(value: string, pathHost: AgentPathHost): boolean {
  if (value === "" || value !== value.trim() || value.includes("\0") || /[\s;&|`$<>]/u.test(value)) return false;
  if (SAFE_BARE_AGENT_COMMAND_PATTERN.test(value)) return true;
  if (pathHost === "current") return isAbsolute(value) && basename(value) !== "";
  return isAbsoluteLike(value) && value.split(/[\\/]/u).at(-1) !== "";
}

export function isHostAbsoluteAgentDir(value: string): boolean {
  return isSafeAgentDirPath(value) && isAbsolute(value);
}

function isPortableAbsoluteAgentPath(value: string): boolean {
  return isSafeAgentDirPath(value) && isAbsoluteLike(value);
}

function isSafeAgentDirPath(value: string): boolean {
  return value !== "" && value === value.trim() && !hasControlCharacter(value);
}

function parseAllowedHostsEnv(value: string): string[] | true {
  if (value.trim() === "true") return true;
  if (["[", "{", "\"", "]"].some((prefix) => value.trimStart().startsWith(prefix)) || /^(false|null)$/.test(value.trim())) {
    return parseBasePiWebConfig({ allowedHosts: parseEnvJson(value, "PI_WEB_ALLOWED_HOSTS") }, "PI_WEB_ALLOWED_HOSTS").allowedHosts ?? [];
  }
  return value.split(",").map((host) => host.trim()).filter((host) => host !== "");
}

export function parsePathAccessConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["pathAccess"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config pathAccess must be an object: ${path}`);
  requireNamespaceKeys(value, "pathAccess", path);
  const allowedPaths = value["allowedPaths"];
  return {
    ...(allowedPaths !== undefined ? { allowedPaths: parseAllowedPaths(allowedPaths, path) } : {}),
  };
}

function parseAllowedPaths(value: unknown, path: string): string[] {
  if (!isNonEmptyStringArray(value)) throw new Error(`PI WEB config pathAccess.allowedPaths must be an array of non-empty strings: ${path}`);
  return value;
}

export function parseUploadsConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["uploads"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config uploads must be an object: ${path}`);
  requireNamespaceKeys(value, "uploads", path);
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "uploads.defaultFolder", path) } : {}),
  };
}

export function parseAttachmentsConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["attachments"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config attachments must be an object: ${path}`);
  requireNamespaceKeys(value, "attachments", path);
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "attachments.defaultFolder", path) } : {}),
  };
}

function parseWorkspaceRelativeFolder(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`PI WEB config ${key} must be a non-empty workspace-relative path: ${path}`);
  if (isAbsoluteLike(value)) throw new Error(`PI WEB config ${key} must be workspace-relative: ${path}`);
  const parts = value.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) throw new Error(`PI WEB config ${key} must be a non-empty workspace-relative path: ${path}`);
  if (parts.some((part) => part === "..")) throw new Error(`PI WEB config ${key} must not contain path traversal: ${path}`);
  return parts.join("/");
}


function isHomePath(value: string, pathHost: AgentPathHost): boolean {
  return value === "~" || value.startsWith("~/") || ((pathHost === "portable" || process.platform === "win32") && value.startsWith("~\\"));
}

function expandHomePath(value: string, env: NodeJS.ProcessEnv): string {
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();
  if (value === "~") return home;
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) return join(home, value.slice(2));
  return value;
}

function defaultAgentDirForCommand(command: string, env: NodeJS.ProcessEnv): string {
  if (usesPiCodingAgentStateCompatibility(command)) return expandHomePath("~/.pi/agent", env);
  throw new Error(`PI WEB config agent.dir or ${PI_WEB_AGENT_DIR_ENV} is required when agent.command is ${JSON.stringify(command)}`);
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value !== undefined && value !== "" ? value : undefined;
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return isAbsolute(value) || withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//.test(withForwardSlashes);
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

export function examplePiWebConfig(config: PiWebConfig = {}): string {
  return `${JSON.stringify({ host: config.host ?? "127.0.0.1", port: config.port ?? 8504, allowedHosts: config.allowedHosts ?? [] }, null, 2)}\n`;
}
