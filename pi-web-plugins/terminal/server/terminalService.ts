import type { TerminalTitlePresentation } from "@chainingintention/pi-web-cn/server-plugin-api";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, existsSync } from "node:fs";
import { t } from "./i18n.js";
import { isAbsolute } from "node:path";
import type { PtyHandle, PtyProvider } from "./ptyProvider.js";
import type { ServerPluginNoticeInput } from "@chainingintention/pi-web-cn/server-plugin-api";

const MAX_REPLAY_BUFFER = 200_000;

export type TerminalCommandRunStatus = "queued" | "running" | "succeeded" | "failed";

export type TerminalIdentity =
  | { scope?: "workspace"; projectId: string; workspaceId: string }
  | { scope: "maintenance"; projectId?: never; workspaceId?: never };

export type TerminalCommandRun = TerminalIdentity & {
  id: string;
  origin: string;
  terminalId: string;
  title: string;
  titlePresentation?: TerminalTitlePresentation;
  command: string;
  status: TerminalCommandRunStatus;
  exitCode?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, string>;
}

export interface TerminalCommandRunFilter {
  projectId?: string;
  workspaceId?: string;
  terminalId?: string;
  statuses?: TerminalCommandRunStatus[];
  metadata?: Record<string, string>;
}

export type TerminalInfo = TerminalIdentity & {
  id: string;
  cwd: string;
  name: string;
  titlePresentation?: TerminalTitlePresentation;
  /** Present only for an automatically named shell; name remains the wire fallback. */
  defaultShellNumber?: number;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  commandRunId?: string;
}

export interface TerminalWorkspaceScope {
  scope?: "workspace";
  projectId: string;
  workspaceId: string;
  cwd: string;
}
export type TerminalScope = TerminalIdentity & { cwd: string };

export type CreateTerminalOptions = TerminalScope & {
  name?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalCommandFailureNotice {
  readonly presentation?: { kind: "workspaceRemovalCommandFailed" };
  readonly message: string;
  readonly context: Readonly<Record<string, string>>;
}

export type RunTerminalCommandOptions = TerminalScope & {
  origin: string;
  title: string;
  titlePresentation?: TerminalTitlePresentation;
  command: string;
  metadata?: unknown;
  /** Private host-composition intent; never accepted from the paired browser protocol. */
  failureNotice?: TerminalCommandFailureNotice;
  cols?: number;
  rows?: number;
}

export interface TerminalActivitySink {
  updateTerminal(terminal: Pick<TerminalInfo, "id" | "cwd" | "exited">): void;
  removeTerminal(terminalId: string, cwd?: string): void;
}

type TerminalRecord = TerminalInfo & {
  cancellationRequested?: boolean;
  shell?: string;
  pty?: PtyHandle;
  generation: number;
  buffer: string;
  events: EventEmitter;
  commandRunId?: string;
  failureNotice?: TerminalCommandFailureNotice;
}

export interface MaintenanceExecutionContext {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

/** Validate the private host boundary without interpreting host configuration. */
export function snapshotMaintenanceExecutionContext(value: unknown): MaintenanceExecutionContext {
  if (typeof value !== "object" || value === null) throw new Error("Terminal maintenance execution context is required");
  const cwd: unknown = Reflect.get(value, "cwd");
  const env: unknown = Reflect.get(value, "env");
  if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new Error("Terminal maintenance cwd must be absolute");
  if (!isRecord(env)) throw new Error("Terminal maintenance env is required");
  const snapshot: NodeJS.ProcessEnv = {};
  for (const [key, entry] of Object.entries(env)) {
    if (entry !== undefined && typeof entry !== "string") throw new Error("Terminal maintenance env must contain only strings or undefined");
    Object.defineProperty(snapshot, key, { value: entry, enumerable: true });
  }
  return Object.freeze({ cwd, env: Object.freeze(snapshot) });
}

export class TerminalService {
  private readonly terminals = new Map<string, TerminalRecord>();
  private readonly commandRuns = new Map<string, TerminalCommandRun>();
  private activitySink: TerminalActivitySink | undefined;
  private disposed = false;

  private maintenanceExecutionContext: MaintenanceExecutionContext | undefined;

  constructor(
    private readonly provider: PtyProvider,
    private readonly recordNotice?: (input: ServerPluginNoticeInput) => void,
  ) {}

  bindMaintenanceExecutionContext(context: MaintenanceExecutionContext): void {
    if (this.maintenanceExecutionContext !== undefined) throw new Error("Terminal maintenance execution context is already bound");
    this.maintenanceExecutionContext = snapshotMaintenanceExecutionContext(context);
  }

  maintenanceScope(): TerminalScope {
    return { scope: "maintenance", cwd: this.requireMaintenanceExecutionContext().cwd };
  }

  private requireMaintenanceExecutionContext(): MaintenanceExecutionContext {
    if (this.maintenanceExecutionContext === undefined) throw new Error("Terminal maintenance directory is unavailable");
    return this.maintenanceExecutionContext;
  }

  private executionEnvironment(scope: TerminalIdentity): NodeJS.ProcessEnv {
    const env = scope.scope === "maintenance" ? this.requireMaintenanceExecutionContext().env : process.env;
    return { ...env, TERM: "xterm-256color", PI_WEB_TERMINAL: "1" };
  }

  private prepareCwd(scope: TerminalScope): void {
    if (scope.scope !== "maintenance") return;
    if (scope.cwd !== this.requireMaintenanceExecutionContext().cwd) throw new Error("Invalid Terminal maintenance directory");
    mkdirSync(scope.cwd, { recursive: true });
  }

  bindActivitySink(sink: TerminalActivitySink): void {
    if (this.activitySink !== undefined) throw new Error(t("ui.main.5d3c64acebaa", "Terminal activity sink is already bound"));
    this.activitySink = sink;
  }

  list(scope: TerminalScope): TerminalInfo[] {
    validateScope(scope);
    return [...this.terminals.values()]
      .filter((terminal) => matchesScope(terminal, scope))
      .map(toInfo);
  }

  closeForCwd(cwd: string): void {
    if (cwd === "") throw new Error(t("ui.main.3554e67956ef", "cwd is required"));
    for (const terminal of [...this.terminals.values()].filter((candidate) => candidate.cwd === cwd)) {
      this.closeRecord(terminal);
    }
  }

  create(options: CreateTerminalOptions): TerminalInfo {
    validateScope(options);
    const shell = interactiveShell(this.executionEnvironment(options));
    return this.createTerminal({ ...options, shell, shellArgs: interactiveShellArgs(shell) });
  }

  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun {
    validateCommandRunOptions(options);
    this.requireAvailable();
    const commandRunId = randomUUID();
    const terminalId = randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = parseMetadata(options.metadata);
    const failureNotice = parseFailureNotice(options.failureNotice);
    if (failureNotice !== undefined && this.recordNotice === undefined) {
      throw new Error(t("ui.main.e4f11dab9de6", "Terminal command failure notices are unavailable"));
    }
    const queued: TerminalCommandRun = {
      id: commandRunId,
      origin: options.origin,
      ...terminalIdentity(options),
      terminalId,
      title: options.title,
      ...terminalTitlePresentationField(options.titlePresentation),
      command: options.command,
      status: "queued",
      createdAt,
      metadata,
    };
    const running: TerminalCommandRun = { ...queued, status: "running", startedAt: new Date().toISOString() };
    this.commandRuns.set(commandRunId, running);

    try {
      this.createTerminal({
        id: terminalId,
        ...terminalIdentity(options),
        cwd: options.cwd,
        name: options.title,
        ...terminalTitlePresentationField(options.titlePresentation),
        ...(options.cols === undefined ? {} : { cols: options.cols }),
        ...(options.rows === undefined ? {} : { rows: options.rows }),
        shellArgs: ["-lc", commandRunShellScript(options.command)],
        shell: commandRunShell(this.executionEnvironment(options)),
        commandRunId,
        ...(failureNotice === undefined ? {} : { failureNotice }),
      });
    } catch (error) {
      this.commandRuns.delete(commandRunId);
      throw error;
    }

    return copyCommandRun(this.commandRuns.get(commandRunId) ?? running);
  }

  listCommandRuns(filter: TerminalCommandRunFilter = {}): TerminalCommandRun[] {
    return [...this.commandRuns.values()]
      .filter((run) => matchesCommandRunFilter(run, filter))
      .map(copyCommandRun);
  }

  listCommandRunsForScope(scope: TerminalScope, filter: TerminalCommandRunFilter = {}): TerminalCommandRun[] {
    validateScope(scope);
    return this.listCommandRuns(filter).filter((run) => matchesIdentity(run, scope));
  }

  getCommandRun(runId: string): TerminalCommandRun | undefined {
    const run = this.commandRuns.get(runId);
    return run === undefined ? undefined : copyCommandRun(run);
  }

  getCommandRunForScope(scope: TerminalScope, runId: string): TerminalCommandRun | undefined {
    validateScope(scope);
    const run = this.commandRuns.get(runId);
    return run !== undefined && matchesIdentity(run, scope)
      ? copyCommandRun(run)
      : undefined;
  }

  cancelCommandRun(runId: string): TerminalCommandRun {
    return this.cancelCommandRunRecord(this.requireCommandRun(runId));
  }

  cancelCommandRunForScope(scope: TerminalScope, runId: string): TerminalCommandRun {
    const run = this.getCommandRunForScope(scope, runId);
    if (run === undefined) throw new Error(t("ui.main.3bea6b3edcd2", "Terminal command run not found in this workspace"));
    return this.cancelCommandRunRecord(this.requireCommandRun(runId));
  }

  get(scope: TerminalScope, id: string): TerminalInfo | undefined {
    const terminal = this.terminals.get(id);
    return terminal === undefined || !matchesScope(terminal, scope) ? undefined : toInfo(terminal);
  }

  attach(
    scope: TerminalScope,
    id: string,
    handlers: { output(data: string, replay: boolean): void; exit(exitCode: number | undefined): void; closed?(): void },
  ): () => void {
    const terminal = this.requireScoped(scope, id);
    if (terminal.buffer !== "") handlers.output(terminal.buffer, true);
    if (terminal.exited) handlers.exit(terminal.exitCode);
    const onOutput = (data: string): void => { handlers.output(data, false); };
    const onExit = (exitCode: number | undefined): void => { handlers.exit(exitCode); };
    const onClosed = (): void => { handlers.closed?.(); };
    terminal.events.on("output", onOutput);
    terminal.events.on("exit", onExit);
    terminal.events.on("closed", onClosed);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      terminal.events.off("output", onOutput);
      terminal.events.off("exit", onExit);
      terminal.events.off("closed", onClosed);
    };
  }

  write(scope: TerminalScope, id: string, data: string): void {
    const terminal = this.requireScoped(scope, id);
    if (!terminal.exited) terminal.pty?.write(data);
  }

  resize(scope: TerminalScope, id: string, cols: number, rows: number): void {
    const terminal = this.requireScoped(scope, id);
    if (!terminal.exited && Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
      terminal.pty?.resize(Math.floor(cols), Math.floor(rows));
    }
  }

  continue(scope: TerminalScope, id: string): TerminalInfo {
    this.requireAvailable();
    const record = this.requireScoped(scope, id);
    this.prepareCwd(record);
    if (!record.exited) return toInfo(record);
    const previousExitCode = record.exitCode;
    const previousCommandRunId = record.commandRunId;
    const previousFailureNotice = record.failureNotice;
    delete record.exitCode;
    delete record.commandRunId;
    delete record.failureNotice;
    record.exited = false;
    const shell = interactiveShell(this.executionEnvironment(record));
    const previousShell = record.shell;
    record.shell = shell;
    delete record.cancellationRequested;
    try {
      this.spawnPty(record, interactiveShellArgs(shell), 100, 30, "\r\n[continued in interactive shell]\r\n");
    } catch (error) {
      record.exited = true;
      if (previousExitCode !== undefined) record.exitCode = previousExitCode;
      if (previousCommandRunId !== undefined) record.commandRunId = previousCommandRunId;
      if (previousFailureNotice !== undefined) record.failureNotice = previousFailureNotice;
      if (previousShell === undefined) delete record.shell;
      else record.shell = previousShell;
      throw error;
    }

    const info = toInfo(record);
    this.activitySink?.updateTerminal(info);
    return info;
  }

  closeAll(scope: TerminalScope): void {
    validateScope(scope);
    for (const terminal of [...this.terminals.values()].filter((candidate) => matchesScope(candidate, scope))) {
      this.closeRecord(terminal);
    }
  }

  close(scope: TerminalScope, id: string): void {
    validateScope(scope);
    const terminal = this.terminals.get(id);
    if (terminal === undefined) return;
    if (!matchesScope(terminal, scope)) throw new Error(t("ui.main.002ca07f2de5", "Terminal not found in this workspace"));
    this.closeRecord(terminal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const terminal of [...this.terminals.values()]) {
      try { this.closeRecord(terminal); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Failed to dispose terminal PTYs");
  }

  private createTerminal(options: CreateTerminalOptions & { titlePresentation?: TerminalTitlePresentation; id?: string; shell?: string; shellArgs: string[]; commandRunId?: string; failureNotice?: TerminalCommandFailureNotice }): TerminalInfo {
    this.requireAvailable();
    validateScope(options);
    this.prepareCwd(options);
    const id = options.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const requestedName = options.name?.trim();
    const defaultShellNumber = requestedName === undefined || requestedName === "" ? this.list(options).length + 1 : undefined;
    const record: TerminalRecord = {
      id,
      ...terminalIdentity(options),
      cwd: options.cwd,
      ...(options.shell === undefined ? {} : { shell: options.shell }),
      name: defaultShellNumber === undefined ? requestedName ?? "" : `Shell ${String(defaultShellNumber)}`,
      ...(defaultShellNumber === undefined ? {} : { defaultShellNumber }),
      ...terminalTitlePresentationField(options.titlePresentation),
      createdAt,
      exited: false,
      generation: 0,
      buffer: "",
      events: new EventEmitter(),
      ...(options.commandRunId === undefined ? {} : { commandRunId: options.commandRunId }),
      ...(options.failureNotice === undefined ? {} : { failureNotice: options.failureNotice }),
    };
    this.terminals.set(id, record);
    try {
      this.spawnPty(record, options.shellArgs, options.cols ?? 100, options.rows ?? 30);
    } catch (error) {
      this.terminals.delete(id);
      throw error;
    }
    const info = toInfo(record);
    this.activitySink?.updateTerminal(info);
    return info;
  }

  private spawnPty(record: TerminalRecord, args: string[], cols: number, rows: number, marker = ""): void {
    const generation = ++record.generation;
    // Stage synchronous spawn callbacks until the handle and continuation marker are installed.
    const pending: (() => void)[] = [];
    let ready = false;
    const deliver = (callback: () => void): void => {
      if (!ready) pending.push(callback);
      else callback();
    };
    const current = (): boolean => this.terminals.get(record.id) === record
      && record.generation === generation && !record.exited;
    const env = this.executionEnvironment(record);
    const handle = this.provider.spawn({
      shell: record.shell ?? interactiveShell(env), args, cwd: record.cwd, cols, rows, env,
    }, {
      output: (data) => { deliver(() => {
        if (!current()) return;
        record.buffer = trimReplayBuffer(record.buffer + data);
        record.events.emit("output", data);
      }); },
      exit: (exitCode) => { deliver(() => {
        if (!current()) return;
        record.exited = true;
        if (exitCode !== undefined) record.exitCode = exitCode;
        record.pty?.dispose();
        delete record.pty;
        this.completeCommandRun(record.commandRunId, exitCode, record.failureNotice, record.cancellationRequested === true);
        record.events.emit("exit", exitCode);
        this.activitySink?.updateTerminal(toInfo(record));
      }); },
    });
    record.pty = handle;
    if (marker !== "") {
      record.buffer = trimReplayBuffer(record.buffer + marker);
      record.events.emit("output", marker);
    }
    ready = true;
    for (const callback of pending) callback();
  }

  private completeCommandRun(
    runId: string | undefined,
    exitCode: number | undefined,
    failureNotice: TerminalCommandFailureNotice | undefined,
    cancelled = false,
  ): void {
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
    if (!this.disposed && !cancelled && completed.status === "failed" && failureNotice !== undefined) {
      this.recordNotice?.({
        severity: "error",
        message: failureNotice.message,
        ...(failureNotice.presentation === undefined ? {} : { presentation: failureNotice.presentation }),
        ...(completed.scope === "maintenance" ? {} : { scope: { projectId: completed.projectId } }),
        context: { ...failureNotice.context, commandRunId: completed.id },
      });
    }
  }

  private requireScoped(scope: TerminalScope, id: string): TerminalRecord {
    validateScope(scope);
    const terminal = this.terminals.get(id);
    if (terminal === undefined || !matchesScope(terminal, scope)) {
      throw new Error(t("ui.main.002ca07f2de5", "Terminal not found in this workspace"));
    }
    return terminal;
  }

  private requireCommandRun(runId: string): TerminalCommandRun {
    const run = this.commandRuns.get(runId);
    if (run === undefined) throw new Error(t("ui.shared.ca71fd855ae2", "Terminal command run not found"));
    return run;
  }

  private cancelCommandRunRecord(run: TerminalCommandRun): TerminalCommandRun {
    if (isTerminalCommandRunFinal(run.status)) return copyCommandRun(run);
    const terminal = this.terminals.get(run.terminalId);
    if (terminal === undefined) throw new Error(t("ui.main.970ebf253e68", "Terminal not found"));
    if (!terminal.exited && terminal.cancellationRequested !== true) {
      terminal.cancellationRequested = true;
      try { terminal.pty?.write("\x03"); }
      catch (error) { terminal.cancellationRequested = false; throw error; }
    }
    return copyCommandRun(run);
  }

  private closeRecord(terminal: TerminalRecord): void {
    if (!this.terminals.delete(terminal.id)) return;
    // Closing is final even if a provider never publishes an exit after disposal.
    terminal.generation += 1;
    this.completeCommandRun(terminal.commandRunId, undefined, undefined);
    try {
      terminal.pty?.dispose();
    } finally {
      delete terminal.pty;
      terminal.events.emit("closed");
      terminal.events.removeAllListeners();
      this.activitySink?.removeTerminal(terminal.id, terminal.cwd);
    }
  }

  private requireAvailable(): void {
    if (this.disposed) throw new Error(t("ui.main.ee0fa7cb477f", "Terminal service is stopped"));
  }
}

function toInfo(record: TerminalRecord): TerminalInfo {
  return {
    id: record.id,
    ...terminalIdentity(record),
    cwd: record.cwd,
    name: record.name,
    ...terminalTitlePresentationField(record.titlePresentation),
    ...(record.defaultShellNumber === undefined ? {} : { defaultShellNumber: record.defaultShellNumber }),    createdAt: record.createdAt,
    exited: record.exited,
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.commandRunId === undefined ? {} : { commandRunId: record.commandRunId }),
  };
}

function trimReplayBuffer(buffer: string): string {
  if (buffer.length <= MAX_REPLAY_BUFFER) return buffer;
  return buffer.slice(buffer.length - MAX_REPLAY_BUFFER);
}

export function interactiveShellArgs(shell: string): string[] {
  const executable = shell.split(/[\\/]/).at(-1)?.toLowerCase().replace(/^-/, "").replace(/\.exe$/, "");
  // Preserve the existing invocation for arbitrary SHELL values rather than guessing at an unsupported login flag.
  return executable === "bash" || executable === "zsh" || executable === "fish" ? ["-l"] : [];
}

function interactiveShell(env: NodeJS.ProcessEnv = process.env): string {
  const shell = env["SHELL"]?.trim();
  if (shell !== undefined && shell !== "") return shell;
  return process.platform === "win32" ? "powershell.exe" : "/bin/bash";
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

function commandRunShellScript(command: string): string {
  return `printf '%s\\n' ${shellQuote(`$ ${command}`)}\n${command}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateScope(scope: { scope?: string; projectId?: string; workspaceId?: string; cwd: string }): void {
  if (scope.scope === "maintenance") {
    if (scope.projectId !== undefined || scope.workspaceId !== undefined) throw new Error("Maintenance scope cannot include workspace ids");
  } else {
    if (scope.scope !== undefined && scope.scope !== "workspace") throw new Error("Invalid Terminal scope");
    if (typeof scope.projectId !== "string" || scope.projectId.trim() === "") throw new Error("projectId is required");
    if (typeof scope.workspaceId !== "string" || scope.workspaceId.trim() === "") throw new Error("workspaceId is required");
  }
  if (scope.cwd.trim() === "") throw new Error("cwd is required");
}

function terminalIdentity(scope: TerminalIdentity): TerminalIdentity {
  return scope.scope === "maintenance"
    ? { scope: "maintenance" }
    : { ...(scope.scope === undefined ? {} : { scope: "workspace" as const }), projectId: scope.projectId, workspaceId: scope.workspaceId };
}

function matchesIdentity(record: TerminalIdentity, scope: TerminalIdentity): boolean {
  if (record.scope === "maintenance" || scope.scope === "maintenance") return record.scope === scope.scope;
  return record.projectId === scope.projectId && record.workspaceId === scope.workspaceId;
}

function matchesScope(record: TerminalScope, scope: TerminalScope): boolean {
  return matchesIdentity(record, scope) && record.cwd === scope.cwd;
}

function validateCommandRunOptions(options: RunTerminalCommandOptions): void {
  validateScope(options);
  if (options.origin.trim() === "") throw new Error(t("ui.main.0b08e0eda1a4", "origin is required"));
  if (options.title.trim() === "") throw new Error(t("ui.main.394f110fbd2e", "title is required"));
  if (options.command.trim() === "") throw new Error(t("ui.main.f3029405fa76", "command is required"));
  parseMetadata(options.metadata);
}

function parseMetadata(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(t("ui.main.8aaf09278346", "metadata must be an object"));
  return Object.fromEntries(Object.entries(value).map(([key, metadataValue]) => {
    if (key.trim() === "") throw new Error(t("ui.main.32968c7e6565", "metadata keys must not be empty"));
    if (typeof metadataValue !== "string") throw new Error(t("ui.main.ca6186d140b2", "metadata values must be strings"));
    return [key, metadataValue];
  }));
}

function parseFailureNotice(value: TerminalCommandFailureNotice | undefined): TerminalCommandFailureNotice | undefined {
  if (value === undefined) return undefined;
  if (typeof value.message !== "string" || value.message.trim() === "") {
    throw new Error(t("ui.main.b63294884798", "failureNotice message must be a non-empty string"));
  }
  if (!isRecord(value.context) || !Object.values(value.context).every((item) => typeof item === "string")) {
    throw new Error(t("ui.main.a38dcafc6669", "failureNotice context must contain only strings"));
  }
  return Object.freeze({
    message: value.message,
    context: Object.freeze({ ...value.context }),
    ...(value.presentation?.kind === "workspaceRemovalCommandFailed"
      ? { presentation: Object.freeze({ kind: "workspaceRemovalCommandFailed" as const }) } : {}),
  });
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

// This server entry is shipped as a self-contained transpiled graph, not bundled
// with core. Validate its private input locally; only the public type is imported.
function terminalTitlePresentationField(value: unknown): { titlePresentation?: TerminalTitlePresentation } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const kind: unknown = Reflect.get(value, "kind");
  const label: unknown = Reflect.get(value, "label");
  return kind === "workspaceRemoval" && typeof label === "string" && label.length <= 4096
    ? { titlePresentation: Object.freeze({ kind, label }) } : {};
}

function copyCommandRun(run: TerminalCommandRun): TerminalCommandRun {
  return { ...run, metadata: { ...run.metadata } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
