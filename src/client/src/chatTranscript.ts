import { appendText, appendThinking, normalizeMessage, previewFromDetails, summarizeArgs, textMessage } from "./chatMessages";
import type { ChatLine, ToolExecutionPart } from "./components/shared";
import { appendShellChunk, finalizeShellMessage, shellStartMessage } from "./shellMessages";
import type { SessionUiEvent } from "./sessionSocket";

export function applyTranscriptEvent(messages: ChatLine[], event: SessionUiEvent): ChatLine[] | undefined {
  if (event.type === "message.append") return appendNewMessage(messages, event.message);
  if (event.type === "assistant.delta") return appendText(messages, "assistant", event.text);
  if (event.type === "assistant.thinking.delta") return appendThinking(messages, event.text);
  if (event.type === "tool.start") return appendToolExecutionStart(messages, event);
  if (event.type === "tool.update") return updateToolExecution(messages, event.toolCallId, (part) => mergeToolExecutionUpdate(part, event));
  if (event.type === "tool.end") return finalizeToolExecution(messages, event.toolCallId, event.toolName, summarizeArgs(event.content), event.text, event.isError, event.content, event.details);
  if (event.type === "shell.start") return [...messages, shellStartMessage(event.command, event.excludeFromContext)];
  if (event.type === "shell.chunk") return appendShellChunk(messages, event.chunk);
  if (event.type === "shell.end") return finalizeShellMessage(messages, event);
  if (event.type === "command.output") return [...messages, textMessage(event.level === "error" ? "system" : "tool", event.message)];
  if (event.type === "session.error") return [...messages, textMessage("system", event.message)];
  if (event.type === "message.end") return event.message === undefined ? undefined : applyFinalMessage(messages, event.message);
  return undefined;
}

function applyFinalMessage(messages: ChatLine[], rawMessage: unknown): ChatLine[] | undefined {
  const rawToolResult = toolResultFromRawMessage(rawMessage);
  if (rawToolResult !== undefined) {
    return finalizeToolExecution(messages, rawToolResult.toolCallId, rawToolResult.toolName, summarizeArgs(rawToolResult.content), rawToolResult.text, rawToolResult.isError, rawToolResult.content, rawToolResult.details);
  }

  const ended = normalizeMessage(rawMessage);
  if (ended.length === 0) return undefined;
  const displayEnded = ended
    .map((line) => line.role === "assistant" ? withoutToolCalls(line) : line)
    .filter((line) => line.parts.length > 0);
  if (displayEnded.length === 0) return messages;
  return displayEnded.reduce((next, line) => applyFinalLine(next, line), messages);
}

function applyFinalLine(messages: ChatLine[], displayEnded: ChatLine): ChatLine[] {
  const skillReadIndex = findMatchingSkillRead(messages, displayEnded);
  if (skillReadIndex >= 0) return [...messages.slice(0, skillReadIndex), displayEnded, ...messages.slice(skillReadIndex + 1)];
  const last = messages.at(-1);
  if (last?.role !== displayEnded.role) return [...messages, displayEnded];
  if (displayEnded.role === "assistant" || sameMessageText(last, displayEnded)) return [...messages.slice(0, -1), displayEnded];
  return [...messages, displayEnded];
}

function withoutToolCalls(message: ChatLine): ChatLine {
  return { ...message, parts: message.parts.filter((part) => part.type !== "toolCall") };
}

function parseSkillReadPath(path: string | undefined): { name: string; path: string } | undefined {
  if (path === undefined || path === "") return undefined;
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.endsWith("/SKILL.md") && normalized !== "SKILL.md") return undefined;
  const name = normalized.split("/").at(-2);
  if (name === undefined || name === "") return undefined;
  return { name, path };
}

function appendToolExecutionStart(messages: ChatLine[], event: Extract<SessionUiEvent, { type: "tool.start" }>): ChatLine[] {
  const skillRead = event.toolName === "read" ? parseSkillReadPath(getString(event.args, "path")) : undefined;
  if (skillRead !== undefined) return appendLine(messages, { role: "skill", parts: [{ type: "skillRead", ...skillRead }] });

  const part: ToolExecutionPart = {
    type: "toolExecution",
    ...(event.toolCallId === "" ? {} : { toolCallId: event.toolCallId }),
    toolName: event.toolName,
    summary: event.summary || summarizeArgs(event.args),
    ...(event.args === undefined ? {} : { args: event.args }),
    status: "running",
  };
  return [...messages, { role: "tool", parts: [part] }];
}

function mergeToolExecutionUpdate(part: ToolExecutionPart, event: Extract<SessionUiEvent, { type: "tool.update" }>): ToolExecutionPart {
  const preview = previewFromDetails(event.details) ?? part.preview;
  return {
    ...part,
    status: part.status === "pending" ? "running" : part.status,
    ...(event.text === "" ? {} : { resultText: event.text }),
    ...(event.content === undefined ? {} : { content: event.content }),
    ...(event.details === undefined ? {} : { details: event.details }),
    ...(preview === undefined ? {} : { preview }),
  };
}

function finalizeToolExecution(messages: ChatLine[], toolCallId: string | undefined, toolName: string, fallbackSummary: string, text: string, isError: boolean, content: unknown, details: unknown): ChatLine[] {
  const updated = updateToolExecution(messages, toolCallId, (part) => {
    const preview = previewFromDetails(details) ?? part.preview;
    return {
      ...part,
      status: isError ? "error" : "success",
      resultText: text,
      ...(content === undefined ? {} : { content }),
      ...(details === undefined ? {} : { details }),
      ...(preview === undefined ? {} : { preview }),
    };
  });
  if (updated !== messages) return updated;

  const preview = previewFromDetails(details);
  const part: ToolExecutionPart = {
    type: "toolExecution",
    ...(toolCallId === undefined || toolCallId === "" ? {} : { toolCallId }),
    toolName,
    summary: fallbackSummary,
    status: isError ? "error" : "success",
    resultText: text,
    ...(content === undefined ? {} : { content }),
    ...(details === undefined ? {} : { details }),
    ...(preview === undefined ? {} : { preview }),
  };
  return [...messages, { role: "tool", parts: [part] }];
}

function updateToolExecution(messages: ChatLine[], toolCallId: string | undefined, update: (part: ToolExecutionPart) => ToolExecutionPart): ChatLine[] {
  if (toolCallId === undefined || toolCallId === "") return messages;
  for (let lineIndex = messages.length - 1; lineIndex >= 0; lineIndex--) {
    const line = messages[lineIndex];
    if (line === undefined) continue;
    const partIndex = line.parts.findIndex((part) => part.type === "toolExecution" && part.toolCallId === toolCallId);
    if (partIndex < 0) continue;
    const part = line.parts[partIndex];
    if (part?.type !== "toolExecution") continue;
    const nextLine = { ...line, parts: [...line.parts.slice(0, partIndex), update(part), ...line.parts.slice(partIndex + 1)] };
    return [...messages.slice(0, lineIndex), nextLine, ...messages.slice(lineIndex + 1)];
  }
  return messages;
}

function toolResultFromRawMessage(message: unknown): { toolCallId?: string; toolName: string; text: string; isError: boolean; content: unknown; details: unknown } | undefined {
  if (getString(message, "role") !== "toolResult") return undefined;
  const toolCallId = getString(message, "toolCallId");
  const content = getProperty(message, "content");
  return {
    ...(toolCallId === undefined ? {} : { toolCallId }),
    toolName: getString(message, "toolName") ?? "tool",
    text: stringifyToolContent(content),
    isError: getBoolean(message, "isError") === true,
    content,
    details: getProperty(message, "details"),
  };
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(stringifyToolContent).filter((text) => text !== "").join("\n");
  if (typeof content === "object" && content !== null) {
    const text = getString(content, "text") ?? getString(content, "content") ?? getString(content, "output");
    if (text !== undefined) return text;
  }
  return "";
}

function findMatchingSkillRead(messages: ChatLine[], ended: ChatLine): number {
  const endedReads = skillReads(ended);
  if (endedReads.length === 0) return -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "skill") continue;
    const reads = skillReads(message);
    if (sameSkillReads(reads, endedReads)) return index;
  }
  return -1;
}

function skillReads(message: ChatLine | undefined): SkillRead[] {
  if (message === undefined) return [];
  return message.parts.filter((part): part is SkillRead => part.type === "skillRead");
}

type SkillRead = Extract<ChatLine["parts"][number], { type: "skillRead" }>;

function sameSkillReads(left: SkillRead[], right: SkillRead[]): boolean {
  return left.length === right.length && left.every((read, index) => sameSkillRead(read, right[index]));
}

function sameSkillRead(left: SkillRead, right: SkillRead | undefined): boolean {
  if (right === undefined) return false;
  return normalizeSkillPath(left.path) === normalizeSkillPath(right.path) || left.name === right.name;
}

function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function sameMessageText(left: ChatLine, right: ChatLine): boolean {
  return messageText(left) === messageText(right);
}

function messageText(message: ChatLine): string {
  return message.parts
    .filter((part): part is Extract<ChatLine["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

function appendNewMessage(messages: ChatLine[], rawMessage: unknown): ChatLine[] {
  const lines = normalizeMessage(rawMessage);
  return lines.length === 0 ? messages : [...messages, ...lines];
}

function appendLine(messages: ChatLine[], line: ChatLine): ChatLine[] {
  const last = messages.at(-1);
  if (line.role === "skill" && sameSkillReads(skillReads(last), skillReads(line))) return messages;
  if (last?.role === line.role && line.role !== "skill") return [...messages.slice(0, -1), { ...last, parts: [...last.parts, ...line.parts] }];
  return [...messages, line];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}
