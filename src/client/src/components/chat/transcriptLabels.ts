import { t } from "../../i18n";

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? t("ui.chatView.toolOutput", "Tool output") : t("ui.chatView.output", "{toolName} output", { toolName });
}

export function chatMessageGroupClassName(defaultOpen: boolean): string {
  return defaultOpen ? "msg event-group live" : "msg event-group";
}

export function chatMessageGroupLabel(defaultOpen: boolean): string {
  return defaultOpen ? t("ui.chatView.liveEvent", "Live event") : t("ui.chatView.event", "Event");
}
