import type { PluginCapability } from "../../shared/pluginApiTypes.js";
import type { TerminalCommandRun } from "../../shared/apiTypes.js";
import { REQUIRED_TERMINAL_PLUGIN_ID } from "../../shared/requiredTerminalPlugin.js";

/**
 * Host-only composition port for the bundled Terminal plugin.
 *
 * sessiond still constructs `TerminalService` and owns `/terminals`. Moving PTY
 * ownership into the plugin would drop management-embed sandboxing and the
 * Windows shell fallback that live on that service. This snapshot is the typed
 * view core can hand a future plugin server entry without changing that ownership.
 */
export interface RequiredTerminalActivity {
  id: string;
  cwd: string;
  exited: boolean;
}

export interface RequiredTerminalActivitySink {
  updateTerminal(terminal: RequiredTerminalActivity): void;
  removeTerminal(terminalId: string, cwd?: string): void;
}

export interface RequiredTerminalService {
  closeForCwd(cwd: string): void;
  runCommand(options: unknown): TerminalCommandRun;
  bindActivitySink(sink: RequiredTerminalActivitySink): void;
}

/** Core's typed view of the bundled Terminal service capability. */
export const REQUIRED_TERMINAL_SERVICE_CAPABILITY = Object.freeze({
  pluginId: REQUIRED_TERMINAL_PLUGIN_ID,
  id: "service",
  version: 1,
  parse: snapshotRequiredTerminalService,
}) satisfies PluginCapability<RequiredTerminalService, 1>;

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
    runCommand: (options: unknown) => requireCommandRun(Reflect.apply(runCommand, value, [options])),
    bindActivitySink: (sink: RequiredTerminalActivitySink) => {
      Reflect.apply(bindActivitySink, value, [Object.freeze({
        updateTerminal: (terminal: RequiredTerminalActivity) => { sink.updateTerminal(terminal); },
        removeTerminal: (terminalId: string, cwd?: string) => { sink.removeTerminal(terminalId, cwd); },
      })]);
    },
  });
}

function requireCommandRun(value: unknown): TerminalCommandRun {
  if (!isRecord(value)) throw invalidCommandRun();
  const status = value["status"];
  const exitCode = optionalFiniteNumber(value["exitCode"]);
  const startedAt = optionalString(value["startedAt"]);
  const completedAt = optionalString(value["completedAt"]);
  if (typeof value["id"] !== "string"
    || typeof value["origin"] !== "string"
    || typeof value["projectId"] !== "string"
    || typeof value["workspaceId"] !== "string"
    || typeof value["terminalId"] !== "string"
    || typeof value["title"] !== "string"
    || typeof value["command"] !== "string"
    || (status !== "queued" && status !== "running" && status !== "succeeded" && status !== "failed")
    || exitCode === invalidOptionalField
    || typeof value["createdAt"] !== "string"
    || startedAt === invalidOptionalField
    || completedAt === invalidOptionalField
    || !isStringRecord(value["metadata"])) {
    throw invalidCommandRun();
  }
  return {
    id: value["id"],
    origin: value["origin"],
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
    terminalId: value["terminalId"],
    title: value["title"],
    command: value["command"],
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
    createdAt: value["createdAt"],
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    metadata: { ...value["metadata"] },
  };
}

const invalidOptionalField = Symbol("invalid optional Terminal field");

function optionalFiniteNumber(value: unknown): number | undefined | typeof invalidOptionalField {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : invalidOptionalField;
}

function optionalString(value: unknown): string | undefined | typeof invalidOptionalField {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : invalidOptionalField;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((child) => typeof child === "string");
}

function invalidCommandRun(): Error {
  return new Error("Required Terminal server entry returned an invalid command run");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
