import type { QueuedSessionMessage } from "./api";
import { chatActionMessages } from "./chatActionMessages";

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

export function queuedMessageAttachmentLabel(
  message: QueuedSessionMessage,
  present: (count: number) => string = (count) => count > 0 ? `${String(count)} ${count === 1 ? "attachment" : "attachments"}` : "Attachments",
): string | undefined {
  const count = message.attachmentCount ?? 0;
  return count > 0 || message.hasAttachments === true ? present(Math.max(0, count)) : undefined;
}

/** Queues are displayed in delivery order: steering first, then follow-ups. */
export function queuedMessageRecallConfirmation(messages: readonly QueuedSessionMessage[], index: number): string | undefined {
  const message = messages[index];
  const hasAttachments = message?.hasAttachments === true || (message?.attachmentCount ?? 0) > 0;
  const later = messages.slice(index + 1);
  if (later.length === 0 && !hasAttachments) return undefined;
  const steers = later.filter((message) => message.kind === "steer").length;
  return chatActionMessages.t("recall", { attachments: hasAttachments ? "yes" : "no", steers, followUps: later.length - steers });
}
