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
import { writeClipboardText } from "../clipboard";
import type { QueuedMessageActionTarget } from "../queuedMessageActions";
import { chatQueuedMessageSections, renderQueuedMessageSection, type QueuedMessageSection } from "./chat/QueuedMessages";
export { chatQueuedMessageSections, chatQueuedSectionShowsClearAction, type QueuedMessageSection } from "./chat/QueuedMessages";
import { clientLocale, t } from "../i18n";
import { renderNotificationMessage } from "../notificationMessage";
import { thinkingLevelDisplayLabel } from "../../../shared/thinkingLevels";
import { renderSessionWarningIcon } from "./shared";
import type { SessionWarningSeverity } from "../api";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { ChatMessageActionController } from "./ChatMessageActionController";
import * as transcript from "./chatTranscriptTemplates";
import type { TranscriptRenderContext } from "./chatTranscriptTemplates";
import { ChatDisclosureController } from "../chatDisclosure";
import type { DisplayedMessageActionAvailabilityContext, MessageActionAvailabilityContext, MessageActionResult } from "../../../plugin-api";
import type { RegisteredMessageAction } from "../plugins/messageActions";
import { machineSessionKey } from "../machineKeys";
import { canonicalEntryActionHeaders, ChatMessageGrouper, groupConsecutiveImageOutputs, type ChatDisplayGroup, type ChatGroup } from "../chatGroups";
import { openTranscriptQuestion, transcriptQuestionOutcomes } from "../chatQuestions";
import { ChatScrollFlows } from "../ChatScrollFlows";
import { ChatRenderKeys } from "../chatRenderKeys";
import { DEFAULT_CHAT_BEHAVIORS, type ChatBehaviors } from "../chatBehaviors";
import type { AskUserSubmission, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionRef, SessionStatus } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import type { ChatLine, ChatPart } from "../chatTypes";
import { chatStyles } from "./chat/chatStyles";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import "./ImageGalleryDialog";
import type { ImageGalleryDialog } from "./ImageGalleryDialog";
import "./FormattedText";
import type { MarkdownWorkspaceContext } from "../formatting/workspaceLinks";
import "./ToolExecutionView";
import { transcriptImageSource } from "./TranscriptImage";
import type { ImageOpenDetail } from "./ImagePresentation";

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

interface PendingNotificationFocus {
  chatKey: string;
  focusTarget: NotificationFocusTarget;
}

export type ChatImagePart = Extract<ChatPart, { type: "image" }>;

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

export function chatMessageRoleLabel(role: ChatLine["role"]): string {
  return chatMessageRoleLabels[role]();
}

export function chatGroupScrollMarkerId(endIndex: number): string {
  return `g:${String(endIndex)}`;
}

export function chatMessageGroupClassName(defaultOpen: boolean): string {
  return defaultOpen ? "msg event-group live" : "msg event-group";
}

export function chatMessageGroupLabel(defaultOpen: boolean): string {
  return defaultOpen ? t("ui.chatView.liveEvent", "Live event") : t("ui.chatView.event", "Event");
}



export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

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

export { chatActivityText } from "./conversationActivity";

export function chatImagePartSource(part: ChatImagePart, session?: SessionRef, machineId = "local"): { src: string; alt: string } | undefined {
  return transcriptImageSource(part, session, machineId);
}

function chatLineIdentity(index: number, message?: ChatLine): string {
  return chatLineScrollIdentity(message) ?? String(index);
}

function chatLineScrollIdentity(message?: ChatLine): string | undefined {
  if (message?.entryId === undefined || message.entryId === "") return undefined;
  // Page offsets count raw entries, whereas display indexes count normalized
  // lines. Only durable entry identity survives coalescing during a prepend.
  // Skill invocations can also produce a user-text line from the same entry.
  const slice = message.parts.some((part) => part.type === "skillInvocation") ? "skill-invocation" : "message";
  return JSON.stringify([message.entryId, message.role, slice]);
}

export function chatMessageAnchorKey(_index: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `m:${identity}`;
}

export function chatGroupAnchorKey(_startIndex: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `g:${identity}`;
}

export function chatEventAnchorKey(_index: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `e:${identity}`;
}

@customElement("chat-view")
export class ChatView extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) messages: ChatLine[] = [];

  @property() sessionId = "";

  @property({ attribute: false }) onNavigationChange?: (controls: TemplateResult) => void;

  @property() sessionCwd = "";

  @property({ attribute: false }) workspaceContext: MarkdownWorkspaceContext | undefined;

  @property({ attribute: false }) contentRendering: import("../formatting/contentRendering").ChatContentRendering | undefined;

  @property() machineId = "local";

  @property({ attribute: false }) messageActions: readonly RegisteredMessageAction[] = [];

  @property({ attribute: false }) messageActionContext?: Omit<MessageActionAvailabilityContext, "message">;

  @property({ attribute: false }) onMessageAction?: (input: MessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;

  @property({ attribute: false }) onDisplayedMessageAction?: (input: DisplayedMessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;

  private readonly messageActionController = new ChatMessageActionController(() => ({
    machineId: this.machineId,
    sessionId: this.sessionId,
    connected: this.isConnected,
    actions: this.messageActions,
    availability: this.messageActionContext,
    onEntry: this.onMessageAction,
    onDisplay: this.onDisplayedMessageAction,
  }), () => { this.requestUpdate(); });

  private messageActionIdentity = "";

  @property({ type: Number }) messageStart = 0;

  @property({ type: Number }) messageEnd = 0;

  @property({ type: Number }) messageTotal = 0;

  @property({ type: Boolean }) hasMore = false;

  @property({ type: Boolean }) historyReady = true;

  @property({ type: Boolean }) loadingMore = false;

  @property({ type: Boolean }) isSendingPrompt = false;

  @property({ type: Boolean }) isCompacting = false;

  @property({ type: Number }) pendingMessageCount = 0;

  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];

  @property({ attribute: false }) status?: SessionStatus;

  @property({ attribute: false }) activity?: SessionActivity;

  @property({ attribute: false }) askDraftSessionId = "";

  @property({ attribute: false }) onSubmitAsk: ((askId: string, submission: AskUserSubmission) => void | Promise<void>) | undefined;

  @property({ attribute: false }) pendingDialogs: PendingExtensionDialog[] = [];

  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];

  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;

  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;

  @property({ attribute: false }) onDismissClosedDialog?: ExtensionDialogDismissCallback;

  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;

  @property({ attribute: false }) onClearServerQueue?: () => void;
  @property({ attribute: false }) onQueuedMessageAction?: (target: QueuedMessageActionTarget) => Promise<void>;
  @property({ type: Boolean }) canMutateQueuedMessages = false;
  @property({ type: Boolean }) queuedMessageActionPending = false;
  @state() private queuedCopyFeedback = "";
  private queuedCopyGeneration = 0;

  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;

  @property({ attribute: false }) onDismissNotification?: (notificationId: string) => void;

  @property({ attribute: false }) onDismissAllNotifications?: () => void;

  @property({ type: Boolean }) warningsVisible = true;

  @property({ attribute: false }) onToggleWarnings?: () => void;

  @property({ attribute: false }) onLoadMore?: () => void;

  @property({ attribute: false }) behaviors: ChatBehaviors = DEFAULT_CHAT_BEHAVIORS;

  @query(".chat") private chat?: HTMLDivElement;

  @query("pi-web-image-gallery-dialog") private imageGalleryDialog?: ImageGalleryDialog;

  @state() private followingLive = false;

  @state() private expandedMetaKey: string | undefined;

  private readonly disclosures = new ChatDisclosureController();

  private readonly transientDisclosures = new Map<string, boolean>();

  private readonly scrollFlows = new ChatScrollFlows({
    getScroller: () => this.chat ?? undefined,
    onFollowingChange: (following) => { this.followingLive = following; },
    getAnchors: () => this.scrollAnchorElements(),
    getSessionId: () => machineSessionKey(this.machineId, this.sessionId),
    getBehaviors: () => this.behaviors,
    hasMore: () => this.hasMore,
    isHistoryReady: () => this.historyReady,
    isLoadingMore: () => this.loadingMore || this.loadMoreRequested,
    canRequestEarlier: () => this.onLoadMore !== undefined,
    requestEarlier: () => { this.requestLoadMore(); },
    getOpenForm: (kind) => this.renderRoot.querySelector<HTMLElement>(kind === "dialog"
      ? ".chat > extension-dialog-card.open-dialog-card"
      : kind === "ask" ? ".chat ask-user-card.open-question-card"
      : ".chat ask-user-card.open-question-card, .chat > extension-dialog-card.open-dialog-card") ?? undefined,
  });

  private lastOpenQuestionId: string | undefined;

  private questionOutcomes = transcriptQuestionOutcomes([]);

  private questionIds: ReadonlySet<string> = new Set();

  private groupedMessagesInput?: ChatLine[];

  private groupedMessagesStart = 0;

  private groupedMessagesCache: ChatGroup[] = [];

  private readonly messageGrouper = new ChatMessageGrouper();

  private readonly messageMetaCache = new WeakMap<ChatLine, string>();

  private imageSession: SessionRef | undefined;

  private touchY: number | undefined;

  private loadMoreRequested = false;

  private readonly onViewportResize = () => { this.scrollFlows.onViewportResize(); };

  private readonly onContentLayoutChanged = () => { this.scrollFlows.onViewportResize(); };

  private readonly handleScroll = () => { this.scrollFlows.onScroll(); };

  private readonly handleDisclosureToggle = {
    capture: true,
    handleEvent: (event: Event): void => {
      if (event.target instanceof HTMLDetailsElement) this.scrollFlows.onContentLayoutChanged();
    },
  };

  private readonly handleWheel = (event: WheelEvent) => {
    if (event.deltaY !== 0) this.scrollFlows.onInteraction();
    if (event.deltaY < 0) this.scrollFlows.onUpIntent();
  };

  private readonly handleTouchStart = (event: TouchEvent) => {
    this.touchY = event.touches[0]?.clientY;
    this.scrollFlows.onInteraction();
  };

  private readonly handleTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (this.touchY !== undefined && y !== undefined && y > this.touchY) this.scrollFlows.onUpIntent();
    this.touchY = y;
  };

  private readonly handleTouchEnd = () => { this.touchY = undefined; };

  private readonly handleJumpTop = () => { this.scrollFlows.jumpToTop(); };

  private readonly handleJumpEnd = () => { this.scrollFlows.jumpToEnd(); };

  private readonly openImageZoom = (src: string, alt: string): void => {
    if (this.behaviors.loadImages) this.imageGalleryDialog?.show([{ src, alt }]);
  };

  private openToolImageGallery(images: readonly { part: ChatImagePart; description: string }[], selectedIndex: number): void {
    if (!this.behaviors.loadImages) return;
    const entries = images.flatMap((image, index) => {
      const source = transcriptImageSource(image.part, this.transcriptSession(), this.machineId);
      return source === undefined ? [] : [{ src: source.src, alt: image.description, partIndex: index }];
    });
    const index = entries.findIndex((entry) => entry.partIndex === selectedIndex);
    if (index >= 0) this.imageGalleryDialog?.show(entries, index);
  }

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

  override disconnectedCallback(): void {
    this.pendingNotificationFocus = undefined;
    this.retainedEmptyNotificationTrayTargetKey = undefined;
    this.scrollFlows.dispose();
    this.messageActionController.reset();
    this.queuedCopyGeneration += 1;
    this.queuedCopyFeedback = "";
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private prepareSessionUiState(): void {
    if (this.behaviors.rememberDisclosures) this.disclosures.syncSession(machineSessionKey(this.machineId, this.sessionId));
    this.loadMoreRequested = false;
    this.pendingNotificationFocus = undefined;
    this.retainedEmptyNotificationTrayTargetKey = undefined;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("messages")) {
      this.questionOutcomes = transcriptQuestionOutcomes(this.messages);
      this.questionIds = new Set(this.messages.flatMap((line) => line.parts.flatMap((part) => part.type === "askUserQuestion" ? [part.ask.askId] : [])));
    }
    if (changed.has("sessionId") || changed.has("machineId") || (changed.has("behaviors") && !this.behaviors.loadImages)) this.imageGalleryDialog?.close();
    if (changed.has("sessionId") || changed.has("machineId")) {
      this.transientDisclosures.clear();
      this.lastOpenQuestionId = undefined;

    }
    const actionIdentity = JSON.stringify([this.machineId, this.sessionId, this.sessionCwd, this.workspaceContext?.machineId, this.workspaceContext?.projectId, this.workspaceContext?.workspaceId, this.workspaceContext?.root]);
    if (actionIdentity !== this.messageActionIdentity) {
      this.queuedCopyGeneration += 1;
      this.queuedCopyFeedback = "";
      this.messageActionIdentity = actionIdentity;
      this.messageActionController.reset();
    }
    if (changed.has("sessionId") || changed.has("machineId")) {
      this.prepareSessionUiState();
    }
    if (changed.has("notificationInbox") && this.notificationTargetChanged(changed.get("notificationInbox"))) {
      this.pendingNotificationFocus = undefined;
      this.retainedEmptyNotificationTrayTargetKey = undefined;
    }
    if (changed.has("behaviors")) {
      this.scrollFlows.configure();
      if (this.behaviors.rememberDisclosures) this.disclosures.syncSession(machineSessionKey(this.machineId, this.sessionId));
    }
  }

  protected override update(changed: Map<string, unknown>): void {
    const previousStart = changed.get("messageStart");
    const previousMachineId = changed.get("machineId");
    const previousSessionId = changed.get("sessionId");
    this.scrollFlows.beforeRender({
      sessionChanged: changed.has("sessionId") || changed.has("machineId"),
      previousSessionId: machineSessionKey(typeof previousMachineId === "string" ? previousMachineId : this.machineId, typeof previousSessionId === "string" ? previousSessionId : this.sessionId),
      prepend: typeof previousStart === "number" && this.messageStart < previousStart,
      loadingBoundaryChanged: changed.has("loadingMore"),
    });
    super.update(changed);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    const openQuestionId = this.openQuestion()?.askId;
    this.scrollFlows.afterRender({
      sessionChanged: changed.has("sessionId") || changed.has("machineId"),
      contentChanged: this.scrollContentChanged(changed),
      historyChanged: changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("historyReady"),
      openedForm: changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs")) ? "dialog"
        : openQuestionId !== undefined && openQuestionId !== this.lastOpenQuestionId ? "ask" : false,
    });
    if (changed.has("notificationInbox") && this.pendingNotificationFocus !== undefined) this.focusPendingNotificationTarget();
    if (this.onTranscriptRendered !== undefined) void this.reportRenderedTranscript();
    this.lastOpenQuestionId = openQuestionId;
    if (changed.has("followingLive") || changed.has("behaviors") || changed.has("onNavigationChange")) {
      this.onNavigationChange?.(this.renderNavigation());
    }
  }

  private readonly renderKeys = new ChatRenderKeys();

  override render() {
    const sourceGroups = this.groupedMessages();
    const entryActionHeaders = canonicalEntryActionHeaders(sourceGroups);
    const groups = groupConsecutiveImageOutputs(sourceGroups);
    const context = this.transcriptRenderContext();
    // Keep incremental updates within one transcript, but dispose the whole
    // repeat part when the transcript changes. Besides preventing cross-session
    // DOM reuse, clearing the part reclaims the end markers that the current Lit
    // build retains when repeat items are removed.
    const transcriptIdentity = machineSessionKey(this.machineId, this.sessionId);
    const keys = this.renderKeys.reconcile(transcriptIdentity, groups.map((group) => {
      const source = group.kind === "tool-images" ? group.outputs[0] : group;
      const index = source.kind === "group" ? source.startIndex : source.index;
      const message = source.kind === "group" ? source.messages[0]?.message : source.message;
      const identity = chatLineScrollIdentity(message);
      return {
        slot: JSON.stringify([group.kind, index, message?.role]),
        ...(message?.streamId === undefined ? {} : { streamIdentity: JSON.stringify([group.kind, message.role, message.streamId]) }),
        ...(identity === undefined ? {} : { identity: JSON.stringify([group.kind, identity]) }),
      };
    }));
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class=${this.behaviors.visualEffects ? "chat-wrap" : "chat-wrap plain"}>
        <div class="chat" @image-open=${(event: CustomEvent<ImageOpenDetail>) => { this.openImageZoom(event.detail.src, event.detail.alt); }}
          @scroll=${this.behaviors.rememberPosition || this.behaviors.followTail || this.behaviors.automaticHistory ? this.handleScroll : undefined}
          @toggle=${this.behaviors.followTail ? this.handleDisclosureToggle : undefined}
          @content-layout-changed=${this.onContentLayoutChanged}
          @wheel=${this.handlesScrollIntent ? this.handleWheel : undefined}
          @touchstart=${this.handlesScrollIntent ? this.handleTouchStart : undefined}
          @touchmove=${this.handlesScrollIntent ? this.handleTouchMove : undefined}
          @touchend=${this.handlesScrollIntent ? this.handleTouchEnd : undefined}
          @touchcancel=${this.handlesScrollIntent ? this.handleTouchEnd : undefined}>
          ${this.renderHistoryBoundary()}
          ${keyed(transcriptIdentity, repeat(
            groups,
            (_group, index) => keys[index],
            (group, index) => {
              if (group.kind === "group") return this.renderMessageGroup(context, group, this.isLiveTailGroup(groups, index), entryActionHeaders);
              if (group.kind === "tool-images") return transcript.renderToolImageOutputs(context, group, entryActionHeaders);
              return transcript.renderMessage(context, group.message, group.index, entryActionHeaders);
            },
          ))}
          ${this.renderQueuedMessages()}
          ${this.renderSessionActivity()}
          ${this.renderSuggestedInput()}
          ${this.renderExtensionDialogs()}
        </div>
        ${this.onNavigationChange === undefined ? this.renderNavigation() : nothing}
      </div>
      <pi-web-image-gallery-dialog></pi-web-image-gallery-dialog>
    `;
  }

  private renderNavigation() {
    const following = this.behaviors.followTail && this.followingLive;
    return html`<nav class="chat-jumps" aria-label=${t("ui.chatView.chatNavigation", "Chat navigation")}>
      <button type="button" title=${t("ui.chatView.jumpToTop", "Jump to top")} aria-label=${t("ui.chatView.jumpToTop", "Jump to top")} @click=${this.handleJumpTop}>↑</button>
      <button type="button" class=${following ? "following" : ""}
        title=${!this.behaviors.followTail ? t("ui.chatView.jumpToEnd", "Jump to end") : following ? t("ui.chatView.followingLiveJumpToEnd", "Following live - jump to end") : t("ui.chatView.jumpToEndAndFollowLive", "Jump to end and follow live")}
        aria-label=${t("ui.chatView.jumpToEnd", "Jump to end")} aria-describedby="chat-follow-state" @click=${this.handleJumpEnd}>↓</button>
      <span id="chat-follow-state" class="chat-follow-state">${!this.behaviors.followTail ? t("ui.chatView.followingDisabled", "Automatic following disabled") : following ? t("ui.chatView.followingLive", "Following live") : t("ui.chatView.followingPaused", "Live following paused")}</span>
    </nav>`;
  }

  private renderTopNotices() {
    const warnings = this.renderWarnings();
    const notifications = this.renderNotificationTray();
    if (warnings === null && notifications === null) return null;
    return html`<div class="top-notices">${warnings}${notifications}</div>`;
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

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = this.messageGrouper.group(this.messages, this.messageStart);
    return this.groupedMessagesCache;
  }

  private isLiveTailGroup(groups: readonly ChatDisplayGroup[], index: number): boolean {
    return index === groups.length - 1 && this.isSessionLive();
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private renderQueuedMessages() {
    const serverQueued = this.status?.queuedMessages ?? [];
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, serverQueued).map((section) => this.renderQueuedMessageList(section))}
      ${this.queuedCopyFeedback === "" ? nothing : html`<small role="status">${this.queuedCopyFeedback}</small>`}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const target = { machineId: this.machineId, sessionId: this.sessionId, cwd: this.sessionCwd };
    return renderQueuedMessageSection(section, {
      machineId: this.machineId, sessionId: this.sessionId,
      behaviors: this.behaviors, contentRendering: this.contentRendering,
      contentRendererVersion: this.contentRendererVersion, workspaceContext: this.workspaceContext,
      pending: this.queuedMessageActionPending, canMutate: this.canMutateQueuedMessages,
      canClearServerQueue: this.canClearServerQueue, unavailable: this.status?.queueMessageActionsUnavailable,
      onClear: this.onClearServerQueue === undefined ? undefined : this.handleClearServerQueue,
      onCopy: (text) => { void this.copyQueuedMessage(text); },
      onAction: this.onQueuedMessageAction === undefined ? undefined : (action, index, messages) => {
        this.actOnQueuedMessage({ ...target, action, index, expectedQueue: messages.map((message) => ({ ...message })) });
      },
    });
  }

  private async copyQueuedMessage(text: string): Promise<void> {
    const generation = this.queuedCopyGeneration;
    const copied = await writeClipboardText(text);
    if (!this.isConnected || generation !== this.queuedCopyGeneration) return;
    this.queuedCopyFeedback = copied ? "" : t("ui.queuedMessages.copyFailed", "Could not copy message");
  }

  private actOnQueuedMessage(target: QueuedMessageActionTarget): void {
    if (!this.canMutateQueuedMessages || this.queuedMessageActionPending || this.status?.queueMessageActionsUnavailable !== undefined) return;
    if (target.machineId !== this.machineId || target.sessionId !== this.sessionId || target.cwd !== this.sessionCwd) return;
    void this.onQueuedMessageAction?.(target);
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
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
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

  private transcriptRenderContext(): TranscriptRenderContext {
    return {
      machineId: this.machineId,
      sessionId: this.sessionId,
      session: this.transcriptSession(),
      messages: this.messages,
      messageStart: this.messageStart,
      behaviors: this.behaviors,
      contentRendering: this.contentRendering,
      contentRendererVersion: this.contentRendererVersion,
      workspaceContext: this.workspaceContext,
      anchors: { message: chatMessageAnchorKey, event: chatEventAnchorKey },
      disclosure: {
        isOpen: (key, defaultOpen) => this.isDisclosureOpen(key, defaultOpen),
        toggle: (key, event, defaultOpen) => { this.onDisclosureToggle(key, event, defaultOpen); },
      },
      metadata: {
        expandedKey: this.expandedMetaKey,
        label: (message) => this.messageMetaLabel(message),
        expand: (key) => { this.expandedMetaKey = key; },
      },
      actions: this.messageActionController,
      openQuestionId: () => this.openQuestion()?.askId,
      questionOutcomes: this.questionOutcomes,
      questionIds: this.questionIds,
      askDraftSessionId: this.askDraftSessionId,
      onSubmitAsk: this.onSubmitAsk,
      openImageGallery: (images, index) => { this.openToolImageGallery(images, index); },
    };
  }

  private renderMessageGroup(context: TranscriptRenderContext, group: Extract<ChatGroup, { kind: "group" }>, defaultOpen: boolean, entryActionHeaders: ReadonlySet<ChatLine> = new Set()) {
    const disclosureKey = this.groupDisclosureKey(group, defaultOpen);
    const open = this.isDisclosureOpen(disclosureKey, defaultOpen);
    return transcript.renderMessageGroup(context, group, defaultOpen, entryActionHeaders, {
      open,
      anchor: this.groupAnchorKey(group, defaultOpen),
      toggle: (event) => { this.onDisclosureToggle(disclosureKey, event, defaultOpen); },
    });
  }

  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private transcriptSession(): SessionRef {
    if (this.imageSession?.id !== this.sessionId || this.imageSession.cwd !== this.sessionCwd) {
      this.imageSession = { id: this.sessionId, cwd: this.sessionCwd };
    }
    return this.imageSession;
  }

  private isDisclosureOpen(key: string, defaultOpen: boolean): boolean {
    return this.behaviors.rememberDisclosures
      ? this.disclosures.isOpen(key, defaultOpen)
      : this.transientDisclosures.get(key) ?? defaultOpen;
  }

  private onDisclosureToggle(key: string, event: Event, defaultOpen: boolean) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    const changed = this.isDisclosureOpen(key, defaultOpen) !== details.open;
    if (this.behaviors.rememberDisclosures) this.disclosures.applyToggle(key, details.open, defaultOpen);
    else this.transientDisclosures.set(key, details.open);
    if (changed) this.requestUpdate();
  }

  private get handlesScrollIntent(): boolean {
    return this.behaviors.followTail || this.behaviors.rememberPosition;
  }

  private scrollContentChanged(changed: Map<string, unknown>): boolean {
    return changed.has("messages") || changed.has("historyReady") || changed.has("messageEnd") || changed.has("messageTotal") || changed.has("onSubmitAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs");
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested || !this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private openQuestion() {
    return openTranscriptQuestion(this.messages, {
      historyReady: this.historyReady,
      messageEnd: this.messageEnd,
      messageTotal: this.messageTotal,
      writable: this.onSubmitAsk !== undefined,
    });
  }

  private isNewOpenDialog(previous: unknown): boolean {
    const oldest = this.pendingDialogs[0];
    if (oldest === undefined) return false;
    if (!Array.isArray(previous)) return true;
    const previousOldest: unknown = previous[0];
    return typeof previousOldest !== "object" || previousOldest === null || Reflect.get(previousOldest, "dialogId") !== oldest.dialogId;
  }

  restoreScrollPosition(): void {
    this.scrollFlows.restorePosition();
  }

  saveScrollPosition(sessionId = this.sessionId): void {
    this.scrollFlows.savePosition(machineSessionKey(this.machineId, sessionId));
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private groupDisclosureKey(group: Extract<ChatGroup, { kind: "group" }>, defaultOpen: boolean): string {
    return defaultOpen
      ? `${machineSessionKey(this.machineId, this.sessionId)}:live:${chatLineIdentity(group.startIndex, group.messages[0]?.message)}`
      : `${machineSessionKey(this.machineId, this.sessionId)}:${chatLineIdentity(group.endIndex, group.messages.at(-1)?.message)}`;
  }

  private groupAnchorKey(group: Extract<ChatGroup, { kind: "group" }>, live: boolean): string | undefined {
    // Historical groups can absorb earlier events; live groups grow at the end.
    // Skip transient members rather than persisting their display indexes.
    const durableIdentities = group.messages
      .map(({ message }) => chatLineScrollIdentity(message))
      .filter((identity): identity is string => identity !== undefined);
    const identity = live ? durableIdentities[0] : durableIdentities.at(-1);
    if (identity === undefined) return undefined;
    return live ? `g:${identity}` : `g-end:${identity}`;
  }

  static override styles = chatStyles;

  @state() private collapsedNotificationTargetKeys: ReadonlySet<string> = new Set();

  @state() private retainedEmptyNotificationTrayTargetKey: string | undefined;

  private pendingNotificationFocus: PendingNotificationFocus | undefined;

  @property({ attribute: false }) onTranscriptRendered?: (transcript: RenderedChatTranscript) => void;

  @property({ type: Boolean }) canClearServerQueue = false;

  @property({ attribute: false }) onUseSuggestedInput: ((machineId: string, sessionId: string) => void) | undefined;

  @property({ type: Number }) contentRendererVersion = 0;

  private notificationTargetChanged(previous: unknown): boolean {
    const currentInbox = this.notificationInbox;
    if (!isSessionNotificationTarget(previous) || currentInbox === undefined) return previous !== currentInbox;
    return notificationTargetKey(previous) !== notificationTargetKey(currentInbox);
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
                <p class="notification-message" dir="auto">${renderNotificationMessage(notification.message, notification.truncated)}</p>
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

  private renderSuggestedInput() {
    const text = this.status?.sessionId === this.sessionId ? this.status.suggestedInput : undefined;
    if (text === undefined || this.onUseSuggestedInput === undefined) return null;
    return html`
      <aside class="suggested-input">
        <strong>${t("ui.chatView.suggestedInput", "Suggested input")}</strong>
        <p class="suggested-input-text" dir="auto">${text === "" ? t("ui.chatView.emptyInput", "Empty input") : text}</p>
        <small>${t("ui.chatView.suggestedInputHint", "Replaces your current draft. Nothing is sent.")}</small>
        <button type="button" class="ui-button" @click=${() => { this.onUseSuggestedInput?.(this.machineId, this.sessionId); }}>${t("ui.chatView.useSuggestedInput", "Use suggested input")}</button>
      </aside>
    `;
  }







  private async reportRenderedTranscript(): Promise<void> {
    const machineId = this.machineId;
    const cwd = this.sessionCwd;
    const transcript = { sessionId: this.sessionId, messages: this.messages, start: this.messageStart, end: this.messageEnd };
    await this.updateComplete;
    if (!this.isConnected || machineId !== this.machineId || cwd !== this.sessionCwd || transcript.sessionId !== this.sessionId || transcript.messages !== this.messages
      || transcript.start !== this.messageStart || transcript.end !== this.messageEnd) return;
    this.onTranscriptRendered?.(transcript);
  }
}
