import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { isCachedNewSessionInfo } from "../cachedNewSessions";
import { shortSessionId } from "../sessionLabels";
import { isArchivableSessionInfo, isTransientNewSessionInfo, sessionPersistenceState } from "../sessionPersistence";
import type { SessionLabelItem } from "../plugins/types";
import { renderSessionLabelItems } from "./sessionLabel";
import { normalizeSessionPath } from "../sessionPaths";
import { isSessionActive } from "../../../shared/activity";
import { CORE_STATUS_FLAGS, type StatusFlags } from "../../../shared/machineStatus";
import { AnchoredPopupController } from "./anchoredPopup";
import { renderCopyIdAction } from "./copyIdAction";
import { interventionRequiredLabel, renderActionActivityIndicator, type ActivityIndicatorKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles, scrollBoundaryShadow } from "./shared";
import { sidebarListStyles } from "./sidebarListStyles";
import { localization, LocalizationController } from "../localization/browser";
import definitions from "./sessionNavigation.messages";

export const sessionNavigationMessages = localization.registerMessages("core.sessionNavigation", definitions);

function sessionMenuId(sessionId: string): string {
  return `session-menu-${encodeURIComponent(sessionId)}`;
}

function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  return session.firstMessage !== "" ? session.firstMessage : shortSessionId(session.id);
}

export interface SessionRow {
  session: SessionInfo;
  depth: number;
  hasMissingParent: boolean;
}

type SessionSelectionScope = "current" | "archived";

export const SESSION_LIST_BATCH_SIZE = 50;
const ORPHAN_PARENT_TITLE = t("client.parentSessionLocation.no.parent.session.available.in.this.workspace.cbd17a", "No parent session available in this workspace");

const NON_RENDERING_PROPERTIES = new Set([
  "onSelect", "onSearch", "onTogglePin", "onStart", "onToggleCollapsed", "onArchivedCollapsed",
  "onFocusPreviousSection", "onFocusNextSection", "onCancelKeyboardNavigation", "onArchive",
  "onArchiveWithDescendants", "onArchiveMany", "onRestore", "onDelete", "onDeleteArchived",
  "onDeleteArchivedMany", "onRename", "onDetachParent", "onMarkRead",
  "onMarkReadMany", "onReload", "onCleanup",
]);

@customElement("session-list")
export class SessionList extends LitElement implements KeyboardNavigableSection {
  private readonly popup = new AnchoredPopupController(this, () => {
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".action-menu-panel");
    return panel && this.menuAnchor ? { anchor: this.menuAnchor, panel, onClose: () => { this.openMenuSessionId = undefined; }, options: { minWidth: 120 } } : undefined;
  });

  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) scopeKey = "";
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) pinnedSessionIds: string[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) pinnedRootIds: string[] = [];
  @property({ attribute: false }) onMovePin?: (session: SessionInfo, direction: -1 | 1) => void;
  @property({ attribute: false }) statuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) activities: Record<string, SessionActivity> = {};
  // Undefined is an older daemon; an empty map is an authoritative idle snapshot.
  @property({ attribute: false }) sessionFlags: Readonly<Record<string, StatusFlags>> | undefined;
  @property({ attribute: false }) sending: Record<string, true> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) selected?: SessionInfo;
  @property({ attribute: false }) sessionLabelItems: (session: SessionInfo) => SessionLabelItem[] = () => [];
  @property({ type: Number }) startingCount = 0;
  @property({ type: Boolean }) canStart = false;
  @property({ type: Boolean }) canDeleteArchived = false;
  @property({ type: Boolean }) canReload = false;
  @property({ type: Boolean }) canCleanup = false;
  @property({ type: Boolean }) authoritativeSessionPersistence = false;
  @property({ type: String }) archivedDeleteUnavailableMessage = t("ui.appNavigationPanel.updateAndRestartPiWebOnThisMachine2", "Update and restart Pi-Web on this machine before deleting archived sessions.");
  @property({ type: String }) cleanupUnavailableMessage = t("ui.sessionCleanupDialog.updateAndRestartPiWebOnThisMachine", "Update and restart Pi-Web on this machine before cleaning up sessions.");
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /** Use viewport intersections when an ancestor owns the scroll boundary. */
  @property({ type: Boolean, attribute: "external-scroll" }) externalScroll = false;
  @property({ attribute: false }) onSelect?: (session: SessionInfo) => void;
  @property({ attribute: false }) onSearch?: () => void;
  @property({ attribute: false }) onTogglePin?: (session: SessionInfo) => void;
  @property({ attribute: false }) onStart?: () => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onArchivedCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @property({ attribute: false }) onArchive?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveWithDescendants?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveMany?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRestore?: (session: SessionInfo) => void;
  @property({ attribute: false }) onDelete?: (session: SessionInfo) => void;
  @property({ attribute: false }) onDeleteArchived?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedMany?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRename?: (session: SessionInfo, name: string) => void | Promise<void>;
  @property({ attribute: false }) onDetachParent?: (session: SessionInfo) => void;
  @property({ attribute: false }) onMarkRead?: (session: SessionInfo) => void;
  @property({ attribute: false }) onMarkUnread?: (session: SessionInfo) => void;
  @property({ attribute: false }) onMarkReadMany?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onReload?: (session: SessionInfo) => void;
  @property({ attribute: false }) onCleanup?: () => void;

  @state() private openMenuSessionId: string | undefined;
  private menuAnchor: HTMLElement | undefined;
  @state() private archivedExpanded = false;
  @state() private selectionScopes: ReadonlySet<SessionSelectionScope> = new Set();
  @state() private selectedSessionIds: ReadonlySet<string> = new Set();
  @state() private currentVisibleLimit = SESSION_LIST_BATCH_SIZE;
  @state() private archivedVisibleLimit = SESSION_LIST_BATCH_SIZE;
  @query(".list-body") private listBody?: HTMLElement;
  private loadMoreObserver: IntersectionObserver | undefined;
  @state() private expandedAgentParents: ReadonlySet<string> = new Set();

  private agentAttentionCache?: {
    rows: readonly SessionRow[];
    statuses: SessionList["statuses"];
    activities: SessionList["activities"];
    sessionFlags: SessionList["sessionFlags"];
    sending: SessionList["sending"];
    unreadSessionIds: SessionList["unreadSessionIds"];
    attention: ReadonlyMap<string, AgentAttention>;
  };

  private visibleTreeCache?: {
    tree: NonNullable<SessionList["treeCache"]>;
    expanded: ReadonlySet<string>;
    pins: string[];
    pinnedRootIds: string[];
    pinnedRowCount: number;
    currentAgentOffsets: ReadonlyMap<string, number>;
    archivedAgentOffsets: ReadonlyMap<string, number>;
    currentRows: SessionRow[];
    currentSelectableSessions: SessionInfo[];
    archivedRows: SessionRow[];
    archivedSessions: SessionInfo[];
  };

  private treeCache: {
    sessions: SessionInfo[];
    pinnedSessionIds: string[];
    currentRows: SessionRow[];
    currentSelectableSessions: SessionInfo[];
    archivedRows: SessionRow[];
    archivedSessions: SessionInfo[];
    descendantCounts?: Map<string, number>;
    currentAgentGroups: AgentSessionGroups;
    archivedAgentGroups: AgentSessionGroups;
  } | undefined;

  private sessionTree() {
    if (this.treeCache?.sessions !== this.sessions || this.treeCache.pinnedSessionIds !== this.pinnedSessionIds) {
      const currentRows = sessionRowsForCurrentTree(this.sessions, this.pinnedSessionIds);
      const currentRowIds = new Set(currentRows.map((row) => row.session.id));
      const archivedRows = sessionRows(this.sessions.filter((session) => session.archived === true && !currentRowIds.has(session.id)), this.pinnedSessionIds);
      this.treeCache = {
        sessions: this.sessions,
        pinnedSessionIds: this.pinnedSessionIds,
        currentRows,
        currentAgentGroups: agentSessionGroups(currentRows),
        archivedAgentGroups: agentSessionGroups(archivedRows),
        currentSelectableSessions: currentRows.map((row) => row.session).filter((session) => sessionSelectionScope(session) === "current"),
        archivedRows,
        archivedSessions: archivedRows.map((row) => row.session),
      };
    }
    return this.treeCache;
  }

  private visibleSessionTree() {
    const tree = this.sessionTree();
    if (this.visibleTreeCache?.tree !== tree || this.visibleTreeCache.expanded !== this.expandedAgentParents || this.visibleTreeCache.pins !== this.pinnedRootIds) {
      const members = pinnedRootMembers(tree.currentRows, this.pinnedSessionIds);
      const order = [...this.pinnedRootIds.filter((id) => members.has(id)), ...members];
      const projection = pinnedSessionRows(visibleAgentSessionRows(tree.currentRows, this.expandedAgentParents, tree.currentAgentGroups), order);
      const currentRows = projection.rows;
      const archivedRows = visibleAgentSessionRows(tree.archivedRows, this.expandedAgentParents, tree.archivedAgentGroups);
      this.visibleTreeCache = {
        tree, expanded: this.expandedAgentParents, pins: this.pinnedRootIds,
        pinnedRootIds: projection.pinnedRootIds, pinnedRowCount: projection.pinnedRowCount, currentRows, archivedRows,
        currentAgentOffsets: agentChildOffsets(currentRows, tree.currentAgentGroups),
        archivedAgentOffsets: agentChildOffsets(archivedRows, tree.archivedAgentGroups),
        currentSelectableSessions: currentRows.map((row) => row.session).filter((session) => sessionSelectionScope(session) === "current"),
        archivedSessions: archivedRows.map((row) => row.session),
      };
    }
    return this.visibleTreeCache;
  }

  automaticSessionCandidates(sessions: SessionInfo[]): SessionInfo[] {
    return sessionNavigationCandidates(sessions, {
      collapsed: this.collapsed,
      expandedAgentParents: this.expandedAgentParents,
      archivedExpanded: this.archivedExpanded,
    });
  }

  private agentGroupAttention(rows: readonly SessionRow[], groups: AgentSessionGroups): ReadonlyMap<string, AgentAttention> {
    const cached = this.agentAttentionCache;
    if (cached?.rows === rows && cached.statuses === this.statuses && cached.activities === this.activities
      && cached.sessionFlags === this.sessionFlags && cached.sending === this.sending && cached.unreadSessionIds === this.unreadSessionIds) return cached.attention;
    const attention = new Map<string, AgentAttention>();
    // Parent-first tree order lets nested agent activity roll up in one reverse pass.
    // User/unknown children are always visible and do not contribute to these chips.
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];
      if (row === undefined) continue;
      const { session } = row;
      const parentId = groups.parentByAgentId.get(session.id);
      if (parentId === undefined) continue;
      const nested = attention.get(session.id);
      const parent = attention.get(parentId);
      const ownKind = sessionRowActivityKind(session, this.statuses[session.id], this.activities[session.id], this.sending[session.id] === true, this.sessionFlags);
      const kinds = [ownKind, nested?.kind, parent?.kind];
      const kind = kinds.includes("intervention-required") ? "intervention-required"
        : kinds.includes("sending") ? "sending" : ownKind ?? nested?.kind ?? parent?.kind;
      const unread = sessionRowUnread(session, this.unreadSessionIds) || nested?.unread === true || parent?.unread === true;
      if (kind !== undefined || unread) attention.set(parentId, { kind, unread });
    }
    this.agentAttentionCache = {
      rows, statuses: this.statuses, activities: this.activities, sessionFlags: this.sessionFlags, sending: this.sending,
      unreadSessionIds: this.unreadSessionIds, attention,
    };
    return attention;
  }

  private revealSelectedAgentRow(): boolean {
    if (this.selected === undefined) return false;
    const tree = this.sessionTree();
    const groups = tree.currentRows.some((row) => row.session.id === this.selected?.id) ? tree.currentAgentGroups : tree.archivedAgentGroups;
    const expanded = new Set(this.expandedAgentParents);
    const seen = new Set<string>();
    let id: string | undefined = this.selected.id;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      id = groups.parentByAgentId.get(id);
      if (id !== undefined) expanded.add(id);
    }
    if (expanded.size === this.expandedAgentParents.size) return false;
    this.expandedAgentParents = expanded;
    return true;
  }

  private toggleAgentParent(parentId: string): void {
    const expanded = new Set(this.expandedAgentParents);
    if (expanded.has(parentId)) expanded.delete(parentId);
    else expanded.add(parentId);
    this.expandedAgentParents = expanded;
    if (!expanded.has(parentId)) this.selectedSessionIds = this.includeCollapsedChildren(this.selectedSessionIds);
    this.openMenuSessionId = undefined;
  }


  private includeCollapsedChildren(sessionIds: ReadonlySet<string>): ReadonlySet<string> {
    if (sessionIds.size === 0) return sessionIds;
    const tree = this.sessionTree();
    const visible = this.visibleSessionTree();
    const scopeById = new Map(this.sessions.map((session) => [session.id, sessionSelectionScope(session)]));
    const next = new Set(sessionIds);
    for (const scope of ["current", "archived"] as const) {
      const inherited = new Set([...sessionIds].filter((id) => scopeById.get(id) === scope));
      if (inherited.size === 0) continue;
      for (const [rows, visibleRows, groups] of [
        [tree.currentRows, visible.currentRows, tree.currentAgentGroups],
        [tree.archivedRows, visible.archivedRows, tree.archivedAgentGroups],
      ] as const) {
        const visibleIds = new Set(visibleRows.map((row) => row.session.id));
        // Parent-first order includes nested hidden groups even if their own toggle is expanded.
        for (const { session } of rows) {
          const parentId = groups.parentByAgentId.get(session.id);
          if (parentId === undefined || visibleIds.has(session.id) || !inherited.has(parentId)) continue;
          // Carry inheritance through mixed archive states without selecting outside the scope.
          inherited.add(session.id);
          if (sessionSelectionScope(session) === scope) next.add(session.id);
        }
      }
    }
    return next.size === sessionIds.size ? sessionIds : next;
  }

  override connectedCallback(): void {
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = undefined;
    super.disconnectedCallback();
  }

  private focusedMenuControl: HTMLElement | undefined;
  private focusAfterPinReorder: HTMLElement | undefined;
  private autoExpandedForSelection = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.autoExpandedForSelection = false;
    if (changed.has("pinnedRootIds")) this.focusAfterPinReorder = this.focusedMenuControl;
    if (changed.has("scopeKey")) {
      this.currentVisibleLimit = SESSION_LIST_BATCH_SIZE;
      this.archivedVisibleLimit = SESSION_LIST_BATCH_SIZE;
      this.expandedAgentParents = new Set();
      this.selectionScopes = new Set();
      this.selectedSessionIds = new Set();
      this.openMenuSessionId = undefined;
    }
    if (changed.has("sessions")) {
      if (this.openMenuSessionId !== undefined && !this.sessions.some((session) => session.id === this.openMenuSessionId)) this.openMenuSessionId = undefined;
      if (!this.sessions.some((session) => session.archived === true)) this.archivedExpanded = false;
      this.pruneSelectedSessionIds();
    }
    if (changed.has("collapsed") && this.collapsed) this.openMenuSessionId = undefined;
    if (this.shouldRevealSelectedRow(changed)) this.revealSelectedAgentRow();
    const previousSelected = changed.get("selected");
    if (changed.has("selected") && this.selected?.archived === true && (previousSelected?.id !== this.selected.id || previousSelected.archived !== true) && !this.archivedExpanded) {
      this.revealSelectedAgentRow();
      this.archivedExpanded = true;
      this.autoExpandedForSelection = true;
    }
    if (changed.has("selected") || changed.has("sessions") || changed.has("pinnedSessionIds")) this.expandVisibleLimitForSelected();
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size === 0) return true;
    for (const [name, previous] of changed) {
      if (NON_RENDERING_PROPERTIES.has(String(name))) continue;
      if (name === "sessions" && sessionsRenderEqual(previous, this.sessions)) continue;
      if (name === "selected" && selectedSessionRenderEqual(previous, this.selected)) continue;
      // Group attention consumes each runtime signal once when its map changes.
      if ((name === "statuses" || name === "activities") && this.sessionTree().currentAgentGroups.parentByAgentId.size > 0) return true;
      if (name === "statuses" && sessionRuntimeMapRenderEqual(previous, this.statuses, this.activities, this.sending, this.sessions, this.authoritativeSessionPersistence, "status")) continue;
      if (name === "activities" && sessionRuntimeMapRenderEqual(previous, this.activities, this.statuses, this.sending, this.sessions, this.authoritativeSessionPersistence, "activity")) continue;
      return true;
    }
    return false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("pinnedRootIds") && this.focusAfterPinReorder?.isConnected === true) {
      const control = this.focusAfterPinReorder;
      const target = control instanceof HTMLButtonElement && control.disabled
        ? control.closest(".action-menu-panel")?.querySelector<HTMLElement>("button[data-pin-move]:not(:disabled)")
        : control;
      target?.focus({ preventScroll: true });
    }
    this.focusAfterPinReorder = undefined;
    if (this.autoExpandedForSelection || this.shouldRevealSelectedRow(changed)) this.scrollSelectedIntoView();
    this.observeLoadMoreSentinels();
  }

  /**
   * Positive reveal triggers only: live data refreshes replace `sessions` and
   * `selected` with same-id objects (status churn, renames, archive flips) and
   * must never re-scroll. Reveal the selected row only when the selection
   * moves to a different row (first render with a selection included), when a
   * restore moves it from the archived section back to the current section
   * (same id, archived flag cleared), or when the section expands.
   */
  private shouldRevealSelectedRow(changed: PropertyValues<this>): boolean {
    if (this.collapsed) return false;
    if (changed.has("scopeKey")) return true;
    if (changed.has("collapsed")) return true;
    if (!changed.has("selected")) return false;
    const previousSelected = changed.get("selected");
    if (previousSelected?.id !== this.selected?.id) return true;
    return previousSelected?.archived === true && this.selected?.archived !== true;
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle, h2 button:not([disabled])" });
  }

  override render() {
    const tree = this.sessionTree();
    const { currentSelectableSessions } = tree;
    const { currentRows, archivedRows, currentAgentOffsets, archivedAgentOffsets, pinnedRowCount } = this.visibleSessionTree();
    const needsAgentAttention = !this.collapsed && tree.currentAgentGroups.countByParentId.size > 0 && currentRows.some(({ session }) =>
      tree.currentAgentGroups.countByParentId.has(session.id) && !this.expandedAgentParents.has(session.id));
    const agentAttention = needsAgentAttention ? this.agentGroupAttention(tree.currentRows, tree.currentAgentGroups) : undefined;
    if (!this.collapsed) tree.descendantCounts ??= unarchivedDescendantCounts(this.sessions);
    const unreadCount = unreadSessionCount(currentSelectableSessions, this.unreadSessionIds);
    const visibleCurrentRows = currentRows.slice(0, this.currentVisibleLimit);
    const visibleCurrentSessions = visibleCurrentRows.map((row) => row.session).filter((session) => sessionSelectionScope(session) === "current");
    const visibleArchivedRows = archivedRows.slice(0, this.archivedVisibleLimit);
    const visibleArchivedSessions = visibleArchivedRows.map((row) => row.session);
    return html`
      <section data-ui-context="sessions" data-collapsed=${String(this.collapsed)}>
        ${this.renderHeading(tree.currentRows.length + tree.archivedRows.length, currentSelectableSessions, unreadCount)}
        ${this.collapsed ? null : html`
          <div class="list-body ui-nav-list" aria-busy=${String(this.loading)}>
            ${this.renderCurrentSelectionToolbar(visibleCurrentSessions)}
            ${this.startingCount > 0 ? this.renderStartingSession() : null}
            ${pinnedRowCount > 0 ? html`<h2 class="subheading pin-heading">${sessionNavigationMessages.t("pinned")}</h2>` : null}
            ${repeat(visibleCurrentRows, (row) => row.session.id, (row, index) => html`
              ${pinnedRowCount > 0 && index === pinnedRowCount ? html`<h2 class="subheading pin-heading">${sessionNavigationMessages.t("recent")}</h2>` : null}
              ${this.renderSession(row, "current", tree.currentAgentGroups.countByParentId.get(row.session.id) ?? 0, currentAgentOffsets.get(row.session.id) ?? 0, agentAttention?.get(row.session.id))}
            `)}
            ${pinnedRowCount > 0 && pinnedRowCount === visibleCurrentRows.length ? html`<h2 class="subheading pin-heading">${sessionNavigationMessages.t("recent")}</h2>` : null}
            ${this.renderLoadMoreSentinel("current", visibleCurrentRows.length, currentRows.length)}
            ${archivedRows.length > 0 ? html`
              ${this.renderArchivedHeading(tree.archivedSessions, visibleArchivedSessions)}
              ${this.archivedExpanded ? html`
                ${this.renderArchivedSelectionToolbar(visibleArchivedSessions)}
                ${repeat(visibleArchivedRows, (row) => row.session.id, (row) => this.renderSession(row, "archived", tree.archivedAgentGroups.countByParentId.get(row.session.id) ?? 0, archivedAgentOffsets.get(row.session.id) ?? 0))}
                ${this.renderLoadMoreSentinel("archived", visibleArchivedRows.length, archivedRows.length)}
              ` : null}
            ` : null}
          </div>
        `}
      </section>
    `;
  }

  private renderHeading(sessionCount: number, currentSessions: SessionInfo[], unreadCount: number) {
    if (!this.collapsible) {
      return html`
        <h2 class="ui-toolbar session-heading">
          <span class="plain-heading">${sessionNavigationMessages.t("sessions")}</span>
          ${this.renderUnreadCount(unreadCount)}
          <span class="session-heading-actions ui-toolbar-group">
            ${this.renderSearchButton()}
            ${this.renderCurrentSelectionButton(currentSessions)}
            ${this.renderCleanupButton()}
            ${this.renderStartButton()}
          </span>
        </h2>
      `;
    }
    const selectedSummary = this.selected === undefined ? sessionNavigationMessages.t("noSelection") : sessionLabel(this.selected);
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`
      <h2 class="ui-toolbar session-heading">
        <button class="ui-button ui-toolbar-title ui-nav-section-toggle section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${sessionNavigationMessages.t("sessions")}</span>${this.collapsed ? html`<small class="section-selected" dir="auto" title=${selectedTitle}>${selectedSummary}</small>` : null}</span></button>
        ${this.renderUnreadCount(unreadCount)}
        <small class="section-count">${sessionCount}</small>
        <span class="session-heading-actions ui-toolbar-group">
          ${this.renderSearchButton()}
          ${this.renderCurrentSelectionButton(currentSessions)}
          ${this.renderCleanupButton()}
          ${this.renderStartButton()}
        </span>
      </h2>
    `;
  }

  private renderSearchButton() {
    return html`<button class="ui-button ui-button--icon session-search" title="${t("ui.sessionSearchDialog.searchSessionContent", "Search session content")}" aria-label="${t("ui.sessionSearchDialog.searchSessionContent", "Search session content")}" @click=${(event: MouseEvent) => { event.stopPropagation(); this.onSearch?.(); }}>⌕</button>`;
  }

  private renderUnreadCount(unreadCount: number) {
    if (unreadCount === 0) return null;
    const label = sessionNavigationMessages.t("unread", { count: unreadCount });
    return html`<small class="section-unread-count" title=${label}>${label}</small>`;
  }

  private renderCurrentSelectionButton(currentSessions: SessionInfo[]) {
    if (this.collapsed || currentSessions.length === 0) return null;
    const active = this.selectionScopes.has("current");
    return html`<button class="ui-button ui-button--icon bulk-select-entry ${active ? "selected" : ""}" title=${active ? sessionNavigationMessages.t("closeCurrentSelection") : sessionNavigationMessages.t("selectCurrent")} aria-label=${active ? sessionNavigationMessages.t("closeCurrentSelection") : sessionNavigationMessages.t("selectCurrent")} aria-expanded=${String(active)} aria-pressed=${String(active)} @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleSelection("current", this.visibleSessionTree().currentSelectableSessions.slice(0, this.currentVisibleLimit)); }}>☑</button>`;
  }

  private renderCleanupButton() {
    return html`<button class="ui-button cleanup-entry" title=${this.canCleanup ? sessionNavigationMessages.t("cleanupPreview") : this.cleanupUnavailableMessage} @click=${(event: MouseEvent) => { event.stopPropagation(); this.onCleanup?.(); }}>${sessionNavigationMessages.t("cleanup")}</button>`;
  }

  private renderStartButton() {
    const title = this.startingCount > 0 ? sessionNavigationMessages.t("startAnother") : t("ui.sessionList.startNewSession", "Start new session");
    return html`<button class="ui-button ui-button--icon start-session-button" title=${title} aria-label=${title} ?disabled=${!this.canStart} @click=${(event: MouseEvent) => { event.stopPropagation(); this.onStart?.(); }}>+</button>`;
  }

  private renderStartingSession() {
    const plural = this.startingCount !== 1;
    return html`
      <div class="pending-session-row starting-session" role="status" aria-live="polite">
        <div class="action-main">
          <span class="action-name"><span class="activity-indicator sending" aria-hidden="true"></span>${plural ? t("ui.sessionList.startingSessions", "Starting {startingCount} sessions…", { startingCount: String(this.startingCount) }) : t("ui.sessionList.startingSession", "Starting session…")}</span>
          <small>${t("ui.main.2db7f2df3d07", "Waiting for")}${plural ? t("client.sessionController.new.session.c57c30", "New session") : sessionNavigationMessages.t("sessions")}${t("ui.main.fcbd0932929e", "to be created")}</small>
        </div>
      </div>
    `;
  }

  private renderArchivedHeading(archivedSessions: SessionInfo[], visibleArchivedSessions: SessionInfo[]) {
    const active = this.selectionScopes.has("archived");
    return html`
      <h2 class="subheading">
        <button class="ui-button ui-toolbar-title ui-nav-section-toggle section-toggle" aria-expanded=${String(this.archivedExpanded)} @click=${() => { this.toggleArchived(); }}><span>${this.archivedExpanded ? "▾" : "▸"} ${sessionNavigationMessages.t("archived")}</span></button>
        ${this.archivedExpanded ? html`<button class="ui-button ui-button--icon bulk-select-entry ${active ? "selected" : ""}" title=${active ? sessionNavigationMessages.t("closeArchivedSelection") : sessionNavigationMessages.t("selectArchived")} aria-label=${active ? sessionNavigationMessages.t("closeArchivedSelection") : sessionNavigationMessages.t("selectArchived")} aria-expanded=${String(active)} aria-pressed=${String(active)} @click=${() => { this.toggleSelection("archived", visibleArchivedSessions); }}>☑</button>` : null}
        <small class="section-count">${archivedSessions.length}</small>
      </h2>
    `;
  }

  private renderCurrentSelectionToolbar(visibleSessions: SessionInfo[]) {
    if (this.sessionTree().currentSelectableSessions.length === 0 || !this.selectionScopes.has("current")) return null;

    const selectedSessions = this.selectedSessions("current");
    const archivableSessions = selectedSessions.filter((session) => isArchivableSessionInfo(session, this.statuses[session.id], this.sessionPersistenceOptions()));
    const unreadSelectedSessions = selectedSessions.filter((session) => this.unreadSessionIds.has(session.id));
    return html`
      <div class="selection-toolbar"><div class="bulk-row selecting">
        ${this.renderSelectionControls("current", visibleSessions.length === 0 ? this.sessionTree().currentSelectableSessions : visibleSessions)}
        <div class="bulk-actions">
        <button ?disabled=${archivableSessions.length === 0} @click=${() => { this.archiveSelectedCurrent(); }}>${sessionNavigationMessages.t("archive")}</button>
        <button ?disabled=${unreadSelectedSessions.length === 0} @click=${() => { this.markSelectedCurrentRead(); }}>${sessionNavigationMessages.t("markRead")}</button>
        </div>
      </div></div>
    `;
  }

  private renderArchivedSelectionToolbar(visibleSessions: SessionInfo[]) {
    if (visibleSessions.length === 0 || !this.selectionScopes.has("archived")) return null;

    const selectedSessions = this.selectedSessions("archived");
    return html`
      <div class="selection-toolbar"><div class="bulk-row selecting">
        ${this.renderSelectionControls("archived", visibleSessions)}
        <button class="ui-button ui-menu-item danger" title=${this.canDeleteArchived ? sessionNavigationMessages.t("deleteSelectedTitle") : this.archivedDeleteUnavailableMessage} ?disabled=${selectedSessions.length === 0 || !this.canDeleteArchived} @click=${() => { this.confirmDeleteSelectedArchived(); }}>${sessionNavigationMessages.t("delete")}</button>
        ${this.canDeleteArchived ? null : html`<small class="capability-hint">${this.archivedDeleteUnavailableMessage}</small>`}
      </div></div>
    `;
  }

  /**
   * 两个范围共用同一组选中状态控件。存在选中项时清除该范围的选择；
   * 选择模式本身由标题栏中进入该模式的同一个按钮关闭。
   */
  private renderSelectionControls(scope: SessionSelectionScope, visibleSessions: SessionInfo[]) {
    const selectedCount = this.selectedSessions(scope).length;
    const visibleSelectedCount = visibleSessions.filter((session) => this.selectedSessionIds.has(session.id)).length;
    return html`
      ${selectedCount === 0
        ? html`<button @click=${() => { this.selectVisibleSessions(visibleSessions); }}>${t("ui.sessionList.selectVisible", "Select visible")}</button>`
        : html`<button @click=${() => { this.clearSelection(scope); }}>${sessionNavigationMessages.t("clearSelected", { count: selectedCount })}</button>`}
      ${visibleSelectedCount !== selectedCount ? html`<small>${t("ui.main.fcafc66aea52", " visible")} ${visibleSelectedCount}</small>` : null}
    `;
  }

  private renderSession(row: SessionRow, scope: SessionSelectionScope, agentChildCount = 0, agentOffset = 0, agentAttention?: AgentAttention) {
    const { session } = row;
    const linkedAgentChild = agentOffset > 0;
    const cappedDepth = Math.min(row.depth, 2);
    const canBulkSelect = sessionSelectionScope(session) === scope;
    const selectionActive = this.selectionScopes.has(scope);
    const showsCheckbox = selectionActive && canBulkSelect;
    const bulkSelected = showsCheckbox && this.selectedSessionIds.has(session.id);
    const status = this.statuses[session.id];
    const activity = this.activities[session.id];
    const indicatorKind = sessionRowActivityKind(session, status, activity, this.sending[session.id] === true, this.sessionFlags);
    const isWorking = sessionRowIsWorking(session, status, activity, this.sessionFlags);
    const unread = sessionRowUnread(session, this.unreadSessionIds);
    const persistenceOptions = this.sessionPersistenceOptions();
    const canArchive = isArchivableSessionInfo(session, status, persistenceOptions);
    const canRename = isRenamableSession(session, status, persistenceOptions);
    const canDeleteTransient = isTransientNewSessionInfo(session, status, persistenceOptions);
    const canReloadSession = canArchive && this.canReload;
    const pinned = this.pinnedSessionIds.includes(session.id);
    const canPin = session.persisted !== false;
    const descendantCount = this.openMenuSessionId === session.id ? (this.sessionTree().descendantCounts?.get(session.id) ?? 0) : 0;
    const labelItems = this.sessionLabelItems(session);
    return html`
      <div
        class="action-row ui-nav-row ${this.selected?.id === session.id ? "selected" : ""} ${bulkSelected ? "bulk-selected" : ""} ${session.archived === true ? "archived" : ""} ${selectionActive ? "selecting" : ""} ${unread ? "unread" : ""} ${indicatorKind === "intervention-required" ? "intervention-required" : ""} ${pinned ? "pinned" : ""} ${this.openMenuSessionId === session.id ? "menu-open" : ""} ${agentChildCount > 0 ? "has-agent-subsessions" : ""} ${linkedAgentChild ? "linked-agent-child" : ""}"
        style=${`--depth:${String(cappedDepth)};--agent-offset:${String(agentOffset)}px`}
        tabindex="0"
        data-session-id=${session.id}
        data-current=${this.selected?.id === session.id}
        aria-current=${this.selected?.id === session.id ? "true" : nothing}
        data-activity=${indicatorKind ?? "idle"}
        data-busy=${this.sending[session.id] === true || isWorking}
        data-unread=${unread}
        data-selected=${bulkSelected}
        data-selecting=${showsCheckbox}
        data-archived=${session.archived === true}
        data-expanded=${agentChildCount > 0 ? this.expandedAgentParents.has(session.id) : nothing}
        title=${session.path}
        @click=${(event: MouseEvent) => { activateSelectableRow(event, () => { this.activateSessionRow(session, scope); }); }}
        @keydown=${(event: KeyboardEvent) => { this.handleSessionKeydown(event, session, scope); }}
      >
        <div class="action-main ui-nav-row-main ${selectionActive ? "selecting" : ""}">
          ${showsCheckbox ? html`<input class="session-checkbox" type="checkbox" aria-label=${sessionNavigationMessages.t("selectSession", { label: sessionLabel(session) })} .checked=${bulkSelected} @click=${(event: MouseEvent) => { event.stopPropagation(); }} @change=${() => { this.toggleSelected(session.id); }}>` : null}
          <span class="action-name-line"><span class="action-name ui-nav-row-label" dir="auto" title=${sessionLabel(session)}>${this.renderRowMarker(row)}${pinned ? html`<span class="pin-indicator" title="${sessionNavigationMessages.t("pinned")}" aria-label="${sessionNavigationMessages.t("pinned")}">★</span>` : null}${sessionLabel(session)}</span>${this.renderRowBadges(row)}</span>
          <small class="session-secondary ui-nav-row-meta"><span class="session-meta">${indicatorKind === "intervention-required" ? html`${interventionRequiredLabel()} · ` : null}${sessionNavigationMessages.t("sessionMeta", { state: this.sessionMetaState(session, status, activity), count: session.messageCount })}</span>${labelItems.length === 0 ? null : html`<span class="session-label-separator" aria-hidden="true">·</span><span class="session-labels">${renderSessionLabelItems(labelItems)}</span>`}</small>
          ${this.renderActivity(indicatorKind, unread)}
        </div>
        <div class="action-menu ui-nav-row-actions">
          <button class="ui-button ui-button--icon action-menu-toggle ui-nav-row-action ui-popup-trigger" aria-expanded=${String(this.openMenuSessionId === session.id)} aria-controls=${sessionMenuId(session.id)} title="${sessionNavigationMessages.t("actions")}" @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(session.id, event.currentTarget); }}>⋯</button>
          ${this.openMenuSessionId === session.id ? html`
            <div popover="auto" class="ui-menu action-menu-panel ui-nav-row-menu ui-popup-panel" data-ui-context="session-actions" id=${sessionMenuId(session.id)}
              @focusin=${(event: FocusEvent) => { this.focusedMenuControl = event.target instanceof HTMLElement ? event.target : undefined; }}
              @focusout=${() => { this.focusedMenuControl = undefined; }}>
              ${this.renderPinMoveActions(row)}
              ${session.archived === true
                ? html`
                  ${canPin ? html`<button class="ui-button ui-menu-item" title=${pinned ? sessionNavigationMessages.t("unpin") : sessionNavigationMessages.t("pin")} @click=${() => { this.openMenuSessionId = undefined; this.onTogglePin?.(session); }}>${pinned ? t("ui.sessionList.unpin", "Unpin") : t("ui.sessionList.pin", "Pin")}</button>` : null}
                  <button class="ui-button ui-menu-item" title="${sessionNavigationMessages.t("restoreTitle")}" @click=${() => { this.openMenuSessionId = undefined; this.onRestore?.(session); }}>${sessionNavigationMessages.t("restore")}</button>
                  <button class="ui-button ui-menu-item danger" title=${this.canDeleteArchived ? sessionNavigationMessages.t("deleteArchivedTitle") : this.archivedDeleteUnavailableMessage} ?disabled=${!this.canDeleteArchived} @click=${() => { this.openMenuSessionId = undefined; this.confirmDeleteArchived(session); }}>${sessionNavigationMessages.t("deleteArchived")}</button>
                `
                : canDeleteTransient
                  ? html`<button class="ui-button ui-menu-item" title="${t("ui.sessionList.deleteTemporaryNewSession", "Delete temporary new session")}" @click=${() => { this.openMenuSessionId = undefined; this.onDelete?.(session); }}>${sessionNavigationMessages.t("delete")}</button>`
                  : html`
                    ${canPin ? html`<button class="ui-button ui-menu-item" title=${pinned ? sessionNavigationMessages.t("unpin") : sessionNavigationMessages.t("pin")} @click=${() => { this.openMenuSessionId = undefined; this.onTogglePin?.(session); }}>${pinned ? t("ui.sessionList.unpin", "Unpin") : t("ui.sessionList.pin", "Pin")}</button>` : null}
                    ${canRename ? html`<button class="ui-button ui-menu-item" title="${t("ui.sessionList.renameSession", "Rename session")}" @click=${() => { this.renameSession(session); }}>${t("ui.sessionList.rename", "Rename")}</button>` : null}
                    ${this.unreadSessionIds.has(session.id) ? html`<button class="ui-button ui-menu-item" title=${sessionNavigationMessages.t("markReadTitle")} @click=${() => { this.openMenuSessionId = undefined; this.onMarkRead?.(session); }}>${sessionNavigationMessages.t("markAsRead")}</button>` : session.agentSubsession !== true ? html`<button class="ui-button ui-menu-item" title=${sessionNavigationMessages.t("markUnreadTitle")} @click=${() => { this.openMenuSessionId = undefined; this.onMarkUnread?.(session); }}>${sessionNavigationMessages.t("markAsUnread")}</button>` : null}
                    ${canArchive ? html`
                      <button class="ui-button ui-menu-item" title="${sessionNavigationMessages.t("archiveTitle")}" @click=${() => { this.openMenuSessionId = undefined; this.onArchive?.(session); }}>${sessionNavigationMessages.t("archive")}</button>
                      ${descendantCount > 0 ? html`<button class="ui-button ui-menu-item" title="${sessionNavigationMessages.t("archiveDescendantsTitle")}" @click=${() => { this.openMenuSessionId = undefined; this.confirmArchiveWithDescendants(session, descendantCount); }}>${t("ui.main.6844d936c280", "Archive with descendants (")}${descendantCount}）</button>` : null}
                    ` : null}
                    ${session.parentSessionPath !== undefined ? html`<button class="ui-button ui-menu-item" title="${sessionNavigationMessages.t("detach")}" @click=${() => { this.openMenuSessionId = undefined; this.onDetachParent?.(session); }}>${sessionNavigationMessages.t("detach")}</button>` : null}
                    ${canReloadSession ? html`<button class="ui-button ui-menu-item" title=${isWorking ? sessionNavigationMessages.t("stopBeforeReload") : t("ui.sessionList.reloadTheSessionFromDiskWithoutRefreshingPi", "Reload the session from disk without refreshing Pi runtime resources")} ?disabled=${isWorking} @click=${() => { this.openMenuSessionId = undefined; this.onReload?.(session); }}>${sessionNavigationMessages.t("reload")}</button>` : null}
                  `}
              ${renderCopyIdAction("session", session.id, () => { this.openMenuSessionId = undefined; })}
            </div>
          ` : null}
        </div>
      </div>
      ${agentChildCount > 0 ? html`<button class="agent-subsession-toggle ui-nav-row-disclosure" style=${`--depth:${String(cappedDepth)};--agent-offset:${String(agentOffset)}px`} aria-expanded=${String(this.expandedAgentParents.has(session.id))} @click=${() => { this.toggleAgentParent(session.id); }}><span class="agent-subsession-label">${this.expandedAgentParents.has(session.id) ? "▾" : "▸"} ${sessionNavigationMessages.t("agentSubsessions", { count: agentChildCount })}</span>${!this.expandedAgentParents.has(session.id) && agentAttention !== undefined ? renderActionActivityIndicator(agentAttention.kind, agentAttention.kind === "sending" ? sessionNavigationMessages.t("sendingSubsession") : sessionNavigationMessages.t("activeSubsessions"), agentAttention.unread ? sessionNavigationMessages.t("unreadSubsession") : undefined) : null}</button>` : null}
    `;
  }

  private renderPinMoveActions(row: SessionRow) {
    const roots = this.visibleSessionTree().pinnedRootIds;
    const index = roots.indexOf(row.session.id);
    if (this.onMovePin === undefined || index < 0) return null;
    return html`
      <button class="ui-button ui-menu-item" data-pin-move ?disabled=${index === 0} @click=${() => { this.onMovePin?.(row.session, -1); }}>${sessionNavigationMessages.t("moveUp")}</button>
      <button class="ui-button ui-menu-item" data-pin-move ?disabled=${index === roots.length - 1} @click=${() => { this.onMovePin?.(row.session, 1); }}>${sessionNavigationMessages.t("moveDown")}</button>
    `;
  }

  /**
   * Leading marker stating that the row is a child of another session. Orphan
   * children (a recorded parent that is not in this list) render at depth 0 and
   * would otherwise look like roots, so they keep the same child glyph, dimmed
   * to signal that the parent itself is not shown here. Where that parent lives
   * signals that the parent is not available in this workspace.
   */
  private renderRowMarker(row: SessionRow) {
    if (row.hasMissingParent) {
      return html`<span class="tree-marker orphan-marker" title=${ORPHAN_PARENT_TITLE} aria-label=${ORPHAN_PARENT_TITLE}>↳</span>`;
    }
    return row.depth > 0 ? html`<span class="tree-marker">↳</span>` : null;
  }

  /** Badges live outside `.action-name` so the clamped title cannot hide them. */
  private renderRowBadges(row: SessionRow) {
    if (row.depth <= 2) return null;
    return html`<span class="row-badges"><span class="badge">depth ${row.depth}</span></span>`;
  }

  private handleSessionKeydown(event: KeyboardEvent, session: SessionInfo, scope: SessionSelectionScope): void {
    handleSelectableRowKeyboard(event, {
      activate: () => { this.activateSessionRow(session, scope); },
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  private activateSessionRow(session: SessionInfo, scope: SessionSelectionScope): void {
    if (this.selectionScopes.has(scope) && sessionSelectionScope(session) === scope) {
      this.toggleSelected(session.id);
      return;
    }
    this.onSelect?.(session);
  }

  private renameSession(session: SessionInfo): void {
    this.openMenuSessionId = undefined;
    const name = sessionRenameInput(session);
    if (name !== undefined) void this.onRename?.(session, name);
  }

  private confirmArchiveWithDescendants(session: SessionInfo, descendantCount: number): void {
    if (confirm(sessionNavigationMessages.t("confirmArchive", { label: sessionLabel(session), count: descendantCount }))) this.onArchiveWithDescendants?.(session);
  }

  private confirmDeleteArchived(session: SessionInfo): void {
    if (!this.canDeleteArchived) return;
    if (confirm(sessionNavigationMessages.t("confirmDelete", { label: sessionLabel(session) }))) void this.onDeleteArchived?.(session);
  }

  private confirmDeleteSelectedArchived(): void {
    if (!this.canDeleteArchived) return;
    const archived = this.selectedSessions("archived");
    if (archived.length === 0) return;
    if (!confirm(sessionNavigationMessages.t("confirmDeleteSelected", { count: archived.length }))) return;
    this.selectedSessionIds = removeSessionIds(this.selectedSessionIds, archived.map((session) => session.id));
    void this.onDeleteArchivedMany?.(archived);
  }

  private markSelectedCurrentRead(): void {
    const unreadSelected = this.selectedSessions("current").filter((session) => this.unreadSessionIds.has(session.id));
    if (unreadSelected.length === 0) return;
    void this.onMarkReadMany?.(unreadSelected);
  }

  private archiveSelectedCurrent(): void {
    const sessions = this.selectedSessions("current").filter((session) => isArchivableSessionInfo(session, this.statuses[session.id], this.sessionPersistenceOptions()));
    this.selectedSessionIds = removeSessionIds(this.selectedSessionIds, sessions.map((session) => session.id));
    void this.onArchiveMany?.(sessions);
  }

  private toggleSelection(scope: SessionSelectionScope, visibleSessions: SessionInfo[]): void {
    if (this.selectionScopes.has(scope)) {
      this.closeSelection(scope);
      return;
    }
    this.startSelection(scope, visibleSessions);
  }

  private startSelection(scope: SessionSelectionScope, visibleSessions: SessionInfo[]): void {
    this.selectionScopes = new Set([...this.selectionScopes, scope]);
    const onlyVisibleSession = visibleSessions.length === 1 ? visibleSessions[0] : undefined;
    if (onlyVisibleSession !== undefined) this.selectedSessionIds = this.includeCollapsedChildren(new Set([...this.selectedSessionIds, onlyVisibleSession.id]));
  }

  private closeSelection(scope: SessionSelectionScope): void {
    this.selectionScopes = new Set([...this.selectionScopes].filter((candidate) => candidate !== scope));
    this.clearSelection(scope);
  }

  private clearSelection(scope: SessionSelectionScope): void {
    const sessionIds = this.sessions.filter((session) => sessionSelectionScope(session) === scope).map((session) => session.id);
    this.selectedSessionIds = removeSessionIds(this.selectedSessionIds, sessionIds);
  }

  private toggleSelected(sessionId: string): void {
    const group = this.includeCollapsedChildren(new Set([sessionId]));
    const selected = this.selectedSessionIds.has(sessionId);
    const next = new Set(this.selectedSessionIds);
    for (const id of group) {
      if (selected) next.delete(id);
      else next.add(id);
    }
    this.selectedSessionIds = next;
  }

  private selectVisibleSessions(sessions: SessionInfo[]): void {
    this.selectedSessionIds = this.includeCollapsedChildren(new Set([...this.selectedSessionIds, ...sessions.map((session) => session.id)]));
  }

  private selectedSessions(scope: SessionSelectionScope): SessionInfo[] {
    return this.sessions.filter((session) => this.selectedSessionIds.has(session.id) && sessionSelectionScope(session) === scope);
  }

  private pruneSelectedSessionIds(): void {
    const existing = new Set(this.sessions.map((session) => session.id));
    const next = new Set([...this.selectedSessionIds].filter((sessionId) => existing.has(sessionId)));
    if (next.size !== this.selectedSessionIds.size) this.selectedSessionIds = next;
    this.selectedSessionIds = this.includeCollapsedChildren(this.selectedSessionIds);
    if (this.selectionScopes.has("archived") && !this.sessions.some((session) => session.archived === true)) this.closeSelection("archived");
    if (this.selectionScopes.has("current") && !this.sessions.some((session) => session.archived !== true)) this.closeSelection("current");
  }

  private toggleMenu(sessionId: string, target: EventTarget | null) {
    if (this.openMenuSessionId === sessionId) {
      this.openMenuSessionId = undefined;
      return;
    }
    this.menuAnchor = target instanceof HTMLElement ? target : undefined;
    this.openMenuSessionId = sessionId;
  }

  private toggleArchived() {
    this.archivedExpanded = !this.archivedExpanded;
    if (!this.archivedExpanded) {
      this.openMenuSessionId = undefined;
      if (this.selectionScopes.has("archived")) this.closeSelection("archived");
      this.onArchivedCollapsed?.();
    }
  }

  private renderLoadMoreSentinel(scope: SessionSelectionScope, visibleCount: number, totalCount: number) {
    if (visibleCount >= totalCount) return null;
    const remaining = totalCount - visibleCount;
    return html`
      <div class="session-load-more-sentinel">
        <button class="ui-button" data-load-scope=${scope} @click=${() => { this.loadMore(scope); }}>${t("ui.sessionList.loadMoreCount", "Load more ({count} remaining)", { count: remaining })}</button>
      </div>
    `;
  }

  private loadMore(scope: SessionSelectionScope): void {
    if (scope === "current") this.currentVisibleLimit += SESSION_LIST_BATCH_SIZE;
    else this.archivedVisibleLimit += SESSION_LIST_BATCH_SIZE;
  }

  private observeLoadMoreSentinels(): void {
    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = undefined;
    if (typeof IntersectionObserver === "undefined" || this.listBody === undefined) return;
    const observer = new IntersectionObserver((entries) => {
      if (this.loadMoreObserver !== observer || !this.isConnected) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const scope = entry.target.getAttribute("data-load-scope");
        if (scope === "current") this.loadMore("current");
        else if (scope === "archived" && !this.hasMoreCurrentRows()) this.loadMore("archived");
      }
    }, { root: this.externalScroll ? null : this.listBody, rootMargin: "0px 0px 160px" });
    for (const sentinel of this.renderRoot.querySelectorAll<HTMLElement>("[data-load-scope]")) observer.observe(sentinel);
    this.loadMoreObserver = observer;
  }

  private hasMoreCurrentRows(): boolean {
    return this.visibleSessionTree().currentRows.length > this.currentVisibleLimit;
  }

  private expandVisibleLimitForSelected(): void {
    const selected = this.selected;
    if (selected === undefined) return;
    const currentRows = this.visibleSessionTree().currentRows;
    const currentIndex = currentRows.findIndex((row) => row.session.id === selected.id);
    if (currentIndex >= 0) {
      this.currentVisibleLimit = Math.max(this.currentVisibleLimit, currentIndex + 1);
      return;
    }
    const currentRowIds = new Set(currentRows.map((row) => row.session.id));
    const archivedRows = sessionRows(this.sessions.filter((session) => session.archived === true && !currentRowIds.has(session.id)), this.pinnedSessionIds);
    const archivedIndex = archivedRows.findIndex((row) => row.session.id === selected.id);
    if (archivedIndex < 0) return;
    this.currentVisibleLimit = Math.max(this.currentVisibleLimit, currentRows.length);
    this.archivedVisibleLimit = Math.max(this.archivedVisibleLimit, archivedIndex + 1);
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  private sessionMetaState(session: SessionInfo, status: SessionStatus | undefined, activity: SessionActivity | undefined) {
    if (isTransientNewSessionInfo(session, status, this.sessionPersistenceOptions())) {
      if (activity?.phase === "active") return "creating";
      if (activity?.phase === "error") return "error";
      if (activity?.phase === "idle") return "other";
      return "new";
    }
    if (session.archived === true) return "archived";
    return "other";
  }

  private sessionPersistenceOptions() {
    return { authoritative: this.authoritativeSessionPersistence };
  }

  private renderActivity(kind: ActivityIndicatorKind | undefined, unread: boolean) {
    const label = kind === "sending" ? sessionNavigationMessages.t("sending") : sessionNavigationMessages.t("active");
    return renderActionActivityIndicator(kind, label, unread ? sessionNavigationMessages.t("unreadActivity") : undefined);
  }

  static override styles = [listStyles, sidebarListStyles, css`
    @layer pi-web-base {
    /* Keep positioned/animated session content in the scroller's paint hierarchy. */
    .list-body { isolation: isolate; }
    .action-main { padding: 10px; padding-inline-start: calc(19px + var(--depth, 0) * 16px); text-align: start; }
    .tree-marker { margin: 0; margin-inline-end: 5px; }
    .subheading.ui-toolbar { margin-top: 0; }
    .session-heading { flex-wrap: wrap; align-items: center; }
    .session-heading > .section-toggle { width: auto; min-width: 64px; }
    .plain-heading { flex: 1 1 auto; align-self: center; padding: 6px 10px; }
    .session-heading-actions { margin-inline-start: auto; }
    h2 > .section-count { flex: 0 0 auto; align-self: center; padding-inline: 6px; display: inline; color: var(--pi-muted); font-size: inherit; }
    h2 > .section-unread-count { flex: 0 0 auto; align-self: center; padding-inline: 6px; display: inline; color: var(--pi-accent); font-size: inherit; text-transform: none; }
    .bulk-select-entry, .start-session-button, .cleanup-entry { flex: 0 0 auto; text-transform: none; }
    .bulk-row { flex-wrap: wrap; }
    .bulk-row button { white-space: nowrap; }
    .bulk-actions { margin-inline-start: auto; }
    .bulk-row small { display: inline; min-width: 0; color: var(--pi-muted); }
    .action-name, .section-selected { text-align: start; unicode-bidi: plaintext; }
    .action-name { display: block; max-height: none; line-height: normal; white-space: nowrap; text-overflow: ellipsis; }
    .action-row.unread .action-name { color: var(--pi-text-bright); font-weight: 650; }
    .action-row { content-visibility: auto; contain-intrinsic-size: auto 58px; }
    .action-row.menu-open { content-visibility: visible; }
    .session-load-more-sentinel { display: grid; place-items: center; min-height: 36px; margin: 2px 0 6px; }
    .session-load-more-sentinel button { padding: 5px 9px; color: var(--pi-muted); font-size: 12px; }
     .plain-heading { min-width: 0; }
    .session-search { flex: 0 0 auto; font-size: 19px; text-transform: none; }
     .pin-indicator { margin-inline-end: 5px; color: var(--pi-accent); font-size: 11px; }
    .session-secondary { display: flex; align-items: baseline; gap: 5px; min-width: 0; margin-top: 3px; }
    .session-meta, .session-label-separator { flex: 0 0 auto; }
    .session-labels { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
    .session-label-item, .session-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    a.session-label-item { color: var(--pi-accent); text-decoration: none; }
    a.session-label-item:hover, a.session-label-item:focus { text-decoration: underline; }
    .session-label-render > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .action-name-line { min-width: 0; display: flex; align-items: flex-start; gap: 6px; }
    .action-name-line .action-name { flex: 1 1 auto; min-width: 0; }
    /* Badges must not sit inside the line-clamped title, or a long name hides them entirely. */
    .row-badges { flex: 0 0 auto; display: flex; align-items: flex-start; gap: 4px; }
    .row-badges .badge { margin: 0; white-space: nowrap; }
    /* Same glyph as a normal child marker, dimmed: the row is a child whose parent is not displayed here. */
    .orphan-marker { color: var(--pi-dim); opacity: .65; }
    .bulk-row .capability-hint { flex: 1 0 100%; color: var(--pi-warning); }
    .selection-toolbar { position: sticky; top: 0; z-index: 4; background: var(--pi-bg); border-bottom: 1px solid var(--pi-border-muted); box-shadow: ${scrollBoundaryShadow}; }
    .action-row.has-agent-subsessions { margin-bottom: 0; border-bottom: 0; }
    .action-row.has-agent-subsessions .action-main { padding-bottom: 6px; }
    .agent-subsession-toggle { position: relative; display: flex; align-items: center; gap: 6px; box-sizing: border-box; width: 100%; min-height: 24px; margin: 0; padding-block: 2px; padding-inline: calc(35px + var(--agent-offset, 0px) + var(--depth, 0) * 16px) 16px; border: 0; border-radius: 0; background: transparent; font: 12px/20px var(--pi-font, system-ui, sans-serif); text-align: start; color: var(--pi-muted); overflow: hidden; }
    .agent-subsession-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-subsession-toggle::before { content: ""; position: absolute; top: 0; bottom: 50%; inset-inline-start: calc(19px + var(--agent-offset, 0px) + var(--depth, 0) * 16px); width: 10px; border-inline-start: 1px solid var(--pi-border-muted); border-bottom: 1px solid var(--pi-border-muted); pointer-events: none; }
    .agent-subsession-toggle .action-activity { pointer-events: none; }
    /* The disclosure closes a collapsed group; an expanded group's final row owns its separator. */
    .agent-subsession-toggle[aria-expanded="false"]:not(:last-child) { box-shadow: inset 0 -1px var(--pi-border-muted); }
    .action-row.linked-agent-child .action-main { padding-inline-start: calc(19px + var(--agent-offset) + var(--depth, 0) * 16px); }
    .agent-subsession-toggle:hover, .agent-subsession-toggle:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); }
    .agent-subsession-toggle:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    button.danger, .action-menu-panel button.danger { color: var(--pi-danger); }
    button.danger:hover, .action-menu-panel button.danger:hover { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    .action-row.bulk-selected { box-shadow: inset 3px 0 0 var(--pi-accent); }
    .pending-session-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); margin: 0; padding: 3px 10px; cursor: default; }
    .pending-session-row.starting-session .action-main { border-radius: 0; border-style: dashed; border-color: var(--pi-border); color: var(--pi-muted); }
    .pending-session-row.starting-session .action-name { display: flex; align-items: center; gap: 6px; max-height: none; -webkit-line-clamp: 1; }
    .pending-session-row.starting-session .activity-indicator { flex: 0 0 auto; margin: 0; }
    .action-main.selecting, .action-row.linked-agent-child .action-main.selecting { padding-inline-start: calc(48px + var(--depth, 0) * 16px + var(--agent-offset, 0px)); }
    .session-checkbox { position: absolute; top: 9px; inset-inline-start: calc(24px + var(--depth, 0) * 16px + var(--agent-offset, 0px)); z-index: 2; margin: 0; }

    }
  `];
}

export function unreadSessionCount(
  sessions: readonly SessionInfo[],
  unreadSessionIds: ReadonlySet<string>,
): number {
  if (unreadSessionIds.size === 0) return 0;
  return sessions.filter((session) => sessionRowUnread(session, unreadSessionIds)).length;
}

export function sessionRenameInput(session: SessionInfo): string | undefined {
  const name = globalThis.prompt(t("ui.sessionList.renameSession", "Rename session"), sessionLabel(session));
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function isRenamableSession(
  session: SessionInfo | undefined,
  status?: SessionStatus,
  options?: Parameters<typeof isArchivableSessionInfo>[2],
): boolean {
  return isArchivableSessionInfo(session, status, options);
}

/** Plain-text count of children living in other workspaces, or undefined when there are none. */
function sessionSelectionScope(session: SessionInfo): SessionSelectionScope {
  return session.archived === true ? "archived" : "current";
}

function removeSessionIds(sessionIds: ReadonlySet<string>, removedIds: readonly string[]): ReadonlySet<string> {
  const removed = new Set(removedIds);
  return new Set([...sessionIds].filter((sessionId) => !removed.has(sessionId)));
}

function unarchivedDescendantCounts(sessions: SessionInfo[]): Map<string, number> {
  const childrenByParentPath = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (session.parentSessionPath === undefined) continue;
    const parentKey = normalizeSessionPath(session.parentSessionPath);
    const children = childrenByParentPath.get(parentKey) ?? [];
    children.push(session);
    childrenByParentPath.set(parentKey, children);
  }

  const countFor = (session: SessionInfo, seenPaths: Set<string>): number => {
    const sessionKey = normalizeSessionPath(session.path);
    if (seenPaths.has(sessionKey)) return 0;
    const nextSeenPaths = new Set(seenPaths);
    nextSeenPaths.add(sessionKey);
    let count = 0;
    for (const child of childrenByParentPath.get(sessionKey) ?? []) {
      if (nextSeenPaths.has(normalizeSessionPath(child.path))) continue;
      if (child.archived !== true) count += 1;
      count += countFor(child, nextSeenPaths);
    }
    return count;
  };

  return new Map(sessions.map((session) => [session.id, countFor(session, new Set())]));
}


export function unarchivedDescendantCount(sessions: SessionInfo[], root: SessionInfo): number {
  const childrenByParentPath = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (session.parentSessionPath === undefined) continue;
    const parentKey = normalizeSessionPath(session.parentSessionPath);
    const children = childrenByParentPath.get(parentKey) ?? [];
    children.push(session);
    childrenByParentPath.set(parentKey, children);
  }

  const countFor = (session: SessionInfo, seenPaths: Set<string>): number => {
    const sessionKey = normalizeSessionPath(session.path);
    if (seenPaths.has(sessionKey)) return 0;
    const nextSeenPaths = new Set(seenPaths);
    nextSeenPaths.add(sessionKey);
    let count = 0;
    for (const child of childrenByParentPath.get(sessionKey) ?? []) {
      if (nextSeenPaths.has(normalizeSessionPath(child.path))) continue;
      if (child.archived !== true) count += 1;
      count += countFor(child, nextSeenPaths);
    }
    return count;
  };

  return countFor(root, new Set());
}

function sessionsRenderEqual(previous: unknown, current: SessionInfo[]): boolean {
  if (!Array.isArray(previous) || previous.length !== current.length) return false;
  return current.every((session, index) => sessionInfoRenderKey(session) === sessionInfoRenderKey(previous[index]));
}

function sessionInfoRenderKey(session: unknown): string {
  if (!isSessionInfo(session)) return "";
  return JSON.stringify([
    session.id, session.path, session.cwd, session.name, session.firstMessage, session.messageCount,
    session.modified, session.archived, session.archivedAt, session.persisted, session.parentSessionPath, session.agentSubsession,
  ]);
}

function selectedSessionRenderEqual(previous: unknown, current: SessionInfo | undefined): boolean {
  if (previous === undefined || current === undefined) return previous === current;
  return sessionInfoRenderKey(previous) === sessionInfoRenderKey(current);
}

function sessionRuntimeMapRenderEqual(
  previous: unknown,
  current: Record<string, SessionStatus> | Record<string, SessionActivity>,
  companion: Record<string, SessionActivity> | Record<string, SessionStatus>,
  sending: Record<string, true>,
  sessions: SessionInfo[],
  authoritativePersistence: boolean,
  changedKind: "status" | "activity",
): boolean {
  if (!isRecord(previous)) return false;
  for (const session of sessions) {
    const oldStatus = changedKind === "status" ? sessionStatusAt(previous, session.id) : sessionStatusAt(companion, session.id);
    const newStatus = changedKind === "status" ? sessionStatusAt(current, session.id) : sessionStatusAt(companion, session.id);
    const oldActivity = changedKind === "activity" ? sessionActivityAt(previous, session.id) : sessionActivityAt(companion, session.id);
    const newActivity = changedKind === "activity" ? sessionActivityAt(current, session.id) : sessionActivityAt(companion, session.id);
    const oldKey = sessionRuntimeRenderKey(session, oldStatus, oldActivity, sending[session.id] === true, authoritativePersistence);
    const newKey = sessionRuntimeRenderKey(session, newStatus, newActivity, sending[session.id] === true, authoritativePersistence);
    if (oldKey !== newKey) return false;
  }
  return true;
}

function sessionRuntimeRenderKey(session: SessionInfo, status: SessionStatus | undefined, activity: SessionActivity | undefined, sending: boolean, authoritativePersistence: boolean): string {
  return JSON.stringify([
    sessionRowActivityKind(session, status, activity, sending),
    activity?.phase,
    sessionPersistenceState(session, status, { authoritative: authoritativePersistence }),
  ]);
}

function isSessionInfo(value: unknown): value is SessionInfo {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["path"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sessionStatusAt(value: unknown, sessionId: string): SessionStatus | undefined {
  if (!isRecord(value)) return undefined;
  const status = value[sessionId];
  return isSessionStatus(status) ? status : undefined;
}

function sessionActivityAt(value: unknown, sessionId: string): SessionActivity | undefined {
  if (!isRecord(value)) return undefined;
  const activity = value[sessionId];
  return isSessionActivity(activity) ? activity : undefined;
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return isRecord(value)
    && typeof value["sessionId"] === "string"
    && typeof value["isStreaming"] === "boolean"
    && typeof value["isCompacting"] === "boolean"
    && typeof value["isBashRunning"] === "boolean"
    && typeof value["pendingMessageCount"] === "number"
    && Array.isArray(value["queuedMessages"])
    && isRecord(value["tokens"])
    && typeof value["cost"] === "number";
}

function isSessionActivity(value: unknown): value is SessionActivity {
  return isRecord(value)
    && typeof value["sessionId"] === "string"
    && (value["phase"] === "active" || value["phase"] === "idle" || value["phase"] === "error")
    && typeof value["label"] === "string"
    && typeof value["at"] === "string";
}

/**
 * Resolve the activity indicator kind for a session row, or undefined when the
 * row should show no work dot. Pure so it can be unit-tested without rendering.
 *
 * Intervention takes priority over work. "sending" (client-side upload in flight)
 * takes precedence over ordinary server activity, so it can be colored distinctly to
 * signal that it is not yet propagated to workspace/machine activity. Unread
 * is not a kind: it is an attention flag resolved by `sessionRowUnread` and
 * rendered as a ring around this dot (or a filled dot when this is undefined).
 */
export function sessionRowActivityKind(
  session: SessionInfo,
  status: SessionStatus | undefined,
  activity: SessionActivity | undefined,
  sending: boolean,
  sessionFlags?: Readonly<Record<string, StatusFlags>>,
): ActivityIndicatorKind | undefined {
  if (isCachedNewSessionInfo(session) || session.archived === true) return undefined;
  // Complete snapshots own navigation state, including absent/cleared flags.
  // Live status and persisted listings support daemons without that projection.
  const intervention = sessionFlags !== undefined
    ? sessionFlags[session.id]?.[CORE_STATUS_FLAGS.interventionRequired] === true
    : (status?.sessionId === session.id ? status.interventionRequired : undefined) ?? session.interventionRequired;
  if (intervention === true) return "intervention-required";
  if (sending) return "sending";
  return sessionRowIsWorking(session, status, activity, sessionFlags) ? "session" : undefined;
}

function sessionRowIsWorking(
  session: SessionInfo,
  status: SessionStatus | undefined,
  activity: SessionActivity | undefined,
  sessionFlags?: Readonly<Record<string, StatusFlags>>,
): boolean {
  // The complete daemon projection owns navigation activity. Live chat events
  // are only a compatibility fallback, not a second writer of this state.
  return sessionFlags === undefined
    ? isSessionActive(status, activity)
    : sessionFlags[session.id]?.[CORE_STATUS_FLAGS.working] === true;
}

/**
 * Whether a session row carries the unread attention flag. Cached-new and
 * archived sessions can never be unread: they have no server-side unread
 * completions to acknowledge.
 */
export function sessionRowUnread(session: SessionInfo, unreadSessionIds: ReadonlySet<string>): boolean {
  if (isCachedNewSessionInfo(session) || session.archived === true) return false;
  return unreadSessionIds.has(session.id);
}

/**
 * Index sessions by their normalized path. Parent links can arrive from a
 * different server producer than the listing itself (a `session.created`
 * broadcast carries the live runtime's file path), so keys are normalized to
 * keep tree building from silently missing a link.
 */
function sessionsByNormalizedPath(sessions: readonly SessionInfo[]): Map<string, SessionInfo> {
  return new Map(sessions.map((session) => [normalizeSessionPath(session.path), session]));
}

export function sessionRowsForCurrentTree(sessions: SessionInfo[], pinnedSessionIds: readonly string[] = []): SessionRow[] {
  const byPath = sessionsByNormalizedPath(sessions);
  const visible = new Set<string>();
  for (const session of sessions) {
    if (session.archived === true) continue;
    visible.add(session.id);
    let parentKey = session.parentSessionPath === undefined ? undefined : normalizeSessionPath(session.parentSessionPath);
    const seenPaths = new Set<string>([normalizeSessionPath(session.path)]);
    while (parentKey !== undefined && !seenPaths.has(parentKey)) {
      seenPaths.add(parentKey);
      const parent = byPath.get(parentKey);
      if (parent === undefined) break;
      visible.add(parent.id);
      parentKey = parent.parentSessionPath === undefined ? undefined : normalizeSessionPath(parent.parentSessionPath);
    }
  }
  return sessionRows(sessions.filter((session) => visible.has(session.id)), pinnedSessionIds);
}

function sessionRows(sessions: SessionInfo[], pinnedSessionIds: readonly string[] = []): SessionRow[] {
  const byPath = sessionsByNormalizedPath(sessions);
  const childrenByPath = new Map<string, SessionInfo[]>();
  const roots: SessionInfo[] = [];
  for (const session of sessions) {
    const parentPath = session.parentSessionPath;
    const parent = parentPath === undefined ? undefined : byPath.get(normalizeSessionPath(parentPath));
    if (parent === undefined) {
      roots.push(session);
      continue;
    }
    const parentKey = normalizeSessionPath(parent.path);
    const children = childrenByPath.get(parentKey) ?? [];
    children.push(session);
    childrenByPath.set(parentKey, children);
  }

  const pinned = new Set(pinnedSessionIds);
  const originalOrder = new Map(sessions.map((session, index) => [normalizeSessionPath(session.path), index]));
  const containsPinnedMemo = new Map<string, boolean>();
  const containsPinned = (session: SessionInfo, stack: Set<string>): boolean => {
    if (pinned.has(session.id)) return true;
    const sessionKey = normalizeSessionPath(session.path);
    const cached = containsPinnedMemo.get(sessionKey);
    if (cached !== undefined) return cached;
    if (stack.has(sessionKey)) return false;
    const nextStack = new Set(stack);
    nextStack.add(sessionKey);
    const result = (childrenByPath.get(sessionKey) ?? []).some((child) => containsPinned(child, nextStack));
    containsPinnedMemo.set(sessionKey, result);
    return result;
  };
  const compareSessions = (left: SessionInfo, right: SessionInfo): number => {
    const pinnedOrder = Number(containsPinned(right, new Set())) - Number(containsPinned(left, new Set()));
    if (pinnedOrder !== 0) return pinnedOrder;
    const modifiedOrder = right.modified.localeCompare(left.modified);
    if (modifiedOrder !== 0) return modifiedOrder;
    return (originalOrder.get(normalizeSessionPath(left.path)) ?? 0) - (originalOrder.get(normalizeSessionPath(right.path)) ?? 0);
  };

  const rows: SessionRow[] = [];
  const visit = (session: SessionInfo, depth: number, stack: Set<string>) => {
    const sessionKey = normalizeSessionPath(session.path);
    if (stack.has(sessionKey)) return;
    const parentPath = session.parentSessionPath;
    rows.push({ session, depth, hasMissingParent: parentPath !== undefined && !byPath.has(normalizeSessionPath(parentPath)) });
    const nextStack = new Set(stack);
    nextStack.add(sessionKey);
    for (const child of [...(childrenByPath.get(sessionKey) ?? [])].sort((a, b) => Number(b.agentSubsession === true) - Number(a.agentSubsession === true) || compareSessions(a, b))) visit(child, depth + 1, nextStack);
  };
  for (const root of roots.sort(compareSessions)) visit(root, 0, new Set());
  return rows;
}

export function pinnedSessionRootIds(sessions: readonly SessionInfo[], pinnedSessionIds: readonly string[]): string[] {
  const rows = sessionRowsForCurrentTree([...sessions], pinnedSessionIds);
  return pinnedSessionRows(rows, [...pinnedRootMembers(rows, pinnedSessionIds)]).pinnedRootIds;
}

export function orderedPinnedSessionRootIds(sessions: readonly SessionInfo[], pins: readonly string[]): string[] {
  const rows = sessionRowsForCurrentTree([...sessions], pins);
  const roots = new Map<string, string>();
  let root: string | undefined;
  for (const row of rows) {
    if (row.depth === 0) root = row.session.id;
    if (root !== undefined) roots.set(row.session.id, root);
  }
  const order = pins.flatMap((id) => roots.get(id) ?? []);
  return pinnedSessionRows(rows, order).pinnedRootIds;
}

function pinnedRootMembers(rows: readonly SessionRow[], pins: readonly string[]): ReadonlySet<string> {
  const members = new Set(pins);
  const roots = new Set<string>();
  let root: string | undefined;
  for (const row of rows) {
    if (row.depth === 0) root = row.session.id;
    if (root !== undefined && members.has(row.session.id)) roots.add(root);
  }
  return roots;
}

interface AgentAttention {
  kind: ActivityIndicatorKind | undefined;
  unread: boolean;
}

function isPinnableRoot(row: SessionRow): boolean {
  return row.depth === 0 && !row.hasMissingParent && row.session.parentSessionPath === undefined && row.session.archived !== true;
}

export function pinnedSessionRows(rows: readonly SessionRow[], pinIds: readonly string[]): {
  rows: SessionRow[];
  pinnedRootIds: string[];
  pinnedRowCount: number;
} {
  const trees: SessionRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || trees.length === 0) trees.push([]);
    trees[trees.length - 1]?.push(row);
  }
  const eligible = new Map(trees.flatMap((tree) => {
    const root = tree[0];
    return root !== undefined && isPinnableRoot(root) ? [[root.session.id, tree] as const] : [];
  }));
  const pinnedRootIds = [...new Set(pinIds)].filter((id) => eligible.has(id));
  const pinned = new Set(pinnedRootIds);
  const pinnedRows = pinnedRootIds.flatMap((id) => eligible.get(id) ?? []);
  return {
    rows: [...pinnedRows, ...trees.filter((tree) => !pinned.has(tree[0]?.session.id ?? "")).flat()],
    pinnedRootIds,
    pinnedRowCount: pinnedRows.length,
  };
}

export function agentChildOffsets(rows: readonly SessionRow[], groups: AgentSessionGroups): ReadonlyMap<string, number> {
  const offsets = new Map<string, number>();
  for (const { session } of rows) {
    const parent = groups.parentByAgentId.get(session.id);
    if (parent !== undefined) offsets.set(session.id, (offsets.get(parent) ?? 0) + 12);
  }
  return offsets;
}

export interface AgentSessionGroups {
  parentByAgentId: ReadonlyMap<string, string>;
  countByParentId: ReadonlyMap<string, number>;
}

export function agentSessionGroups(rows: readonly SessionRow[]): AgentSessionGroups {
  const byPath = sessionsByNormalizedPath(rows.map((row) => row.session));
  const parentByAgentId = new Map<string, string>();
  const countByParentId = new Map<string, number>();
  for (const { session } of rows) {
    if (session.agentSubsession !== true || session.parentSessionPath === undefined) continue;
    const parent = byPath.get(normalizeSessionPath(session.parentSessionPath));
    if (parent === undefined || parent.id === session.id) continue;
    parentByAgentId.set(session.id, parent.id);
    countByParentId.set(parent.id, (countByParentId.get(parent.id) ?? 0) + 1);
  }
  return { parentByAgentId, countByParentId };
}

export function sessionNavigationCandidates(sessions: SessionInfo[], options: {
  collapsed?: boolean;
  expandedAgentParents?: ReadonlySet<string>;
  archivedExpanded?: boolean;
} = {}): SessionInfo[] {
  if (options.collapsed === true) return [];
  const expanded = options.expandedAgentParents ?? new Set<string>();
  const currentRows = sessionRowsForCurrentTree(sessions);
  const visibleIds = new Set(visibleAgentSessionRows(currentRows, expanded).map((row) => row.session.id));
  if (options.archivedExpanded === true) {
    const currentIds = new Set(currentRows.map((row) => row.session.id));
    const archivedRows = sessionRows(sessions.filter((session) => session.archived === true && !currentIds.has(session.id)));
    for (const row of visibleAgentSessionRows(archivedRows, expanded)) visibleIds.add(row.session.id);
  }
  return sessions.filter((session) => visibleIds.has(session.id));
}

export function visibleAgentSessionRows(
  rows: readonly SessionRow[],
  expandedParents: ReadonlySet<string>,
  groups: AgentSessionGroups = agentSessionGroups(rows),
): SessionRow[] {
  const hidden = new Set<string>();
  return rows.filter((row) => {
    const parentId = groups.parentByAgentId.get(row.session.id);
    if (parentId === undefined) return true;
    if (!hidden.has(parentId) && expandedParents.has(parentId)) return true;
    hidden.add(row.session.id);
    return false;
  });
}
