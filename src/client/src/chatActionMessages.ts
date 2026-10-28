import { localization } from "./localization/browser";
import definitions from "./components/chatActions.messages";

export const chatActionMessages = localization.registerMessages("core.chatActions", definitions);

type HistoryActionErrorKey = "conversationUnavailable" | "draftActionPending" | "historyUnavailable" | "messageUnavailable" | "treeUnavailable";

/** Retain the presentation key so existing action feedback follows language changes. */
export class HistoryActionError extends Error {
  constructor(private readonly key: HistoryActionErrorKey) { super(); }
  override get message(): string { return chatActionMessages.t(this.key); }
}
