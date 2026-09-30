export function historyMessagesFromEntries(entries: readonly unknown[]): unknown[] {
  const messages: unknown[] = [];
  let thinkingLevel: string | undefined;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "thinking_level_change") {
      const level = entry["thinkingLevel"];
      if (typeof level === "string") thinkingLevel = level;
      continue;
    }
    let message: unknown;
    if (entry["type"] === "message") message = annotateAssistantThinkingLevel(entry["message"], thinkingLevel);
    else if (entry["type"] === "custom_message" && entry["display"] === true) message = { role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] };
    else if (entry["type"] === "compaction") message = { role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` };
    else if (entry["type"] === "branch_summary") message = { role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` };
    else continue;
    messages.push(withDurableEntryId(message, entry["id"]));
  }
  return messages;
}

export function annotateAssistantThinkingLevel(message: unknown, thinkingLevel: string | undefined): unknown {
  if (thinkingLevel === undefined || thinkingLevel === "" || thinkingLevel === "off") return message;
  if (!isRecord(message) || message["role"] !== "assistant") return message;
  return { ...message, thinkingLevel };
}

/** The enclosing session-tree entry is authoritative. Provider message ids are not navigation targets. */
function withDurableEntryId(message: unknown, entryId: unknown): unknown {
  if (!isRecord(message) || typeof entryId !== "string" || entryId === "") return message;
  const payload = { ...message };
  delete payload["entryId"];
  return { ...payload, entryId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
