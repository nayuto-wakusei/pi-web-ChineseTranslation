import type { ExtensionCommandContextActions } from "../../piSdk.js";
import crypto from "node:crypto";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import type { ClientCommandResult, ClientSession, ClientSessionTreeSnapshot } from "../types.js";
import { isBuiltinCommand } from "./builtinCommands.js";
import { loadNodeTranslator } from "../../localization.js";
import { userFacingErrorMessage, type Translator } from "../../shared/i18n.js";

export interface CommandSession {
  sessionId: string;
  sessionFile: string | undefined;
  sessionName: string | undefined;
  messages: readonly unknown[];
  isStreaming: boolean;
  isBashRunning: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
  promptTemplates: readonly { name: string }[];
  extensionRunner: { getRegisteredCommands(): readonly { invocationName: string }[] };
  resourceLoader: { getSkills(): { skills: readonly { name: string }[] } };
  sessionManager: { getLeafId(): string | null; getHeader?: () => { parentSession?: string } | null | undefined };
  setSessionName: (name: string) => void;
  compact: (instructions?: string) => Promise<{ summary: string; tokensBefore: number }>;
  getSessionStats: () => {
    sessionId: string;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    tokens: { input: number; output: number; total: number };
    cost: number;
  };
  getUserMessagesForForking: () => readonly { entryId: string; text: string }[];
}

export interface CommandRuntime<TSession extends CommandSession = CommandSession> {
  cwd: string;
  session: TSession;
  fork: (entryId: string, options?: Parameters<ExtensionCommandContextActions["fork"]>[1]) => Promise<{ cancelled: boolean; selectedText?: string }>;
}

export interface CommandActiveSession<TSession extends CommandSession = CommandSession> {
  runtime: CommandRuntime<TSession>;
}

export type GetScopedCommandActiveSession<TSession extends CommandSession = CommandSession> = (sessionId: string, eventScope?: string) => Promise<CommandActiveSession<TSession>>;

export interface CommandEventPublisher {
  publish(sessionId: string, event: SessionUiEvent, eventScope?: string): void;
  publishGlobal?(event: Extract<SessionUiEvent, { type: "session.name" }>, eventScope?: string): void;
}

export interface SessionCommandLifecycle<TSession extends CommandSession = CommandSession> {
  onCompactionStart?: (session: TSession) => void;
  onCompactionEnd?: (session: TSession, result: "success" | "error", detail?: string) => void;
  reloadSession?: (session: TSession) => Promise<void>;
  getSessionTree?: (session: TSession) => ClientSessionTreeSnapshot | undefined;
  hasActiveWork?: (session: TSession) => boolean;
  isTreeNavigationActive?: (session: TSession) => boolean;
  runSessionReplacement?: <T>(session: TSession, operation: () => Promise<T>) => Promise<T>;
}

export interface SessionCommandNaming {
  listSessionNames?: (cwd: string) => Promise<readonly string[]>;
}

export interface ForkEntryOptions {
  position?: "before" | "at";
  withSession?: NonNullable<Parameters<ExtensionCommandContextActions["fork"]>[1]>["withSession"];
  expectedSession?: CommandSession;
  /** Rechecked inside the serialized replacement boundary when supplied by /tree. */
  expectedLeafId: string | null;
}

type RelatedSessionKind = "fork" | "copy";

interface PendingCommandSelect {
  sessionId: string;
  eventScope: string | undefined;
  command: "fork";
}

export class SessionCommandService<TSession extends CommandSession = CommandSession> {
  private readonly pendingSelects = new Map<string, PendingCommandSelect>();

  constructor(
    private readonly getActive: GetScopedCommandActiveSession<TSession>,
    private readonly prompt: (sessionId: string, text: string, eventScope?: string) => Promise<void>,
    private readonly events: CommandEventPublisher,
    private readonly lifecycle: SessionCommandLifecycle<TSession> = {},
    private readonly naming: SessionCommandNaming = {},
    private readonly t: Translator = loadNodeTranslator("server"),
  ) {}

  async run(sessionId: string, text: string, eventScope?: string, t: Translator = loadNodeTranslator("server")): Promise<ClientCommandResult> {
    const active = await this.getActive(sessionId, eventScope);
    const session = active.runtime.session;
    const [name = "", ...args] = text.trim().replace(/^\//, "").split(/\s+/);
    const rest = args.join(" ").trim();

    if (this.lifecycle.isTreeNavigationActive?.(session) === true) return treeNavigationActiveUnsupported(t);

    if (!isBuiltinCommand(name)) {
      if (this.isRuntimeCommand(session, name)) {
        // The command is forwarded to the agent, which expands it (e.g. /skill:*
        // into a skill block) and streams the canonical message back. That is the
        // authoritative feedback, so we don't synthesize an extra "Accepted" line
        // that would only vanish on reload.
        await this.prompt(sessionId, text, eventScope);
        return { type: "done" };
      }
      return { type: "unsupported", message: this.t("command.unknown", "Unknown command: /{value0}", { value0: name }) };
    }

    if (name === "session") return { type: "done", message: formatSessionStats(session, this.t) };
    if (name === "name") return this.nameSession(active, rest, eventScope);
    if (name === "compact") return this.compact(session, rest);
    if (name === "reload") return this.reload(session);
    if (name === "clone") return this.clone(active, eventScope);
    if (name === "fork") return this.fork(active, eventScope);
    if (name === "tree") return this.tree(session);

    return { type: "unsupported", message: this.t("command.unsupported", "/{value0} is not implemented in the Web UI", { value0: name }) };
  }

  async respond(sessionId: string, requestId: string, value: string, eventScope?: string): Promise<ClientCommandResult> {
    const pending = this.pendingSelects.get(requestId);
    if (pending?.sessionId !== sessionId || pending.eventScope !== eventScope) return { type: "unsupported", message: this.t("command.expired", "Command request expired") };
    this.pendingSelects.delete(requestId);

    return this.forkEntry(sessionId, value, eventScope);
  }

  /** Fork a tree entry into a new session file while preserving the original. */
  async forkEntry(sessionId: string, entryId: string, eventScope?: string, options?: ForkEntryOptions, t: Translator = loadNodeTranslator("server")): Promise<ClientCommandResult> {
    const active = await this.getActive(sessionId, eventScope);
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported(t);
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork", this.t);
    const relatedName = await this.nextRelatedSessionName(active, "fork");
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported(t);
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork", this.t);
    const result = await this.runSessionReplacement(active.runtime, async () => {
      const session = active.runtime.session;
      if (options?.expectedSession !== undefined && session !== options.expectedSession) throw new Error(this.t("session.forkRuntimeChanged", "The session runtime changed before forking. Try again from the current session."));
      if (options !== undefined && session.sessionManager.getLeafId() !== options.expectedLeafId) {
        throw new Error(t("session.treeStale", "The session changed since /tree was opened. Reopen /tree and try again."));
      }
      const forkResult = await active.runtime.fork(entryId, {
        position: options?.position ?? this.forkPosition(session, entryId),
        ...(options?.withSession === undefined ? {} : { withSession: options.withSession }),
      });
      if (!forkResult.cancelled) this.tryNameRelatedSession(active.runtime.session, relatedName, eventScope);
      return forkResult;
    });
    if (result.cancelled) return { type: "done", message: this.t("command.forkCancelled", "Fork cancelled") };
    return { type: "done", message: this.t("command.forked", "Session forked"), session: clientSessionFromRuntime(active.runtime), ...promptDraft(result.selectedText) };
  }

  private nameSession(active: CommandActiveSession<TSession>, name: string, eventScope: string | undefined): ClientCommandResult {
    if (name === "") return { type: "unsupported", message: this.t("command.nameUsage", "Usage: /name <session name>") };
    active.runtime.session.setSessionName(name);
    this.publishSessionName(active.runtime.session, eventScope);
    return { type: "done", message: this.t("command.named", "Session named: {value0}", { value0: name }), session: clientSessionFromRuntime(active.runtime) };
  }
  private compact(session: TSession, instructions: string): ClientCommandResult {
    this.lifecycle.onCompactionStart?.(session);
    void session.compact(instructions === "" ? undefined : instructions)
      .then(() => { this.lifecycle.onCompactionEnd?.(session, "success"); })
      .catch((error: unknown) => {
        this.lifecycle.onCompactionEnd?.(session, "error", userFacingErrorMessage(error, this.t));
      });
    return { type: "done" };
  }

  private async reload(session: TSession, t: Translator = loadNodeTranslator("server")): Promise<ClientCommandResult> {
    if (this.hasActiveWork(session)) return { type: "unsupported", message: t("command.reloadActive", "Cannot reload an active session. Stop current activity first.") };
    if (this.lifecycle.reloadSession === undefined) return { type: "unsupported", message: t("command.reloadUnsupported", "/reload is not supported by this session runtime.") };

    try {
      await this.lifecycle.reloadSession(session);
    } catch (error: unknown) {
      const message = userFacingErrorMessage(error, this.t);
      return { type: "unsupported", message: this.t("command.reloadFailed", "Reload failed: {value0}", { value0: message }) };
    }
    return { type: "done", message: this.t("command.reloaded", "Session runtime resources reloaded: extensions, skills, prompt templates, themes, and context/system prompt files. Refresh the browser separately for PI WEB browser plugin changes.") };
  }

  private async clone(active: CommandActiveSession<TSession>, eventScope: string | undefined, t: Translator = loadNodeTranslator("server")): Promise<ClientCommandResult> {
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("clone", this.t);
    const initialLeafId = active.runtime.session.sessionManager.getLeafId();
    if (initialLeafId === null || initialLeafId === "") return { type: "unsupported", message: this.t("command.cloneNoEntry", "Cannot clone: no current session entry") };
    const relatedName = await this.nextRelatedSessionName(active, "copy");
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported(t);
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("clone", this.t);
    const leafId = active.runtime.session.sessionManager.getLeafId();
    if (leafId === null || leafId === "") return { type: "unsupported", message: this.t("command.cloneNoEntry", "Cannot clone: no current session entry") };
    const result = await this.runSessionReplacement(active.runtime, async () => {
      const cloneResult = await active.runtime.fork(leafId, { position: "at" });
      if (!cloneResult.cancelled) this.tryNameRelatedSession(active.runtime.session, relatedName, eventScope);
      return cloneResult;
    });
    if (result.cancelled) return { type: "done", message: this.t("command.cloneCancelled", "Clone cancelled") };
    return { type: "done", message: this.t("command.cloned", "Session cloned"), session: clientSessionFromRuntime(active.runtime) };
  }

  private fork(active: CommandActiveSession<TSession>, eventScope: string | undefined): ClientCommandResult {
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork", this.t);
    const messages = active.runtime.session.getUserMessagesForForking();
    if (!messages.length) return { type: "unsupported", message: this.t("command.forkNoMessages", "No user messages available for forking") };
    const requestId = crypto.randomUUID();
    this.pendingSelects.set(requestId, { sessionId: active.runtime.session.sessionId, eventScope, command: "fork" });
    return {
      type: "select",
      requestId,
      title: this.t("command.forkTitle", "Fork from message"),
      options: [...messages].reverse().map((message) => ({ value: message.entryId, label: truncate(message.text, 140) })),
    };
  }

  private tree(session: TSession, t: Translator = loadNodeTranslator("server")): ClientCommandResult {
    if (this.hasActiveWork(session)) {
      return { type: "unsupported", message: t("server.main.a918daf4f693", "Cannot open the session tree while the session is active. Stop current activity and try /tree again.") };
    }
    if (this.lifecycle.getSessionTree === undefined) return treeUnavailableUnsupported(this.t);

    try {
      const tree = this.lifecycle.getSessionTree(session);
      if (tree === undefined) return treeUnavailableUnsupported();
      if (tree.nodes.length === 0) return { type: "unsupported", message: t("server.main.ab9910fde691", "Cannot navigate an empty session tree.") };
      return { type: "tree", tree };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: "unsupported", message: t("server.main.0678911a2580", "Unable to open the session tree: {arg0}", { arg0: message }) };
    }
  }

  private hasActiveWork(session: TSession): boolean {
    return sessionHasActiveWork(session) || this.lifecycle.hasActiveWork?.(session) === true;
  }

  private forkPosition(session: TSession, entryId: string): "before" | "at" {
    const treeNode = this.lifecycle.getSessionTree?.(session)?.nodes.find((node) => node.id === entryId);
    if (treeNode !== undefined) return treeNode.kind === "user" ? "before" : "at";
    return session.getUserMessagesForForking().some((message) => message.entryId === entryId) ? "before" : "at";
  }

  private runSessionReplacement<T>(runtime: CommandRuntime<TSession>, operation: () => Promise<T>): Promise<T> {
    const runReplacement = this.lifecycle.runSessionReplacement;
    return runReplacement === undefined ? operation() : runReplacement(runtime.session, operation);
  }

  private async nextRelatedSessionName(active: CommandActiveSession<TSession>, kind: RelatedSessionKind): Promise<string> {
    const sourceTitle = relatedSessionSourceTitle(active.runtime.session, this.t);
    const sourceName = normalizedName(active.runtime.session.sessionName);
    let existingNames: readonly string[];
    try {
      existingNames = await this.naming.listSessionNames?.(active.runtime.cwd) ?? [];
    } catch {
      existingNames = [];
    }
    return uniqueRelatedSessionName(sourceTitle, kind, sourceName === undefined ? existingNames : [...existingNames, sourceName], this.t);
  }

  private tryNameRelatedSession(session: TSession, name: string, eventScope: string | undefined): void {
    try {
      session.setSessionName(name);
      this.publishSessionName(session, eventScope);
    } catch (error: unknown) {
      const message = userFacingErrorMessage(error, this.t);
      this.events.publish(session.sessionId, { type: "command.output", level: "error", message: this.t("command.namingFailed", "Session created, but naming failed: {value0}", { value0: message }) }, eventScope);
    }
  }

  private publishSessionName(session: TSession, eventScope: string | undefined): void {
    const event = session.sessionName === undefined
      ? { type: "session.name", sessionId: session.sessionId } as const
      : { type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const;
    this.events.publish(session.sessionId, event, eventScope);
    this.events.publishGlobal?.(event, eventScope);
  }

  private isRuntimeCommand(session: TSession, name: string): boolean {
    return session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === name)
      || session.promptTemplates.some((template) => template.name === name)
      || session.resourceLoader.getSkills().skills.some((skill) => `skill:${skill.name}` === name);
  }
}

function clientSessionFromRuntime(runtime: CommandRuntime): ClientSession {
  const session = runtime.session;
  const parentSessionPath = typeof session.sessionManager.getHeader === "function" ? session.sessionManager.getHeader()?.parentSession : undefined;
  return {
    id: session.sessionId,
    path: session.sessionFile ?? "",
    cwd: runtime.cwd,
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: session.messages.length,
    firstMessage: "",
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function relatedSessionSourceTitle(session: CommandSession, t: Translator): string {
  const name = normalizedName(session.sessionName);
  if (name !== undefined) return name;
  for (const message of session.messages) {
    const text = normalizedName(extractUserMessageText(message));
    if (text !== undefined) return truncate(text, 80);
  }
  return t("session.untitled", "Untitled session");
}

function uniqueRelatedSessionName(sourceTitle: string, kind: RelatedSessionKind, existingNames: readonly string[], t: Translator): string {
  const baseName = stripRelatedSessionSuffix(sourceTitle) || t("session.untitled", "Untitled session");
  const label = kind === "fork" ? t("session.fork", "Fork") : t("session.copy", "Copy");
  const usedNames = new Set(existingNames.map(normalizedName).filter(isDefined));
  for (let counter = 1; ; counter += 1) {
    const candidate = `${baseName} — ${label} ${String(counter)}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

function stripRelatedSessionSuffix(name: string): string {
  return name.replace(/\s+(?:—|-)\s+(?:Fork|Copy|Clone|分叉|副本|克隆)\s+\d+$/u, "").trim();
}

function extractUserMessageText(message: unknown): string | undefined {
  if (!isRecord(message) || message["role"] !== "user") return undefined;
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content.map((part) => {
    if (!isRecord(part) || part["type"] !== "text") return "";
    return typeof part["text"] === "string" ? part["text"] : "";
  }).join("");
}

function normalizedName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sessionHasActiveWork(session: CommandSession): boolean {
  return session.isStreaming || session.isBashRunning || session.isCompacting || session.pendingMessageCount > 0;
}

function forkActiveUnsupported(command: "fork" | "clone", t: Translator): ClientCommandResult {
  return { type: "unsupported", message: t("command.relatedActive", "Cannot {value0} while the session is active. Stop current activity first.", { value0: command === "fork" ? t("session.fork", "Fork") : t("session.clone", "Clone") }) };
}

function treeUnavailableUnsupported(t: Translator = loadNodeTranslator("server")): ClientCommandResult {
  return { type: "unsupported", message: t("command.treeUnavailable", "The current Pi runtime does not support session tree navigation.") };
}

function treeNavigationActiveUnsupported(t: Translator = loadNodeTranslator("server")): ClientCommandResult {
  return { type: "unsupported", message: t("server.main.53f693cde268", "Cannot run commands while session tree navigation is active. Stop or finish the navigation first.") };
}

function promptDraft(text: string | undefined): Partial<Pick<Extract<ClientCommandResult, { type: "done" }>, "promptDraft">> {
  return text === undefined ? {} : { promptDraft: text };
}

function formatSessionStats(session: CommandSession, t: Translator): string {
  const stats = session.getSessionStats();
  return [
    t("stats.session", "Session: {value0}", { value0: stats.sessionId }),
    t("stats.messages", "Messages: {value0} (user {value1}, assistant {value2})", { value0: String(stats.totalMessages), value1: String(stats.userMessages), value2: String(stats.assistantMessages) }),
    t("stats.toolCalls", "Tool calls: {value0}", { value0: String(stats.toolCalls) }),
    t("stats.tokens", "Tokens: ↑{value0} ↓{value1} total {value2}", { value0: String(stats.tokens.input), value1: String(stats.tokens.output), value2: String(stats.tokens.total) }),
    t("stats.cost", "Cost: ${value0}", { value0: stats.cost.toFixed(4) }),
  ].join("\n");
}

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}
