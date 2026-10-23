import type { PluginCapability } from "../../server-plugin-api.js";
import type { TerminalCommandRun } from "../../shared/apiTypes.js";
import { REQUIRED_TERMINAL_PLUGIN_ID } from "../../shared/requiredTerminalPlugin.js";
import { requireTerminalCommandRun } from "../../shared/terminalCommandRun.js";

export interface RequiredTerminalCommandFailureNotice {
  readonly message: string;
  readonly context: Readonly<Record<string, string>>;
}

export interface RunTerminalCommandOptions {
  projectId: string;
  workspaceId: string;
  cwd: string;
  origin: string;
  title: string;
  command: string;
  metadata?: unknown;
  /** Private host-composition intent; never part of the browser Terminal protocol. */
  failureNotice?: RequiredTerminalCommandFailureNotice;
  cols?: number;
  rows?: number;
}

export interface RequiredTerminalActivity {
  id: string;
  cwd: string;
  exited: boolean;
}

export interface RequiredTerminalActivitySink {
  updateTerminal(terminal: RequiredTerminalActivity): void;
  removeTerminal(terminalId: string, cwd?: string): void;
}

/** Privileged host-only composition port supplied by the required bundled Terminal; not third-party API. */
export interface RequiredTerminalService {
  closeForCwd(cwd: string): void;
  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun;
  bindActivitySink(sink: RequiredTerminalActivitySink): void;
}

/** Core's typed view of the bundled Terminal service capability. */
export const REQUIRED_TERMINAL_SERVICE_CAPABILITY = Object.freeze({
  pluginId: REQUIRED_TERMINAL_PLUGIN_ID,
  id: "service",
  version: 1,
  parse: snapshotRequiredTerminalService,
}) satisfies PluginCapability<RequiredTerminalService, 1>;

export class RequiredTerminalUnavailableError extends Error {
  override name = "RequiredTerminalUnavailableError";
}

export function snapshotRequiredTerminalService(value: unknown): RequiredTerminalService {
  if (!isRecord(value)) throw new Error("Required Terminal server entry did not provide its composition service");
  const closeForCwd = value["closeForCwd"];
  const runCommand = value["runCommand"];
  const bindActivitySink = value["bindActivitySink"];
  if (typeof closeForCwd !== "function" || typeof runCommand !== "function" || typeof bindActivitySink !== "function") {
    throw new Error("Required Terminal server entry did not provide its composition service");
  }
  return Object.freeze({
    closeForCwd: (cwd: string) => { Reflect.apply(closeForCwd, value, [cwd]); },
    runCommand: (options: RunTerminalCommandOptions) => requireTerminalCommandRun(Reflect.apply(runCommand, value, [options]), invalidCommandRun),
    bindActivitySink: (sink: RequiredTerminalActivitySink) => {
      Reflect.apply(bindActivitySink, value, [Object.freeze({
        updateTerminal: (terminal: RequiredTerminalActivity) => { sink.updateTerminal(terminal); },
        removeTerminal: (terminalId: string, cwd?: string) => { sink.removeTerminal(terminalId, cwd); },
      })]);
    },
  });
}

export function unavailableRequiredTerminalService(): RequiredTerminalService {
  const unavailable = (): never => {
    throw new RequiredTerminalUnavailableError(
      "Required Terminal plugin is unavailable in recovery safe start; workspace removal cannot continue",
    );
  };
  return Object.freeze({
    closeForCwd: unavailable,
    runCommand: unavailable,
    bindActivitySink: () => undefined,
  });
}

function invalidCommandRun(): Error {
  return new Error("Required Terminal server entry returned an invalid command run");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
