import { html, type TemplateResult } from "lit";
import { writeClipboardText } from "../clipboard";
import { localization } from "../localization/browser";
import definitions from "./copyId.messages";

const messages = localization.registerMessages("core.copyId", definitions);

export function renderCopyIdAction(kind: "session" | "workspace" | "project" | "machine", id: string, onCopied: () => void): TemplateResult {
  return html`<button type="button" class="ui-button ui-menu-item" data-copy-id @click=${async () => {
    if (await writeClipboardText(id)) onCopied();
    else window.alert(messages.t("failed"));
  }}>${messages.t(kind)}</button>`;
}
