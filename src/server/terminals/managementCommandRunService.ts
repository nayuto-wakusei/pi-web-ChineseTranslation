import { UserFacingError } from "../../shared/i18n.js";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunStatus, TerminalUiEvent } from "../../shared/apiTypes.js";
import { managementToolAllowed, type ManagementEmbedContext } from "../managementEmbed.js";
import { managementPrivileges } from "../managementPrivileges.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { eventScopeFromManagementContext, type SessionEventScope } from "../realtime/sessionEventScope.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { createBubblewrapShellInvocation, createManagedSandboxEnvironment, DEFAULT_BUBBLEWRAP_PATHS } from "../sessions/managementSandbox.js";

const MAX_REPLAY_BUFFER = 200_000;

export type ManagementProcessSpawner = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface TerminalInfo {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  commandRunId?: string;
}

export interface RunTerminalCommandOptions {
  origin: string;
  projectId: string;
  workspaceId: string;
  cwd: string;
  title: string;
  command: string;
  metadata?: unknown;
  cols?: number;
  rows?: number;
  managementContext?: ManagementEmbedContext;
}

interface TerminalRecord extends TerminalInfo {
  cancellationRequested?: boolean;
  process: ChildProcess;
  buffer: string;
  events: EventEmitter;
  eventScope: SessionEventScope;
  commandRunId?: string;
}

export class ManagementCommandRunService {
  private readonly terminals = new Map<string, TerminalRecord>();
  private readonly commandRuns = new Map<string, TerminalCommandRun>();
  private readonly commandRunScopes = new Map<string, SessionEventScope>();

  constructor(
    private readonly events?: SessionEventHub,
    private readonly workspaceActivity?: Pick<WorkspaceActivityService, "updateTerminal" | "removeTerminal">,
    private readonly spawnProcess: ManagementProcessSpawner = spawn,
    private readonly allowPrivileged = false,
  ) {}

  list(cwd: string): TerminalInfo[] {
    return [...this.terminals.values()]
      .filter((terminal) => terminal.cwd === cwd)
      .map(toInfo);
  }

  closeForCwd(cwd: string, managementContext?: ManagementEmbedContext): void {
    if (cwd === "") throw new Error("cwd is required");
    if (managementContext === undefined) throw new Error("Management context is required");
    const scope = eventScopeFromManagementContext(managementContext);
    for (const terminal of [...this.terminals.values()].filter((candidate) => candidate.cwd === cwd && candidate.eventScope === scope)) this.close(terminal.id);
  }

  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun {
    validateCommandRunOptions(options);
    if (options.managementContext === undefined) throw new Error("Management context is required");
    if (options.managementContext.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(options.managementContext, "terminal-command-runs")) {
      throw new Error("Terminal command runs are disabled in management embed mode");
    }
    const commandRunId = randomUUID();
    const terminalId = randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = parseMetadata(options.metadata);
    const eventScope = eventScopeFromManagementContext(options.managementContext);
    const queued: TerminalCommandRun = {
      id: commandRunId,
      origin: options.origin,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      terminalId,
      title: options.title,
      command: options.command,
      status: "queued",
      createdAt,
      metadata,
    };
    const running: TerminalCommandRun = { ...queued, status: "running", startedAt: new Date().toISOString() };
    this.commandRuns.set(commandRunId, running);
    this.commandRunScopes.set(commandRunId, eventScope);

    try {
      const commandProcess = managementCommandRunProcess(options, this.allowPrivileged);
      this.createTerminal({
        id: terminalId,
        cwd: options.cwd,
        name: options.title,
        ...(options.cols === undefined ? {} : { cols: options.cols }),
        ...(options.rows === undefined ? {} : { rows: options.rows }),
        shellArgs: commandProcess.args,
        commandRunId,
        eventScope,
        shell: commandProcess.command,
        ...(commandProcess.env === undefined ? {} : { env: commandProcess.env }),
      });
    } catch (error) {
      this.commandRuns.delete(commandRunId);
      this.commandRunScopes.delete(commandRunId);
      throw error;
    }

    return copyCommandRun(this.commandRuns.get(commandRunId) ?? running);
  }

  listCommandRuns(filter: TerminalCommandRunFilter = {}, managementContext?: ManagementEmbedContext): TerminalCommandRun[] {
    const eventScope = eventScopeFromManagementContext(managementContext);
    return [...this.commandRuns.values()]
      .filter((run) => this.commandRunScopes.get(run.id) === eventScope)
      .filter((run) => matchesCommandRunFilter(run, filter))
      .map(copyCommandRun);
  }

  getCommandRun(runId: string, managementContext?: ManagementEmbedContext): TerminalCommandRun | undefined {
    if (this.commandRunScopes.get(runId) !== eventScopeFromManagementContext(managementContext)) return undefined;
    const run = this.commandRuns.get(runId);
    return run === undefined ? undefined : copyCommandRun(run);
  }

  cancelCommandRun(runId: string, managementContext?: ManagementEmbedContext): TerminalCommandRun {
    if (this.commandRunScopes.get(runId) !== eventScopeFromManagementContext(managementContext)) throw new UserFacingError("routing.commandRunMissing", "Terminal command run not found");
    const run = this.commandRuns.get(runId);
    if (run === undefined) throw new UserFacingError("routing.commandRunMissing", "Terminal command run not found");
    if (isTerminalCommandRunFinal(run.status)) return copyCommandRun(run);
    const terminal = this.terminals.get(run.terminalId);
    if (terminal === undefined) throw new Error("Terminal not found");
    if (!terminal.exited && terminal.cancellationRequested !== true) {
      terminal.cancellationRequested = true;
      try { this.stopProcess(terminal, "SIGINT"); }
      catch (error) { terminal.cancellationRequested = false; throw error; }
    }
    return copyCommandRun(run);
  }

  get(id: string): TerminalInfo | undefined {
    const terminal = this.terminals.get(id);
    return terminal === undefined ? undefined : toInfo(terminal);
  }

  attach(id: string, handlers: { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void }): () => void {
    const terminal = this.require(id);
    if (terminal.buffer !== "") handlers.output(terminal.buffer, true);
    if (terminal.exited) handlers.exit(terminal.exitCode);
    const onOutput = (data: string) => { handlers.output(data, false); };
    const onExit = (exitCode: number | undefined) => { handlers.exit(exitCode); };
    terminal.events.on("output", onOutput);
    terminal.events.on("exit", onExit);
    return () => {
      terminal.events.off("output", onOutput);
      terminal.events.off("exit", onExit);
    };
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal === undefined) return;
    this.terminals.delete(id);
    terminal.events.removeAllListeners();
    this.workspaceActivity?.removeTerminal(id, terminal.cwd, terminal.eventScope);
    if (!terminal.exited) this.stopProcess(terminal, "SIGTERM");
    this.publish({ type: "terminal.closed", terminalId: id, cwd: terminal.cwd }, terminal.eventScope);
  }

  dispose(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }

  private createTerminal(options: { id?: string; cwd: string; name?: string; cols?: number; rows?: number; shellArgs: string[]; commandRunId?: string; eventScope: SessionEventScope; env?: NodeJS.ProcessEnv; shell?: string }): TerminalInfo {
    if (options.cwd === "") throw new Error("cwd is required");
    const id = options.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    if (options.shell === undefined) throw new Error("Managed command executable is required");
    const child = this.spawnProcess(options.shell, options.shellArgs, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...options.env, TERM: "xterm-256color", PI_WEB_TERMINAL: "1" },
    });
    const requestedName = options.name?.trim();
    const record: TerminalRecord = {
      id,
      cwd: options.cwd,
      name: requestedName !== undefined && requestedName !== "" ? requestedName : `Shell ${String(this.list(options.cwd).length + 1)}`,
      createdAt,
      exited: false,
      process: child,
      buffer: "",
      events: new EventEmitter(),
      eventScope: options.eventScope,
      ...(options.commandRunId === undefined ? {} : { commandRunId: options.commandRunId }),
    };
    this.attachProcessEvents(record);
    this.terminals.set(id, record);
    const info = toInfo(record);
    this.workspaceActivity?.updateTerminal(info, record.eventScope);
    this.publish({ type: "terminal.created", terminal: info }, record.eventScope);
    return info;
  }

  private attachProcessEvents(record: TerminalRecord): void {
    const onOutput = (text: string): void => {
      if (text === "") return;
      record.buffer = trimReplayBuffer(record.buffer + text);
      record.events.emit("output", text);
    };
    for (const stream of [record.process.stdout, record.process.stderr]) {
      const decoder = new StringDecoder("utf8");
      stream?.on("data", (data: Buffer) => { onOutput(decoder.write(data)); });
      stream?.once("end", () => { onOutput(decoder.end()); });
    }
    const onExit = (exitCode: number | undefined): void => {
      if (record.exited) return;
      record.exited = true;
      if (exitCode !== undefined) record.exitCode = exitCode;
      this.completeCommandRun(record.commandRunId, exitCode, record.cancellationRequested === true);
      record.events.emit("exit", exitCode);
      if (!this.terminals.has(record.id)) return;
      const info = toInfo(record);
      this.workspaceActivity?.updateTerminal(info, record.eventScope);
      this.publish({ type: "terminal.exited", terminal: info }, record.eventScope);
    };
    record.process.once("error", (error) => {
      onOutput(error.message);
      onExit(undefined);
    });
    record.process.once("close", (exitCode) => { onExit(exitCode ?? undefined); });
  }

  private stopProcess(record: TerminalRecord, signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && record.process.pid !== undefined) {
      try { process.kill(-record.process.pid, signal); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    } else record.process.kill(signal);
  }

  private completeCommandRun(runId: string | undefined, exitCode: number | undefined, cancelled: boolean): void {
    if (runId === undefined) return;
    const run = this.commandRuns.get(runId);
    if (run === undefined || isTerminalCommandRunFinal(run.status)) return;
    const completed: TerminalCommandRun = {
      ...run,
      status: exitCode === 0 && !cancelled ? "succeeded" : "failed",
      ...(exitCode === undefined ? {} : { exitCode }),
      completedAt: new Date().toISOString(),
    };
    this.commandRuns.set(runId, completed);
  }

  private require(id: string): TerminalRecord {
    const terminal = this.terminals.get(id);
    if (terminal === undefined) throw new UserFacingError("routing.terminalMissing", "Terminal not found");
    return terminal;
  }

  private publish(event: TerminalUiEvent, scope: SessionEventScope): void {
    this.events?.publishRealtime(event, scope);
  }
}

function toInfo(record: TerminalRecord): TerminalInfo {
  return {
    id: record.id,
    cwd: record.cwd,
    name: record.name,
    createdAt: record.createdAt,
    exited: record.exited,
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.commandRunId === undefined ? {} : { commandRunId: record.commandRunId }),
  };
}

function trimReplayBuffer(buffer: string): string {
  if (buffer.length <= MAX_REPLAY_BUFFER) return buffer;
  return buffer.slice(buffer.length - MAX_REPLAY_BUFFER);
}

function commandRunShellScript(command: string): string {
  return `printf '%s\\n' ${shellQuote(`$ ${command}`)}\n${command}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateCommandRunOptions(options: RunTerminalCommandOptions): void {
  if (options.origin.trim() === "") throw new UserFacingError("routing.originRequired", "origin is required");
  if (options.projectId.trim() === "") throw new UserFacingError("routing.projectIdRequired", "projectId is required");
  if (options.workspaceId.trim() === "") throw new UserFacingError("routing.workspaceIdRequired", "workspaceId is required");
  if (options.cwd.trim() === "") throw new UserFacingError("routing.terminalCwdRequired", "cwd is required");
  if (options.title.trim() === "") throw new UserFacingError("routing.titleRequired", "title is required");
  if (options.command.trim() === "") throw new UserFacingError("routing.commandRequired", "command is required");
  parseMetadata(options.metadata);
}

function parseMetadata(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Array.isArray(value)) throw new UserFacingError("routing.metadataObject", "metadata must be an object");
  return Object.fromEntries(Object.entries(value).map(([key, metadataValue]) => {
    if (key.trim() === "") throw new UserFacingError("routing.metadataKeyEmpty", "metadata keys must not be empty");
    if (typeof metadataValue !== "string") throw new UserFacingError("routing.metadataValueString", "metadata values must be strings");
    return [key, metadataValue];
  }));
}

function matchesCommandRunFilter(run: TerminalCommandRun, filter: TerminalCommandRunFilter): boolean {
  if (filter.projectId !== undefined && run.projectId !== filter.projectId) return false;
  if (filter.workspaceId !== undefined && run.workspaceId !== filter.workspaceId) return false;
  if (filter.terminalId !== undefined && run.terminalId !== filter.terminalId) return false;
  if (filter.statuses !== undefined && filter.statuses.length > 0 && !filter.statuses.includes(run.status)) return false;
  for (const [key, value] of Object.entries(filter.metadata ?? {})) {
    if (run.metadata[key] !== value) return false;
  }
  return true;
}

function isTerminalCommandRunFinal(status: TerminalCommandRunStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function copyCommandRun(run: TerminalCommandRun): TerminalCommandRun {
  return { ...run, metadata: { ...run.metadata } };
}

function commandRunShell(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["PI_WEB_COMMAND_SHELL"]?.trim();
  if (configured !== undefined && configured !== "") return configured;
  const shell = env["SHELL"]?.trim();
  if (shell !== undefined && shell !== "" && shell.toLowerCase().includes("bash")) return shell;
  if (process.platform === "win32") {
    const gitBash = "D:\\Program Files\\Git\\bin\\bash.exe";
    if (existsSync(gitBash)) return gitBash;
    return "bash";
  }
  return shell !== undefined && shell !== "" ? shell : "/bin/bash";
}

export function managementCommandRunProcess(options: RunTerminalCommandOptions, allowPrivileged: boolean): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const script = commandRunShellScript(options.command);
  const managementEnv = managementEnvironment(options.managementContext);
  if (managementEnv === undefined) throw new Error("Management context is required");
  const network = options.managementContext === undefined
    ? false
    : managementPrivileges(options.managementContext, { allowPrivileged }).network;
  const invocation = createBubblewrapShellInvocation({
    bubblewrapExecutable: "bwrap",
    shellExecutable: commandRunShell(),
    workspaceRoot: options.cwd,
    script,
    env: managementEnv,
    readOnlyPaths: DEFAULT_BUBBLEWRAP_PATHS.filter((path) => existsSync(path)),
    network,
  });
  return { command: invocation.command, args: invocation.args, env: managementEnv };
}

function managementEnvironment(context: ManagementEmbedContext | undefined): NodeJS.ProcessEnv | undefined {
  if (context === undefined) return undefined;
  const env = createManagedSandboxEnvironment({ hostEnv: process.env, context });
  const pythonExecutable = context.sandbox?.pythonExecutable;
  if (pythonExecutable !== undefined && pythonExecutable !== "") {
    env["PI_WEB_SANDBOX_PYTHON"] = pythonExecutable;
  }
  return env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
