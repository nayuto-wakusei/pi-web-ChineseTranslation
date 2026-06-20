import type { PiWebConfigValues } from "../../api";

export interface ConfigDraft {
  host: string;
  port: string;
  allowedHostsMode: "list" | "all";
  allowedHostsText: string;
}

export function emptyConfigDraft(): ConfigDraft {
  return { host: "", port: "", allowedHostsMode: "list", allowedHostsText: "" };
}

export function draftFromConfig(config: PiWebConfigValues): ConfigDraft {
  return {
    host: config.host ?? "",
    port: config.port === undefined ? "" : String(config.port),
    allowedHostsMode: config.allowedHosts === true ? "all" : "list",
    allowedHostsText: Array.isArray(config.allowedHosts) ? config.allowedHosts.join("\n") : "",
  };
}

export function configFromDraft(draft: ConfigDraft, baseConfig: PiWebConfigValues = {}): PiWebConfigValues {
  const config: PiWebConfigValues = {
    ...(baseConfig.shortcuts === undefined ? {} : { shortcuts: baseConfig.shortcuts }),
    ...(baseConfig.plugins === undefined ? {} : { plugins: baseConfig.plugins }),
    ...(baseConfig.spawnSessions === undefined ? {} : { spawnSessions: baseConfig.spawnSessions }),
    ...(baseConfig.subsessions === undefined ? {} : { subsessions: baseConfig.subsessions }),
  };
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

function parseAllowedHostsText(value: string): string[] {
  return value.split(/[\n,]/u).map((host) => host.trim()).filter((host) => host !== "");
}
