import { t } from "../../i18n";
import { html, nothing } from "lit";
import type { QueuedSessionMessage } from "../../api";
import { queuedMessageAttachmentLabel, type QueuedMessageAction } from "../../queuedMessageActions";
import type { ChatBehaviors } from "../../chatBehaviors";
import type { ChatContentRendering } from "../../formatting/contentRendering";
import type { MarkdownWorkspaceContext } from "../../formatting/workspaceLinks";
import { renderCopyIcon, renderGoBackIcon, renderTrashIcon } from "../messageActionIcons";
import { renderAttachIcon, renderQueueIcon, renderSteerIcon } from "../promptEditorIcons";

export interface QueuedMessageSection {
  source: "client" | "server";
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
}

export function chatQueuedMessageSections(clientQueued: QueuedSessionMessage[], serverQueued: QueuedSessionMessage[]): QueuedMessageSection[] {
  return [
    clientQueued.length === 0 ? undefined : { source: "client", heading: t("ui.chatView.waitingForSessionStartup", "Waiting for session startup"), detail: t("ui.chatView.willSendAutomaticallyWhenTheBackendSessionIs", "Will send automatically when the backend session is ready"), messages: clientQueued },
    serverQueued.length === 0 ? undefined : { source: "server", heading: t("ui.chatView.queuedMessages", "Queued messages"), detail: t("ui.chatView.pending", "{length} pending", { length: String(serverQueued.length) }), messages: serverQueued },
  ].filter((section): section is QueuedMessageSection => section !== undefined);
}

export function chatQueuedSectionShowsClearAction(section: QueuedMessageSection, canClearServerQueue: boolean, hasClearHandler: boolean): boolean {
  return section.source === "server" && canClearServerQueue && hasClearHandler;
}

export interface QueuedMessagesOptions {
  machineId: string;
  sessionId: string;
  behaviors: ChatBehaviors;
  contentRendering: ChatContentRendering | undefined;
  workspaceContext: MarkdownWorkspaceContext | undefined;
  pending: boolean;
  canMutate: boolean;
  canClearServerQueue: boolean;
  contentRendererVersion: number;
  unavailable: string | undefined;
  onClear: (() => void) | undefined;
  onCopy: (text: string) => void;
  onAction: ((action: QueuedMessageAction, index: number, messages: QueuedSessionMessage[]) => void) | undefined;
}

/** Templates deliberately share the transcript root: layout and scroll observation stay with ChatView. */
export function renderQueuedMessageSection(section: QueuedMessageSection, options: QueuedMessagesOptions) {
  const unavailable = section.source === "server" ? options.unavailable : undefined;
  const reason = unavailable === undefined ? undefined : unavailable === "" ? t("ui.queuedMessages.unavailable", "Individual queue controls are unavailable with this runtime.") : unavailable;
  const disabled = options.pending || unavailable !== undefined;
  return html`
    <aside class="queued-messages ui-transcript-surface" aria-live="polite">
      <div class="queued-header">
        <div class="queued-heading"><strong>${section.heading}</strong><small>${section.detail}</small></div>
        ${chatQueuedSectionShowsClearAction(section, options.canClearServerQueue, options.onClear !== undefined) ? html`
          <button type="button" class="queued-clear-button ui-button ui-button--icon ui-button--compact" ?disabled=${options.pending} aria-label=${t("ui.queuedMessages.clearQueue", "Clear queue")} title=${t("ui.queuedMessages.clearTitle", "Clear queued messages without stopping active work")} @click=${options.onClear}>${renderTrashIcon()}</button>
        ` : nothing}
      </div>
      ${reason === undefined ? nothing : html`<small role="status">${reason}</small>`}
      ${section.messages.map((message, index) => html`
        <div class="queued-message">
          <div class="queued-message-header">
            <div class="queued-message-meta">
              <span class="queued-kind">${message.kind === "steer" ? t("ui.queuedMessages.steer", "Steer") : t("ui.queuedMessages.queue", "Queue")} ${String(section.messages.slice(0, index + 1).filter((entry) => entry.kind === message.kind).length)}</span>
              ${queuedMessageAttachmentLabel(message) === undefined ? nothing : html`<span class="queued-attachments" title=${t("ui.queuedMessages.attachmentsTitle", "Attachments included with this queued message")}><span aria-hidden="true">${renderAttachIcon()}</span> ${queuedMessageAttachmentLabel(message)}</span>`}
            </div>
            <div class="queued-message-actions ui-toolbar-group">
              <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" aria-label=${t("ui.queuedMessages.copy", "Copy queued message")} title=${t("ui.queuedMessages.copyTitle", "Copy message")} @click=${() => { options.onCopy(message.text); }}>${renderCopyIcon()}</button>
              ${section.source !== "server" || !options.canMutate || options.onAction === undefined ? nothing : html`
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} title=${reason ?? (message.kind === "steer" ? t("ui.queuedMessages.switchToQueueTitle", "Move to the end of the follow-up queue") : t("ui.queuedMessages.switchToSteerTitle", "Move to the end of the steering queue"))} aria-label=${message.kind === "steer" ? t("ui.queuedMessages.switchToQueue", "Switch to Queue") : t("ui.queuedMessages.switchToSteer", "Switch to Steer")} @click=${() => { options.onAction?.("toggle", index, section.messages); }}>${message.kind === "steer" ? renderQueueIcon() : renderSteerIcon()}</button>
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} aria-label=${t("ui.queuedMessages.recall", "Recall queued message")} title=${reason ?? t("ui.queuedMessages.recallTitle", "Recall this message's text and clear later queued messages")} @click=${() => { options.onAction?.("edit", index, section.messages); }}>${renderGoBackIcon()}</button>
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} aria-label=${t("ui.queuedMessages.remove", "Remove queued message")} title=${reason ?? t("ui.queuedMessages.removeTitle", "Remove only this message")} @click=${() => { options.onAction?.("remove", index, section.messages); }}>${renderTrashIcon()}</button>
              `}
            </div>
          </div>
          <formatted-text .imagesEnabled=${options.behaviors.loadImages} .codeBlocks=${options.behaviors.codeBlocks} .intentKey=${JSON.stringify([options.machineId, options.sessionId, "queue", section.source, index, message.kind])} .contentRendering=${options.contentRendering} .contentRendererVersion=${options.contentRendererVersion} .machineId=${options.machineId} .workspaceContext=${options.workspaceContext} .text=${message.text}></formatted-text>
        </div>
      `)}
    </aside>
  `;
}
