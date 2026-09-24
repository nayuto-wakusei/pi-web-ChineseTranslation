export function historyMessagesFromEntries(entries: readonly unknown[]): unknown[] {
  const messages: unknown[] = [];
  let thinkingLevel: string | undefined;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "message") messages.push(annotateAssistantThinkingLevel(entry["message"], thinkingLevel));
    else if (entry["type"] === "thinking_level_change") {
      const level = entry["thinkingLevel"];
      if (typeof level === "string") thinkingLevel = level;
    }
    else if (entry["type"] === "custom_message" && entry["display"] === true) messages.push({ role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (entry["type"] === "compaction") messages.push({ role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") messages.push({ role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return messages;
}

export function annotateAssistantThinkingLevel(message: unknown, thinkingLevel: string | undefined): unknown {
  if (thinkingLevel === undefined || thinkingLevel === "" || thinkingLevel === "off") return message;
  if (!isRecord(message) || message["role"] !== "assistant") return message;
  return { ...message, thinkingLevel };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
