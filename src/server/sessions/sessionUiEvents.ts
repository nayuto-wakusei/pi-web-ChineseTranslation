import type { SessionUiEvent } from "../types.js";
import { projectBrowserMessage } from "../browserMessageProjection.js";
import { summarizeToolArgs } from "./toolSummary.js";
import { annotateAssistantThinkingLevel, historyMessagesFromEntries } from "./transcriptMessages.js";

export function toClientEvent(event: unknown, thinkingLevel?: string, streamId?: string): SessionUiEvent {
  const eventType = getString(event, "type");
  // Nested execution belongs to its parent result, not a separate durable message.
  if (getString(event, "parentToolCallId") !== undefined && eventType?.startsWith("tool_execution_") === true) {
    return { type: "pi.event", eventType };
  }
  if (eventType === "message_start" && getString(getProperty(event, "message"), "role") === "assistant") {
    return { type: "assistant.start", message: annotateAssistantStreamId(annotateAssistantThinkingLevel(projectBrowserMessage(getProperty(event, "message")), thinkingLevel), streamId) };
  }
  const streamIdentity = streamId === undefined ? {} : { streamId };
  const assistantMessageEvent = getProperty(event, "assistantMessageEvent");
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "text_delta") {
    return { type: "assistant.delta", text: getString(assistantMessageEvent, "delta") ?? "", ...streamIdentity };
  }
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "thinking_delta") {
    return { type: "assistant.thinking.delta", text: getString(assistantMessageEvent, "delta") ?? "", ...streamIdentity };
  }
  if (eventType === "tool_execution_start") {
    const args = getProperty(event, "args");
    return { type: "tool.start", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", summary: summarizeToolArgs(args) || stringifyPrimitive(args), args };
  }
  if (eventType === "tool_execution_update") {
    const partialResult = getProperty(event, "partialResult");
    return { type: "tool.update", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: stringifyToolResult(partialResult), content: toolResultContent(partialResult), details: toolResultDetails(partialResult) };
  }
  if (eventType === "tool_execution_end") {
    const result = getProperty(event, "result");
    return { type: "tool.end", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: stringifyToolResult(result), content: toolResultContent(result), details: toolResultDetails(result), isError: getBoolean(event, "isError") === true };
  }
  if (eventType === "entry_appended") {
    const [message] = historyMessagesFromEntries([getProperty(event, "entry")]);
    if (message !== undefined) return { type: "message.append", message };
  }
  if (eventType === "agent_start") return { type: "agent.start" };
  if (eventType === "agent_end") return { type: "agent.end" };
  if (eventType === "message_end") {
    const message = getProperty(event, "message");
    return message === undefined ? { type: "message.end" } : { type: "message.end", message: annotateAssistantStreamId(annotateAssistantThinkingLevel(message, thinkingLevel), streamId) };
  }
  return { type: "pi.event", eventType: eventType ?? "unknown" };
}

export function annotateAssistantStreamId(message: unknown, streamId?: string): unknown {
  return streamId !== undefined && getString(message, "role") === "assistant" && isRecord(message)
    ? { ...message, streamId } : message;
}

export function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

export function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function toolResultContent(result: unknown): unknown {
  if (isRecord(result)) {
    const content = getProperty(result, "content");
    if (content !== undefined) return content;
    const text = getString(result, "text") ?? getString(result, "output");
    if (text !== undefined) return [{ type: "text", text }];
  }
  if (typeof result === "string") return [{ type: "text", text: result }];
  return result;
}

function toolResultDetails(result: unknown): unknown {
  return isRecord(result) ? getProperty(result, "details") : undefined;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(stringifyToolResult).filter((text) => text !== "").join("\n");
  if (isRecord(result)) {
    if (getString(result, "type") === "image") return "[image]";
    const text = getString(result, "text") ?? getString(result, "content") ?? getString(result, "output");
    if (text !== undefined) return text;
    const content = getProperty(result, "content");
    if (Array.isArray(content)) return stringifyToolResult(content);
    return JSON.stringify(result, null, 2);
  }
  return stringifyPrimitive(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  // Preserve legacy piSessionService behavior: top-level tool args/results can
  // be arrays, and the event mappers still need indexed property access plus
  // the old array-summary rendering.
  return typeof value === "object" && value !== null;
}

function stringifyPrimitive(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}
