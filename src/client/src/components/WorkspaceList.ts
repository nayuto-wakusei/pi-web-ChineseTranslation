import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Workspace, WorkspaceActivity } from "../api";
import type { WorkspaceLabelItem } from "../plugins/types";
import { workspaceActivityFor, workspaceActivityIndicator } from "../workspaceActivity";
import { actionMenuPanelStyle } from "./actionMenu";
import { renderActivityIndicator } from "./activityBadge";
import { activateSelectableRow, activateSelectableRowFromKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { renderWorkspaceLabelInlineItems } from "./workspaceLabel";

@customElement("workspace-list")
export class WorkspaceList extends LitElement {
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selected?: Workspace;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) onSelect?: (workspace: Workspace) => void;
  @property({ attribute: false }) onDelete?: (workspace: Workspace) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @state() private openMenuWorkspaceId: string | undefined;
  @state() private menuStyle = "";

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuWorkspaceId = undefined;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("workspaces") && this.openMenuWorkspaceId !== undefined && !this.workspaces.some((workspace) => workspace.id === this.openMenuWorkspaceId)) this.openMenuWorkspaceId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuWorkspaceId = undefined;
    if ((changed.has("selected") || changed.has("workspaces") || changed.has("collapsed")) && !this.collapsed) this.scrollSelectedIntoView();
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.workspaces.map((workspace) => {
              const label = workspacePrimaryLabel(workspace);
              const items = this.workspaceLabelItems(workspace);
              return html`
                <div
                  class=${`action-row workspace-row ${this.selected?.id === workspace.id ? "selected" : ""}`}
                  tabindex="0"
                  title=${label}
                  @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(workspace)); }}
                  @keydown=${(event: KeyboardEvent) => { this.handleWorkspaceKeydown(event, workspace); }}
                >
                  <div class="action-main">
                    ${this.renderWorkspaceMain(label, items, workspace)}
                  </div>
                  ${this.renderWorkspaceMenu(label, items, workspace)}
                </div>
              `;
            })}
          </div>
        `}
      </section>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return "工作区";
    const selectedSummary = this.selected === undefined ? "未选择工作区" : `${this.selected.label}${this.selected.isMain ? " · 主工作区" : ""} · ${this.selected.path}`;
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} 工作区</span><small class="section-selected" title=${selectedTitle}>${selectedSummary}</small></span><small class="section-count">${this.workspaces.length}</small></button>`;
  }

  private renderActivity(workspace: Workspace): TemplateResult | undefined {
    const kind = workspaceActivityIndicator(workspaceActivityFor(workspace, this.activities));
    return renderActivityIndicator(kind, kind === "terminal" ? "工作区终端活跃" : "工作区活跃");
  }

  private renderWorkspaceMain(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    return html`
      <span class="workspace-primary">
        ${this.renderActivity(workspace)}
        <span class="workspace-primary-label">${label}</span>
        ${this.isDeleting(workspace) ? html`<span class="workspace-status">正在删除…</span>` : null}
      </span>
      ${items.length === 0 ? null : html`
        <small class="workspace-secondary">
          <span class="workspace-label">${renderWorkspaceLabelInlineItems(items)}</span>
        </small>
      `}
    `;
  }

  private renderWorkspaceMenu(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    const open = this.openMenuWorkspaceId === workspace.id;
    const menuId = workspaceMenuId(workspace.id);
    return html`
      <div class="action-menu">
        <button
          class="action-menu-toggle"
          title="工作区操作和详情"
          aria-label=${`${label} 的操作和详情`}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(workspace.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div class="action-menu-panel workspace-menu-panel" id=${menuId} style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${this.renderWorkspaceActions(workspace)}
            ${this.renderWorkspaceDetails(label, items, workspace)}
          </div>
        ` : null}
      </div>
    `;
  }

  private renderWorkspaceActions(workspace: Workspace): TemplateResult | undefined {
    if (!canDeleteWorkspace(workspace)) return undefined;
    const deleting = this.isDeleting(workspace);
    return html`
      <div class="workspace-menu-actions">
        <button class="danger" title=${deleting ? "正在删除工作区" : "删除工作区"} ?disabled=${deleting} @click=${() => { this.delete(workspace); }}>${deleting ? "正在删除…" : "删除工作区"}</button>
      </div>
    `;
  }

  private renderWorkspaceDetails(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    return html`
      <dl class="workspace-menu-details">
        <div class="workspace-detail-row">
          <dt>${workspace.branch === undefined ? "工作区" : "分支"}</dt>
          <dd>${label}</dd>
        </div>
        <div class="workspace-detail-row">
          <dt>路径</dt>
          <dd title=${workspace.path}>${workspace.path}</dd>
        </div>
        ${items.length === 0 ? null : html`
          <div class="workspace-detail-row">
            <dt>详情</dt>
            <dd><span class="workspace-label">${renderWorkspaceLabelInlineItems(items)}</span></dd>
          </div>
        `}
      </dl>
    `;
  }

  private delete(workspace: Workspace): void {
    if (this.isDeleting(workspace)) return;
    this.openMenuWorkspaceId = undefined;
    this.onDelete?.(workspace);
  }

  private isDeleting(workspace: Workspace): boolean {
    return this.deletingWorkspaceIds.includes(workspace.id);
  }

  private toggleMenu(workspaceId: string, target: EventTarget | null): void {
    if (this.openMenuWorkspaceId === workspaceId) {
      this.openMenuWorkspaceId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target);
    this.openMenuWorkspaceId = workspaceId;
  }

  private handleWorkspaceKeydown(event: KeyboardEvent, workspace: Workspace): void {
    if (event.key === "Escape" && this.openMenuWorkspaceId === workspace.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuWorkspaceId = undefined;
      return;
    }
    activateSelectableRowFromKeyboard(event, () => this.onSelect?.(workspace));
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  static override styles = listStyles;
}

function workspacePrimaryLabel(workspace: Workspace): string {
  return `${workspace.branch ?? workspace.label}${workspace.isMain ? " · 主工作区" : ""}`;
}

function canDeleteWorkspace(workspace: Workspace): boolean {
  return workspace.isGitWorktree && !workspace.isMain;
}

function workspaceMenuId(workspaceId: string): string {
  return `workspace-menu-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
