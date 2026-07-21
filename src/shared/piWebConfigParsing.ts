import type { PiWebConfigValues } from "./apiTypes.js";
import { isPiWebPluginId, piWebPluginIdPattern } from "./pluginIds.js";

export type ParsedPiWebConfig = PiWebConfigValues;

type ParseContext =
  | { format: "file"; path: string }
  | { format: "request" };

export function piWebConfigRecord(config: ParsedPiWebConfig): Record<string, unknown> {
  return {
    ...(config.host !== undefined ? { host: config.host } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
    ...(config.allowedHosts !== undefined ? { allowedHosts: config.allowedHosts } : {}),
    ...(config.shortcuts !== undefined ? { shortcuts: config.shortcuts } : {}),
    ...(config.plugins !== undefined ? { plugins: config.plugins } : {}),
    ...(config.normalAuth !== undefined ? { normalAuth: config.normalAuth } : {}),
    ...(config.managementEmbed !== undefined ? { managementEmbed: config.managementEmbed } : {}),
    ...(config.pathAccess !== undefined ? { pathAccess: config.pathAccess } : {}),
    ...(config.uploads !== undefined ? { uploads: config.uploads } : {}),
    ...(config.maxUploadBytes !== undefined ? { maxUploadBytes: config.maxUploadBytes } : {}),
    ...(config.spawnSessions !== undefined ? { spawnSessions: config.spawnSessions } : {}),
    ...(config.subsessions !== undefined ? { subsessions: config.subsessions } : {}),
  };
}

export function parsePiWebConfig(value: Record<string, unknown>, path: string): ParsedPiWebConfig {
  return parsePiWebConfigFields(value, { format: "file", path });
}

export function parsePiWebConfigRequest(value: unknown): ParsedPiWebConfig {
  if (!isRecord(value)) throw new Error("PI WEB config update must include a config object");
  return parsePiWebConfigFields(value, { format: "request" });
}

export function parsePort(value: unknown, key: string, path = "environment"): number {
  const port = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PI WEB config ${key} must be an integer from 1 to 65535: ${path}`);
  return port;
}

export function parseMaxUploadBytes(value: unknown, key: string, path = "environment"): number {
  const bytes = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error(`PI WEB config ${key} must be a positive integer: ${path}`);
  return bytes;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePiWebConfigFields(value: Record<string, unknown>, context: ParseContext): ParsedPiWebConfig {
  return {
    ...(value["host"] !== undefined ? { host: parseString(value["host"], "host", context) } : {}),
    ...(value["port"] !== undefined ? { port: context.format === "request" ? parseRequestPort(value["port"]) : parsePort(value["port"], "port", context.path) } : {}),
    ...(value["allowedHosts"] !== undefined ? { allowedHosts: parseAllowedHosts(value["allowedHosts"], context) } : {}),
    ...(value["shortcuts"] !== undefined ? { shortcuts: parseShortcuts(value["shortcuts"], context) } : {}),
    ...(value["plugins"] !== undefined ? { plugins: parsePlugins(value["plugins"], context) } : {}),
    ...(value["normalAuth"] !== undefined ? { normalAuth: parseNormalAuth(value["normalAuth"], context) } : {}),
    ...(value["managementEmbed"] !== undefined ? { managementEmbed: parseManagementEmbed(value["managementEmbed"], context) } : {}),
    ...(value["pathAccess"] !== undefined ? { pathAccess: parsePathAccessConfig(value["pathAccess"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["uploads"] !== undefined ? { uploads: parseUploadsConfig(value["uploads"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["maxUploadBytes"] !== undefined ? { maxUploadBytes: parseMaxUploadBytes(value["maxUploadBytes"], "maxUploadBytes", context.format === "file" ? context.path : "request") } : {}),
    ...(value["spawnSessions"] !== undefined ? { spawnSessions: parseBoolean(value["spawnSessions"], "spawnSessions", context) } : {}),
    ...(value["subsessions"] !== undefined ? { subsessions: parseBoolean(value["subsessions"], "subsessions", context) } : {}),
  };
}

function parseRequestPort(value: unknown): number {
  if (typeof value !== "number") throw new Error("PI WEB config port must be a number");
  return value;
}

function parseString(value: unknown, key: string, context: ParseContext): string {
  if (context.format === "request") {
    if (key === "host") {
      if (typeof value !== "string") throw new Error("PI WEB config host must be a string");
      return value;
    }
    if (typeof value !== "string" || value === "") throw new Error(`PI WEB config ${key} must be a non-empty string`);
    return value;
  }
  if (typeof value !== "string" || value === "") throw new Error(`PI WEB config ${key} must be a non-empty string: ${context.path}`);
  return value;
}

function parseBoolean(value: unknown, key: string, context: ParseContext): boolean {
  if (typeof value !== "boolean") throw new Error(context.format === "request" ? `PI WEB config ${key} must be a boolean` : `PI WEB config ${key} must be a boolean: ${context.path}`);
  return value;
}

function parseAllowedHosts(value: unknown, context: ParseContext): string[] | true {
  if (value === true) return true;
  if (context.format === "request") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error("PI WEB config allowedHosts must be true or an array of strings");
    }
    return value;
  }
  if (!isNonEmptyStringArray(value)) {
    throw new Error(`PI WEB config allowedHosts must be true or an array of non-empty strings: ${context.path}`);
  }
  return value;
}

function parseShortcuts(value: unknown, context: ParseContext): Record<string, string | null> {
  if (!isRecord(value)) throw new Error(context.format === "request" ? "PI WEB config shortcuts must be an object" : `PI WEB config shortcuts must be an object: ${context.path}`);
  return Object.fromEntries(Object.entries(value).map(([actionId, shortcut]) => {
    if (shortcut !== null && (typeof shortcut !== "string" || shortcut === "")) {
      throw new Error(context.format === "request" ? "PI WEB config shortcut values must be non-empty strings or null" : `PI WEB config shortcut values must be non-empty strings or null: ${context.path}`);
    }
    return [actionId, shortcut];
  }));
}

function parsePlugins(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["plugins"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(context.format === "request" ? "PI WEB config plugins must be an object" : `PI WEB config plugins must be an object: ${context.path}`);
  return Object.fromEntries(Object.entries(value).map(([pluginId, config]) => {
    if (!isPiWebPluginId(pluginId)) throw new Error(context.format === "request" ? "PI WEB config plugin ids are invalid" : `PI WEB config plugin ids must match ${piWebPluginIdPattern.source}: ${context.path}`);
    if (!isRecord(config) || Array.isArray(config)) throw new Error(context.format === "request" ? "PI WEB config plugin entries must be objects" : `PI WEB config plugin entries must be objects: ${context.path}`);
    const enabled = config["enabled"];
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error(context.format === "request" ? "PI WEB config plugin enabled values must be booleans" : `PI WEB config plugin enabled values must be booleans: ${context.path}`);
    const settings = config["settings"];
    if (settings !== undefined && (!isRecord(settings) || Array.isArray(settings))) throw new Error(context.format === "request" ? "PI WEB config plugin settings must be objects" : `PI WEB config plugin settings must be objects: ${context.path}`);
    return [pluginId, config];
  }));
}

function parseNormalAuth(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["normalAuth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "normalAuth must be an object"));
  return {
    ...(value["passwordHash"] === undefined ? {} : { passwordHash: parseNormalAuthPasswordHash(value["passwordHash"], context) }),
  };
}

function parseNormalAuthPasswordHash(value: unknown, context: ParseContext): string {
  if (typeof value !== "string") throw new Error(error(context, "normalAuth.passwordHash must use pbkdf2-sha256 format"));
  const [algorithm, iterationsValue, saltValue, hashValue, extra] = value.split("$");
  const iterations = Number(iterationsValue);
  if (
    algorithm !== "pbkdf2-sha256"
    || extra !== undefined
    || !Number.isInteger(iterations)
    || iterations < 1
    || saltValue === undefined
    || hashValue === undefined
    || !isBase64Url(saltValue)
    || !isBase64Url(hashValue)
  ) {
    throw new Error(error(context, "normalAuth.passwordHash must use pbkdf2-sha256 format"));
  }
  return value;
}

function isBase64Url(value: string): boolean {
  return value !== "" && /^[A-Za-z0-9_-]+$/u.test(value);
}

function parseManagementEmbed(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["managementEmbed"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "managementEmbed must be an object"));
  const enabled = value["enabled"];
  const projectRoot = value["projectRoot"];
  const auth = value["auth"];
  const sandbox = value["sandbox"];
  const tools = value["tools"];
  return {
    ...(enabled === undefined ? {} : { enabled: parseBoolean(enabled, "managementEmbed.enabled", context) }),
    ...(projectRoot === undefined ? {} : { projectRoot: parseString(projectRoot, "managementEmbed.projectRoot", context) }),
    ...(auth === undefined ? {} : { auth: parseManagementEmbedAuth(auth, context) }),
    ...(sandbox === undefined ? {} : { sandbox: parseManagementEmbedSandbox(sandbox, context) }),
    ...(tools === undefined ? {} : { tools: parseManagementEmbedTools(tools, context) }),
  };
}

function parseManagementEmbedAuth(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["auth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "managementEmbed.auth must be an object"));
  if (value["introspectionUrl"] !== undefined || value["serviceSecretEnv"] !== undefined) throw new Error(error(context, "managementEmbed.auth only supports local signed tokens"));
  return {
    ...(value["sharedSecretEnv"] === undefined ? {} : { sharedSecretEnv: parseString(value["sharedSecretEnv"], "managementEmbed.auth.sharedSecretEnv", context) }),
    ...(value["issuer"] === undefined ? {} : { issuer: parseString(value["issuer"], "managementEmbed.auth.issuer", context) }),
    ...(value["audience"] === undefined ? {} : { audience: parseString(value["audience"], "managementEmbed.auth.audience", context) }),
  };
}

function parseManagementEmbedSandbox(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["sandbox"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "managementEmbed.sandbox must be an object"));
  return {
    ...(value["pythonExecutable"] === undefined ? {} : { pythonExecutable: parseString(value["pythonExecutable"], "managementEmbed.sandbox.pythonExecutable", context) }),
    ...(value["env"] === undefined ? {} : { env: parseStringRecord(value["env"], "managementEmbed.sandbox.env", context) }),
  };
}

function parseManagementEmbedTools(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["tools"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "managementEmbed.tools must be an object"));
  return {
    ...(value["allow"] === undefined ? {} : { allow: parseStringArray(value["allow"], "managementEmbed.tools.allow", context) }),
    ...(value["deny"] === undefined ? {} : { deny: parseStringArray(value["deny"], "managementEmbed.tools.deny", context) }),
    ...(value["permissions"] === undefined ? {} : { permissions: parseBooleanRecord(value["permissions"], "managementEmbed.tools.permissions", context) }),
  };
}

function parseStringRecord(value: unknown, key: string, context: ParseContext): Record<string, string> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, `${key} must be an object`));
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "string") throw new Error(error(context, `${key} values must be strings`));
    return [recordKey, recordValue];
  }));
}

function parseBooleanRecord(value: unknown, key: string, context: ParseContext): Record<string, boolean> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, `${key} must be an object`));
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "boolean") throw new Error(error(context, `${key} values must be booleans`));
    return [recordKey, recordValue];
  }));
}

function parseStringArray(value: unknown, key: string, context: ParseContext): string[] {
  if (!isNonEmptyStringArray(value)) throw new Error(error(context, `${key} must be an array of non-empty strings`));
  return value;
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

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//.test(withForwardSlashes);
}

function error(context: ParseContext, message: string): string {
  return context.format === "request" ? `PI WEB config ${message}` : `PI WEB config ${message}: ${context.path}`;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}
