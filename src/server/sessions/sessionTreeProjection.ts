import type { Translator } from "../../shared/i18n.js";
import { loadNodeTranslator } from "../../localization.js";
import type { SessionTreeNode, SessionTreeNodeKind, SessionTreeSnapshot } from "../../shared/apiTypes.js";

const SUMMARY_MAX_LENGTH = 360;
const SUMMARY_SOURCE_MAX_LENGTH = SUMMARY_MAX_LENGTH * 2;
const LABEL_MAX_LENGTH = 160;
const NAMED_FIELD_MAX_LENGTH = 80;
const TIMESTAMP_MAX_LENGTH = 80;

/** Narrow structural view of the tree returned by Pi's SessionManager.getTree(). */
export interface ProjectableSessionTreeNode {
  readonly entry: unknown;
  readonly children: readonly ProjectableSessionTreeNode[];
  readonly label?: unknown;
}

interface ProjectableSessionEntry extends Record<string, unknown> {
  id: string;
  parentId: string | null;
  type: string;
}

interface EntryProjection {
  kind: SessionTreeNodeKind;
  summary: string;
}

/**
 * Project Pi's complete append-only session tree into the strict browser contract.
 * Only explicitly selected plain-text fields leave this boundary.
 */
export function projectSessionTree(
  roots: readonly ProjectableSessionTreeNode[],
  activeLeafId: string | null, t: Translator = loadNodeTranslator("server")
): SessionTreeSnapshot {
  const nodes: SessionTreeNode[] = [];
  const projectedIds = new Set<string>();
  const stack = [...roots].reverse();
  const visitedNodes = new WeakSet<ProjectableSessionTreeNode>();

  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate === undefined) continue;
    if (!isProjectableSessionTreeNode(candidate)) throw new Error(t("server.main.4b60afa8c1ba", "Pi returned a malformed session-tree node"));
    const node = candidate;
    if (visitedNodes.has(node)) continue;
    visitedNodes.add(node);

    if (!isProjectableSessionEntry(node.entry)) {
      throw new Error(t("server.main.e6b6a590f7ed", "Pi returned a malformed session-tree entry"));
    }
    if (projectedIds.has(node.entry.id)) throw new Error(t("server.main.3857869ba727", "Pi returned duplicate session-tree entry IDs"));
    projectedIds.add(node.entry.id);
    nodes.push(projectNode(node, node.entry, t));

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child !== undefined) stack.push(child);
    }
  }

  if (activeLeafId !== null && (activeLeafId.trim() === "" || !projectedIds.has(activeLeafId))) {
    throw new Error(t("server.main.7a5bc8620ac0", "Pi returned an invalid active session-tree leaf"));
  }

  return {
    nodes,
    activeLeafId,
    activePathIds: buildActivePath(nodes, activeLeafId),
  };
}

function projectNode(node: ProjectableSessionTreeNode, entry: ProjectableSessionEntry, t: Translator = loadNodeTranslator("server")): SessionTreeNode {
  const projection = projectEntry(entry, t);
  const timestamp = optionalPlainText(entry["timestamp"], TIMESTAMP_MAX_LENGTH);
  const label = optionalPlainText(node.label, LABEL_MAX_LENGTH);
  return {
    id: entry.id,
    parentId: entry.parentId,
    kind: projection.kind,
    summary: projection.summary,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(label === undefined ? {} : { label }),
  };
}

function projectEntry(entry: ProjectableSessionEntry, t: Translator = loadNodeTranslator("server")): EntryProjection {
  switch (entry.type) {
    case "message":
      return projectMessage(entry["message"], t);
    case "custom_message":
      return projectCustomMessage(entry, t);
    case "compaction":
      return { kind: "compaction", summary: summary(entry["summary"], t("server.main.d765f83522b3", "Compaction summary")) };
    case "branch_summary":
      return { kind: "branch-summary", summary: summary(entry["summary"], t("ui.sessionTreeNavigator.branchSummary", "Branch summary")) };
    case "model_change":
      return { kind: "model-change", summary: modelChangeSummary(entry, t) };
    case "thinking_level_change":
      return { kind: "thinking-level-change", summary: namedSummary(t("ui.sessionTreeNavigator.thinkingLevel", "Thinking level"), entry["thinkingLevel"], t("server.main.bd3089eabef7", "Thinking level changed")) };
    case "session_info":
      return { kind: "session-info", summary: namedSummary(t("server.main.864aff361dc2", "Session name"), entry["name"], t("server.main.fa649632e3e0", "Session info changed")) };
    case "label":
      return { kind: "label", summary: namedSummary(t("ui.sessionTreeNavigator.label", "Label"), entry["label"], t("server.main.7fcc85f15076", "Label removed")) };
    case "custom":
      return { kind: "custom", summary: namedSummary(t("server.main.5f0cbfe15886", "Custom entry"), entry["customType"], t("server.main.5f0cbfe15886", "Custom entry")) };
    default:
      return { kind: "other", summary: namedSummary(t("server.main.4e5f90ffebb5", "Entry"), entry.type, t("server.main.6723d8968dbb", "Other session entry")) };
  }
}

function projectMessage(value: unknown, t: Translator = loadNodeTranslator("server")): EntryProjection {
  if (!isRecord(value)) return { kind: "other", summary: t("server.main.dc6de3fa868f", " message") };
  switch (value["role"]) {
    case "user":
      return { kind: "user", summary: summary(contentPreview(value["content"], true, t), t("server.main.146671b0a192", "User message")) };
    case "assistant":
      return { kind: "assistant", summary: assistantSummary(value, t) };
    case "toolResult":
      return { kind: "tool-result", summary: toolResultSummary(value, t) };
    case "bashExecution":
      return { kind: "bash", summary: namedSummary(t("ui.toolExecutionView.command", "Command"), value["command"], t("server.main.616f0f69fb0c", "Shell command")) };
    case "custom":
      return projectCustomMessage(value, t);
    case "compactionSummary":
      return { kind: "compaction", summary: summary(value["summary"], t("server.main.d765f83522b3", "Compaction summary")) };
    case "branchSummary":
      return { kind: "branch-summary", summary: summary(value["summary"], t("ui.sessionTreeNavigator.branchSummary", "Branch summary")) };
    default:
      return { kind: "other", summary: t("server.main.dc6de3fa868f", " message") };
  }
}

function projectCustomMessage(value: Record<string, unknown>, t: Translator = loadNodeTranslator("server")): EntryProjection {
  if (value["display"] !== true) return { kind: "custom-message", summary: t("server.main.be56e839ddf1", "Hidden custom message") };
  const customType = optionalPlainText(value["customType"], NAMED_FIELD_MAX_LENGTH);
  const content = contentPreview(value["content"], true, t);
  const prefix = customType === undefined ? t("ui.sessionTreeNavigator.customMessage", "Custom message") : t("server.main.fa01b7e998e3", "Custom message ({arg0})", { arg0: customType });
  return { kind: "custom-message", summary: summary(content === "" ? prefix : `${prefix}: ${content}`, prefix) };
}

function assistantSummary(message: Record<string, unknown>, t: Translator = loadNodeTranslator("server")): string {
  const text = contentPreview(message["content"], false, t);
  if (text !== "") return summary(text, t("server.main.5c94fc594b12", "Assistant response"));

  const toolNames = assistantToolNames(message["content"]);
  if (toolNames.length > 0) return summary(t("server.main.1bd15151d237", "Tool call: {arg0}", { arg0: toolNames.join(", ") }), t("server.main.794d91c7d8b2", "Assistant tool call"));
  if (message["stopReason"] === "error") return t("server.main.303ddde0151b", "Assistant error");
  if (message["stopReason"] === "aborted") return t("server.main.7f2288f6a14d", "Assistant response aborted");
  return t("server.main.5c94fc594b12", "Assistant response");
}

function assistantToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part["type"] !== "toolCall") continue;
    const name = optionalPlainText(part["name"], NAMED_FIELD_MAX_LENGTH);
    if (name !== undefined && !names.includes(name)) names.push(name);
    if (names.length === 3) break;
  }
  return names;
}

function toolResultSummary(message: Record<string, unknown>, t: Translator = loadNodeTranslator("server")): string {
  const isError = message["isError"] === true;
  const toolName = optionalPlainText(message["toolName"], NAMED_FIELD_MAX_LENGTH);
  const prefix = toolName === undefined
    ? isError ? t("server.main.544b5247f8ed", "Tool error") : t("ui.sessionTreeNavigator.toolResult", "Tool result")
    : `${isError ? t("server.main.544b5247f8ed", "Tool error") : t("ui.sessionTreeNavigator.toolResult", "Tool result")} (${toolName})`;
  const content = contentPreview(message["content"], true, t);
  return summary(content === "" ? prefix : `${prefix}: ${content}`, prefix);
}

function modelChangeSummary(entry: Record<string, unknown>, t: Translator = loadNodeTranslator("server")): string {
  const provider = optionalPlainText(entry["provider"], NAMED_FIELD_MAX_LENGTH);
  const modelId = optionalPlainText(entry["modelId"], NAMED_FIELD_MAX_LENGTH);
  if (provider !== undefined && modelId !== undefined) return summary(t("server.main.113718afc707", "Model: {arg0}/{arg1}", { arg0: provider, arg1: modelId }), t("server.main.58ae2359bc5c", "Model changed"));
  return namedSummary(t("ui.sessionTreeNavigator.model", "Model"), modelId ?? provider, t("server.main.58ae2359bc5c", "Model changed"));
}

function contentPreview(content: unknown, includeImageMarkers: boolean, t: Translator = loadNodeTranslator("server")): string {
  const fragments: string[] = [];
  let remaining = SUMMARY_SOURCE_MAX_LENGTH;
  const append = (text: string): void => {
    if (remaining <= 0 || text === "") return;
    const fragment = text.slice(0, remaining);
    fragments.push(fragment);
    remaining -= fragment.length;
  };

  if (typeof content === "string") {
    append(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part["type"] === "text" && typeof part["text"] === "string") append(part["text"]);
      else if (includeImageMarkers && part["type"] === "image") append(t("server.main.4f622a639dae", "[image]"));
      if (remaining <= 0) break;
    }
  }
  return plainText(fragments.join(" "));
}

function namedSummary(prefix: string, value: unknown, fallback: string): string {
  const field = optionalPlainText(value, NAMED_FIELD_MAX_LENGTH);
  return field === undefined ? fallback : summary(`${prefix}: ${field}`, fallback);
}

function summary(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = plainText(value);
  return normalized === "" ? fallback : truncate(normalized, SUMMARY_MAX_LENGTH);
}

function optionalPlainText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = plainText(value);
  return normalized === "" ? undefined : truncate(normalized, maxLength);
}

function plainText(value: string): string {
  // Browser previews should not retain non-whitespace C0/C1 controls.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  let end = maxLength - 1;
  const finalCodeUnit = value.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

function buildActivePath(nodes: readonly SessionTreeNode[], activeLeafId: string | null): string[] {
  if (activeLeafId === null) return [];
  const byId = new Map<string, SessionTreeNode>();
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }

  const path: string[] = [];
  const visitedIds = new Set<string>();
  let currentId: string | null = activeLeafId;
  while (currentId !== null && !visitedIds.has(currentId)) {
    const node = byId.get(currentId);
    if (node === undefined) break;
    visitedIds.add(currentId);
    path.push(currentId);
    currentId = node.parentId;
  }
  path.reverse();
  return path;
}

function isProjectableSessionTreeNode(value: unknown): value is ProjectableSessionTreeNode {
  return isRecord(value) && Array.isArray(value["children"]);
}

function isProjectableSessionEntry(value: unknown): value is ProjectableSessionEntry {
  return isRecord(value)
    && typeof value["id"] === "string"
    && value["id"].trim() !== ""
    && (value["parentId"] === null || (typeof value["parentId"] === "string" && value["parentId"].trim() !== ""))
    && typeof value["type"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
