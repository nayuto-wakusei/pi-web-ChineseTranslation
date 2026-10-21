import type { DisplayedMessageActionAvailabilityContext, MessageActionAvailabilityContext, MessageActionFeedback, MessageActionResult } from "../../../plugin-api";
import { displayedMessageActionMessage, messageActionMessage, MessageActionAvailabilityCache, type RegisteredMessageAction } from "../plugins/messageActions";
import { clientLocale, t } from "../i18n.js";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { thinkingLevelDisplayLabel } from "../../../shared/thinkingLevels";
import { ChatDisclosureController } from "../chatDisclosure";
import { groupChatMessages, summarizeChatGroup, type ChatGroup } from "../chatGroups";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { ChatScrollController, distanceFromScrollBottom, findFirstVisibleArticle, isNearScrollBottom, type ChatAnchorScrollPosition, type ChatScrollRestoreResult } from "../chatScrollPosition";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus, SessionWarningSeverity } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import {
  notificationAnnouncementLabel,
  notificationDismissLabel,
  notificationFocusTargetAfterDismiss,
  notificationInboxOverflowLabel,
  notificationInboxTotalCount,
  notificationMessageTruncationLabel,
  notificationSeverityLabel,
  notificationTargetKey,
  notificationTrayHeading,
  notificationTrayIsCollapsed,
  setNotificationTrayCollapsed,
  type NotificationFocusTarget,
  type SelectedSessionNotificationView,
  type SessionNotificationTarget,
} from "../sessionNotifications";
import type { ChatContentRendering } from "../formatting/contentRendering";
import type { MarkdownWorkspaceContext } from "../formatting/workspaceLinks";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./ConversationMeter";
import "./FormattedText";
import "./ToolExecutionView";

const messageTimestampFormatter = localizedDateTimeFormatter({ dateStyle: "medium", timeStyle: "medium" });
const notificationTimestampFormatter = localizedDateTimeFormatter({ timeStyle: "short" });

function localizedDateTimeFormatter(options: Intl.DateTimeFormatOptions) {
  let locale = clientLocale();
  let formatter = new Intl.DateTimeFormat(locale, options);
  return { format(date: Date): string {
    if (locale !== clientLocale()) {
      locale = clientLocale();
      formatter = new Intl.DateTimeFormat(locale, options);
    }
    return formatter.format(date);
  } };
}

function renderNotificationDisclosureIcon(collapsed: boolean) {
  return html`
    <svg class=${`notification-icon notification-disclosure-icon${collapsed ? "" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}

function renderNotificationCloseIcon() {
  return html`
    <svg class="notification-icon notification-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12"></path>
      <path d="M18 6 6 18"></path>
    </svg>
  `;
}

function isSessionNotificationTarget(value: unknown): value is SessionNotificationTarget {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "machineId") === "string"
    && typeof Reflect.get(value, "cwd") === "string"
    && typeof Reflect.get(value, "sessionId") === "string";
}

function clampPercent(value: number): number {
  return clampNumber(value, 0, 100);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface PendingNotificationFocus {
  chatKey: string;
  focusTarget: NotificationFocusTarget;
}

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

export type ChatImagePart = Extract<ChatPart, { type: "image" }>;

/** Derive the `<img>` source URL and alt text for a rendered image part. */
export function chatImagePartSource(part: ChatImagePart): { src: string; alt: string } {
  return { src: `data:${part.mimeType};base64,${part.data}`, alt: t("ui.chatView.attachedImage", "Attached image") };
}

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? t("ui.chatView.toolOutput", "Tool output") : t("ui.chatView.output", "{toolName} output", { toolName: toolName });
}

const chatMessageRoleLabels: Record<ChatLine["role"], () => string> = {
  user: () => t("ui.chatView.user", "User"),
  assistant: () => t("ui.chatView.assistant", "Assistant"),
  tool: () => t("ui.chatView.tool", "Tool"),
  system: () => t("ui.chatView.system", "System"),
  bash: () => t("ui.chatView.command", "Command"),
  skill: () => t("ui.chatView.skill", "Skill"),
};

/** User-facing label for a protocol-level chat role. */
export function chatMessageRoleLabel(role: ChatLine["role"]): string {
  return chatMessageRoleLabels[role]();
}

/** The stable scroll-anchor/render key for a top-level message at `index`. */
export function chatMessageAnchorKey(index: number): string {
  return `m:${String(index)}`;
}

/** The stable scroll-anchor/render key for a collapsed event group starting at `startIndex`. */
export function chatGroupAnchorKey(startIndex: number): string {
  return `g:${String(startIndex)}`;
}

/** The stable scroll-anchor key for an event inside a group at `index`. */
export function chatEventAnchorKey(index: number): string {
  return `e:${String(index)}`;
}

/** The stable scroll-marker id emitted before an event group ending at `endIndex`. */
export function chatGroupScrollMarkerId(endIndex: number): string {
  return `g:${String(endIndex)}`;
}

/** The CSS class list for an event-group `<details>`, distinguishing the live tail. */
export function chatMessageGroupClassName(defaultOpen: boolean): string {
  return defaultOpen ? "msg event-group live" : "msg event-group";
}

/** The disclosure summary label for an event group, distinguishing the live tail. */
export function chatMessageGroupLabel(defaultOpen: boolean): string {
  return defaultOpen ? t("ui.chatView.liveEvent", "Live event") : t("ui.chatView.event", "Event");
}

/** Whether a queued-message section shows the server clear-queue action. */
export function chatQueuedSectionShowsClearAction(section: QueuedMessageSection, canClearServerQueue: boolean, hasClearHandler: boolean): boolean {
  return section.source === "server" && canClearServerQueue && hasClearHandler;
}

/** A rendered session-warning row derived from live status warnings. */
export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

/** Derive one severity-tagged warning row per live status warning, in order. */
export function chatSessionWarningRows(status: SessionStatus | undefined): ChatSessionWarningRow[] {
  return (status?.warnings ?? []).map((warning) => ({
    severity: warning.severity,
    severityClass: `session-warning ${warning.severity}`,
    message: warning.message,
    ...(warning.source === undefined ? {} : { source: warning.source }),
    ...(warning.path === undefined ? {} : { path: warning.path }),
    ...(warning.dismiss === undefined ? {} : { dismissId: warning.dismiss.id }),
  }));
}

export function chatMessageMetadataLabel(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp);
  const model = chatMessageModelLabel(message);
  const thinkingLevel = message.meta?.thinkingLevel;
  const parts = [time, model, thinkingLevel === undefined || thinkingLevel === "" ? undefined : thinkingLevelDisplayLabel(thinkingLevel, t)]
    .filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? t("ui.chatView.noPiMessageMetadataAvailable", "No Pi message metadata available") : parts.join(" · ");
}

function formatMessageTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return messageTimestampFormatter.format(date);
}

function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

export interface RenderedChatTranscript {
  sessionId: string;
  messages: ChatLine[];
  start: number;
  end: number;
}

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property() sessionId = "";
  @property() machineId = "local";
  @property({ attribute: false }) contentRendering: ChatContentRendering | undefined;
  @property({ type: Number }) contentRendererVersion = 0;
  @property({ attribute: false }) workspaceContext: MarkdownWorkspaceContext | undefined;
  @property({ type: Number }) messageStart = 0;
  @property({ type: Number }) messageEnd = 0;
  @property({ type: Number }) messageTotal = 0;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) loadingMore = false;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Number }) pendingMessageCount = 0;
  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ attribute: false }) pendingAsk?: PendingAskUser;
  @property({ attribute: false }) pendingDialogs: PendingExtensionDialog[] = [];
  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];
  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onDismissClosedDialog?: ExtensionDialogDismissCallback;
  @property({ attribute: false }) askDraftSessionId = "";
  @property({ attribute: false }) onSubmitAsk?: (askId: string, submission: AskUserSubmission) => void | Promise<void>;
  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;
  @property({ type: Boolean }) canClearServerQueue = false;
  @property({ attribute: false }) onClearServerQueue?: () => void;
  @property({ attribute: false }) onMessageAction?: (input: MessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;
  @state() private messageActionPending = false;
  @state() private messageActionError: { machineId: string; sessionId: string; key: string; message: string } | undefined;
  private messageActionGeneration = 0;
  private messageActionIdentity = "";
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ attribute: false }) onDismissNotification?: (notificationId: string) => void;
  @property({ attribute: false }) onDismissAllNotifications?: () => void;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  @property({ attribute: false }) onTranscriptRendered?: (transcript: RenderedChatTranscript) => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @state() private pinnedToBottom = true;
  @state() private zoomedImage: { src: string; alt: string } | undefined = undefined;
  private imageZoomModalRegistration: RenderedModalRegistration | undefined;
  @state() private expandedMetaKey: string | undefined;
  @state() private currentConversationIndex: number | undefined;
  @state() private collapsedNotificationTargetKeys: ReadonlySet<string> = new Set();
  @state() private retainedEmptyNotificationTrayTargetKey: string | undefined;
  private pendingNotificationFocus: PendingNotificationFocus | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollController = new ChatScrollController();
  private suppressScrollSave = false;
  private suppressLoadMoreRequests = false;
  private loadMoreCheckFrame: number | undefined;
  private scrollToBottomFrame: number | undefined;
  private scrollToOpenAskFrame: number | undefined;
  private scrollToOpenDialogFrame: number | undefined;
  private conversationRailFrame: number | undefined;
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private transcriptStructureKey = "";
  private primaryArticleElements: HTMLElement[] = [];
  private articleElements: HTMLElement[] = [];
  private scrollAnchorElementIndex: HTMLElement[] = [];
  private scrollMarkerElements: HTMLElement[] = [];
  private scrollMarkerElementById = new Map<string, HTMLElement>();
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private lastScrollTop = 0;
  private lastClientHeight = 0;
  private touchStartY: number | undefined;
  private pendingScrollRestoreSessionId: string | undefined;
  private pendingScrollRestorePosition: ChatAnchorScrollPosition | undefined;
  private restoreScrollFrame: number | undefined;
  private prependRestoreToken = 0;
  @state() private loadMoreRequested = false;
  private readonly onViewportResize = () => {
    if (this.pinnedToBottom) this.scrollToBottom();
    else this.lastClientHeight = this.chat?.clientHeight ?? 0;
  };
  private readonly onImageLoad = (): void => {
    if (this.pinnedToBottom) this.scrollToBottom();
  };
  private readonly openImageZoom = (src: string, alt: string): void => {
    this.zoomedImage = { src, alt };
  };
  private readonly closeImageZoom = (): void => {
    if (this.zoomedImage !== undefined) this.zoomedImage = undefined;
  };
  private readonly onImageZoomDialogClick = (event: MouseEvent): void => {
    if (event.target === this.imageZoomDialog) this.closeImageZoom();
  };
  private readonly onPageHide = () => {
    this.saveScrollPosition();
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  protected override firstUpdated(): void {
    this.lastClientHeight = this.chat?.clientHeight ?? 0;
  }

  override disconnectedCallback(): void {
    this.resetMessageAction();
    this.saveScrollPosition();
    this.scrollController.dispose();
    this.releaseImageZoomModal();
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    if (this.scrollToBottomFrame !== undefined) cancelAnimationFrame(this.scrollToBottomFrame);
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
    if (this.conversationRailFrame !== undefined) cancelAnimationFrame(this.conversationRailFrame);
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    this.clearTranscriptElementIndex();
    super.disconnectedCallback();
  }

  private savePreviousSessionScrollPosition(previousSessionId: unknown): void {
    if (typeof previousSessionId !== "string" || previousSessionId === "" || previousSessionId === this.sessionId) return;
    this.saveScrollPosition(previousSessionId);
  }

  private prepareSessionUiState(): void {
    this.disclosures.syncSession(this.sessionId);
    this.pendingNotificationFocus = undefined;
    this.retainedEmptyNotificationTrayTargetKey = undefined;
    this.scrollController.clearScheduledSave();
    this.suppressScrollSave = false;
    this.suppressLoadMoreRequests = false;
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.prependRestoreToken += 1;
    this.clearTranscriptElementIndex();
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    const identity = this.currentMessageActionIdentity();
    if (identity !== this.messageActionIdentity) {
      this.messageActionIdentity = identity;
      this.resetMessageAction();
    }
    if (changed.has("sessionId")) {
      this.savePreviousSessionScrollPosition(changed.get("sessionId"));
      this.prepareSessionUiState();
    } else if (changed.has("notificationInbox") && this.notificationTargetChanged(changed.get("notificationInbox"))) {
      this.pendingNotificationFocus = undefined;
      this.retainedEmptyNotificationTrayTargetKey = undefined;
    }
    if (this.liveTailContentChanged(changed)) this.pinnedToBottom = this.pinnedToBottom && (this.didChatHeightChange() || this.isNearBottom());
  }

  protected override update(changed: Map<string, unknown>): void {
    const prependAnchor = this.isPrependingMessages(changed) ? this.capturePrependScrollAnchor() : undefined;
    super.update(changed);
    this.syncTranscriptElementIndex();
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    if (changed.has("sessionId")) this.restoreScrollPosition();
    const openedAsk = changed.has("pendingAsk") && this.isNewPendingAsk(changed.get("pendingAsk"));
    const openedDialog = changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs"));
    // The form uses the transcript scroller. Start a new long form at question
    // one rather than applying the usual live-tail scroll and landing at its end.
    if (!changed.has("sessionId") && openedAsk && this.pinnedToBottom) this.scrollToOpenAsk();
    else if (!changed.has("sessionId") && openedDialog && this.pinnedToBottom) this.scrollToOpenDialog();
    else if (!changed.has("sessionId") && this.liveTailContentChanged(changed) && this.pinnedToBottom) this.scrollToBottom();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("messageTotal") || changed.has("hasMore") || changed.has("loadingMore")) this.scheduleConversationRailUpdate();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.continuePendingScrollRestore();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    if (changed.has("notificationInbox") && this.pendingNotificationFocus !== undefined) this.focusPendingNotificationTarget();
    if (changed.has("zoomedImage")) this.syncImageZoomDialog();
    if (this.onTranscriptRendered !== undefined) void this.reportRenderedTranscript();
  }

  private async reportRenderedTranscript(): Promise<void> {
    const transcript = { sessionId: this.sessionId, messages: this.messages, start: this.messageStart, end: this.messageEnd };
    await this.updateComplete;
    if (!this.isConnected || transcript.sessionId !== this.sessionId || transcript.messages !== this.messages
      || transcript.start !== this.messageStart || transcript.end !== this.messageEnd) return;
    this.onTranscriptRendered?.(transcript);
  }

  private liveTailContentChanged(changed: Map<string, unknown>): boolean {
    return changed.has("messages")
      || changed.has("pendingAsk")
      || changed.has("pendingDialogs")
      || changed.has("closedDialogs")
      || changed.has("pendingMessageCount")
      || changed.has("clientQueuedMessages");
  }

  private syncImageZoomDialog(): void {
    const dialog = this.imageZoomDialog;
    if (dialog === undefined) return;
    if (this.zoomedImage !== undefined) {
      if (this.imageZoomModalRegistration === undefined) {
        const registration = registerRenderedModal({
          element: dialog,
          nativeTopLayer: true,
          focus: () => {
            const close = this.renderRoot.querySelector<HTMLElement>(".image-zoom-close");
            (close ?? dialog).focus();
          },
        });
        this.imageZoomModalRegistration = registration;
        try {
          if (!dialog.open) dialog.showModal();
        } catch (error) {
          this.imageZoomModalRegistration = undefined;
          registration.unregister();
          throw error;
        }
      }
      this.imageZoomModalRegistration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseImageZoomModal();
  }

  private releaseImageZoomModal(): void {
    const registration = this.imageZoomModalRegistration;
    this.imageZoomModalRegistration = undefined;
    registration?.unregister();
  }

  private notificationTargetChanged(previous: unknown): boolean {
    const currentInbox = this.notificationInbox;
    if (!isSessionNotificationTarget(previous) || currentInbox === undefined) return previous !== currentInbox;
    return notificationTargetKey(previous) !== notificationTargetKey(currentInbox);
  }

  override render() {
    const groups = this.groupedMessages();
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class="chat-wrap">
        ${this.renderConversationRail()}
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
          ${this.renderHistoryBoundary()}
          ${repeat(
            groups,
            (group) => group.kind === "group" ? this.groupRenderKey(group.startIndex) : this.messageAnchorKey(group.index),
            (group, index) => {
              if (group.kind === "group") return this.renderMessageGroup(group.messages, group.startIndex, group.endIndex, this.isLiveTailGroup(groups, index));
              if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, group.toolName);
              return this.renderMessage(group.message, group.index);
            },
          )}
          ${this.renderQueuedMessages()}
          ${this.renderSessionActivity()}
          ${this.renderOpenAsk()}
          ${this.renderExtensionDialogs()}
        </div>
        ${this.renderActivityDock()}
      </div>
      ${this.renderImageZoom()}
    `;
  }

  private renderTopNotices() {
    const warnings = this.renderWarnings();
    const notifications = this.renderNotificationTray();
    if (warnings === null && notifications === null) return null;
    return html`<div class="top-notices">${warnings}${notifications}</div>`;
  }

  private renderNotificationTray() {
    const inbox = this.notificationInbox;
    if (inbox?.sessionId !== this.sessionId) return null;
    const chatKey = notificationTargetKey(inbox);
    const hasPendingOverlay = inbox.pendingDismissedIds.size > 0 || inbox.dismissAllPending;
    const retainsFocusTarget = this.retainedEmptyNotificationTrayTargetKey === chatKey;
    const totalCount = notificationInboxTotalCount(inbox);
    if (totalCount === 0 && !hasPendingOverlay && !retainsFocusTarget) return null;
    const collapsed = notificationTrayIsCollapsed(this.collapsedNotificationTargetKeys, inbox);
    const toggleLabel = collapsed ? t("ui.chatView.expandNotifications", "Expand notifications") : t("ui.chatView.collapseNotifications", "Collapse notifications");
    return html`
      <section class=${`notification-tray${collapsed ? " collapsed" : ""}`} role="region" aria-labelledby="session-notifications-heading" @focusout=${(event: FocusEvent) => { this.releaseEmptyNotificationTray(event); }}>
        <header class="notification-header" data-notification-focus="header" tabindex="-1">
          <strong class="notification-heading" id="session-notifications-heading">${notificationTrayHeading(inbox)}</strong>
          <div class="notification-header-actions">
            <button
              type="button"
              class="notification-control notification-clear"
              aria-label="${t("ui.chatView.clearAllNotifications", "Clear all notifications")}"
              title="${t("ui.chatView.clearAllNotifications", "Clear all notifications")}"
              ?disabled=${inbox.dismissAllPending || totalCount === 0 || this.onDismissAllNotifications === undefined}
              @click=${() => { this.dismissAllNotifications(); }}
            >${t("ui.chatView.clear", "Clear")}</button>
            <button
              type="button"
              class="notification-control notification-toggle"
              aria-label=${toggleLabel}
              title=${toggleLabel}
              aria-expanded=${String(!collapsed)}
              aria-controls="session-notification-list"
              @click=${() => { this.toggleNotificationTray(inbox, collapsed); }}
            >${renderNotificationDisclosureIcon(collapsed)}</button>
          </div>
        </header>
        <div class="notification-list" id="session-notification-list" ?hidden=${collapsed}>
          ${inbox.discardedCount === 0 ? null : html`
            <p class="notification-overflow">${notificationInboxOverflowLabel(inbox.discardedCount)}</p>
          `}
          ${inbox.notifications.map((notification) => {
            const label = notificationSeverityLabel(notification.severity);
            const truncationLabel = notificationMessageTruncationLabel(notification);
            return html`
              <article class=${`notification-row ${notification.severity}`} data-notification-id=${notification.id} tabindex="-1">
                <div class="notification-metadata">
                  <strong class="notification-severity">${label}</strong>
                  <span aria-hidden="true">·</span>
                  <time datetime=${notification.receivedAt}>${notificationTimestampFormatter.format(new Date(notification.receivedAt))}</time>
                </div>
                <p class="notification-message" dir="auto">${notification.message}</p>
                ${truncationLabel === undefined ? null : html`<p class="notification-truncated">${truncationLabel}</p>`}
                <button
                  type="button"
                  class="notification-row-dismiss"
                  aria-label=${notificationDismissLabel(notification)}
                  title="${t("ui.chatView.dismissNotification", "Dismiss notification")}"
                  ?disabled=${inbox.pendingDismissedIds.has(notification.id) || inbox.dismissAllPending || this.onDismissNotification === undefined}
                  @click=${() => { this.dismissNotification(notification.id); }}
                >${renderNotificationCloseIcon()}</button>
              </article>
            `;
          })}
        </div>
      </section>
    `;
  }

  private renderNotificationLiveRegions() {
    const announcements = this.notificationInbox?.sessionId === this.sessionId ? this.notificationInbox.announcements : [];
    const polite = announcements.filter((announcement) => announcement.severity !== "error");
    const assertive = announcements.filter((announcement) => announcement.severity === "error");
    return html`
      <div class="visually-hidden notification-live" aria-live="polite" aria-atomic="false">${repeat(polite, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
      <div class="visually-hidden notification-live" aria-live="assertive" aria-atomic="false">${repeat(assertive, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
    `;
  }

  private toggleNotificationTray(inbox: SelectedSessionNotificationView, collapsed: boolean): void {
    this.collapsedNotificationTargetKeys = setNotificationTrayCollapsed(this.collapsedNotificationTargetKeys, inbox, !collapsed);
  }

  private dismissNotification(notificationId: string): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissNotification === undefined) return;
    const focusTarget = notificationFocusTargetAfterDismiss(inbox.notifications, notificationId);
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget };
    if (focusTarget.kind === "header") this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissNotification(notificationId);
  }

  private dismissAllNotifications(): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissAllNotifications === undefined) return;
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget: { kind: "header" } };
    this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissAllNotifications();
  }

  private releaseEmptyNotificationTray(event: FocusEvent): void {
    const tray = event.currentTarget;
    const next = event.relatedTarget;
    if (tray instanceof HTMLElement && next instanceof Node && tray.contains(next)) return;
    // Removing the activated row can emit focusout before updated() moves focus.
    if (this.pendingNotificationFocus !== undefined) return;
    const inbox = this.notificationInbox;
    if (inbox !== undefined
      && this.retainedEmptyNotificationTrayTargetKey === notificationTargetKey(inbox)
      && notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = undefined;
  }

  private focusPendingNotificationTarget(): void {
    const pending = this.pendingNotificationFocus;
    this.pendingNotificationFocus = undefined;
    const inbox = this.notificationInbox;
    if (pending === undefined || inbox === undefined || notificationTargetKey(inbox) !== pending.chatKey) return;
    const target = pending.focusTarget;
    if (target.kind === "header") {
      this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
      return;
    }
    const row = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-notification-id]"))
      .find((candidate) => candidate.dataset["notificationId"] === target.notificationId);
    if (row !== undefined) {
      row.focus();
      return;
    }
    if (notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = pending.chatKey;
    this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
  }

  private renderWarnings() {
    const rows = chatSessionWarningRows(this.status);
    if (!this.warningsVisible || rows.length === 0) return null;
    return html`
      <aside class="session-warnings" role="alert" aria-live="polite">
        ${this.onToggleWarnings === undefined ? null : html`
          <div class="session-warnings-controls">
            <button
              type="button"
              class="session-warnings-collapse"
              title="${t("ui.chatView.minimizeWarning", "Minimize warning")}"
              aria-label="${t("ui.chatView.minimizeWarning", "Minimize warning")}"
              @click=${this.handleToggleWarnings}
            >
              <svg class="session-warnings-collapse-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
              <span>${t("ui.chatView.minimize", "Minimize")}</span>
            </button>
          </div>
        `}
        ${rows.map((row) => {
          const dismissId = row.dismissId;
          return html`
          <div class=${row.severityClass}>
            <div class="session-warning-head">
              ${renderSessionWarningIcon(row.severity, "session-warning-icon")}
              ${row.source === undefined ? null : html`<span class="session-warning-source">${row.source}</span>`}
            </div>
            <div class="session-warning-body">
              <p class="session-warning-message">${row.message}</p>
              ${row.path === undefined ? null : html`<p class="session-warning-path">${row.path}</p>`}
            </div>
            ${dismissId === undefined ? null : html`
              <button
                type="button"
                class="session-warning-dismiss"
                title="${t("ui.chatView.doNotShowThisWarningAgain", "Do not show this warning again")}"
                aria-label="${t("ui.chatView.dismissWarning", "Dismiss warning")}"
                @click=${() => { this.onDismissWarning?.(dismissId); }}
              >×</button>
            `}
          </div>
        `;
        })}
      </aside>
    `;
  }

  private renderImageZoom() {
    return html`
      <dialog class="image-zoom" @click=${this.onImageZoomDialogClick} @close=${this.closeImageZoom} @cancel=${this.closeImageZoom}>
        ${this.zoomedImage === undefined ? null : html`
          <button type="button" class="image-zoom-close" aria-label="${t("ui.chatView.closeImage", "Close image")}" @click=${this.closeImageZoom}>×</button>
          <img class="image-zoom-full" src=${this.zoomedImage.src} alt=${this.zoomedImage.alt} />
        `}
      </dialog>
    `;
  }

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(this.messages, this.messageStart);
    return this.groupedMessagesCache;
  }

  private isLiveTailGroup(groups: ChatGroup[], index: number): boolean {
    return index === groups.length - 1 && this.isSessionLive();
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private renderActivityDock() {
    if (this.isSendingPrompt) {
      return html`
        <div class="activity-dock active" aria-live="polite">
          <span class="dot"></span>
          <span class="activity-text">${t("ui.chatView.sendingYourMessage", "Sending your message…")}</span>
        </div>
      `;
    }
    const state = this.activityState();
    if (state === undefined) return null;
    const active = state !== "idle" || this.activity?.phase === "active";
    return html`
      <div class=${active ? "activity-dock active" : "activity-dock"} aria-live="polite">
        <span class="dot"></span>
        <span class="activity-text">${this.activityText(state)}</span>
      </div>
    `;
  }

  private renderQueuedMessages() {
    const serverQueued = this.status?.queuedMessages ?? [];
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, serverQueued).map((section) => this.renderQueuedMessageList(section))}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const canClear = chatQueuedSectionShowsClearAction(section, this.canClearServerQueue, this.onClearServerQueue !== undefined);
    return html`
      <aside class="queued-messages" aria-live="polite">
        <div class="queued-header">
          <div class="queued-heading">
            <strong>${section.heading}</strong>
            <small>${section.detail}</small>
          </div>
          ${canClear ? html`
            <button type="button" class="queued-clear-button" title="${t("ui.chatView.clearQueuedMessagesWithoutStoppingTheCurrentTask", "Clear queued messages without stopping the current task")}" @click=${this.handleClearServerQueue}>${t("ui.chatView.clearQueue", "Clear queue")}</button>
          ` : null}
        </div>
        ${section.messages.map((message, index) => html`
          <div class="queued-message">
            <span class="queued-kind">${message.kind === "steer" ? t("ui.chatView.steering", "Steering") : t("ui.chatView.followUp", "Follow-up")} ${String(index + 1)}</span>
            <formatted-text .text=${message.text} .contentRendering=${this.contentRendering} .contentRendererVersion=${this.contentRendererVersion} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .intentKey=${JSON.stringify([this.machineId, this.sessionId, "queue", section.source, index, message.kind])}></formatted-text>
          </div>
        `)}
      </aside>
    `;
  }

  private renderOpenAsk() {
    if (this.pendingAsk === undefined) return null;
    return html`
      <ask-user-card
        data-scroll-anchor-id=${`ask:${this.pendingAsk.askId}`}
        .ask=${this.pendingAsk}
        .draftSessionId=${this.askDraftSessionId}
        .onSubmit=${this.onSubmitAsk}
      ></ask-user-card>
    `;
  }

  private renderExtensionDialogs() {
    const open = this.pendingDialogs[0];
    if (open === undefined && this.closedDialogs.length === 0) return null;
    const queuedCount = this.pendingDialogs.length - 1;
    return html`
      ${repeat(
        this.closedDialogs,
        (closed) => closed.dialog.dialogId,
        (closed) => html`
          <extension-dialog-card
            class="closed-dialog-card"
            data-scroll-anchor-id=${`closed-dialog:${closed.dialog.dialogId}`}
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
          data-scroll-anchor-id=${`dialog:${open.dialogId}`}
          .dialog=${open}
          .onAnswer=${this.onAnswerDialog}
          .onCancel=${this.onCancelDialog}
        ></extension-dialog-card>
        ${queuedCount > 0 ? html`<p class="queued-dialogs" role="status">${t("ui.chatView.queuedDialogCount", "{count} more extension dialogs queued", { count: queuedCount })}</p>` : null}
      `}
    `;
  }

  private renderSessionActivity() {
    if (!this.isCompacting) return null;
    return html`
      <aside class="session-activity compacting" aria-live="polite">
        <strong>${t("ui.chatView.compactingHistory", "Compacting history…")}</strong>
        <span>${t("ui.chatView.theAgentIsSummarizingEarlierContextNewPrompts", "The agent is summarizing earlier context. New prompts will queue until compaction finishes.")}</span>
        ${this.pendingMessageCount > 0 ? html`<small>${this.pendingMessageCount} ${t("ui.main.4cf91aa75737", " messages queued")}</small>` : null}
      </aside>
    `;
  }

  private activityState(): string | undefined {
    const status = this.status;
    if (status === undefined) return this.activity?.label;
    if (status.isCompacting) return "compacting";
    if (status.isBashRunning) return "bash";
    if (status.isStreaming) return "running";
    if (status.pendingMessageCount > 0) return "queued";
    return "idle";
  }

  private activityText(state: string): string {
    return chatActivityText(state, this.activity);
  }

  private renderConversationRail() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const total = this.conversationDisplayTotal();
    const position = this.conversationPositionPercent(total);
    const loadedPercent = this.hasMore ? clampPercent((this.messages.length / total) * 100) : 100;
    return html`<conversation-meter .positionPercent=${position} .loadedPercent=${loadedPercent}></conversation-meter>`;
  }

  private conversationDisplayTotal(): number {
    if (!this.hasMore && this.messageStart === 0) return Math.max(1, this.messages.length);
    return Math.max(1, this.messageTotal, this.messageStart + this.messages.length);
  }

  private conversationPositionPercent(total = this.conversationDisplayTotal()): number {
    if (total <= 1) return 100;
    const fallbackIndex = this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart;
    const index = clampNumber(this.currentConversationIndex ?? fallbackIndex, 0, total - 1);
    return clampPercent((index / (total - 1)) * 100);
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>${t("ui.chatView.loadingEarlierMessages", "Loading earlier messages…")}</span>${range}</div>`;
    if (this.hasMore) return html`
      <div class="history-boundary">
        <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested} @click=${() => { this.requestLoadMore(); }}>${t("ui.chatView.loadEarlierMessages", "Load earlier messages")}</button>
        <span>${t("ui.chatView.scrollUpToLoadEarlierMessages", "Scroll up to load earlier messages")}</span>
        ${range}
      </div>
    `;
    if (this.messages.length) return html`<div class="history-boundary"><span>${t("ui.chatView.startOfSession", "Start of session")}</span>${range}</div>`;
    return null;
  }

  private historyRangeLabel() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const from = this.messageStart + 1;
    const to = this.loadedRawMessageEnd();
    const total = Math.max(this.messageTotal, to);
    return html`<small>${t("ui.main.f99875eec53e", "Showing messages")} ${from}–${to}${t("ui.main.c66df59d637e", " of ")}${total} ${t("ui.main.bce2ef61514a", " messages")}</small>`;
  }

  private loadedRawMessageEnd(): number {
    return Math.max(this.messageEnd, this.messageStart + this.messages.length);
  }

  private renderMessage(message: ChatLine, index: number) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    const askUserRecordOnly = this.isAskUserRecordOnlyMessage(message);
    const shellClass = toolOnly ? "msg tool-execution-shell" : "msg ask-user-record-shell";
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class=${toolOnly || askUserRecordOnly ? shellClass : `msg ${message.role}`} data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${toolOnly || askUserRecordOnly ? null : this.renderMessageHeader(message, String(index), index)}
        ${message.parts.map((part, partIndex) => this.renderPart(part, message, index, partIndex))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${this.renderMessageHeader(message, String(index), index, label)}
        ${message.parts.map((part, partIndex) => this.renderPart(part, message, index, partIndex))}
      </article>
    `;
  }

  private isToolExecutionOnlyMessage(message: ChatLine): boolean {
    return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "toolExecution");
  }

  private isAskUserRecordOnlyMessage(message: ChatLine): boolean {
    return message.parts.length > 0 && message.parts.every((part) => part.type === "askUserRecord");
  }

  private renderMessageGroup(messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) {
    const disclosureKey = this.groupDisclosureKey(startIndex, endIndex, defaultOpen);
    const open = this.disclosures.isOpen(disclosureKey, defaultOpen);
    return html`
      ${this.renderScrollMarker(this.groupScrollMarkerId(endIndex))}
      <details class=${chatMessageGroupClassName(defaultOpen)} data-index=${startIndex} data-scroll-anchor-id=${this.groupAnchorKey(startIndex)} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event, defaultOpen); }}>
        <summary>
          <b class="label">${chatMessageGroupLabel(defaultOpen)}</b>
          <span>${summarizeChatGroup(messages)}</span>
        </summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex) : null}
      </details>
    `;
  }

  private renderMessageGroupBody(messages: ChatLine[], startIndex: number) {
    return html`
      <div class="group-body">
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset} data-scroll-anchor-id=${this.eventAnchorKey(startIndex + offset)}>
              ${toolOnly ? null : this.renderMessageHeader(message, `${String(startIndex)}:${String(offset)}`, startIndex + offset)}
              ${message.parts.map((part, partIndex) => this.renderPart(part, message, startIndex + offset, partIndex))}
            </section>
          `;
        })}
      </div>
    `;
  }

  private renderScrollMarker(markerId: string) {
    return html`<span class="scroll-marker" data-marker-id=${markerId} aria-hidden="true"></span>`;
  }

  private renderMessageHeader(message: ChatLine, key: string, index: number, label: string = chatMessageRoleLabel(message.role)) {
    const meta = this.messageMetaLabel(message);
    const expanded = this.expandedMetaKey === key;
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
        <div class="msg-header-trailing">
          ${this.renderMessageActions(message, key, this.messages[index - this.messageStart] ?? message)}
          <span class=${expanded ? "msg-meta expanded" : "msg-meta"} role="button" tabindex="0" title=${meta} aria-label=${meta} aria-expanded=${String(expanded)} @click=${() => { this.expandedMetaKey = expanded ? undefined : key; }} @keydown=${(event: KeyboardEvent) => { this.onMetaKeydown(event, key, expanded); }}>${meta}</span>
        </div>
      </div>
    `;
  }

  private renderMessageActions(message: ChatLine, key: string, source: ChatLine) {
    const actions = this.messageActionContext === undefined ? []
      : this.messageActionAvailability.get(source, this.messageActions, this.messageActionContext, message)
        .filter(({ action }) => action.target === "display" ? this.onDisplayedMessageAction !== undefined : this.onMessageAction !== undefined);
    if (actions.length === 0) return null;
    const feedback = this.messageActionFeedback;
    return html`
      <div class="msg-actions" aria-label=${t("ui.chatView.messageActions", "Message actions")}>
        ${actions.map(({ action, enabled, ariaLabel }) => {
          const presentation = feedback?.machineId === this.machineId && feedback.sessionId === this.sessionId && feedback.key === key && feedback.actionId === action.id
            ? feedback.presentation : undefined;
          const pending = action.target === "display" ? this.displayedMessageActionsPending.has(this.messageActionKey(key, action.id)) : this.messageActionPending;
          return html`<button type="button" class="msg-action" title=${presentation?.title ?? action.title} aria-label=${presentation?.ariaLabel ?? presentation?.title ?? ariaLabel} ?disabled=${!enabled || pending} @click=${(event: MouseEvent) => { void this.actOnMessage(source, message, key, action, event); }}>${presentation?.icon ?? action.icon ?? action.title}</button>`;
        })}
        ${this.messageActionError?.machineId === this.machineId && this.messageActionError.sessionId === this.sessionId && this.messageActionError.key === key ? html`<span role="alert">${this.messageActionError.message}</span>` : null}
      </div>
    `;
  }

  private currentMessageActionIdentity(): string {
    const workspace = this.workspaceContext;
    return JSON.stringify([this.machineId, this.sessionId, workspace?.machineId, workspace?.projectId, workspace?.workspaceId, workspace?.root]);
  }

  private resetMessageAction(): void {
    this.messageActionGeneration += 1;
    this.messageActionPending = false;
    this.messageActionError = undefined;
    this.displayedMessageActionsPending = new Set();
    this.clearMessageActionFeedback();
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
  }


  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private renderPart(part: ChatPart, message: ChatLine, messageIndex: number, partIndex: number) {
    const intentKey = JSON.stringify([this.machineId, this.sessionId, message.entryId ?? messageIndex, partIndex]);
    if (part.type === "text" && message.role === "bash") return html`<pre class="part shell-output">${part.text}</pre>`;
    if (part.type === "text") return this.renderFormattedText(part.text, intentKey);
    if (part.type === "thinking") return html`<details class="part"><summary>${t("ui.chatView.thinking", "Thinking")}</summary>${this.renderFormattedText(part.text, intentKey)}</details>`;
    if (part.type === "skillInvocation") return html`
      <details class="part skill-invocation">
        <summary><b>[skill]</b> ${part.name}</summary>
        <small>${part.location}</small>
        ${this.renderFormattedText(part.content, intentKey)}
      </details>
    `;
    if (part.type === "skillRead") return html`
      <div class="part skill-read">
        <strong>Loaded ${part.name}</strong>
        <small>read ${part.path}</small>
      </div>
    `;
    if (part.type === "askUserRecord") return html`
      <ask-user-card
        class="part"
        .outcome=${part.outcome}
        .draftSessionId=${this.askDraftSessionId}
      ></ask-user-card>
    `;
    if (part.type === "image") {
      const { src, alt } = chatImagePartSource(part);
      return html`<img class="part chat-image" src=${src} alt=${alt} loading="lazy" role="button" tabindex="0" title="${t("ui.chatView.clickToEnlarge", "Click to enlarge")}" @load=${this.onImageLoad} @click=${() => { this.openImageZoom(src, alt); }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openImageZoom(src, alt); } }} />`;
    }
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part}></tool-execution-view>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        ${this.renderFormattedText(part.text, intentKey)}
      </details>
    `;
    return null;
  }

  private renderFormattedText(text: string, identity: string) {
    return html`<formatted-text class="part" .text=${text} .contentRendering=${this.contentRendering} .contentRendererVersion=${this.contentRendererVersion} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .intentKey=${identity}></formatted-text>`;
  }

  private onGroupToggle(key: string, event: Event, defaultOpen: boolean) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (this.disclosures.applyToggle(key, details.open, defaultOpen)) this.requestUpdate();
  }

  private onScroll() {
    this.requestLoadMoreIfNeeded();
    this.updatePinnedToBottomFromScroll();
    this.scheduleConversationRailUpdate();
    if (!this.suppressScrollSave) this.scheduleScrollPositionSave();
  }

  private onWheel(event: WheelEvent) {
    if (event.deltaY < 0 && this.canScrollUp()) this.pinnedToBottom = false;
  }

  private onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0]?.clientY;
  }

  private onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY;
    if (this.touchStartY !== undefined && y !== undefined && y > this.touchStartY && this.canScrollUp()) this.pinnedToBottom = false;
  }

  private updatePinnedToBottomFromScroll() {
    const chat = this.chat;
    if (!chat) return;
    const heightChanged = this.didChatHeightChange();
    const wasPinnedToBottom = this.pinnedToBottom;
    const scrollingUp = chat.scrollTop < this.lastScrollTop;
    if (heightChanged && wasPinnedToBottom) {
      this.lastClientHeight = chat.clientHeight;
      this.scrollToBottom();
      return;
    }
    if (this.isAtBottom()) this.pinnedToBottom = true;
    else if (scrollingUp) this.pinnedToBottom = false;
    else this.pinnedToBottom = this.isNearBottom();
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  }

  private didChatHeightChange(): boolean {
    const chat = this.chat;
    return chat !== undefined && this.lastClientHeight !== 0 && chat.clientHeight !== this.lastClientHeight;
  }

  private isPrependingMessages(changed: Map<string, unknown>): boolean {
    const oldMessageStart = changed.get("messageStart");
    return typeof oldMessageStart === "number" && this.messageStart < oldMessageStart;
  }

  private requestLoadMoreIfNeeded(): void {
    if (this.loadMoreCheckFrame !== undefined) return;
    this.loadMoreCheckFrame = requestAnimationFrame(() => {
      this.loadMoreCheckFrame = undefined;
      if (this.suppressLoadMoreRequests) return;
      const chat = this.chat;
      if (!chat) return;
      if (shouldRequestEarlierMessages({
        hasMore: this.hasMore,
        loadingMore: this.loadingMore || this.loadMoreRequested,
        canRequest: this.onLoadMore !== undefined,
        scrollTop: chat.scrollTop,
        scrollHeight: chat.scrollHeight,
        clientHeight: chat.clientHeight,
      })) this.requestLoadMore();
    });
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested) return;
    if (!this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return isNearScrollBottom(chat);
  }

  private isAtBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return distanceFromScrollBottom(chat) < 2;
  }

  private canScrollUp(): boolean {
    const chat = this.chat;
    return chat !== undefined && chat.scrollTop > 0;
  }

  private scrollToBottom() {
    if (this.scrollToBottomFrame !== undefined) return;
    this.scrollToBottomFrame = requestAnimationFrame(() => {
      this.scrollToBottomFrame = undefined;
      const chat = this.chat;
      if (!chat) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop = chat.scrollHeight;
        this.lastScrollTop = chat.scrollTop;
        this.lastClientHeight = chat.clientHeight;
      });
    });
  }

  private isNewPendingAsk(previous: unknown): boolean {
    return this.pendingAsk !== undefined
      && (typeof previous !== "object" || previous === null || Reflect.get(previous, "askId") !== this.pendingAsk.askId);
  }

  private isNewOpenDialog(previous: unknown): boolean {
    const oldest = this.pendingDialogs[0];
    if (oldest === undefined) return false;
    const previousDialogs: unknown[] = Array.isArray(previous) ? previous : [];
    const previousOldest: unknown = previousDialogs[0];
    return typeof previousOldest !== "object" || previousOldest === null || Reflect.get(previousOldest, "dialogId") !== oldest.dialogId;
  }

  private scrollToOpenAsk(): void {
    if (this.scrollToOpenAskFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenAskFrame = requestAnimationFrame(() => {
      this.scrollToOpenAskFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenAskToTop(); });
    });
  }

  private alignOpenAskToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat > ask-user-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.pinnedToBottom = this.isNearBottom();
    return true;
  }

  private scrollToOpenDialog(): void {
    if (this.scrollToOpenDialogFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenDialogFrame = requestAnimationFrame(() => {
      this.scrollToOpenDialogFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenDialogToTop(); });
    });
  }

  private alignOpenDialogToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat > extension-dialog-card.open-dialog-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.pinnedToBottom = this.isNearBottom();
    return true;
  }

  restoreScrollPosition() {
    const sessionId = this.sessionId;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        if (this.pendingDialogs.length > 0 && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenDialogToTop()) return;
        if (this.pendingAsk !== undefined && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenAskToTop()) return;
        const result = this.scrollController.restorePosition(sessionId, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private continuePendingScrollRestore(): void {
    const sessionId = this.pendingScrollRestoreSessionId;
    const position = this.pendingScrollRestorePosition;
    if (sessionId === undefined || position === undefined || sessionId !== this.sessionId || this.restoreScrollFrame !== undefined) return;
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        const result = this.scrollController.restoreExplicitPosition(position, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private handleScrollRestoreResult(sessionId: string, result: ChatScrollRestoreResult): void {
    this.syncScrollMetrics();
    if (result.status !== "missing") {
      this.updatePinnedToBottomAfterRestore(result.status);
      if (result.status === "restored" || result.status === "bottom") this.cancelPrependRestore();
      this.pendingScrollRestoreSessionId = undefined;
      this.pendingScrollRestorePosition = undefined;
      return;
    }

    this.pinnedToBottom = false;
    this.pendingScrollRestoreSessionId = sessionId;
    this.pendingScrollRestorePosition = result.position;
    const chat = this.chat;
    if (chat === undefined || !this.hasMore || this.loadingMore) return;
    chat.scrollTop = 0;
    this.syncScrollMetrics();
    this.requestLoadMore();
  }

  private shouldFallbackToBottomForMissingAnchor(): boolean {
    // Only fall back to the bottom once the full history is loaded; while earlier
    // pages can still load, a missing scroll anchor should keep retrying rather
    // than jump the user to the bottom.
    return !this.hasMore;
  }

  private updatePinnedToBottomAfterRestore(status: Exclude<ChatScrollRestoreResult["status"], "missing">): void {
    if (status === "bottom") this.pinnedToBottom = true;
    else if (status === "restored") this.pinnedToBottom = this.isNearBottom();
  }

  private syncScrollMetrics(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  }

  private cancelPrependRestore(): void {
    this.prependRestoreToken += 1;
    this.suppressLoadMoreRequests = false;
  }

  capturePrependScrollAnchor(): PrependScrollAnchor | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    return capturePrependScrollAnchor(chat, this.scrollMarkers());
  }

  restorePrependScrollAnchor(anchor: PrependScrollAnchor | undefined): void {
    if (!this.chat || !anchor) return;
    this.suppressLoadMoreRequests = true;
    this.suppressScrollSave = true;
    const token = this.prependRestoreToken + 1;
    this.prependRestoreToken = token;
    let frames = 0;
    const settle = () => {
      const chat = this.chat;
      if (!chat || token !== this.prependRestoreToken) return;
      restorePrependScrollAnchor(chat, anchor, anchor.markerId === undefined ? undefined : this.scrollMarkerAt(anchor.markerId));
      this.lastScrollTop = chat.scrollTop;
      frames += 1;
      // Formatted markdown/code layout can settle after Lit's first render. Re-apply
      // the marker anchor briefly so late height changes above the viewport do not
      // move the user's reading position.
      if (frames < PREPEND_RESTORE_SETTLE_FRAMES) {
        requestAnimationFrame(settle);
        return;
      }
      requestAnimationFrame(() => {
        if (token !== this.prependRestoreToken) return;
        this.suppressScrollSave = false;
        this.suppressLoadMoreRequests = false;
      });
    };
    settle();
  }

  saveScrollPosition(sessionId = this.sessionId) {
    if (!sessionId) return;
    this.scrollController.savePosition(sessionId, this.chat, this.scrollAnchorElements());
  }

  private scheduleScrollPositionSave() {
    const sessionId = this.sessionId;
    this.scrollController.scheduleSave(sessionId, (scheduledSessionId) => {
      if (this.sessionId === scheduledSessionId) this.saveScrollPosition(scheduledSessionId);
    });
  }

  private scheduleConversationRailUpdate(): void {
    if (this.conversationRailFrame !== undefined) return;
    this.conversationRailFrame = requestAnimationFrame(() => {
      this.conversationRailFrame = undefined;
      this.updateConversationRailPosition();
    });
  }

  private updateConversationRailPosition(): void {
    if (!this.messages.length || this.messageTotal <= 0) {
      this.currentConversationIndex = undefined;
      return;
    }
    const total = this.conversationDisplayTotal();
    const article = this.firstVisibleArticle();
    const index = Number(article?.dataset["index"]);
    if (Number.isFinite(index)) {
      this.currentConversationIndex = clampNumber(index, 0, Math.max(0, total - 1));
      return;
    }
    this.currentConversationIndex = clampNumber(this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart, 0, Math.max(0, total - 1));
  }

  private scrollMarkers(): HTMLElement[] {
    return this.scrollMarkerElements;
  }

  private scrollMarkerAt(markerId: string): HTMLElement | undefined {
    return this.scrollMarkerElementById.get(markerId);
  }

  private firstVisibleArticle(): HTMLElement | undefined {
    const chat = this.chat;
    if (chat === undefined) return undefined;
    return findFirstVisibleArticle(chat, this.primaryArticleElements) ?? findFirstVisibleArticle(chat, this.articles());
  }

  private articles(): HTMLElement[] {
    return this.articleElements;
  }

  private scrollAnchorElements(): HTMLElement[] {
    return this.scrollAnchorElementIndex;
  }

  private syncTranscriptElementIndex(): void {
    const structureKey = this.currentTranscriptStructureKey();
    if (structureKey === this.transcriptStructureKey) return;
    this.transcriptStructureKey = structureKey;
    this.primaryArticleElements = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg"));
    this.articleElements = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg, details.msg"));
    this.scrollAnchorElementIndex = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
    this.scrollMarkerElements = Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".scroll-marker"));
    this.scrollMarkerElementById = new Map(this.scrollMarkerElements.flatMap((marker) => {
      const markerId = marker.dataset["markerId"];
      return markerId === undefined ? [] : [[markerId, marker] as const];
    }));
  }

  private currentTranscriptStructureKey(): string {
    const groupedMessages = this.groupedMessages();
    const groups = groupedMessages.map((group, index) => {
      if (group.kind !== "group") return [group.kind, group.index];
      const defaultOpen = this.isLiveTailGroup(groupedMessages, index);
      const disclosureKey = this.groupDisclosureKey(group.startIndex, group.endIndex, defaultOpen);
      return [group.kind, group.startIndex, group.endIndex, this.disclosures.isOpen(disclosureKey, defaultOpen)];
    });
    return JSON.stringify([
      this.sessionId,
      this.messageStart,
      groups,
      this.hasMore,
      this.loadingMore,
      this.pendingAsk?.askId,
    ]);
  }

  private clearTranscriptElementIndex(): void {
    this.transcriptStructureKey = "";
    this.primaryArticleElements = [];
    this.articleElements = [];
    this.scrollAnchorElementIndex = [];
    this.scrollMarkerElements = [];
    this.scrollMarkerElementById.clear();
  }

  private withSuppressedScrollSave(callback: () => void) {
    this.suppressScrollSave = true;
    callback();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.suppressScrollSave = false;
      });
    });
  }

  private groupDisclosureKey(startIndex: number, endIndex: number, defaultOpen: boolean): string {
    return defaultOpen ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private messageAnchorKey(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupRenderKey(startIndex: number): string {
    return chatGroupAnchorKey(startIndex);
  }

  private groupAnchorKey(startIndex: number): string {
    return chatGroupAnchorKey(startIndex);
  }

  private eventAnchorKey(index: number): string {
    return chatEventAnchorKey(index);
  }

  private messageScrollMarkerId(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupScrollMarkerId(endIndex: number): string {
    return chatGroupScrollMarkerId(endIndex);
  }

  static override styles = chatStyles;
  @property({ attribute: false }) messageActions: readonly RegisteredMessageAction[] = [];
  @property({ attribute: false }) messageActionContext?: Omit<MessageActionAvailabilityContext, "message">;
  @property({ attribute: false }) onDisplayedMessageAction?: (input: DisplayedMessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;
  private readonly messageActionAvailability = new MessageActionAvailabilityCache();
  @state() private displayedMessageActionsPending: ReadonlySet<string> = new Set();
  @state() private messageActionFeedback: { machineId: string; sessionId: string; key: string; actionId: string; presentation: MessageActionFeedback } | undefined;
  private messageActionFeedbackTimer: number | undefined;

  private messageActionKey(key: string, actionId: string): string {
    return JSON.stringify([this.machineId, this.sessionId, this.messageActionGeneration, key, actionId]);
  }

  private async actOnMessage(source: ChatLine, displayed: ChatLine, key: string, action: RegisteredMessageAction, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const context = this.messageActionContext;
    if (context === undefined) return;
    const pendingKey = this.messageActionKey(key, action.id);
    if (action.target === "display" ? this.displayedMessageActionsPending.has(pendingKey) : this.messageActionPending) return;
    const entry = messageActionMessage(source, displayed.role);
    const onEntry = this.onMessageAction;
    const onDisplay = this.onDisplayedMessageAction;
    const run = action.target === "display"
      ? onDisplay === undefined ? undefined : () => onDisplay({ ...context, message: displayedMessageActionMessage(displayed) }, action.id)
      : entry === undefined || onEntry === undefined ? undefined : () => onEntry({ ...context, message: entry }, action.id);
    if (run === undefined) return;
    const sessionId = this.sessionId;
    const machineId = this.machineId;
    const generation = this.messageActionGeneration;
    if (action.target === "display") this.displayedMessageActionsPending = new Set([...this.displayedMessageActionsPending, pendingKey]);
    else this.messageActionPending = true;
    this.messageActionError = undefined;
    try {
      const presentation = await run();
      if (presentation !== undefined && this.isConnected && this.messageActionGeneration === generation && this.sessionId === sessionId && this.machineId === machineId) {
        this.clearMessageActionFeedback();
        this.messageActionFeedback = { machineId, sessionId, key, actionId: action.id, presentation };
        this.messageActionFeedbackTimer = window.setTimeout(() => { this.clearMessageActionFeedback(); }, 1200);
      }
    } catch (error) {
      if (this.isConnected && this.messageActionGeneration === generation && this.sessionId === sessionId && this.machineId === machineId) this.messageActionError = { machineId, sessionId, key, message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (action.target === "display" && generation === this.messageActionGeneration) this.displayedMessageActionsPending = new Set([...this.displayedMessageActionsPending].filter((item) => item !== pendingKey));
      else if (generation === this.messageActionGeneration) this.messageActionPending = false;
    }
  }

  private clearMessageActionFeedback(): void {
    if (this.messageActionFeedbackTimer !== undefined) window.clearTimeout(this.messageActionFeedbackTimer);
    this.messageActionFeedbackTimer = undefined;
    this.messageActionFeedback = undefined;
  }

}

export function chatActivityText(state: string, activity?: SessionActivity): string {
  if (activity === undefined) return activityStateLabel(state);
  if (state !== "idle" && activity.phase === "idle") return activityStateLabel(state);
  const label = activity.label;
  return activity.detail !== undefined && activity.detail !== "" ? `${label}：${activity.detail}` : label;
}

function activityStateLabel(state: string, phase?: SessionActivity["phase"]): string {
  if (phase === "idle") return t("activity.idle", "Idle");
  if (phase !== undefined) return activityStateLabel(state);
  const labels: Record<string, string> = {
    "agent running": t("ui.chatView.agentRunning", "Agent running"),
    "bash complete": t("ui.chatView.commandCompleted", "Command completed"),
    "bash failed": t("ui.chatView.commandFailed", "Command failed"),
    "branch summary aborted": t("ui.chatView.branchSummaryAborted", "Branch summary aborted"),
    "compacting": t("ui.chatView.compactingContext", "Compacting context"),
    "compaction complete": t("ui.chatView.contextCompactionCompleted", "Context compaction completed"),
    "compaction failed": t("ui.chatView.contextCompactionFailed", "Context compaction failed"),
    "duplicate queued message ignored": t("ui.chatView.duplicateQueuedMessageIgnored", "Duplicate queued message ignored"),
    "error": t("ui.chatView.anErrorOccurred", "An error occurred"),
    "extension error": t("ui.chatView.extensionError", "Extension error"),
    "idle": t("ui.chatView.idle", "Idle"),
    "message complete": t("ui.chatView.messageCompleted", "Message completed"),
    "message queued": t("ui.chatView.messageQueued", "Message queued"),
    "message queued during compaction": t("ui.chatView.messageQueuedDuringCompaction", "Message queued during compaction"),
    "message started": t("ui.chatView.messageStarted", "Message started"),
    "navigating session tree": t("ui.chatView.navigatingSessionTree", "Navigating session tree"),
    "prompt accepted": t("ui.chatView.messageReceived", "Message received"),
    "receiving response": t("ui.chatView.receivingResponse", "Receiving response"),
    "reload failed": t("ui.chatView.reloadFailed", "Reload failed"),
    "reloading resources": t("ui.chatView.reloadingResources", "Reloading resources"),
    "resources reloaded": t("ui.chatView.resourcesReloaded", "Resources reloaded"),
    running: t("ui.chatView.running", "Running"),
    "running bash": t("ui.chatView.runningCommand", "Running command"),
    "running tool": t("ui.chatView.runningTool", "Running tool"),
    "session tree navigated": t("ui.chatView.sessionTreeUpdated", "Session tree updated"),
    "steering queued": t("ui.chatView.steeringMessageQueued", "Steering message queued"),
    "stop failed": t("ui.chatView.stopFailed", "Stop failed"),
    "stopped": t("ui.chatView.stopped", "Stopped"),
    "summarizing branch": t("ui.chatView.summarizingBranch", "Summarizing branch"),
    "tool complete": t("ui.chatView.toolCompleted", "Tool completed"),
    "tool failed": t("ui.chatView.toolFailed", "Tool failed"),
    "tree navigation cancelled": t("ui.chatView.sessionTreeNavigationCancelled", "Session tree navigation cancelled"),
    "turn complete": t("ui.chatView.turnCompleted", "Turn completed"),
    "updating session": t("ui.chatView.updatingSession", "Updating session"),
    queued: t("ui.chatView.queueing", "Queueing"),
  };
  return labels[state] ?? state;
}
