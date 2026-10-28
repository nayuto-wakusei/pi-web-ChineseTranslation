import type { SessionTreeNode, SessionTreeSummaryPart } from "../../shared/apiTypes";
import { localization } from "./localization/browser";
import definitions from "./sessionTreeSummary.messages";

const messages = localization.registerMessages("core.sessionTreeSummary", definitions);

/** Resolve provenance on every render; never infer a message from an English preview. */
export function sessionTreeSummary(node: SessionTreeNode): string {
  const presentation = node.summaryPresentation;
  if (presentation === undefined) return node.summary;
  const content = (parts: SessionTreeSummaryPart[]): string => parts.map((part) =>
    part.type === "text" ? part.text : messages.t("image")).join(" ");
  let result: string;
  switch (presentation.type) {
    case "status": result = messages.t(presentation.status); break;
    case "content": result = content(presentation.parts) || messages.t(presentation.fallback); break;
    case "named": result = messages.t(presentation.field, { hasValue: presentation.value === undefined ? "no" : "yes", value: presentation.value ?? "" }); break;
    case "assistant-tools": result = messages.t("toolCalls", { names: localization.list(presentation.names) }); break;
    case "tool-result": result = messages.t("toolResult", {
      error: presentation.isError ? "yes" : "no", hasName: presentation.toolName === undefined ? "no" : "yes",
      name: presentation.toolName ?? "", hasContent: presentation.parts.length > 0 ? "yes" : "no", content: content(presentation.parts),
    }); break;
    case "custom-message": result = messages.t("customMessage", {
      hasName: presentation.customType === undefined ? "no" : "yes", name: presentation.customType ?? "",
      hasContent: presentation.parts.length > 0 ? "yes" : "no", content: content(presentation.parts),
    }); break;
  }
  // Bound the complete localized preview, including prefixes and image markers.
  if (result.length <= 360) return result;
  let end = 359;
  const finalCodeUnit = result.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return `${result.slice(0, end)}…`;
}
