
import { html, nothing } from "lit";
import type { QueuedSessionMessage } from "../../api";
import { queuedMessageAttachmentLabel, type QueuedMessageAction } from "../../queuedMessageActions";
import { chatChromeMessages as messages } from "../../chatChromeMessages";
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

export function chatQueuedMessageSections(
  clientQueued: QueuedSessionMessage[],
  serverQueued: QueuedSessionMessage[],
  present: (source: QueuedMessageSection["source"], count: number) => Pick<QueuedMessageSection, "heading" | "detail"> = (source, count) => source === "client"
    ? { heading: "Queued until session starts", detail: "Will send once the backend session is ready" }
    : { heading: "Queued messages", detail: `${String(count)} pending` },
): QueuedMessageSection[] {
  return [
    clientQueued.length === 0 ? undefined : { source: "client", ...present("client", clientQueued.length), messages: clientQueued },
    serverQueued.length === 0 ? undefined : { source: "server", ...present("server", serverQueued.length), messages: serverQueued },
  ].filter((section): section is QueuedMessageSection => section !== undefined);
}

function attachmentLabel(message: QueuedSessionMessage): string | undefined {
  return queuedMessageAttachmentLabel(message, (count) => messages.t("attachments", { count }));
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
  const reason = unavailable === undefined ? undefined : unavailable === "" ? messages.t("unavailable") : unavailable;
  const disabled = options.pending || unavailable !== undefined;
  return html`
    <aside class="queued-messages ui-transcript-surface" aria-live="polite">
      <div class="queued-header">
        <div class="queued-heading"><strong>${section.heading}</strong><small>${section.detail}</small></div>
        ${chatQueuedSectionShowsClearAction(section, options.canClearServerQueue, options.onClear !== undefined) ? html`
          <button type="button" class="queued-clear-button ui-button ui-button--icon ui-button--compact" ?disabled=${options.pending} aria-label=${messages.t("clearQueue")} title=${messages.t("clearQueueTitle")} @click=${options.onClear}>${renderTrashIcon()}</button>
        ` : nothing}
      </div>
      ${reason === undefined ? nothing : html`<small role="status">${reason}</small>`}
      ${section.messages.map((message, index) => html`
        <div class="queued-message">
          <div class="queued-message-header">
            <div class="queued-message-meta">
              <span class="queued-kind">${messages.t("queueKind", { kind: message.kind, index: section.messages.slice(0, index + 1).filter((entry) => entry.kind === message.kind).length })}</span>
              ${attachmentLabel(message) === undefined ? nothing : html`<span class="queued-attachments" title=${messages.t("attachmentsTitle")}><span aria-hidden="true">${renderAttachIcon()}</span> ${attachmentLabel(message)}</span>`}
            </div>
            <div class="queued-message-actions ui-toolbar-group">
              <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" aria-label=${messages.t("copyQueue")} title=${messages.t("copyTitle")} @click=${() => { options.onCopy(message.text); }}>${renderCopyIcon()}</button>
              ${section.source !== "server" || !options.canMutate || options.onAction === undefined ? nothing : html`
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} title=${reason ?? messages.t("switchTitle", { kind: message.kind })} aria-label=${messages.t("switchQueue", { kind: message.kind })} @click=${() => { options.onAction?.("toggle", index, section.messages); }}>${message.kind === "steer" ? renderQueueIcon() : renderSteerIcon()}</button>
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} aria-label=${messages.t("recall")} title=${reason ?? messages.t("recallTitle")} @click=${() => { options.onAction?.("edit", index, section.messages); }}>${renderGoBackIcon()}</button>
                <button type="button" class="queued-action ui-button ui-button--icon ui-button--compact" ?disabled=${disabled} aria-label=${messages.t("remove")} title=${reason ?? messages.t("removeTitle")} @click=${() => { options.onAction?.("remove", index, section.messages); }}>${renderTrashIcon()}</button>
              `}
            </div>
          </div>
          <formatted-text .imagesEnabled=${options.behaviors.loadImages} .codeBlocks=${options.behaviors.codeBlocks} .intentKey=${JSON.stringify([options.machineId, options.sessionId, "queue", section.source, index, message.kind])} .contentRendering=${options.contentRendering} .contentRendererVersion=${options.contentRendererVersion} .machineId=${options.machineId} .workspaceContext=${options.workspaceContext} .text=${message.text}></formatted-text>
        </div>
      `)}
    </aside>
  `;
}
