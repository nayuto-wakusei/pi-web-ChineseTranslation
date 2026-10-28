import type { ServerNotice } from "../../shared/apiTypes";
import { localization } from "./localization/browser";
import definitions from "./serverNotices.messages";

const messages = localization.registerMessages("core.serverNotices", definitions);

/** Resolve at render time so retained snapshots follow language changes. */
export function serverNoticeMessage(notice: ServerNotice): string {
  const presentation = notice.presentation;
  if (presentation?.kind === "workspaceRemovalCommandFailed") return messages.t("workspaceRemovalCommandFailed");
  if (presentation?.kind === "workspaceRemovalFailed") return messages.t("workspaceRemovalFailed", { detail: presentation.detail });
  return notice.message;
}
