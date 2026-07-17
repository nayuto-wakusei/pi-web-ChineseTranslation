import type { PiWebAgentDirEnvSource, PiWebCapability, PiWebComponentStatus, PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues, PiWebInstallationInfo, PiWebPluginConfigMap, PiWebPluginInfo, PiWebPluginsResponse, PiWebPluginScope, PiWebReleaseStatus, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebServiceComponent, PiWebShortcutConfig, PiWebStatusMessage, PiWebStatusResponse, PiWebStatusSeverity } from "../../../../shared/apiTypes";
import { parseActiveAgentProfileDescriptor } from "../../../../shared/activeAgentProfile";
import { parseKnownPiWebCapabilities } from "../../../../shared/capabilities";
import { arrayOf, isRecord, optionalField, optionalNumber, optionalString, requireBoolean, requireRecord, requireString } from "./core";

export function parsePiWebConfigResponse(value: unknown): PiWebConfigResponse {
  const record = requireRecord(value);
  return {
    path: requireString(record, "path"),
    exists: requireBoolean(record, "exists"),
    config: parsePiWebConfigValues(record["config"]),
    effectiveConfig: parsePiWebConfigValues(record["effectiveConfig"]),
    envOverrides: parsePiWebConfigEnvOverrides(record["envOverrides"]),
  };
}

function parsePiWebConfigValues(value: unknown): PiWebConfigValues {
  const record = requireRecord(value);
  return {
    ...optionalField("host", optionalString(record, "host")),
    ...optionalField("port", optionalNumber(record, "port")),
    ...optionalField("allowedHosts", optionalAllowedHosts(record["allowedHosts"])),
    ...optionalField("shortcuts", optionalShortcuts(record["shortcuts"])),
    ...optionalField("plugins", optionalPlugins(record["plugins"])),
    ...optionalField("normalAuth", optionalNormalAuth(record["normalAuth"])),
    ...optionalField("managementEmbed", optionalManagementEmbed(record["managementEmbed"])),
    ...optionalField("pathAccess", optionalPathAccess(record["pathAccess"])),
    ...optionalField("uploads", optionalUploads(record["uploads"])),
    ...optionalField("maxUploadBytes", optionalNumber(record, "maxUploadBytes")),
    ...optionalField("spawnSessions", optionalBoolean(record, "spawnSessions")),
    ...optionalField("subsessions", optionalBoolean(record, "subsessions")),
    ...optionalField("agent", optionalAgent(record["agent"])),
  };
}

function optionalAgent(value: unknown): PiWebConfigValues["agent"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB agent field");
  return {
    ...optionalField("command", optionalString(value, "command")),
    ...optionalField("dir", optionalString(value, "dir")),
  };
}

function optionalNormalAuth(value: unknown): PiWebConfigValues["normalAuth"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB normalAuth field");
  return {
    ...optionalField("passwordHash", optionalString(value, "passwordHash")),
  };
}

function optionalAllowedHosts(value: unknown): PiWebConfigValues["allowedHosts"] | undefined {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error("Invalid PI WEB allowedHosts field");
}

function optionalPathAccess(value: unknown): PiWebConfigValues["pathAccess"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB pathAccess field");
  const allowedPaths = value["allowedPaths"];
  return {
    ...optionalField("allowedPaths", optionalStringArray(allowedPaths, "pathAccess.allowedPaths")),
  };
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string" && item !== "")) return value;
  throw new Error(`Invalid PI WEB ${field} field`);
}

function optionalUploads(value: unknown): PiWebConfigValues["uploads"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB uploads field");
  return {
    ...optionalField("defaultFolder", optionalString(value, "defaultFolder")),
  };
}

function optionalShortcuts(value: unknown): PiWebShortcutConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB shortcuts field");
  return Object.fromEntries(Object.entries(value).map(([actionId, shortcut]) => {
    if (shortcut !== null && (typeof shortcut !== "string" || shortcut === "")) throw new Error("Invalid PI WEB shortcut field");
    return [actionId, shortcut];
  }));
}

function optionalPlugins(value: unknown): PiWebPluginConfigMap | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB plugins field");
  return Object.fromEntries(Object.entries(value).map(([pluginId, config]) => {
    if (!isRecord(config) || Array.isArray(config)) throw new Error("Invalid PI WEB plugin config field");
    const enabled = config["enabled"];
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("Invalid PI WEB plugin enabled field");
    const settings = config["settings"];
    if (settings !== undefined && (!isRecord(settings) || Array.isArray(settings))) throw new Error("Invalid PI WEB plugin settings field");
    return [pluginId, config];
  }));
}

function parsePiWebConfigEnvOverrides(value: unknown): PiWebConfigEnvOverrides {
  const record = requireRecord(value);
  return {
    host: requireBoolean(record, "host"),
    port: requireBoolean(record, "port"),
    allowedHosts: requireBoolean(record, "allowedHosts"),
    spawnSessions: requireBoolean(record, "spawnSessions"),
    subsessions: requireBoolean(record, "subsessions"),
    agentCommand: optionalBoolean(record, "agentCommand") ?? false,
    agentDir: optionalBoolean(record, "agentDir") ?? false,
    ...optionalAgentDirSource(record),
    agentSessionDir: optionalBoolean(record, "agentSessionDir") ?? false,
  };
}

function optionalManagementEmbed(value: unknown): PiWebConfigValues["managementEmbed"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB managementEmbed field");
  return {
    ...optionalField("enabled", optionalBoolean(value, "enabled")),
    ...optionalField("projectRoot", optionalString(value, "projectRoot")),
    ...optionalField("auth", optionalStringFields(value["auth"], ["sharedSecretEnv", "issuer", "audience"], "managementEmbed.auth")),
    ...optionalField("sandbox", optionalManagementSandbox(value["sandbox"])),
    ...optionalField("tools", optionalManagementTools(value["tools"])),
  };
}

function optionalStringFields(value: unknown, keys: string[], field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`Invalid PI WEB ${field} field`);
  return Object.fromEntries(keys.flatMap((key) => {
    const parsed = optionalString(value, key);
    return parsed === undefined ? [] : [[key, parsed]];
  }));
}

function optionalManagementSandbox(value: unknown): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["sandbox"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB managementEmbed.sandbox field");
  return {
    ...optionalField("pythonExecutable", optionalString(value, "pythonExecutable")),
    ...optionalField("env", optionalStringRecord(value["env"], "managementEmbed.sandbox.env")),
  };
}

function optionalManagementTools(value: unknown): NonNullable<NonNullable<PiWebConfigValues["managementEmbed"]>["tools"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid PI WEB managementEmbed.tools field");
  return {
    ...optionalField("allow", optionalStringArray(value["allow"], "managementEmbed.tools.allow")),
    ...optionalField("deny", optionalStringArray(value["deny"], "managementEmbed.tools.deny")),
    ...optionalField("permissions", optionalBooleanRecord(value["permissions"], "managementEmbed.tools.permissions")),
  };
}

function optionalStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== "string")) throw new Error(`Invalid PI WEB ${field} field`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, requireRecordValueString(entry, field)]));
}

function optionalBooleanRecord(value: unknown, field: string): Record<string, boolean> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== "boolean")) throw new Error(`Invalid PI WEB ${field} field`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, requireRecordValueBoolean(entry, field)]));
}

function requireRecordValueString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid PI WEB ${field} field`);
  return value;
}

function requireRecordValueBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid PI WEB ${field} field`);
  return value;
}

function optionalAgentDirSource(record: Record<string, unknown>): { agentDirSource?: PiWebAgentDirEnvSource } {
  const value = record["agentDirSource"];
  if (value === undefined) return {};
  if (value !== "pi-web" && value !== "pi-compatibility") throw new Error("Invalid PI WEB agentDirSource field");
  return { agentDirSource: value };
}

export function parsePiWebPluginsResponse(value: unknown): PiWebPluginsResponse {
  const record = requireRecord(value);
  return { plugins: arrayOf(parsePiWebPluginInfo)(record["plugins"]) };
}

function parsePiWebPluginInfo(value: unknown): PiWebPluginInfo {
  const record = requireRecord(value);
  return {
    id: requireString(record, "id"),
    module: requireString(record, "module"),
    source: requireString(record, "source"),
    scope: parsePiWebPluginScope(record["scope"]),
    machineSpecific: parseOptionalBoolean(record["machineSpecific"], "machineSpecific") ?? false,
    enabled: requireBoolean(record, "enabled"),
  };
}

function parsePiWebPluginScope(value: unknown): PiWebPluginScope {
  if (value !== "bundled" && value !== "local" && value !== "user" && value !== "project") throw new Error("Invalid PI WEB plugin scope");
  return value;
}

export function parsePiWebStatusResponse(value: unknown): PiWebStatusResponse {
  const record = requireRecord(value);
  return {
    packageName: requireString(record, "packageName"),
    generatedAt: requireString(record, "generatedAt"),
    components: parsePiWebComponents(record["components"]),
    release: parsePiWebReleaseStatus(record["release"]),
    commands: parsePiWebCommands(record["commands"]),
    messages: arrayOf(parsePiWebStatusMessage)(record["messages"]),
  };
}

export function parsePiWebRuntimeResponse(value: unknown): PiWebRuntimeResponse {
  const record = requireRecord(value);
  return {
    packageName: requireString(record, "packageName"),
    generatedAt: requireString(record, "generatedAt"),
    components: parsePiWebRuntimeComponents(record["components"]),
    capabilities: parsePiWebCapabilities(record["capabilities"]),
  };
}

function parsePiWebComponents(value: unknown): PiWebStatusResponse["components"] {
  const record = requireRecord(value);
  return { web: parsePiWebComponentStatus(record["web"]), sessiond: parsePiWebComponentStatus(record["sessiond"]) };
}

export function parsePiWebRuntimeComponents(value: unknown): PiWebRuntimeResponse["components"] {
  const record = requireRecord(value);
  return { web: parsePiWebRuntimeComponent(record["web"]), sessiond: parsePiWebRuntimeComponent(record["sessiond"]) };
}

function parsePiWebRuntimeComponent(value: unknown): PiWebRuntimeComponent {
  const record = requireRecord(value);
  const component = parsePiWebServiceComponent(record["component"]);
  const activeAgentProfileValue = record["activeAgentProfile"];
  const activeAgentProfile = activeAgentProfileValue === undefined ? undefined : parseActiveAgentProfileDescriptor(activeAgentProfileValue);
  if (activeAgentProfileValue !== undefined && (component !== "sessiond" || activeAgentProfile === undefined)) throw new Error("Invalid active agent profile descriptor");
  return {
    component,
    label: requireString(record, "label"),
    ...optionalField("runtimeVersion", optionalString(record, "runtimeVersion")),
    available: requireBoolean(record, "available"),
    capabilities: parsePiWebCapabilities(record["capabilities"]),
    ...optionalField("activeAgentProfile", activeAgentProfile),
    ...optionalField("error", optionalString(record, "error")),
  };
}

export function parsePiWebComponentStatus(value: unknown): PiWebComponentStatus {
  const record = requireRecord(value);
  return {
    component: parsePiWebServiceComponent(record["component"]),
    label: requireString(record, "label"),
    ...optionalField("runtimeVersion", optionalString(record, "runtimeVersion")),
    ...optionalField("installedVersion", optionalString(record, "installedVersion")),
    stale: requireBoolean(record, "stale"),
    available: requireBoolean(record, "available"),
    ...optionalField("installation", optionalPiWebInstallationInfo(record["installation"])),
    ...optionalField("error", optionalString(record, "error")),
  };
}

function optionalPiWebInstallationInfo(value: unknown): PiWebInstallationInfo | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value);
  const kind = requireString(record, "kind");
  if (kind !== "pi-package" && kind !== "npm-global" && kind !== "local" && kind !== "docker" && kind !== "unknown") throw new Error("Invalid PI WEB installation kind");
  const scope = record["scope"];
  if (scope !== undefined && scope !== "user" && scope !== "project") throw new Error("Invalid PI WEB installation scope");
  const dockerMode = record["dockerMode"];
  if (dockerMode !== undefined && dockerMode !== "runtime" && dockerMode !== "dev") throw new Error("Invalid PI WEB Docker mode");
  return {
    kind,
    ...optionalField("path", optionalString(record, "path")),
    ...optionalField("source", optionalString(record, "source")),
    ...(scope === undefined ? {} : { scope }),
    ...optionalField("npmRoot", optionalString(record, "npmRoot")),
    ...(dockerMode === undefined ? {} : { dockerMode }),
  };
}

function parsePiWebReleaseStatus(value: unknown): PiWebReleaseStatus {
  const record = requireRecord(value);
  return {
    packageName: requireString(record, "packageName"),
    ...optionalField("latestVersion", optionalString(record, "latestVersion")),
    updateAvailable: requireBoolean(record, "updateAvailable"),
    ...optionalField("checkedAt", optionalString(record, "checkedAt")),
    ...(record["skipped"] === true ? { skipped: true } : {}),
    ...optionalField("error", optionalString(record, "error")),
  };
}

function parsePiWebCommands(value: unknown): PiWebStatusResponse["commands"] {
  const record = requireRecord(value);
  return {
    ...optionalField("update", optionalString(record, "update")),
    ...optionalField("restart", optionalString(record, "restart")),
    ...optionalField("restartWeb", optionalString(record, "restartWeb")),
    ...optionalField("restartSessiond", optionalString(record, "restartSessiond")),
    ...optionalField("status", optionalString(record, "status")),
  };
}

function parsePiWebStatusMessage(value: unknown): PiWebStatusMessage {
  const record = requireRecord(value);
  return {
    id: requireString(record, "id"),
    severity: parsePiWebStatusSeverity(record["severity"]),
    title: requireString(record, "title"),
    body: requireString(record, "body"),
    ...optionalField("command", optionalString(record, "command")),
  };
}

function parsePiWebServiceComponent(value: unknown): PiWebServiceComponent {
  if (value !== "web" && value !== "sessiond") throw new Error("Invalid PI WEB service component");
  return value;
}

export function parsePiWebCapabilities(value: unknown): PiWebCapability[] {
  const capabilities = parseKnownPiWebCapabilities(value);
  if (capabilities === undefined) throw new Error("Invalid PI WEB capabilities");
  return capabilities;
}

function parsePiWebStatusSeverity(value: unknown): PiWebStatusSeverity {
  if (value !== "info" && value !== "warning" && value !== "error") throw new Error("Invalid PI WEB status severity");
  return value;
}

function parseOptionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`Expected optional boolean field: ${key}`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`Invalid PI WEB ${key} field`);
  return value;
}
