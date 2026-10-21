import { isPiWebPluginId } from "./shared/pluginIds.js";
import { createTranslator, type Translator } from "./shared/i18n.js";
import {
  disableServerPlugin,
  loadServerPluginRecoveryConfig,
  setServerPluginSafeStart,
  type ServerPluginRecoveryConfigOptions,
  type ServerPluginSafeStart,
} from "./serverPluginRecovery.js";

export interface SessionDaemonRestartPlan {
  kind: "automatic" | "manual";
  guidance: string;
  command?: string;
  perform?: () => void;
}

export interface PluginRecoveryRestartContext {
  configPath: string;
  explicitConfigPath: boolean;
}

export interface PluginRecoveryCliDependencies {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  writeLine?: (line: string) => void;
  restartPlan: (context: PluginRecoveryRestartContext) => SessionDaemonRestartPlan;
}

type PluginRecoveryCommand =
  | { kind: "help" }
  | { kind: "disable"; pluginId: string; configPath?: string; restart: boolean }
  | { kind: "safe-start-show"; configPath?: string }
  | { kind: "safe-start-set"; safeStart: ServerPluginSafeStart; configPath?: string; restart: boolean }
  | { kind: "safe-start-clear"; configPath?: string; restart: boolean };

export function pluginRecoveryHelp(t: Translator = createTranslator("en", {})): string {
  return t("pluginRecovery.help", `PI WEB server plugin recovery

Usage:
  pi-web plugins disable <plugin-id> [--config <path>] [--restart]
  pi-web plugins safe-start show [--config <path>]
  pi-web plugins safe-start set <bundled-only|none> [--config <path>] [--restart]
  pi-web plugins safe-start clear [--config <path>] [--restart]

Safe-start levels:
  bundled-only  Load bundled server plugins, including required Terminal, only.
  none          Load no server plugins; Terminal is unavailable and the kernel folder workspace remains available.

The required Terminal plugin cannot be disabled individually; use safe-start none for offline recovery.
These commands edit config offline and never contact the session daemon or import plugins.
Changes take effect after a manual session-daemon restart unless --restart can restart it automatically.`);
}

export function runPluginRecoveryCli(
  args: readonly string[],
  dependencies: PluginRecoveryCliDependencies,
  t: Translator = createTranslator("en", {}),
): void {
  const command = parsePluginRecoveryCommand(args);
  const writeLine = dependencies.writeLine ?? ((line) => { console.log(line); });
  if (command.kind === "help") {
    for (const line of pluginRecoveryHelp(t).split("\n")) writeLine(line);
    return;
  }

  const configOptions = recoveryConfigOptions(command.configPath, dependencies);
  if (command.kind === "safe-start-show") {
    const recovery = loadServerPluginRecoveryConfig(configOptions);
    writeLine(t("pluginRecovery.safeStart", "Server plugin safe start: {level}", { level: recovery.safeStart ?? "off" }));
    reportRecoveryDiagnostic(recovery.safeStartDiagnostic, writeLine, t);
    writeLine(t("pluginRecovery.config", "Config: {path}{suffix}", { path: recovery.path, suffix: recovery.exists ? "" : t("pluginRecovery.notCreated", " (not created)") }));
    return;
  }

  if (command.kind === "disable") {
    const recovery = disableServerPlugin(command.pluginId, configOptions);
    writeLine(t("pluginRecovery.disabled", "Disabled server plugin {pluginId} in {path}.", { pluginId: JSON.stringify(command.pluginId), path: recovery.path }));
    reportRecoveryDiagnostic(recovery.safeStartDiagnostic, writeLine, t);
    reportRestart(command.restart, restartPlanFor(recovery.path, command.configPath, dependencies), writeLine, t);
    return;
  }

  if (command.kind === "safe-start-set") {
    const recovery = setServerPluginSafeStart(command.safeStart, configOptions);
    writeLine(t("pluginRecovery.set", "Set server plugin safe start to {level} in {path}.", { level: command.safeStart, path: recovery.path }));
    reportRecoveryDiagnostic(recovery.safeStartDiagnostic, writeLine, t);
    reportRestart(command.restart, restartPlanFor(recovery.path, command.configPath, dependencies), writeLine, t);
    return;
  }

  const recovery = setServerPluginSafeStart(undefined, configOptions);
  writeLine(t("pluginRecovery.cleared", "Cleared server plugin safe start in {path}.", { path: recovery.path }));
  reportRecoveryDiagnostic(recovery.safeStartDiagnostic, writeLine, t);
  reportRestart(command.restart, restartPlanFor(recovery.path, command.configPath, dependencies), writeLine, t);
}

function parsePluginRecoveryCommand(args: readonly string[]): PluginRecoveryCommand {
  const parsed = parseOptions(args);
  if (parsed.help) return { kind: "help" };
  const [command, ...rest] = parsed.positional;
  if (command === undefined || command === "help") return requireNoMutationOptions(parsed, { kind: "help" });

  if (command === "disable") {
    const [pluginId, ...extra] = rest;
    if (pluginId === undefined || extra.length > 0) throw new Error("Usage: pi-web plugins disable <plugin-id> [--config <path>] [--restart]");
    if (!isPiWebPluginId(pluginId)) throw new Error(`Invalid PI WEB plugin id: ${pluginId}`);
    return withConfigPath({ kind: "disable", pluginId, restart: parsed.restart }, parsed.configPath);
  }

  if (command !== "safe-start") throw new Error(`Unknown plugins command: ${command}`);
  const [action, value, ...extra] = rest;
  if (action === "show" && value === undefined && extra.length === 0) {
    if (parsed.restart) throw new Error("--restart is not valid with safe-start show");
    return withConfigPath({ kind: "safe-start-show" }, parsed.configPath);
  }
  if (action === "clear" && value === undefined && extra.length === 0) {
    return withConfigPath({ kind: "safe-start-clear", restart: parsed.restart }, parsed.configPath);
  }
  if (action === "set" && extra.length === 0) {
    if (value !== "bundled-only" && value !== "none") {
      throw new Error("Safe-start level must be bundled-only or none");
    }
    return withConfigPath({ kind: "safe-start-set", safeStart: value, restart: parsed.restart }, parsed.configPath);
  }
  throw new Error("Usage: pi-web plugins safe-start show|clear|set <bundled-only|none> [--config <path>] [--restart]");
}

interface ParsedOptions {
  positional: string[];
  configPath?: string;
  restart: boolean;
  help: boolean;
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const positional: string[] = [];
  let configPath: string | undefined;
  let restart = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--restart") {
      if (restart) throw new Error("Duplicate plugins option: --restart");
      restart = true;
    } else if (arg === "--config") {
      if (configPath !== undefined) throw new Error("Duplicate plugins option: --config");
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) throw new Error("--config requires a path");
      configPath = value;
      index += 1;
    } else if (arg.startsWith("--config=")) {
      if (configPath !== undefined) throw new Error("Duplicate plugins option: --config");
      const value = arg.slice("--config=".length);
      if (value === "") throw new Error("--config requires a path");
      configPath = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown plugins option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return {
    positional,
    ...(configPath === undefined ? {} : { configPath }),
    restart,
    help,
  };
}

function recoveryConfigOptions(
  configPath: string | undefined,
  dependencies: Pick<PluginRecoveryCliDependencies, "env" | "cwd">,
): ServerPluginRecoveryConfigOptions {
  return {
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
    ...(dependencies.cwd === undefined ? {} : { cwd: dependencies.cwd }),
    ...(configPath === undefined ? {} : { configPath }),
  };
}

function withConfigPath<T extends object>(value: T, configPath: string | undefined): T & { configPath?: string } {
  return { ...value, ...(configPath === undefined ? {} : { configPath }) };
}

function requireNoMutationOptions(parsed: ParsedOptions, command: PluginRecoveryCommand): PluginRecoveryCommand {
  if (parsed.configPath !== undefined || parsed.restart) throw new Error("Plugin recovery help does not accept --config or --restart");
  return command;
}

function restartPlanFor(
  configPath: string,
  explicitConfigPath: string | undefined,
  dependencies: Pick<PluginRecoveryCliDependencies, "restartPlan">,
): SessionDaemonRestartPlan {
  return dependencies.restartPlan({ configPath, explicitConfigPath: explicitConfigPath !== undefined });
}

function reportRecoveryDiagnostic(
  diagnostic: string | undefined,
  writeLine: (line: string) => void,
  t: Translator,
): void {
  if (diagnostic !== undefined) writeLine(t("pluginRecovery.warning", "Warning: {detail}", { detail: diagnostic }));
}

function reportRestart(
  performRestart: boolean,
  plan: SessionDaemonRestartPlan,
  writeLine: (line: string) => void,
  t: Translator,
): void {
  if (performRestart && plan.kind === "automatic" && plan.perform !== undefined) {
    plan.perform();
    writeLine(t("pluginRecovery.restartRequested", "Session daemon restart requested. Active sessions owned by that daemon may stop."));
    return;
  }

  if (performRestart && plan.kind === "manual") {
    writeLine(t("pluginRecovery.restartManual", "The session daemon cannot be restarted automatically for this installation."));
  }
  writeLine(t("pluginRecovery.restartNeeded", "Restart the session daemon to apply this change. Active sessions owned by that daemon may stop."));
  writeLine(plan.guidance);
  if (plan.command !== undefined) writeLine(`  ${plan.command}`);
}
