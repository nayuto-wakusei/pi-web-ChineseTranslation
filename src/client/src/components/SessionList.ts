import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { isCachedNewSessionInfo } from "../cachedNewSessions";
import { isSessionActive } from "../../../shared/activity";
import { actionMenuPanelStyle } from "./actionMenu";
import { renderActivityIndicator } from "./activityBadge";
import { activateSelectableRow, activateSelectableRowFromKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  return session.firstMessage !== "" ? session.firstMessage : session.id.slice(0, 8);
}

interface SessionRow {
  session: SessionInfo;
  depth: number;
  hasMissingParent: boolean;
}

@customElement("session-list")
export class SessionList extends LitElement {
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) statuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) activities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) selected?: SessionInfo;
  @property({ type: Boolean }) canStart = false;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (session: SessionInfo) => void;
  @property({ attribute: false }) onStart?: () => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onArchivedCollapsed?: () => void;
  @state() private openMenuSessionId: string | undefined;
  @state() private menuStyle = "";
  @state() private archivedExpanded = false;
  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuSessionId = undefined;
  };
  @property({ attribute: false }) onArchive?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveWithDescendants?: (session: SessionInfo) => void;
  @property({ attribute: false }) onRestore?: (session: SessionInfo) => void;
  @property({ attribute: false }) onDelete?: (session: SessionInfo) => void;
  @property({ attribute: false }) onDetachParent?: (session: SessionInfo) => void;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("sessions") && this.openMenuSessionId !== undefined && !this.sessions.some((session) => session.id === this.openMenuSessionId)) this.openMenuSessionId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuSessionId = undefined;
    if (changed.has("sessions") && !this.sessions.some((session) => session.archived === true)) this.archivedExpanded = false;
    const previousSelected = changed.get("selected");
    if (changed.has("selected") && this.selected?.archived === true && (previousSelected?.id !== this.selected.id || previousSelected.archived !== true) && !this.archivedExpanded) {
      this.archivedExpanded = true;
      void this.updateComplete.then(() => { this.scrollSelectedIntoView(); });
      return;
    }
    if ((changed.has("selected") || changed.has("sessions") || changed.has("collapsed")) && !this.collapsed) this.scrollSelectedIntoView();
  }

  override render() {
    const activeRows = sessionRowsForActiveTree(this.sessions);
    const activeIds = new Set(activeRows.map((row) => row.session.id));
    const archivedRows = sessionRows(this.sessions.filter((session) => session.archived === true && !activeIds.has(session.id)));
    const descendantCounts = unarchivedDescendantCounts(this.sessions);
    return html`
      <section>
        ${this.renderHeading(activeRows.length + archivedRows.length)}
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${activeRows.map((row) => this.renderSession(row, descendantCounts.get(row.session.id) ?? 0))}
            ${archivedRows.length > 0 ? html`
              <h2 class="subheading"><button class="section-toggle" aria-expanded=${String(this.archivedExpanded)} @click=${() => { this.toggleArchived(); }}><span>${this.archivedExpanded ? "▾" : "▸"} 已归档</span><small>${archivedRows.length}</small></button></h2>
              ${this.archivedExpanded ? archivedRows.map((row) => this.renderSession(row, descendantCounts.get(row.session.id) ?? 0)) : null}
            ` : null}
          </div>
        `}
      </section>
    `;
  }

  private renderHeading(sessionCount: number) {
    if (!this.collapsible) return html`<h2>会话 <button ?disabled=${!this.canStart} @click=${() => this.onStart?.()}>+</button></h2>`;
    const selectedSummary = this.selected === undefined ? "未选择会话" : sessionLabel(this.selected);
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`
      <h2>
        <button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} 会话</span><small class="section-selected" title=${selectedTitle}>${selectedSummary}</small></span><small class="section-count">${sessionCount}</small></button>
        <button ?disabled=${!this.canStart} @click=${(event: MouseEvent) => { event.stopPropagation(); this.onStart?.(); }}>+</button>
      </h2>
    `;
  }

  private renderSession(row: SessionRow, descendantCount: number) {
    const { session } = row;
    const cappedDepth = Math.min(row.depth, 2);
    return html`
      <div
        class="action-row ${this.selected?.id === session.id ? "selected" : ""} ${session.archived === true ? "archived" : ""}"
        style=${`--depth:${String(cappedDepth)}`}
        tabindex="0"
        title=${session.path}
        @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(session)); }}
        @keydown=${(event: KeyboardEvent) => { activateSelectableRowFromKeyboard(event, () => this.onSelect?.(session)); }}
      >
        <div class="action-main">
          <span class="action-name">${row.depth > 0 ? html`<span class="tree-marker">↳</span>` : null}${sessionLabel(session)}${row.depth > 2 ? html` <span class="badge">深度 ${row.depth}</span>` : null}${row.hasMissingParent ? html` <span class="badge">父会话不可用</span>` : null}</span><small>${this.renderStatus(session)}${String(session.messageCount)} 条消息</small>
        </div>
        <div class="action-menu">
          <button class="action-menu-toggle" title="会话操作" @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(session.id, event.currentTarget); }}>⋯</button>
          ${this.openMenuSessionId === session.id ? html`
            <div class="action-menu-panel" style=${this.menuStyle}>
              ${session.parentSessionPath !== undefined ? html`<button title="从父会话分离" @click=${() => { this.openMenuSessionId = undefined; this.onDetachParent?.(session); }}>从父会话分离</button>` : null}
              ${isCachedNewSessionInfo(session)
                ? html`<button title="删除浏览器缓存的新会话" @click=${() => { this.openMenuSessionId = undefined; this.onDelete?.(session); }}>删除</button>`
                : session.archived === true
                  ? html`<button title="恢复会话" @click=${() => { this.openMenuSessionId = undefined; this.onRestore?.(session); }}>恢复</button>`
                  : html`
                    <button title="归档会话" @click=${() => { this.openMenuSessionId = undefined; this.onArchive?.(session); }}>归档</button>
                    ${descendantCount > 0 ? html`<button title="归档此会话及其子会话" @click=${() => { this.openMenuSessionId = undefined; this.confirmArchiveWithDescendants(session, descendantCount); }}>连同子会话归档（${descendantCount}）</button>` : null}
                  `}
            </div>
          ` : null}
        </div>
      </div>
    `;
  }

  private confirmArchiveWithDescendants(session: SessionInfo, descendantCount: number): void {
    if (confirm(`归档“${sessionLabel(session)}”及 ${String(descendantCount)} 个子会话？`)) this.onArchiveWithDescendants?.(session);
  }

  private toggleMenu(sessionId: string, target: EventTarget | null) {
    if (this.openMenuSessionId === sessionId) {
      this.openMenuSessionId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target);
    this.openMenuSessionId = sessionId;
  }

  private toggleArchived() {
    this.archivedExpanded = !this.archivedExpanded;
    if (!this.archivedExpanded) {
      this.openMenuSessionId = undefined;
      this.onArchivedCollapsed?.();
    }
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  private renderStatus(session: SessionInfo) {
    if (isCachedNewSessionInfo(session)) return "新建 · ";
    if (session.archived === true) return "只读 · ";
    return renderActivityIndicator(isSessionActive(this.statuses[session.id], this.activities[session.id]) ? "session" : undefined, "会话活跃") ?? "";
  }

  static override styles = listStyles;
}

function unarchivedDescendantCounts(sessions: SessionInfo[]): Map<string, number> {
  const childrenByParentPath = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (session.parentSessionPath === undefined) continue;
    const children = childrenByParentPath.get(session.parentSessionPath) ?? [];
    children.push(session);
    childrenByParentPath.set(session.parentSessionPath, children);
  }

  const countFor = (session: SessionInfo, seenPaths: Set<string>): number => {
    if (seenPaths.has(session.path)) return 0;
    const nextSeenPaths = new Set(seenPaths);
    nextSeenPaths.add(session.path);
    let count = 0;
    for (const child of childrenByParentPath.get(session.path) ?? []) {
      if (nextSeenPaths.has(child.path)) continue;
      if (child.archived !== true) count += 1;
      count += countFor(child, nextSeenPaths);
    }
    return count;
  };

  return new Map(sessions.map((session) => [session.id, countFor(session, new Set())]));
}

function sessionRowsForActiveTree(sessions: SessionInfo[]): SessionRow[] {
  const byPath = new Map(sessions.map((session) => [session.path, session]));
  const visible = new Set<string>();
  for (const session of sessions) {
    if (session.archived === true) continue;
    visible.add(session.id);
    let parentPath = session.parentSessionPath;
    const seen = new Set<string>([session.path]);
    while (parentPath !== undefined && !seen.has(parentPath)) {
      seen.add(parentPath);
      const parent = byPath.get(parentPath);
      if (parent === undefined) break;
      visible.add(parent.id);
      parentPath = parent.parentSessionPath;
    }
  }
  return sessionRows(sessions.filter((session) => visible.has(session.id)));
}

function sessionRows(sessions: SessionInfo[]): SessionRow[] {
  const byPath = new Map(sessions.map((session) => [session.path, session]));
  const childrenByPath = new Map<string, SessionInfo[]>();
  const roots: SessionInfo[] = [];
  for (const session of sessions) {
    const parentPath = session.parentSessionPath;
    const parent = parentPath === undefined ? undefined : byPath.get(parentPath);
    if (parent === undefined) {
      roots.push(session);
      continue;
    }
    const children = childrenByPath.get(parent.path) ?? [];
    children.push(session);
    childrenByPath.set(parent.path, children);
  }

  const rows: SessionRow[] = [];
  const visit = (session: SessionInfo, depth: number, stack: Set<string>) => {
    if (stack.has(session.path)) return;
    const parentPath = session.parentSessionPath;
    rows.push({ session, depth, hasMissingParent: parentPath !== undefined && !byPath.has(parentPath) });
    const nextStack = new Set(stack);
    nextStack.add(session.path);
    for (const child of childrenByPath.get(session.path) ?? []) visit(child, depth + 1, nextStack);
  };
  for (const root of roots) visit(root, 0, new Set());
  return rows;
}
