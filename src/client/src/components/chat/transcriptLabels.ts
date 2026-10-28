import { chatTranscriptMessages as messages } from "../../chatTranscriptMessages";
import { localization } from "../../localization/browser";
import type { ChatGroupSummary } from "../../chatGroups";

export function localizedChatGroupSummary(summary: ChatGroupSummary): string {
  const roles = Object.entries(summary.roles).map(([role, count]) => messages.t("roleCount", { role, count }));
  return messages.t("groupSummary", { kind: summary.kind, count: summary.count, roles: localization.list(roles) });
}

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return messages.t("toolOutput", { name: toolName ?? "", named: toolName === undefined || toolName === "" ? "no" : "yes" });
}

// `live` marks the growing tail group while the session is active. It is
// independent of whether the group is expanded by default, so quiet mode keeps
// the same label and class as the ordinary transcript.
export function chatMessageGroupClassName(live: boolean): string {
  return live ? "msg event-group live" : "msg event-group";
}

export function chatMessageGroupLabel(live: boolean): string {
  return messages.t("groupLabel", { live: live ? "yes" : "no" });
}
