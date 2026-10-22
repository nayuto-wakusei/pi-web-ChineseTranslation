import type { QueuedSessionMessage } from "./api";
import { t } from "./i18n";

// The wire action remains "edit" for compatibility; the UI calls it Recall.
export type QueuedMessageAction = "edit" | "remove" | "toggle";

export interface QueuedMessageActionTarget {
  machineId: string;
  sessionId: string;
  cwd: string;
  action: QueuedMessageAction;
  index: number;
  expectedQueue: QueuedSessionMessage[];
}

export function queuedMessageAttachmentLabel(message: QueuedSessionMessage): string | undefined {
  const count = message.attachmentCount ?? 0;
  if (count > 0) return count === 1 ? t("client.queuedMessageActions.attachment", "1 attachment")
    : t("client.queuedMessageActions.attachments", "{count} attachments", { count });
  return message.hasAttachments === true ? t("client.queuedMessageActions.attachmentsUnknown", "Attachments") : undefined;
}

/** Queues are displayed in delivery order: steering first, then follow-ups. */
export function queuedMessageRecallConfirmation(messages: readonly QueuedSessionMessage[], index: number): string | undefined {
  const message = messages[index];
  const hasAttachments = message?.hasAttachments === true || (message?.attachmentCount ?? 0) > 0;
  const warning = hasAttachments
    ? t("client.queuedMessageActions.recallAttachments", "Recall this message? Only its text will return to the composer. Its attachments will be lost.")
    : t("client.queuedMessageActions.recall", "Recall this message?");
  const later = messages.slice(index + 1);
  if (later.length === 0) return hasAttachments ? warning : undefined;
  const steers = later.filter((message) => message.kind === "steer").length;
  const followUps = later.length - steers;
  const parts = [
    steers === 0 ? undefined : steers === 1 ? t("client.queuedMessageActions.laterSteer", "1 later steer")
      : t("client.queuedMessageActions.laterSteers", "{count} later steers", { count: steers }),
    followUps === 0 ? undefined : followUps === 1 ? t("client.queuedMessageActions.queuedFollowUp", "1 queued follow-up")
      : t("client.queuedMessageActions.queuedFollowUps", "{count} queued follow-ups", { count: followUps }),
  ].filter((part) => part !== undefined);
  return `${warning}\n\n${t("client.queuedMessageActions.removesLater", "This will also remove {messages}.", { messages: parts.join(t("client.queuedMessageActions.and", " and ")) })}`;
}
