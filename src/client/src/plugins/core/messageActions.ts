import { html } from "lit";
import { renderCopyIcon, renderGoBackIcon } from "../../components/messageActionIcons";
import { coreMessageActionMessages as m } from "./messages";

class CopyMessageError extends Error {
  override get message(): string { return m.t("copyFailed"); }
}
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
    get title() { return m.t("fork"); },
    ariaLabel: () => m.t("fork"),
    icon: html`<span class="msg-fork-icon" aria-hidden="true">⑂</span>`,
    run: async ({ history }) => {
      if (window.confirm(m.t("confirmFork"))) await history.fork();
    },
  }, {
    ...historyAction,
    id: "message.back",
    get title() { return m.t("back"); },
    icon: renderGoBackIcon(),
    run: async ({ history }) => {
      await history.goBack();
    },
  }, {
    target: "display",
    id: "message.copy",
    get title() { return m.t("copy"); },
    ariaLabel: ({ message }) => m.t("copyRole", { role: message.role }),
    icon: renderCopyIcon(),
    visible: ({ message }) => (message.role === "user" || message.role === "assistant") && message.text !== "",
    run: async ({ message }) => {
      if (!await writeText(message.text)) throw new CopyMessageError();
      return {
        get title() { return m.t("copied"); },
        get ariaLabel() { return m.t("copiedRole", { role: message.role }); },
        icon: html`<span aria-hidden="true">✓</span>`,
      };
    },
  }];
}
