import type { SessionTreeSummaryField, SessionTreeSummaryPart, SessionTreeSummaryPresentation, SessionTreeSummaryStatus } from "./apiTypes.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is SessionTreeSummaryStatus {
  return value === "message" || value === "user-message" || value === "assistant-response"
    || value === "assistant-error" || value === "assistant-aborted" || value === "hidden-custom-message"
    || value === "compaction-summary" || value === "branch-summary";
}

function isField(value: unknown): value is SessionTreeSummaryField {
  return value === "shell" || value === "model" || value === "thinking-level" || value === "session-name"
    || value === "label" || value === "custom-entry" || value === "entry";
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function parseParts(value: unknown): SessionTreeSummaryPart[] | undefined {
  // Match the projection's 720-character source budget (an image costs seven).
  if (!Array.isArray(value) || value.length > 720) return undefined;
  const parts: SessionTreeSummaryPart[] = [];
  let remaining = 720;
  for (const part of value) {
    if (!isRecord(part)) return undefined;
    if (part["type"] === "text" && isText(part["text"], remaining)) {
      parts.push({ type: "text", text: part["text"] });
      remaining -= part["text"].length;
    } else if (part["type"] === "image" && remaining > 0) {
      parts.push({ type: "image" });
      remaining -= 7;
    } else return undefined;
  }
  return parts;
}

/** Unknown or malformed cosmetic metadata retains the node's raw summary fallback. */
export function parseSessionTreeSummaryPresentation(value: unknown): SessionTreeSummaryPresentation | undefined {
  if (!isRecord(value)) return undefined;
  const type = value["type"];
  switch (type) {
    case "status": return isStatus(value["status"]) ? { type, status: value["status"] } : undefined;
    case "content": {
      const parts = parseParts(value["parts"]);
      return parts !== undefined && isStatus(value["fallback"]) ? { type, parts, fallback: value["fallback"] } : undefined;
    }
    case "named": {
      const field = value["field"];
      const text = value["value"];
      if (!isField(field) || (text !== undefined && !isText(text, field === "model" ? 161 : 80))) return undefined;
      return { type, field, ...(text === undefined ? {} : { value: text }) };
    }
    case "assistant-tools": {
      const names: unknown = value["names"];
      if (!Array.isArray(names) || names.length > 3) return undefined;
      const parsed: string[] = [];
      for (const name of names) {
        if (!isText(name, 80)) return undefined;
        parsed.push(name);
      }
      return { type, names: parsed };
    }
    case "tool-result": {
      const parts = parseParts(value["parts"]);
      const isError = value["isError"];
      const toolName = value["toolName"];
      if (parts === undefined || typeof isError !== "boolean" || (toolName !== undefined && !isText(toolName, 80))) return undefined;
      return { type, parts, isError, ...(toolName === undefined ? {} : { toolName }) };
    }
    case "custom-message": {
      const parts = parseParts(value["parts"]);
      const customType = value["customType"];
      if (parts === undefined || (customType !== undefined && !isText(customType, 80))) return undefined;
      return { type, parts, ...(customType === undefined ? {} : { customType }) };
    }
    default: return undefined;
  }
}
