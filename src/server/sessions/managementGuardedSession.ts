import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createLocalBashOperations, type AgentSession, type BashOperations, type ExtensionFactory } from "../../piSdk.js";
import type { PromptAttachment, PromptImageAttachment } from "../../shared/apiTypes.js";
import { SUBSESSION_NOTIFICATION_CUSTOM_TYPE } from "./subsessionCompletionInbox.js";
import { UserFacingError } from "../../shared/i18n.js";
import {
  checkManagementInput, checkManagementMaterial, checkManagementTool, checkManagementUninspectableMaterial,
  managementGuardrailFailure, ManagementGuardrailError, withGuardrailTurn, type GuardrailScope,
} from "../guardrails/managementGuardrails.js";

const approved = new AsyncLocalStorage<{ scope: GuardrailScope; text: string; consumed: boolean }>();

export function withApprovedPrompt<T>(scope: GuardrailScope, text: string, submit: () => T): T {
  return withGuardrailTurn(scope, text, () => approved.run({ scope, text, consumed: false }, submit));
}

async function checkExpanded(scope: GuardrailScope, text: string): Promise<void> {
  const original = approved.getStore();
  if (original && !original.consumed && original.scope.sessionId === scope.sessionId
    && original.scope.managementContext === scope.managementContext && original.text === text) {
    original.consumed = true;
    return;
  }
  await checkManagementInput(scope, text);
}

// All four supported SDK versions expand templates inside prompt(), after the input
// extension hook. The SDK exposes no asynchronous pre-enqueue hook at this point.
interface SdkExpandedQueues {
  _queueSteer(text: string, images?: ImageContent[]): Promise<void>;
  _queueFollowUp(text: string, images?: ImageContent[]): Promise<void>;
}

function supportsQueues(value: unknown): value is SdkExpandedQueues {
  return isRecord(value) && typeof value["_queueSteer"] === "function" && typeof value["_queueFollowUp"] === "function";
}

interface SdkStartRun {
  _startRun(trigger: { messageType: string; prompt?: string; images?: ImageContent[] }, started?: () => void): Promise<void>;
}

function hasRunBoundary(value: unknown): value is SdkStartRun {
  return isRecord(value) && typeof value["_startRun"] === "function";
}

interface LegacyCompaction {
  _checkCompaction(message: unknown, skipAbortedCheck?: boolean): Promise<boolean>;
}

function supportsLegacyCompaction(value: unknown): value is LegacyCompaction {
  return isRecord(value) && typeof value["_checkCompaction"] === "function";
}

// In 0.86/0.87 idle prompt() can compact before passing expanded messages to
// Agent.prompt. Keep usual post-turn compaction intact and postpone just this
// preflight until the new user text passes. A rejected prompt starts no model.
function deferLegacyPromptCompaction(session: AgentSession, scope: GuardrailScope): () => Promise<void> {
  const hooks: unknown = session;
  if (!supportsLegacyCompaction(hooks)) throw managementGuardrailFailure(scope, "user_input", "unsupported_compaction_boundary");
  const pending = new AsyncLocalStorage<{ waiting: boolean; compact?: () => Promise<boolean> }>();
  const submit = session.prompt.bind(session);
  session.prompt = (text, options) => pending.run({ waiting: true }, () => submit(text, options));
  const compact = hooks._checkCompaction.bind(session);
  hooks._checkCompaction = (message, skip) => {
    const gate = pending.getStore();
    if (gate?.waiting === true && skip === false) {
      gate.waiting = false;
      gate.compact = () => compact(message, false);
      return Promise.resolve(false);
    }
    return compact(message, skip);
  };
  return async () => {
    const gate = pending.getStore();
    if (gate === undefined) return;
    gate.waiting = false;
    const run = gate.compact;
    delete gate.compact;
    await run?.();
  };
}

export function bindExpandedPromptChecks(session: AgentSession, scope: GuardrailScope): void {
  const queues: unknown = session;
  if (!supportsQueues(queues)) throw managementGuardrailFailure(scope, "user_input", "unsupported_queue_boundary");
  for (const key of ["_queueSteer", "_queueFollowUp"] as const) {
    const submit = queues[key].bind(session);
    queues[key] = async (text, images) => {
      await checkExpanded(scope, text);
      if ((images?.length ?? 0) > 0) await checkManagementUninspectableMaterial(scope);
      return submit(text, images);
    };
  }

  // Since SDK 1.3 _startRun precedes the optional compaction request. Older
  // peers still go through Agent.prompt after expansion.
  if (hasRunBoundary(queues)) {
    const start = queues._startRun.bind(session);
    queues._startRun = async (trigger, started) => {
      if (trigger.messageType !== "user" || typeof trigger.prompt !== "string") return start(trigger, started);
      await checkExpanded(scope, trigger.prompt);
      if ((trigger.images?.length ?? 0) > 0) await checkManagementUninspectableMaterial(scope);
      return withGuardrailTurn(scope, trigger.prompt, () => start(trigger, started));
    };
    return;
  }
  const completePreflight = deferLegacyPromptCompaction(session, scope);
  const prompt = session.agent.prompt.bind(session.agent);
  session.agent.prompt = async (message: string | AgentMessage | AgentMessage[], images?: ImageContent[]) => {
    if (typeof message === "string") {
      await checkExpanded(scope, message);
      if ((images?.length ?? 0) > 0) await checkManagementUninspectableMaterial(scope);
      await completePreflight();
      return withGuardrailTurn(scope, message, () => prompt(message, images));
    }
    let task: string | undefined;
    for (const entry of Array.isArray(message) ? message : [message]) {
      if (entry.role !== "user") continue;
      if (Array.isArray(entry.content) && entry.content.some((block) => block.type === "image")) await checkManagementUninspectableMaterial(scope);
      const text = typeof entry.content === "string" ? entry.content
        : entry.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
      await checkExpanded(scope, text);
      task = text;
    }
    await completePreflight();
    return task === undefined ? prompt(message) : withGuardrailTurn(scope,task,() => prompt(message));
  };
}

function externalStrings(value: unknown, parts: string[]): void {
  if (typeof value === "string") parts.push(value);
  else if (Array.isArray(value)) for (const part of value) externalStrings(part, parts);
  else if (isRecord(value)) {
    for (const [key, part] of Object.entries(value)) {
      parts.push(key);
      externalStrings(part, parts);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function inspectResult(scope: GuardrailScope, content: unknown, metadata: unknown[]) {
  const parts: string[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string") parts.push(block["text"]);
      else await checkManagementUninspectableMaterial(scope);
    }
  } else externalStrings(content, parts);
  externalStrings(metadata, parts);
  return checkManagementMaterial(scope, parts.join("\n"));
}

export class IsolatedSessionHistoryError extends UserFacingError {
  constructor(reason: string) {
    super("guardrail.historyIsolated", "Session history contains isolated material. Open a new session to continue. {reason}", { reason });
  }
}

// Reopening an append-only SDK transcript created before enforcement would
// otherwise send unscreened historical tool output straight to the model.
export async function checkRestoredMaterials(entries: readonly unknown[], scope: GuardrailScope): Promise<void> {
  scope = {...scope,origin:"history"};
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const record = entry;
    const message = isRecord(record["message"]) ? record["message"] : undefined;
    let result;
    if (message?.["role"] === "toolResult") {
      result = await inspectResult(scope, message["content"], [message["details"], message["structuredContent"], message["nestedCalls"]]);
    } else if (message?.["role"] === "bashExecution") {
      result = await inspectResult(scope, message["output"], []);
    } else if (record["type"] === "custom_message" && ["session.message", SUBSESSION_NOTIFICATION_CUSTOM_TYPE].includes(String(record["customType"]))) {
      result = await inspectResult(scope, record["content"], [record["details"]]);
    }
    if (result?.isolated === true) throw new IsolatedSessionHistoryError(result.text);
  }
}

// Register a result handler so the SDK always dispatches emitToolResult, even
// when there are no other handlers. Inspect the final transformed result below.
export const managementMaterialEvents: ExtensionFactory = (pi) => { pi.on("tool_result", () => undefined); };

export function bindFinalToolResults(session: AgentSession, scope: GuardrailScope): void {
  const runner = session.extensionRunner;
  const emit = runner.emitToolResult.bind(runner);
  runner.emitToolResult = async (event) => {
    try {
      const changed = await emit(event);
      const content = changed?.content ?? event.content;
      const result = await inspectResult({...scope,origin:(changed?.isError ?? event.isError) ? "tool_error" : "tool_result",tool:event.toolName,toolCallId:event.toolCallId}, content, [
        changed?.details ?? event.details,
        changed?.structuredContent ?? (changed?.content === undefined ? event.structuredContent : undefined),
      ]);
      if (!result.isolated) return changed;
      return { content: [{ type: "text", text: result.text }], details: {}, isError: true };
    } catch (error) {
      // An extension throwing from a tool_result handler is logged and ignored by
      // the SDK. Return a safe replacement for every original payload field.
      const reason = error instanceof ManagementGuardrailError ? error
        : managementGuardrailFailure(scope, "external_text", "material_unavailable");
      if (reason.status === 503) session.agent.abort();
      return { content: [{ type: "text", text: reason.message }], details: {}, isError: true };
    }
  };
}

export function inspectAttachments(scope: GuardrailScope, attachments: PromptImageAttachment[]): Promise<PromptImageAttachment[]>;
export function inspectAttachments(scope: GuardrailScope, attachments: PromptAttachment[]): Promise<PromptAttachment[]>;
export async function inspectAttachments(scope: GuardrailScope, attachments: PromptAttachment[]): Promise<PromptAttachment[]> {
  const checked: PromptAttachment[] = [];
  for (const [index,input] of attachments.entries()) {
    const material = {...scope, origin:"attachment", materialRef:"attachments[" + String(index) + "]" + (input.name !== undefined ? " · " + input.name : "")};
    const filename = input.name === undefined ? undefined : await checkManagementMaterial(material, input.name);
    const attachment = filename?.isolated === true ? { ...input, name: "attachment" } : input;
    const bytes = Buffer.from(attachment.data, "base64");
    let source: string | undefined;
    if (attachment.kind === "file") {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
      try {
        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        if (!text.includes("\0")) source = text;
      } catch { /* Compressed documents and other binary formats require extraction first. */ }
    }
    if (source === undefined) {
      await checkManagementUninspectableMaterial(material);
      checked.push(attachment);
    } else {
      const result = await checkManagementMaterial(material, source);
      checked.push(result.isolated ? { kind: "file", name: "isolated.txt", mimeType: "text/plain", data: Buffer.from(result.text).toString("base64") } : attachment);
    }
  }
  return checked;
}

// Do not stream split or uninspected bytes into SDK previews, spill files, or
// BashExecution history. Pass one inspected output to the existing SDK sink.
function guardedShellOperations(scope: GuardrailScope, operations: BashOperations): BashOperations {
  return { async exec(command, cwd, options) {
    await checkManagementTool({...scope,origin:"direct_terminal"}, "bash", { command });
    const chunks: Buffer[] = [];
    let size = 0;
    const capture = { exceeded: false };
    let failure: string | undefined;
    let result;
    try {
      result = await operations.exec(command, cwd, { ...options, onData(data) {
        const chunk = data.length > 1024 * 1024 ? data.subarray(data.length - 1024 * 1024) : data;
        if (chunk.length !== data.length) capture.exceeded = true;
        chunks.push(Buffer.from(chunk));
        size += chunk.length;
        while (size > 1024 * 1024 && chunks.length > 1) {
          const removed = chunks.shift();
          if (removed !== undefined) size -= removed.length;
          capture.exceeded = true;
        }
      } });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (result === undefined) {
      const checked = await checkManagementMaterial({...scope,origin:"tool_error",tool:"bash"}, failure ?? "Shell command failed");
      throw new Error(checked.text);
    }
    if (capture.exceeded) await checkManagementUninspectableMaterial(scope);
    const checked = await checkManagementMaterial({...scope,origin:"tool_result",tool:"bash"}, Buffer.concat(chunks).toString("utf8"));
    options.onData(Buffer.from(checked.text));
    return result;
  } };
}

export function bindManagedShell(session: AgentSession, scope: GuardrailScope): void {
  const execute = session.executeBash.bind(session);
  session.executeBash = (command, onChunk, options) => {
    const shellPath = session.settingsManager.getShellPath();
    const operations = options?.operations ?? createLocalBashOperations(shellPath === undefined ? {} : { shellPath });
    return execute(command, onChunk, { ...options, operations: guardedShellOperations(scope, operations) });
  };
}
