import type { PiWebConfigValues } from "../../api";

export interface GatewayServerConfigDraft {
  host: string;
  port: string;
  allowedHostsMode: "list" | "all";
  allowedHostsText: string;
}

export interface MachineAccessConfigDraft {
  allowedPathsText: string;
  uploadDefaultFolder: string;
  attachmentDefaultFolder: string;
}

export interface AgentProfileConfigDraft {
  command: string;
  dir: string;
}

export function emptyGatewayServerConfigDraft(): GatewayServerConfigDraft {
  return { host: "", port: "", allowedHostsMode: "list", allowedHostsText: "" };
}

export function emptyMachineAccessConfigDraft(): MachineAccessConfigDraft {
  return { allowedPathsText: "", uploadDefaultFolder: "", attachmentDefaultFolder: "" };
}

export function emptyAgentProfileConfigDraft(): AgentProfileConfigDraft {
  return { command: "", dir: "" };
}

export function gatewayServerDraftFromConfig(config: PiWebConfigValues): GatewayServerConfigDraft {
  return {
    host: config.host ?? "",
    port: config.port === undefined ? "" : String(config.port),
    allowedHostsMode: config.allowedHosts === true ? "all" : "list",
    allowedHostsText: Array.isArray(config.allowedHosts) ? config.allowedHosts.join("\n") : "",
  };
}

export function machineAccessDraftFromConfig(config: PiWebConfigValues): MachineAccessConfigDraft {
  return {
    allowedPathsText: config.pathAccess?.allowedPaths?.join("\n") ?? "",
    uploadDefaultFolder: config.uploads?.defaultFolder ?? "",
    attachmentDefaultFolder: config.attachments?.defaultFolder ?? "",
  };
}

export function agentProfileDraftFromConfig(config: PiWebConfigValues): AgentProfileConfigDraft {
  return {
    command: config.agent?.command ?? "",
    dir: config.agent?.dir ?? "",
  };
}

export function agentProfileConfigPatchFromDraft(draft: AgentProfileConfigDraft): PiWebConfigValues {
  const command = draft.command.trim();
  const dir = draft.dir.trim();
  return {
    agent: {
      ...(command === "" ? {} : { command }),
      ...(dir === "" ? {} : { dir }),
    },
  };
}

export function agentProfileDraftMatchesConfig(draft: AgentProfileConfigDraft, config: PiWebConfigValues): boolean {
  const normalizedDraft = agentProfileConfigPatchFromDraft(draft).agent ?? {};
  const configured = config.agent ?? {};
  return normalizedDraft.command === configured.command && normalizedDraft.dir === configured.dir;
}

export function gatewayServerConfigFromDraft(draft: GatewayServerConfigDraft, baseConfig: PiWebConfigValues = {}): PiWebConfigValues {
  const config = preservedGatewayConfigRemainder(baseConfig);
  const host = draft.host.trim();
  const port = draft.port.trim();
  if (host !== "") config.host = host;
  if (port !== "") {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("端口必须是 1 到 65535 之间的整数。");
    config.port = parsed;
  }
  config.allowedHosts = draft.allowedHostsMode === "all" ? true : parseAllowedHostsText(draft.allowedHostsText);
  return config;
}

export function machineAccessConfigPatchFromDraft(draft: MachineAccessConfigDraft): PiWebConfigValues {
  const allowedPaths = parseAllowedPathsText(draft.allowedPathsText);
  const uploadDefaultFolder = normalizeWorkspaceRelativeFolder(draft.uploadDefaultFolder, "上传默认文件夹");
  const attachmentDefaultFolder = normalizeWorkspaceRelativeFolder(draft.attachmentDefaultFolder, "附件默认文件夹");
  return {
    pathAccess: { allowedPaths },
    uploads: uploadDefaultFolder === "" ? {} : { defaultFolder: uploadDefaultFolder },
    attachments: attachmentDefaultFolder === "" ? {} : { defaultFolder: attachmentDefaultFolder },
  };
}

function preservedGatewayConfigRemainder(baseConfig: PiWebConfigValues): PiWebConfigValues {
  return {
    ...(baseConfig.shortcuts === undefined ? {} : { shortcuts: baseConfig.shortcuts }),
    ...(baseConfig.plugins === undefined ? {} : { plugins: baseConfig.plugins }),
    ...(baseConfig.normalAuth === undefined ? {} : { normalAuth: baseConfig.normalAuth }),
    ...(baseConfig.pathAccess === undefined ? {} : { pathAccess: baseConfig.pathAccess }),
    ...(baseConfig.uploads === undefined ? {} : { uploads: baseConfig.uploads }),
    ...(baseConfig.attachments === undefined ? {} : { attachments: baseConfig.attachments }),
    ...(baseConfig.maxUploadBytes === undefined ? {} : { maxUploadBytes: baseConfig.maxUploadBytes }),
    ...(baseConfig.spawnSessions === undefined ? {} : { spawnSessions: baseConfig.spawnSessions }),
    ...(baseConfig.subsessions === undefined ? {} : { subsessions: baseConfig.subsessions }),
    ...(baseConfig.askUser === undefined ? {} : { askUser: baseConfig.askUser }),
    ...(baseConfig.agent === undefined ? {} : { agent: baseConfig.agent }),
  };
}

function parseAllowedHostsText(value: string): string[] {
  return value.split(/[\n,]/u).map((host) => host.trim()).filter((host) => host !== "");
}

function parseAllowedPathsText(value: string): string[] {
  const paths = value.split("\n").map((path) => path.trim()).filter((path) => path !== "");
  const invalid = paths.find((path) => !isAbsoluteishAllowedPath(path));
  if (invalid !== undefined) throw new Error(`允许的外部路径必须是绝对路径或以 ~ 开头：${invalid}`);
  return paths;
}

function normalizeWorkspaceRelativeFolder(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (isAbsoluteLike(trimmed)) throw new Error(`${label}必须是工作区相对路径。`);
  const parts = trimmed.split(/[\\/]+/u).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return "";
  if (parts.some((part) => part === "..")) throw new Error(`${label}不能包含路径穿越。`);
  return parts.join("/");
}

function isAbsoluteishAllowedPath(path: string): boolean {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\") || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path);
}

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//u.test(withForwardSlashes);
}
