import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { PiWebAgentDirEnvSource, PiWebConfigValues } from "./shared/apiTypes.js";
import { isPiCompanionCommand, usesPiCodingAgentStateCompatibility } from "./shared/activeAgentProfile.js";
import { parsePiWebConfig as parseBasePiWebConfig, piWebConfigRecord as basePiWebConfigRecord } from "./shared/piWebConfigParsing.js";

export { isPiCompanionCommand };

export type PiWebConfig = PiWebConfigValues;

export interface LoadedPiWebConfig {
  path: string;
  exists: boolean;
  config: PiWebConfig;
}

export interface EffectivePiWebConfig extends Omit<PiWebConfig, "uploads" | "spawnSessions" | "subsessions" | "askUser" | "environmentFacts" | "agent" | "extensionDialogsTimeoutMs"> {
  uploads: NonNullable<PiWebConfig["uploads"]>;
  spawnSessions: boolean;
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

/**
 * Default auto-cancel delay for extension dialogs whose extension set no
 * `timeout` of its own: five minutes. `extensionDialogsTimeoutMs: 0` waits
 * forever. Tunes the unattended-dialog safety valve only; dialogs are always
 * enabled.
 */
export const DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS = 300_000;
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

export interface EffectivePiWebAgentConfig {
  command: string;
  dir: string;
  sessionDirEnvKeys: string[];
}

export function effectiveAgentConfig(env: NodeJS.ProcessEnv = process.env, config: Pick<PiWebConfig, "agent"> = {}): EffectivePiWebAgentConfig {
  const command = parseAgentCommand(envValue(env, PI_WEB_AGENT_COMMAND_ENV) ?? config.agent?.command ?? DEFAULT_AGENT_COMMAND, "agent.command", "environment", "current");
  // Keep the deprecated PI WEB alias first for compatibility, then the
  // canonical Pi SDK variable, then the project config alias and SDK default.
  const configuredDir = envValue(env, PI_WEB_AGENT_DIR_ENV) ?? envValue(env, PI_CODING_AGENT_DIR_ENV) ?? config.agent?.dir ?? defaultAgentDirForCommand(command, env);
  return {
    command,
    dir: resolveAgentDirPath(configuredDir, env, "agent.dir", "environment"),
    sessionDirEnvKeys: agentSessionDirEnvKeys(command),
  };
}

export function agentSessionDirEnvKeys(command = DEFAULT_AGENT_COMMAND): string[] {
  void command;
  return [PI_WEB_AGENT_SESSION_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV];
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

export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): number {
  const fromEnv = env["PI_WEB_MAX_UPLOAD_BYTES"];
  if (fromEnv !== undefined && fromEnv !== "") {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  if (config.maxUploadBytes !== undefined) return config.maxUploadBytes;
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export function piWebDataDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_DATA_DIR"];
  if (configured === undefined || configured === "") return defaultPiWebDataDir();
  return resolve(cwd, configured);
}

export function piWebConfigPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_CONFIG"];
  if (configured === undefined || configured === "") return defaultPiWebConfigPath(env);
  return resolve(cwd, configured);
}

export function loadPiWebConfig(options: LoadOptions = {}): LoadedPiWebConfig {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  if (!existsSync(path)) return { path, exists: false, config: {} };

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`PI WEB config must be a JSON object: ${path}`);

  return { path, exists: true, config: parsePiWebConfig(parsed, path) };
}

export function effectivePiWebConfig(options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  return resolveEffectivePiWebConfig(loadPiWebConfig(options), options);
}

export function resolveEffectivePiWebConfig(loaded: LoadedPiWebConfig, options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  const env = options.env ?? process.env;
  const host = env["PI_WEB_HOST"];
  const port = env["PI_WEB_PORT"] ?? env["PORT"];
  const allowedHosts = env["PI_WEB_ALLOWED_HOSTS"];
  const maxUpload = env["PI_WEB_MAX_UPLOAD_BYTES"];
  const agent = effectiveAgentConfig(env, loaded.config);
  const workbenchIntegration = effectiveWorkbenchIntegrationConfig(env, loaded.config.workbenchIntegration);
  const auditLog = effectiveAuditLogConfig(loaded.config.auditLog, env);
  return {
    ...loaded,
    config: {
      ...loaded.config,
      ...(host !== undefined && host !== "" ? { host } : {}),
      ...(port !== undefined && port !== "" ? { port: parsePort(port, "PI_WEB_PORT") } : {}),
      ...(allowedHosts !== undefined && allowedHosts !== "" ? { allowedHosts: parseAllowedHostsEnv(allowedHosts) } : {}),
      ...(maxUpload !== undefined && maxUpload !== "" ? { maxUploadBytes: parseMaxUploadBytes(maxUpload, "PI_WEB_MAX_UPLOAD_BYTES") } : {}),
      ...(workbenchIntegration === undefined ? {} : { workbenchIntegration }),
      auditLog,
      uploads: effectiveUploadsConfig(loaded.config),
      // Always resolved (on by default) so the effective config is the single
      // source of truth for the runtime state and the settings UI toggle.
      spawnSessions: spawnSessionsEnabled(env, loaded.config),
      // Beta capability, resolved off by default.
      subsessions: subsessionsEnabled(env, loaded.config),
      // Always resolved (on by default); the user is present for every ask.
      askUser: askUserEnabled(env, loaded.config),
      environmentFacts: environmentFactsEnabled(env, loaded.config),
      // Always resolved; the unattended-dialog safety valve, not a gate.
      extensionDialogsTimeoutMs: loaded.config.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS,
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
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const normalized = parsePiWebConfig(piWebConfigRecord(config), path);
  effectiveAgentConfig(env, normalized);
  const existing = readExistingConfigObject(path);
  if (existing["agent"] !== undefined) parseAgentConfig(existing["agent"], path);
  delete existing["host"];
  delete existing["port"];
  delete existing["allowedHosts"];
  delete existing["shortcuts"];
  delete existing["plugins"];
  delete existing["pathAccess"];
  delete existing["uploads"];
  delete existing["maxUploadBytes"];
  delete existing["spawnSessions"];
  delete existing["subsessions"];
  delete existing["askUser"];
  delete existing["environmentFacts"];
  delete existing["agent"];
  delete existing["workbenchIntegration"];
  const merged = { ...existing, ...piWebConfigRecord(normalized) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return { path, exists: true, config: normalized };
}

function readExistingConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`PI WEB config must be a JSON object: ${path}`);
  return parsed;
}

function piWebConfigRecord(config: PiWebConfig): Record<string, unknown> {
  return {
    ...basePiWebConfigRecord(config),
    ...(config.askUser === undefined ? {} : { askUser: config.askUser }),
    ...(config.environmentFacts === undefined ? {} : { environmentFacts: config.environmentFacts }),
    ...(config.extensionDialogsTimeoutMs === undefined ? {} : { extensionDialogsTimeoutMs: config.extensionDialogsTimeoutMs }),
    ...(config.agent !== undefined ? { agent: config.agent } : {}),
  };
}

function parsePiWebConfig(value: Record<string, unknown>, path: string): PiWebConfig {
  return {
    ...parseBasePiWebConfig(value, path),
    ...(value["askUser"] === undefined ? {} : { askUser: parseAskUser(value["askUser"], path) }),
    ...(value["environmentFacts"] === undefined ? {} : { environmentFacts: parseBooleanKey(value["environmentFacts"], "environmentFacts", path) }),
    ...(value["extensionDialogsTimeoutMs"] !== undefined ? { extensionDialogsTimeoutMs: parseExtensionDialogsTimeoutMs(value["extensionDialogsTimeoutMs"], path) } : {}),
    ...(value["agent"] !== undefined ? { agent: parseAgentConfig(value["agent"], path) } : {}),
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
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv === "1" || fromEnv.toLowerCase() === "true";
  return config.spawnSessions ?? true;
}

/**
 * Beta: whether LLMs may start tracked child sessions via the spawn_subsession
 * family of tools. Off by default while the capability stabilizes, so it can
 * ship in main without affecting releases; enable with the env var
 * `PI_WEB_SUBSESSIONS` or the `subsessions` config key. The env var takes
 * precedence over the config file. Subsessions also require spawnSessions to be
 * enabled (they share the same project-scope resolver).
 */
export function subsessionsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_SUBSESSIONS"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv === "1" || fromEnv.toLowerCase() === "true";
  return config.subsessions ?? false;
}

export function environmentFactsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_ENVIRONMENT_FACTS"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv === "1" || fromEnv.toLowerCase() === "true";
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
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`PI WEB config extensionDialogsTimeoutMs must be a non-negative integer: ${path}`);
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
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv === "1" || fromEnv.toLowerCase() === "true";
  return config.askUser ?? true;
}

const OFFLINE_ENV_KEYS = ["PI_WEB_OFFLINE", "PI_OFFLINE"] as const;

/**
 * Whether the operator asked PI WEB (or pi itself) to stay offline, meaning
 * background network access must be skipped. Matches the "set and non-empty"
 * semantics used for the other runtime-only env switches.
 *
 * Deliberately narrower than `piWebStatus`'s update-check suppression: the
 * `*_SKIP_VERSION_CHECK` keys only silence release lookups, while these keys ask
 * for no background network at all.
 */
export function offlineModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return OFFLINE_ENV_KEYS.some((key) => isEnvSet(env[key]));
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

function parsePort(value: unknown, key: string, path = "environment"): number {
  const port = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PI WEB config ${key} must be an integer from 1 to 65535: ${path}`);
  return port;
}

function parseAllowedHostsEnv(value: string): string[] | true {
  if (value === "true") return true;
  return value.split(",").map((host) => host.trim()).filter((host) => host !== "");
}

export function parsePathAccessConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["pathAccess"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config pathAccess must be an object: ${path}`);
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
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "uploads.defaultFolder", path) } : {}),
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
