import { t } from "./i18n";
import type { ChatLine, ChatPart } from "./components/shared";

export type ChatGroup =
  | { kind: "message"; message: ChatLine; index: number }
  | { kind: "tool-image"; message: ChatLine; index: number; toolName?: string }
  // Members keep their source indexes even when invisible entries are skipped.
  | { kind: "group"; messages: { message: ChatLine; index: number }[]; startIndex: number; endIndex: number };

export type ChatToolImageOutput = Extract<ChatGroup, { kind: "tool-image" }>;
export type ChatDisplayGroup = Exclude<ChatGroup, ChatToolImageOutput>
  | { kind: "tool-images"; outputs: [ChatToolImageOutput, ...ChatToolImageOutput[]] };

interface MessageSlices {
  readable: ChatLine | undefined;
  technical: ChatLine | undefined;
  toolName: string | undefined;
}

/** Reuse immutable source-message slices without retaining discarded transcripts. */
export class ChatMessageGrouper {
  private readonly slices = new WeakMap<ChatLine, MessageSlices>();

  group(messages: ChatLine[], indexOffset = 0): ChatGroup[] {
    return groupMessages(messages, indexOffset, (message) => {
      let slices = this.slices.get(message);
      if (slices === undefined) {
        slices = splitMessage(message);
        this.slices.set(message, slices);
      }
      return slices;
    });
  }
}

/** Combine only adjoining image outputs; conversation and activity remain boundaries. */
export function groupConsecutiveImageOutputs(groups: readonly ChatGroup[]): ChatDisplayGroup[] {
  const result: ChatDisplayGroup[] = [];
  for (const group of groups) {
    if (group.kind !== "tool-image") { result.push(group); continue; }
    const previous = result.at(-1);
    if (previous?.kind === "tool-images") previous.outputs.push(group);
    else result.push({ kind: "tool-images", outputs: [group] });
  }
  return result;
}

export function groupChatMessages(messages: ChatLine[], indexOffset = 0): ChatGroup[] {
  return groupMessages(messages, indexOffset, splitMessage);
}

function groupMessages(messages: ChatLine[], indexOffset: number, slicesFor: (message: ChatLine) => MessageSlices): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let eventMessages: Extract<ChatGroup, { kind: "group" }>["messages"] = [];

  const pushEvent = (message: ChatLine, index: number) => {
    eventMessages.push({ message, index });
  };
  const flushEvents = () => {
    const first = eventMessages[0];
    const last = eventMessages.at(-1);
    if (first === undefined || last === undefined) return;
    groups.push({ kind: "group", messages: eventMessages, startIndex: first.index, endIndex: last.index });
    eventMessages = [];
  };

  messages.forEach((message, index) => {
    const { readable, technical, toolName } = slicesFor(message);
    const absoluteIndex = indexOffset + index;
    if (technical !== undefined) pushEvent(technical, absoluteIndex);
    if (readable !== undefined) {
      flushEvents();
      if (isToolImageMessage(readable)) {
        groups.push({ kind: "tool-image", message: readable, index: absoluteIndex, ...(toolName === undefined ? {} : { toolName }) });
      } else {
        groups.push({ kind: "message", message: readable, index: absoluteIndex });
      }
    }
  });
  flushEvents();
  return groups;
}

function splitMessage(message: ChatLine): MessageSlices {
  const readableParts: ChatPart[] = [];
  const technicalParts: ChatPart[] = [];
  for (const part of message.parts) {
    if (part.type === "toolResultBoundary" || part.type === "empty") continue;
    (isReadablePart(message, part) ? readableParts : technicalParts).push(part);
  }
  const metadata = { ...(message.streamId === undefined ? {} : { streamId: message.streamId }), ...(message.entryId === undefined ? {} : { entryId: message.entryId }), ...(message.transcriptIndex === undefined ? {} : { transcriptIndex: message.transcriptIndex }), ...(message.source === undefined ? {} : { source: message.source }), ...(message.meta === undefined ? {} : { meta: message.meta }) };
  return {
    readable: readableParts.length === 0 ? undefined : { role: message.role, parts: readableParts, ...metadata },
    technical: technicalParts.length === 0 ? undefined : { role: technicalParts.every((part) => part.type === "skillRead") ? "skill" : message.role, parts: technicalParts, ...metadata },
    toolName: toolNameFromParts(technicalParts),
  };
}

/** Whether this slice renders a message header rather than a headerless shell. */
export function chatMessageHasHeader(message: ChatLine): boolean {
  return !(message.parts.length > 0 && (
    (message.role === "tool" && message.parts.every((part) => part.type === "toolExecution"))
    || message.parts.every((part) => part.type === "askUserRecord")
  ));
}

/** Select rendered slice identities, independent of disclosure and plugin policy. */
export function canonicalEntryActionHeaders(groups: readonly ChatGroup[]): ReadonlySet<ChatLine> {
  const entries = new Map<string, { message: ChatLine; priority: number }>();
  for (const group of groups) {
    for (const message of group.kind === "group" ? group.messages.map((event) => event.message) : [group.message]) {
      if (message.entryId === undefined || !chatMessageHasHeader(message)) continue;
      // A normal reply wins over attached events. Conversation headers also
      // outrank skill-only slices, so thinking retains history when no reply exists.
      const conversation = message.role === "user" || message.role === "assistant";
      const reply = group.kind !== "group" && message.parts.some((part) => part.type === "text" || part.type === "image");
      const priority = conversation ? (reply ? 3 : 2) : (group.kind !== "group" ? 1 : 0);
      const previous = entries.get(message.entryId);
      if (previous === undefined || priority > previous.priority) entries.set(message.entryId, { message, priority });
    }
  }
  return new Set(Array.from(entries.values(), ({ message }) => message));
}

export function summarizeChatGroup(messages: ChatLine[]): string {
  if (messages.every((message) => message.source === "compaction")) return t("client.chatGroups.compaction.summaries.e2309c", "{value1} compaction summaries", { value1: String(messages.length) });
  if (messages.every((message) => message.source === "branch_summary")) return t("client.chatGroups.branch.summaries.c232fa", "{value1} branch summaries", { value1: String(messages.length) });
  const counts = messages.reduce<Record<string, number>>((acc, message) => {
    acc[message.role] = (acc[message.role] ?? 0) + 1;
    return acc;
  }, {});
  const roleLabels: Record<string, string> = { user: t("client.chatGroups.user.0d0e1a", "User"), assistant: t("client.chatGroups.assistant.e5ce5f", "Assistant"), tool: t("client.chatGroups.tool.5ca673", "Tool"), system: t("client.chatGroups.system.5b50d7", "System"), bash: t("client.chatGroups.command.928f87", "Command"), skill: t("client.chatGroups.skill.99aea2", "Skill") };
  const details = Object.entries(counts).map(([role, count]) => `${String(count)} ${roleLabels[role] ?? role}`).join(" · ");
  return t("client.chatGroups.events.12f406", "{value1} events{value2}", { value1: String(messages.length), value2: details !== "" ? ` · ${details}` : "" });
}

function isToolImageMessage(message: ChatLine): boolean {
  return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "image");
}

function toolNameFromParts(parts: ChatPart[]): string | undefined {
  for (const part of parts) {
    if ((part.type === "toolCall" || part.type === "toolExecution" || part.type === "toolResult") && part.toolName !== "") return part.toolName;
  }
  return undefined;
}

function isReadablePart(message: ChatLine, part: ChatPart): boolean {
  if (message.source === "compaction" || message.source === "branch_summary") return false;
  if (part.type === "skillInvocation" || part.type === "image" || part.type === "askUserQuestion" || part.type === "askUserRecord") return true;
  return part.type === "text" && (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "bash");
}
