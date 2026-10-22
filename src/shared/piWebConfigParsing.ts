import { requireDefaultThemePreference } from "./themePreference.js";
import { requireDefaultStreamingBehavior } from "./streamingBehavior.js";
import { UserFacingError, type TranslationParameters } from "./i18n.js";
import type { PiWebConfigValues } from "./apiTypes.js";
import { isPiWebPluginId, piWebPluginIdPattern } from "./pluginIds.js";
import { isKnownThinkingLevel } from "./thinkingLevels.js";

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
    ...(config.defaultTheme !== undefined ? { defaultTheme: config.defaultTheme } : {}),
    ...(config.defaultStreamingBehavior !== undefined ? { defaultStreamingBehavior: config.defaultStreamingBehavior } : {}),
    ...(config.plugins !== undefined ? { plugins: config.plugins } : {}),
    ...(config.normalAuth !== undefined ? { normalAuth: config.normalAuth } : {}),
    ...(config.managementEmbed !== undefined ? { managementEmbed: config.managementEmbed } : {}),
    ...(config.workbenchIntegration !== undefined ? { workbenchIntegration: config.workbenchIntegration } : {}),
    ...(config.auditLog !== undefined ? { auditLog: config.auditLog } : {}),
    ...(config.pathAccess !== undefined ? { pathAccess: config.pathAccess } : {}),
    ...(config.uploads !== undefined ? { uploads: config.uploads } : {}),
    ...(config.attachments !== undefined ? { attachments: config.attachments } : {}),
    ...(config.maxUploadBytes !== undefined ? { maxUploadBytes: config.maxUploadBytes } : {}),
    ...(config.sessionNaming !== undefined ? { sessionNaming: config.sessionNaming } : {}),
    ...(config.sessionArchive !== undefined ? { sessionArchive: config.sessionArchive } : {}),
    ...(config.spawnSessions !== undefined ? { spawnSessions: config.spawnSessions } : {}),
    ...(config.subsessions !== undefined ? { subsessions: config.subsessions } : {}),
  };
}

export function parsePiWebConfig(value: Record<string, unknown>, path: string): ParsedPiWebConfig {
  return parsePiWebConfigFields(value, { format: "file", path });
}

export function parsePiWebConfigRequest(value: unknown): ParsedPiWebConfig {
  if (!isRecord(value)) throw new UserFacingError("configError.pi.web.config.update.must.include.a.config.object.ec8277", "PI WEB config update must include a config object");
  return parsePiWebConfigFields(value, { format: "request" });
}

export function parsePort(value: unknown, key: string, path = "environment"): number {
  const port = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserFacingError("configError.pi.web.config.field.must.be.an.integer.from.1.to.65535.field.2efa42", "PI WEB config {value1} must be an integer from 1 to 65535: {value2}", { value1: key, value2: path });
  return port;
}

export function parseMaxUploadBytes(value: unknown, key: string, path = "environment"): number {
  const bytes = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(bytes) || bytes < 1) throw new UserFacingError("configError.pi.web.config.field.must.be.a.positive.integer.field.e8c08b", "PI WEB config {value1} must be a positive integer: {value2}", { value1: key, value2: path });
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
    ...(value["defaultTheme"] !== undefined ? { defaultTheme: requireDefaultThemePreference(value["defaultTheme"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["defaultStreamingBehavior"] !== undefined ? { defaultStreamingBehavior: requireDefaultStreamingBehavior(value["defaultStreamingBehavior"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["plugins"] !== undefined ? { plugins: parsePlugins(value["plugins"], context) } : {}),
    ...(value["normalAuth"] !== undefined ? { normalAuth: parseNormalAuth(value["normalAuth"], context) } : {}),
    ...(value["managementEmbed"] !== undefined ? { managementEmbed: parseManagementEmbed(value["managementEmbed"], context) } : {}),
    ...(value["workbenchIntegration"] !== undefined ? { workbenchIntegration: parseWorkbenchIntegration(value["workbenchIntegration"], context) } : {}),
    ...(value["auditLog"] !== undefined ? { auditLog: parseAuditLog(value["auditLog"], context) } : {}),
    ...(value["pathAccess"] !== undefined ? { pathAccess: parsePathAccessConfig(value["pathAccess"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["uploads"] !== undefined ? { uploads: parseUploadsConfig(value["uploads"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["attachments"] !== undefined ? { attachments: parseAttachmentsConfig(value["attachments"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["maxUploadBytes"] !== undefined ? { maxUploadBytes: parseMaxUploadBytes(value["maxUploadBytes"], "maxUploadBytes", context.format === "file" ? context.path : "request") } : {}),
    ...(value["sessionNaming"] !== undefined ? { sessionNaming: parseSessionNamingConfig(value["sessionNaming"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["sessionArchive"] !== undefined ? { sessionArchive: parseSessionArchiveConfig(value["sessionArchive"], context.format === "file" ? context.path : "request") } : {}),
    ...(value["spawnSessions"] !== undefined ? { spawnSessions: parseBoolean(value["spawnSessions"], "spawnSessions", context) } : {}),
    ...(value["subsessions"] !== undefined ? { subsessions: parseBoolean(value["subsessions"], "subsessions", context) } : {}),
  };
}

export function parseSessionNamingConfig(value: unknown, source: string): NonNullable<PiWebConfigValues["sessionNaming"]> {
  if (!isRecord(value)) throw new UserFacingError("configError.sessionNaming.object", "PI WEB config sessionNaming must be an object: {source}", { source });
  const unknownKey = Object.keys(value).find((key) => key !== "model" && key !== "maxTokens" && key !== "thinkingLevel" && key !== "timeoutMs");
  if (unknownKey !== undefined) throw new UserFacingError("configError.sessionNaming.unknownKey", "PI WEB config sessionNaming has unknown key {key}: {source}", { key: JSON.stringify(unknownKey), source });
  const model = value["model"];
  const maxTokens = value["maxTokens"];
  const thinkingLevel = value["thinkingLevel"];
  const timeoutMs = value["timeoutMs"];
  if (model !== undefined && (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model))) {
    throw new UserFacingError("configError.sessionNaming.model", "PI WEB config sessionNaming.model must be an exact provider/model-id with non-empty parts: {source}", { source });
  }
  if (maxTokens !== undefined && (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new UserFacingError("configError.sessionNaming.maxTokens", "PI WEB config sessionNaming.maxTokens must be a positive safe integer: {source}", { source });
  }
  if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !isKnownThinkingLevel(thinkingLevel))) {
    throw new UserFacingError("configError.sessionNaming.thinkingLevel", "PI WEB config sessionNaming.thinkingLevel must be a known thinking level: {source}", { source });
  }
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)) {
    throw new UserFacingError("configError.sessionNaming.timeoutMs", "PI WEB config sessionNaming.timeoutMs must be an integer from 1 to 2147483647: {source}", { source });
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export function parseSessionArchiveConfig(value: unknown, source: string): NonNullable<PiWebConfigValues["sessionArchive"]> {
  if (!isRecord(value)) throw new UserFacingError("configError.sessionArchive.object", "PI WEB config sessionArchive must be an object: {source}", { source });
  const unknownKey = Object.keys(value).find((key) => key !== "directory");
  if (unknownKey !== undefined) throw new UserFacingError("configError.sessionArchive.unknownKey", "PI WEB config sessionArchive has unknown key {key}: {source}", { key: JSON.stringify(unknownKey), source });
  const directory = value["directory"];
  if (directory === undefined) return {};
  if (typeof directory !== "string" || directory.trim() === "" || directory.includes("\u0000")) {
    throw new UserFacingError("configError.sessionArchive.directory", "PI WEB config sessionArchive.directory must be a non-empty path: {source}", { source });
  }
  return { directory };
}

const AUDIT_LOG_KEYS = new Set(["normalMode", "managementMode"]);
const NORMAL_MODE_AUDIT_KEYS = new Set(["enabled", "retentionDays", "maxRows"]);
const MANAGEMENT_MODE_AUDIT_KEYS = new Set(["enabled", "baseUrl", "indexPrefix", "retentionDays"]);

function parseAuditLog(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["auditLog"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.auditlog.must.be.an.object.b64d0a", "PI WEB config auditLog must be an object");
  const unknownKey = Object.keys(value).find((key) => !AUDIT_LOG_KEYS.has(key));
  if (unknownKey !== undefined) throw error(context, "configError.pi.web.config.auditlog.contains.unknown.key.field.148797", "PI WEB config auditLog contains unknown key {value1}", { value1: JSON.stringify(unknownKey) });
  const normalMode = optionalAuditSection(value, "normalMode", NORMAL_MODE_AUDIT_KEYS, context);
  const managementMode = optionalAuditSection(value, "managementMode", MANAGEMENT_MODE_AUDIT_KEYS, context);
  return {
    ...(normalMode === undefined ? {} : { normalMode: {
      ...(normalMode["enabled"] === undefined ? {} : { enabled: parseBoolean(normalMode["enabled"], "auditLog.normalMode.enabled", context) }),
      ...optionalPositiveInteger(normalMode, "retentionDays", "auditLog.normalMode.retentionDays", context),
      ...optionalPositiveInteger(normalMode, "maxRows", "auditLog.normalMode.maxRows", context),
    } }),
    ...(managementMode === undefined ? {} : { managementMode: {
      ...(managementMode["enabled"] === undefined ? {} : { enabled: parseBoolean(managementMode["enabled"], "auditLog.managementMode.enabled", context) }),
      ...(managementMode["baseUrl"] === undefined ? {} : { baseUrl: parseHttpUrl(managementMode["baseUrl"], "auditLog.managementMode.baseUrl", context) }),
      ...(managementMode["indexPrefix"] === undefined ? {} : { indexPrefix: parseElasticsearchIndexPrefix(managementMode["indexPrefix"], context) }),
      ...optionalPositiveInteger(managementMode, "retentionDays", "auditLog.managementMode.retentionDays", context),
    } }),
  };
}

function optionalAuditSection(value: Record<string, unknown>, key: string, keys: ReadonlySet<string>, context: ParseContext): Record<string, unknown> | undefined {
  const section = value[key];
  if (section === undefined) return undefined;
  if (!isRecord(section) || Array.isArray(section)) throw error(context, "configError.pi.web.config.auditlog.field.must.be.an.object.6247aa", "PI WEB config auditLog.{value1} must be an object", { value1: key });
  const unknownKey = Object.keys(section).find((candidate) => !keys.has(candidate));
  if (unknownKey !== undefined) throw error(context, "configError.pi.web.config.auditlog.field.contains.unknown.key.field.8aeda4", "PI WEB config auditLog.{value1} contains unknown key {value2}", { value1: key, value2: JSON.stringify(unknownKey) });
  return section;
}

function parseElasticsearchIndexPrefix(value: unknown, context: ParseContext): string {
  const prefix = parseString(value, "auditLog.managementMode.indexPrefix", context);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(prefix) || prefix === "." || prefix === "..") {
    throw error(context, "configError.pi.web.config.auditlog.managementmode.indexprefix.must.be.a.lowercase.elasticsearch.index..1ed4c8", "PI WEB config auditLog.managementMode.indexPrefix must be a lowercase Elasticsearch index prefix");
  }
  return prefix;
}

const WORKBENCH_INTEGRATION_KEYS = new Set([
  "baseUrl",
  "mcpUrl",
  "requestTimeoutMs",
  "capabilityTimeoutMs",
  "skillBundleMaxBytes",
  "skillFileMaxBytes",
  "skillFileCountMax",
]);

function parseWorkbenchIntegration(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["workbenchIntegration"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.workbenchintegration.must.be.an.object.4449e0", "PI WEB config workbenchIntegration must be an object");
  const unknownKey = Object.keys(value).find((key) => !WORKBENCH_INTEGRATION_KEYS.has(key));
  if (unknownKey !== undefined) throw error(context, "configError.pi.web.config.workbenchintegration.contains.unknown.key.field.05f9a2", "PI WEB config workbenchIntegration contains unknown key {value1}", { value1: JSON.stringify(unknownKey) });
  return {
    baseUrl: parseHttpUrl(value["baseUrl"], "workbenchIntegration.baseUrl", context),
    mcpUrl: parseHttpUrl(value["mcpUrl"], "workbenchIntegration.mcpUrl", context),
    ...optionalPositiveInteger(value, "requestTimeoutMs", "workbenchIntegration.requestTimeoutMs", context),
    ...optionalPositiveInteger(value, "capabilityTimeoutMs", "workbenchIntegration.capabilityTimeoutMs", context),
    ...optionalPositiveInteger(value, "skillBundleMaxBytes", "workbenchIntegration.skillBundleMaxBytes", context),
    ...optionalPositiveInteger(value, "skillFileMaxBytes", "workbenchIntegration.skillFileMaxBytes", context),
    ...optionalPositiveInteger(value, "skillFileCountMax", "workbenchIntegration.skillFileCountMax", context),
  };
}

function parseHttpUrl(value: unknown, key: string, context: ParseContext): string {
  const text = parseString(value, key, context);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw error(context, "configError.pi.web.config.field.must.be.an.absolute.http.url.b28922", "PI WEB config {value1} must be an absolute HTTP URL", { value1: key });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw error(context, "configError.pi.web.config.field.must.be.an.absolute.http.url.without.credentials.6b63c3", "PI WEB config {value1} must be an absolute HTTP URL without credentials", { value1: key });
  }
  return url.toString();
}

function optionalPositiveInteger(
  value: Record<string, unknown>,
  field: string,
  key: string,
  context: ParseContext,
): Record<string, number> {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) throw error(context, "configError.pi.web.config.field.must.be.a.positive.integer.1b5503", "PI WEB config {value1} must be a positive integer", { value1: key });
  return { [field]: candidate };
}

function parseRequestPort(value: unknown): number {
  if (typeof value !== "number") throw new UserFacingError("configError.pi.web.config.port.must.be.a.number.8ac8cd", "PI WEB config port must be a number");
  return value;
}

function parseString(value: unknown, key: string, context: ParseContext): string {
  if (context.format === "request") {
    if (key === "host") {
      if (typeof value !== "string") throw new UserFacingError("configError.pi.web.config.host.must.be.a.string.c8d259", "PI WEB config host must be a string");
      return value;
    }
    if (typeof value !== "string" || value === "") throw new UserFacingError("configError.pi.web.config.field.must.be.a.non.empty.string.528b5a", "PI WEB config {value1} must be a non-empty string", { value1: key });
    return value;
  }
  if (typeof value !== "string" || value === "") throw new UserFacingError("configError.pi.web.config.field.must.be.a.non.empty.string.field.b7df01", "PI WEB config {value1} must be a non-empty string: {value2}", { value1: key, value2: context.path });
  return value;
}

function parseBoolean(value: unknown, key: string, context: ParseContext): boolean {
  if (typeof value !== "boolean") throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.field.must.be.a.boolean.1aa5d4", "PI WEB config {value1} must be a boolean", { value1: key }) : new UserFacingError("configError.pi.web.config.field.must.be.a.boolean.field.2352b1", "PI WEB config {value1} must be a boolean: {value2}", { value1: key, value2: context.path }));
  return value;
}

function parseAllowedHosts(value: unknown, context: ParseContext): string[] | true {
  if (value === true) return true;
  if (context.format === "request") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new UserFacingError("configError.pi.web.config.allowedhosts.must.be.true.or.an.array.of.strings.4d8d83", "PI WEB config allowedHosts must be true or an array of strings");
    }
    return value;
  }
  if (!isNonEmptyStringArray(value)) {
    throw new UserFacingError("configError.pi.web.config.allowedhosts.must.be.true.or.an.array.of.non.empty.strings.field.2c3c10", "PI WEB config allowedHosts must be true or an array of non-empty strings: {value1}", { value1: context.path });
  }
  return value;
}

function parseShortcuts(value: unknown, context: ParseContext): Record<string, string | null> {
  if (!isRecord(value)) throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.shortcuts.must.be.an.object.146099", "PI WEB config shortcuts must be an object") : new UserFacingError("configError.pi.web.config.shortcuts.must.be.an.object.field.2896e2", "PI WEB config shortcuts must be an object: {value1}", { value1: context.path }));
  return Object.fromEntries(Object.entries(value).map(([actionId, shortcut]) => {
    if (shortcut !== null && (typeof shortcut !== "string" || shortcut === "")) {
      throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.shortcut.values.must.be.non.empty.strings.or.null.2025e9", "PI WEB config shortcut values must be non-empty strings or null") : new UserFacingError("configError.pi.web.config.shortcut.values.must.be.non.empty.strings.or.null.field.907fe7", "PI WEB config shortcut values must be non-empty strings or null: {value1}", { value1: context.path }));
    }
    return [actionId, shortcut];
  }));
}

function parsePlugins(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["plugins"]> {
  if (!isRecord(value) || Array.isArray(value)) throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.plugins.must.be.an.object.2d870f", "PI WEB config plugins must be an object") : new UserFacingError("configError.pi.web.config.plugins.must.be.an.object.field.5b8b9c", "PI WEB config plugins must be an object: {value1}", { value1: context.path }));
  return Object.fromEntries(Object.entries(value).map(([pluginId, config]) => {
    if (!isPiWebPluginId(pluginId)) throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.plugin.ids.are.invalid.674ddc", "PI WEB config plugin ids are invalid") : new UserFacingError("configError.pi.web.config.plugin.ids.must.match.field.field.26310e", "PI WEB config plugin ids must match {value1}: {value2}", { value1: piWebPluginIdPattern.source, value2: context.path }));
    if (!isRecord(config) || Array.isArray(config)) throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.plugin.entries.must.be.objects.45e442", "PI WEB config plugin entries must be objects") : new UserFacingError("configError.pi.web.config.plugin.entries.must.be.objects.field.0c5cad", "PI WEB config plugin entries must be objects: {value1}", { value1: context.path }));
    const enabled = config["enabled"];
    if (enabled !== undefined && typeof enabled !== "boolean") throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.plugin.enabled.values.must.be.booleans.ab8416", "PI WEB config plugin enabled values must be booleans") : new UserFacingError("configError.pi.web.config.plugin.enabled.values.must.be.booleans.field.55c1ea", "PI WEB config plugin enabled values must be booleans: {value1}", { value1: context.path }));
    const settings = config["settings"];
    if (settings !== undefined && (!isRecord(settings) || Array.isArray(settings))) throw (context.format === "request" ? new UserFacingError("configError.pi.web.config.plugin.settings.must.be.objects.efc582", "PI WEB config plugin settings must be objects") : new UserFacingError("configError.pi.web.config.plugin.settings.must.be.objects.field.2abb70", "PI WEB config plugin settings must be objects: {value1}", { value1: context.path }));
    return [pluginId, config];
  }));
}

function parseNormalAuth(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["normalAuth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.normalauth.must.be.an.object.7d1093", "PI WEB config normalAuth must be an object");
  return {
    ...(value["passwordHash"] === undefined ? {} : { passwordHash: parseNormalAuthPasswordHash(value["passwordHash"], context) }),
  };
}

function parseNormalAuthPasswordHash(value: unknown, context: ParseContext): string {
  if (typeof value !== "string") throw error(context, "configError.pi.web.config.normalauth.passwordhash.must.use.pbkdf2.sha256.format.711f8e", "PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");
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
    throw error(context, "configError.pi.web.config.normalauth.passwordhash.must.use.pbkdf2.sha256.format.711f8e", "PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");
  }
  return value;
}

function isBase64Url(value: string): boolean {
  return value !== "" && /^[A-Za-z0-9_-]+$/u.test(value);
}

function parseManagementEmbed(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["managementEmbed"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.managementembed.must.be.an.object.d4e00b", "PI WEB config managementEmbed must be an object");
  const enabled = value["enabled"];
  const projectRoot = value["projectRoot"];
  const auth = value["auth"];
  const sandbox = value["sandbox"];
  const tools = value["tools"];
  const allowPrivileged = value["allowPrivileged"];
  return {
    ...(enabled === undefined ? {} : { enabled: parseBoolean(enabled, "managementEmbed.enabled", context) }),
    ...(projectRoot === undefined ? {} : { projectRoot: parseString(projectRoot, "managementEmbed.projectRoot", context) }),
    ...(auth === undefined ? {} : { auth: parseManagementEmbedAuth(auth, context) }),
    ...(sandbox === undefined ? {} : { sandbox: parseManagementEmbedSandbox(sandbox, context) }),
    ...(tools === undefined ? {} : { tools: parseManagementEmbedTools(tools, context) }),
    ...(allowPrivileged === undefined ? {} : { allowPrivileged: parseBoolean(allowPrivileged, "managementEmbed.allowPrivileged", context) }),
  };
}

function parseManagementEmbedAuth(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["auth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.managementembed.auth.must.be.an.object.91b8b1", "PI WEB config managementEmbed.auth must be an object");
  if (value["introspectionUrl"] !== undefined || value["serviceSecretEnv"] !== undefined) throw error(context, "configError.pi.web.config.managementembed.auth.only.supports.local.signed.tokens.26661d", "PI WEB config managementEmbed.auth only supports local signed tokens");
  return {
    ...(value["sharedSecretEnv"] === undefined ? {} : { sharedSecretEnv: parseString(value["sharedSecretEnv"], "managementEmbed.auth.sharedSecretEnv", context) }),
    ...(value["issuer"] === undefined ? {} : { issuer: parseString(value["issuer"], "managementEmbed.auth.issuer", context) }),
    ...(value["audience"] === undefined ? {} : { audience: parseString(value["audience"], "managementEmbed.auth.audience", context) }),
  };
}

function parseManagementEmbedSandbox(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["sandbox"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.managementembed.sandbox.must.be.an.object.c37d2b", "PI WEB config managementEmbed.sandbox must be an object");
  return {
    ...(value["pythonExecutable"] === undefined ? {} : { pythonExecutable: parseString(value["pythonExecutable"], "managementEmbed.sandbox.pythonExecutable", context) }),
    ...(value["env"] === undefined ? {} : { env: parseStringRecord(value["env"], "managementEmbed.sandbox.env", context) }),
  };
}

function parseManagementEmbedTools(value: unknown, context: ParseContext): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["tools"]> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.managementembed.tools.must.be.an.object.ae99af", "PI WEB config managementEmbed.tools must be an object");
  return {
    ...(value["allow"] === undefined ? {} : { allow: parseStringArray(value["allow"], "managementEmbed.tools.allow", context) }),
    ...(value["deny"] === undefined ? {} : { deny: parseStringArray(value["deny"], "managementEmbed.tools.deny", context) }),
    ...(value["permissions"] === undefined ? {} : { permissions: parseBooleanRecord(value["permissions"], "managementEmbed.tools.permissions", context) }),
  };
}

function parseStringRecord(value: unknown, key: string, context: ParseContext): Record<string, string> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.field.must.be.an.object.c80b6e", "PI WEB config {value1} must be an object", { value1: key });
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "string") throw error(context, "configError.pi.web.config.field.values.must.be.strings.a88a9e", "PI WEB config {value1} values must be strings", { value1: key });
    return [recordKey, recordValue];
  }));
}

function parseBooleanRecord(value: unknown, key: string, context: ParseContext): Record<string, boolean> {
  if (!isRecord(value) || Array.isArray(value)) throw error(context, "configError.pi.web.config.field.must.be.an.object.c80b6e", "PI WEB config {value1} must be an object", { value1: key });
  return Object.fromEntries(Object.entries(value).map(([recordKey, recordValue]) => {
    if (typeof recordValue !== "boolean") throw error(context, "configError.pi.web.config.field.values.must.be.booleans.76c1fc", "PI WEB config {value1} values must be booleans", { value1: key });
    return [recordKey, recordValue];
  }));
}

function parseStringArray(value: unknown, key: string, context: ParseContext): string[] {
  if (!isNonEmptyStringArray(value)) throw error(context, "configError.pi.web.config.field.must.be.an.array.of.non.empty.strings.4284cb", "PI WEB config {value1} must be an array of non-empty strings", { value1: key });
  return value;
}

export function parsePathAccessConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["pathAccess"]> {
  if (!isRecord(value)) throw new UserFacingError("configError.pi.web.config.pathaccess.must.be.an.object.field.2f49ab", "PI WEB config pathAccess must be an object: {value1}", { value1: path });
  const allowedPaths = value["allowedPaths"];
  return {
    ...(allowedPaths !== undefined ? { allowedPaths: parseAllowedPaths(allowedPaths, path) } : {}),
  };
}

function parseAllowedPaths(value: unknown, path: string): string[] {
  if (!isNonEmptyStringArray(value)) throw new UserFacingError("configError.pi.web.config.pathaccess.allowedpaths.must.be.an.array.of.non.empty.strings.field.2ed16e", "PI WEB config pathAccess.allowedPaths must be an array of non-empty strings: {value1}", { value1: path });
  return value;
}

export function parseUploadsConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["uploads"]> {
  if (!isRecord(value)) throw new UserFacingError("configError.pi.web.config.uploads.must.be.an.object.field.a050be", "PI WEB config uploads must be an object: {value1}", { value1: path });
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "uploads.defaultFolder", path) } : {}),
  };
}

export function parseAttachmentsConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["attachments"]> {
  if (!isRecord(value)) throw new Error(`PI WEB config attachments must be an object: ${path}`);
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "attachments.defaultFolder", path) } : {}),
  };
}

function parseWorkspaceRelativeFolder(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new UserFacingError("configError.pi.web.config.field.must.be.a.non.empty.workspace.relative.path.field.81526e", "PI WEB config {value1} must be a non-empty workspace-relative path: {value2}", { value1: key, value2: path });
  if (isAbsoluteLike(value)) throw new UserFacingError("configError.pi.web.config.field.must.be.workspace.relative.field.57e29b", "PI WEB config {value1} must be workspace-relative: {value2}", { value1: key, value2: path });
  const parts = value.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) throw new UserFacingError("configError.pi.web.config.field.must.be.a.non.empty.workspace.relative.path.field.81526e", "PI WEB config {value1} must be a non-empty workspace-relative path: {value2}", { value1: key, value2: path });
  if (parts.some((part) => part === "..")) throw new UserFacingError("configError.pi.web.config.field.must.not.contain.path.traversal.field.cb1d61", "PI WEB config {value1} must not contain path traversal: {value2}", { value1: key, value2: path });
  return parts.join("/");
}

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//.test(withForwardSlashes);
}

function error(context: ParseContext, key: string, fallback: string, parameters: TranslationParameters = {}): UserFacingError {
  return context.format === "request"
    ? new UserFacingError(key, fallback, parameters)
    : new UserFacingError(`${key}.file`, `${fallback}: {configPath}`, { ...parameters, configPath: context.path });
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}
