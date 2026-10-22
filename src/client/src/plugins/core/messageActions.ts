import { t } from "../../i18n";
import { html } from "lit";
import type { MessageActionAvailabilityContext, MessageActionContribution } from "../../../../plugin-api";
import { writeClipboardText } from "../../clipboard";

export function createCoreMessageActions(writeText = writeClipboardText): MessageActionContribution[] {
  const historyAction = {
    visible: ({ message }: MessageActionAvailabilityContext) => message.role === "user" || message.role === "assistant" || (message.role === "tool" && message.isQuestion === true),
    enabled: ({ session }: MessageActionAvailabilityContext) => !session.archived && !session.pending && !session.busy,
  };
  return [{
    ...historyAction,
    id: "message.fork",
    title: t("ui.main.4e737b072caa", "Clone session from this message"),
    ariaLabel: () => t("session.fork", "Fork"),
    icon: html`<span class="msg-fork-icon" aria-hidden="true">⑂</span>`,
    run: async ({ history }) => {
      if (window.confirm(t("ui.main.5b7be2382217", "Are you sure you want to fork this session?"))) await history.fork();
    },
  }, {
    ...historyAction,
    id: "message.back",
    title: t("ui.main.c99fd586dc20", "Go back to this message"),
    ariaLabel: () => t("ui.main.dedece75f412", "Go back to this message"),
    icon: html`<svg aria-hidden="true" width="16" height="16" viewBox="-3 -3 30 30" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"><path vector-effect="non-scaling-stroke" d="M4 5h11a6 6 0 0 1 0 12H4m5-5-5 5 5 5" /></svg>`,
    run: async ({ history }) => {
      if (window.confirm(t("ui.main.92fa96db248a", "Are you sure you want to go back to this message?"))) await history.goBack();
    },
  }, {
    target: "display",
    id: "message.copy",
    title: t("ui.chatView.copyMessage", "Copy message"),
    ariaLabel: ({ message }) => t("ui.chatView.message", "{copied} {role} message", { copied: t("bundled.updates.copy.63d90d", "Copy"), role: message.role === "user" ? t("ui.chatView.user", "User") : t("ui.chatView.assistant", "Assistant") }),
    icon: html`<span aria-hidden="true">⧉</span>`,
    visible: ({ message }) => (message.role === "user" || message.role === "assistant") && message.text !== "",
    run: async ({ message }) => {
      if (!await writeText(message.text)) throw new Error(t("ui.messageActions.clipboardFailed", "Unable to copy message to the clipboard."));
      return { title: t("ui.toolExecutionView.copied", "Copied"), ariaLabel: t("ui.chatView.message", "{copied} {role} message", { copied: t("ui.toolExecutionView.copied", "Copied"), role: message.role === "user" ? t("ui.chatView.user", "User") : t("ui.chatView.assistant", "Assistant") }), icon: html`<span aria-hidden="true">✓</span>` };
    },
  }];
}
