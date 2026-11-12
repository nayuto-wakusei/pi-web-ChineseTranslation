import { LocalizationController, localization } from "../localization/browser";
import { projectWorkspaceMessages as messages } from "../projectWorkspaceMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { trustApi } from "../api";
import type { Workspace } from "../api";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot } from "../../../shared/machineStatus";
import { renderCopyIdAction } from "./copyIdAction";
import type { WorkspaceActivity } from "../api";
import { DetailCopyController } from "./detailCopy";
import type { WorkspaceLabelItem } from "../plugins/types";
import { canDeleteWorkspace, workspaceRemovalActionLabel } from "../workspaceDeletion";
import { AnchoredPopupController } from "./anchoredPopup";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { sidebarListStyles } from "./sidebarListStyles";
import { ListReorderController } from "./listReorderController";
import type { DropPosition } from "./listReorder";
import { renderWorkspaceLabelInlineItems } from "./workspaceLabel";

import { renderTrustMenuControl, type TrustMenuState } from "./trustMenuControl";

@customElement("workspace-list")
export class WorkspaceList extends LitElement implements KeyboardNavigableSection {
  private readonly popup = new AnchoredPopupController(this, () => {
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".action-menu-panel");
    return panel && this.menuAnchor ? { anchor: this.menuAnchor, panel, onClose: () => { this.openMenuWorkspaceId = undefined; }, options: { minWidth: 120 } } : undefined;
  });

  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property() machineId = "local";
  @property({ type: Boolean }) managementMode = false;
  @property({ type: Boolean, reflect: true, attribute: "tree-layout" }) treeLayout = false;
  @property({ attribute: false }) selectedChildren: TemplateResult | undefined;
  @property({ attribute: false }) selected?: Workspace;
  @property({ attribute: false }) projectId = "";
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) unreadWorkspaceIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ attribute: false }) onSelect?: (workspace: Workspace) => void;
  @property({ attribute: false }) onDelete?: (workspace: Workspace) => void;
  @property({ attribute: false }) onMove?: (workspace: Workspace, direction: -1 | 1) => void;
  @property({ attribute: false }) onReorder?: ((workspace: Workspace, neighbor: Workspace, position: DropPosition) => void) | undefined;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuWorkspaceId: string | undefined;
  private menuAnchor: HTMLElement | undefined;
  @state() private trustByWorkspaceId: Record<string, TrustMenuState> = {};
  private trustGeneration = 0;
  @state() private branchCollapsed = false;

  override connectedCallback(): void {
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    this.trustGeneration++;
    this.trustByWorkspaceId = {};
    super.disconnectedCallback();
  }
  private readonly reorder: ListReorderController<Workspace> = new ListReorderController<Workspace>(this, {
    items: () => this.workspaces,
    enabled: () => this.onReorder !== undefined && !this.collapsed && !this.managementMode,
    onDrop: (workspace, neighbor, position) => { this.onReorder?.(workspace, neighbor, position); },
    onStart: () => { this.openMenuWorkspaceId = undefined; },
    label: workspacePrimaryLabel,
  });
  private reorderMembership = "";
  private readonly detailCopy = new DetailCopyController(this);

  private focusedControl: HTMLElement | undefined;
  private focusAfterReorder: HTMLElement | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("workspaces")) this.focusAfterReorder = this.focusedControl;
    if (changed.has("treeLayout")) this.openMenuWorkspaceId = undefined;
    if (changed.has("machineId") || changed.has("selected") && (changed.get("selected")?.id !== this.selected?.id || changed.get("selected")?.projectId !== this.selected?.projectId || changed.get("selected")?.path !== this.selected?.path)) this.branchCollapsed = false;
    const membership = JSON.stringify(this.workspaces.map(({ id, projectId }) => [id, projectId]));
    if (membership !== this.reorderMembership || changed.has("machineId") || changed.has("projectId") || this.collapsed || this.onReorder === undefined) this.reorder.cancel();
    this.reorderMembership = membership;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("workspaces") && this.focusAfterReorder?.isConnected === true) {
      const control = this.focusAfterReorder;
      const target = control instanceof HTMLButtonElement && control.disabled
        ? control.closest(".action-menu-panel")?.querySelector<HTMLElement>("button[data-move]:not(:disabled)")
        : control;
      target?.focus({ preventScroll: true });
    }
    this.focusAfterReorder = undefined;
    const previousWorkspaces = changed.get("workspaces");
    const workspaceIdentityChanged = previousWorkspaces?.some((previous) => !this.workspaces.some((workspace) => workspace.id === previous.id && workspace.projectId === previous.projectId && workspace.path === previous.path)) === true;
    if (changed.has("machineId") || changed.has("managementMode") || workspaceIdentityChanged) {
      this.trustGeneration++;
      this.trustByWorkspaceId = {};
      this.openMenuWorkspaceId = undefined;
    }
    if (changed.has("workspaces") && this.openMenuWorkspaceId !== undefined && !this.workspaces.some((workspace) => workspace.id === this.openMenuWorkspaceId)) this.openMenuWorkspaceId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuWorkspaceId = undefined;
    if (this.shouldRevealSelectedRow(changed)) this.scrollSelectedIntoView();
  }

  /**
   * Positive reveal triggers only: topology refreshes replace `workspaces`
   * with a new array for the same selection and must never re-scroll. Reveal
   * the selected row only when the selection moves to a different row (first
   * render with a selection included) or when the section expands.
   */
  private shouldRevealSelectedRow(changed: PropertyValues<this>): boolean {
    if (this.collapsed) return false;
    if (changed.has("collapsed")) return true;
    return changed.has("selected") && changed.get("selected")?.id !== this.selected?.id;
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  async revealSelectedBranch(): Promise<void> {
    await this.updateComplete;
    if (!this.treeLayout || this.selected === undefined) return;
    this.branchCollapsed = false;
    await this.updateComplete;
  }

  override render() {
    return html`
      <section data-ui-context="workspaces" data-collapsed=${String(this.collapsed)}>
        <h2 class="ui-toolbar">${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body ui-nav-list">
            ${repeat(this.workspaces, (workspace) => workspace.id, (workspace) => {
              const label = workspacePrimaryLabel(workspace);
              const items = this.workspaceLabelItems(workspace);
              const flags = this.statusSnapshot?.workspaces[workspace.id];
              const kind = statusActivityKind(flags);
              const unread = hasStatusUnread(flags);
              const current = this.selected?.id === workspace.id;
              const row = html`
                <div
                  class=${`action-row workspace-row ui-nav-row ${current ? "selected" : ""} ${this.reorder.rowClass(workspace.id)}`}
                  data-current=${String(current)}
                  aria-current=${current ? "true" : nothing}
                  data-activity=${kind ?? "idle"}
                  data-busy=${String(flags?.[CORE_STATUS_FLAGS.working] === true || this.isDeleting(workspace))}
                  data-unread=${String(unread)}
                  tabindex="0"
                  data-workspace-id=${workspace.id}
                  data-reorder-id=${this.onReorder === undefined ? nothing : workspace.id}
                  data-reorderable=${String(this.onReorder !== undefined)}
                  @pointerdown=${(event: PointerEvent) => { this.reorder.begin(event, workspace); }}
                  @lostpointercapture=${(event: PointerEvent) => { this.reorder.handleLostPointerCapture(event); }}
                  @contextmenu=${(event: MouseEvent) => { if (this.reorder.draggingId !== undefined) event.preventDefault(); }}
                  @focusin=${(event: FocusEvent) => { this.focusedControl = event.target instanceof HTMLElement ? event.target : undefined; }}
                  @focusout=${() => { this.focusedControl = undefined; }}
                  title=${label}
                  @click=${(event: MouseEvent) => {
                    if (this.reorder.consumeClick()) { event.preventDefault(); event.stopPropagation(); return; }
                    activateSelectableRow(event, () => { this.selectWorkspace(workspace); });
                  }}
                  @keydown=${(event: KeyboardEvent) => { this.handleWorkspaceKeydown(event, workspace); }}
                >
                  <div class="action-main ui-nav-row-main">
                    ${this.treeLayout ? html`<button type="button" class="ui-button ui-button--icon tree-disclosure" aria-label=${label} aria-expanded=${String(this.isExpanded(workspace))} @click=${(event: MouseEvent) => { event.stopPropagation(); this.selectWorkspace(workspace); }}><span aria-hidden="true">${this.isExpanded(workspace) ? "▾" : "▸"}</span></button>` : nothing}
                    ${this.renderWorkspaceMain(label, items, workspace, kind, unread)}
                  </div>
                  ${this.renderWorkspaceMenu(label, items, workspace)}
                </div>
              `;
              return this.treeLayout ? html`<div class="workspace-branch">${row}${this.isExpanded(workspace) ? html`<div class="tree-children">${this.selectedChildren}</div>` : nothing}</div>` : row;
            })}
          </div>
        `}
        <div class="list-reorder-status" role="status">${this.reorder.announcement}</div>
      </section>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>${messages.t("workspaces")}</span>`;
    const selectedSummary = this.selected === undefined ? messages.t("noWorkspace") : messages.t("workspaceSummary", { label: workspacePrimaryLabel(this.selected), path: this.selected.path });
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="ui-button ui-toolbar-title section-toggle ui-nav-section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${messages.t("workspaces")}</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${localization.number(this.workspaces.length)}</small></button>`;
  }

  private renderActivity(kind: ReturnType<typeof statusActivityKind>, unread: boolean): TemplateResult | undefined {
    const unreadLabel = unread ? messages.t("workspaceUnread") : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? messages.t("workspaceTerminal") : messages.t("workspaceActive"), unreadLabel);
  }

  private renderWorkspaceMain(label: string, items: WorkspaceLabelItem[], workspace: Workspace, kind: ReturnType<typeof statusActivityKind>, unread: boolean): TemplateResult {
    return html`
      <span class="workspace-primary">
        <span class="workspace-primary-label ui-nav-row-label">${label}</span>
        ${this.isDeleting(workspace) ? html`<span class="workspace-status">${messages.t("deleting")}</span>` : null}
      </span>
      ${items.length === 0 ? null : html`
        <small class="workspace-secondary ui-nav-row-meta">
          <span class="workspace-label">${renderWorkspaceLabelInlineItems(items)}</span>
        </small>
      `}
      ${this.renderActivity(kind, unread)}
    `;
  }

  private renderWorkspaceMenu(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    const open = this.openMenuWorkspaceId === workspace.id;
    const menuId = workspaceMenuId(workspace.id);
    return html`
      <div class="action-menu ui-nav-row-actions">
        <button
          class="ui-button ui-button--icon action-menu-toggle ui-nav-row-action ui-popup-trigger"
          title=${messages.t("workspaceActions")}
          aria-label=${messages.t("detailsFor", { label })}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(workspace.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div popover="auto" class="action-menu-panel workspace-menu-panel ui-menu ui-menu--grouped ui-nav-row-menu ui-popup-panel" data-ui-context="workspace-actions" id=${menuId} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${this.renderWorkspaceActions(workspace)}
            ${this.renderTrustToggle(workspace)}
            <div class="ui-menu-group" data-menu-group="details">
              ${this.renderWorkspaceDetails(label, items, workspace)}
              ${renderCopyIdAction("workspace", workspace.id, this.detailCopy)}
            </div>
          </div>
        ` : null}
      </div>
    `;
  }

  private renderWorkspaceActions(workspace: Workspace): TemplateResult | null {
    if ((this.onMove === undefined || this.managementMode) && !canDeleteWorkspace(workspace)) return null;
    const deleting = this.isDeleting(workspace);
    const actionLabel = workspaceRemovalActionLabel(workspace);
    return html`
      <div class="workspace-menu-actions ui-menu-group" data-menu-group="actions">
        ${this.onMove === undefined || this.managementMode ? null : html`
          <button class="ui-button ui-menu-item" data-move ?disabled=${this.workspaces[0]?.id === workspace.id || deleting} @click=${() => { this.onMove?.(workspace, -1); }}>${messages.t("moveUp")}</button>
          <button class="ui-button ui-menu-item" data-move ?disabled=${this.workspaces.at(-1)?.id === workspace.id || deleting} @click=${() => { this.onMove?.(workspace, 1); }}>${messages.t("moveDown")}</button>
        `}
        ${canDeleteWorkspace(workspace) ? html`
          <button class="danger ui-button ui-menu-item" title=${deleting ? messages.t("removalProgress") : actionLabel} ?disabled=${deleting} @click=${() => { this.delete(workspace); }}>${deleting ? messages.t("removing") : actionLabel}</button>
        ` : null}
      </div>
    `;
  }

  private renderTrustToggle(workspace: Workspace): TemplateResult {
    if (this.managementMode) return html``;
    return html`
      <div class="workspace-menu-trust ui-menu-group" data-menu-group="options">
        ${renderTrustMenuControl({
          id: `${workspaceMenuId(workspace.id)}-trusted`,
          state: this.trustByWorkspaceId[workspace.id],
          label: messages.t("trusted"),
          busyLabel: messages.t("trustedBusy"),
          onChange: (trusted) => { void this.setTrust(workspace, trusted); },
        })}
      </div>
    `;
  }

  /** Fields worth carrying across a loading/saving transition, minus any prior error. */
  private trustBase(state: TrustMenuState | undefined): TrustMenuState {
    return {
      ...(state?.trusted === undefined ? {} : { trusted: state.trusted }),
    };
  }

  private setTrustState(workspaceId: string, state: TrustMenuState): void {
    this.trustByWorkspaceId = { ...this.trustByWorkspaceId, [workspaceId]: state };
  }

  private async loadTrust(workspace: Workspace): Promise<void> {
    if (this.managementMode) return;
    const machineId = this.machineId;
    const generation = this.trustGeneration;
    const current = () => this.isConnected && !this.managementMode && generation === this.trustGeneration && machineId === this.machineId && this.workspaces.some((entry) => entry.id === workspace.id && entry.projectId === workspace.projectId && entry.path === workspace.path);
    const existing = this.trustByWorkspaceId[workspace.id];
    if (existing?.loading === true || existing?.saving === true) return;
    this.setTrustState(workspace.id, { ...this.trustBase(existing), loading: true });
    try {
      const result = await trustApi.workspaceTrust(workspace.projectId, workspace.id, machineId);
      if (current()) this.setTrustState(workspace.id, { trusted: result.trusted });
    } catch (error) {
      if (current()) this.setTrustState(workspace.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async setTrust(workspace: Workspace, trusted: boolean): Promise<void> {
    if (this.managementMode) return;
    const machineId = this.machineId;
    const generation = this.trustGeneration;
    const current = () => this.isConnected && !this.managementMode && generation === this.trustGeneration && machineId === this.machineId && this.workspaces.some((entry) => entry.id === workspace.id && entry.projectId === workspace.projectId && entry.path === workspace.path);
    const existing = this.trustByWorkspaceId[workspace.id];
    if (existing?.loading === true || existing?.saving === true) return;
    this.setTrustState(workspace.id, { ...this.trustBase(existing), saving: true });
    try {
      const result = await trustApi.setWorkspaceTrust(workspace.projectId, workspace.id, trusted, machineId);
      if (current()) this.setTrustState(workspace.id, { trusted: result.trusted });
    } catch (error) {
      // Keep the prior checkbox value (revert the optimistic flip) and surface why.
      if (current()) this.setTrustState(workspace.id, { ...this.trustBase(existing), error: error instanceof Error ? error.message : String(error) });
    }
  }

  private renderWorkspaceDetails(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    const branchCopyAction = workspace.branch === undefined ? messages.t("copyLabel") : t("ui.workspaceList.copyBranch", "Copy branch");
    return html`
      <dl class="workspace-menu-details ui-menu-details">
        <div class="workspace-detail-row ui-menu-detail">
          <dt>${workspace.branch === undefined ? messages.t("workspace") : t("ui.workspaceList.branch", "Branch")}</dt>
          <dd>${label}${this.detailCopy.render(`${workspace.id}:branch`, workspace.branch ?? workspace.label, branchCopyAction)}</dd>
        </div>
        <div class="workspace-detail-row ui-menu-detail">
          <dt>${messages.t("path")}</dt>
          <dd title=${workspace.path}><bdi dir="ltr">${workspace.path}</bdi>${this.detailCopy.render(`${workspace.id}:path`, workspace.path, messages.t("copyPath"))}</dd>
        </div>
        ${items.length === 0 ? null : html`
          <div class="workspace-detail-row ui-menu-detail">
            <dt>${messages.t("details")}</dt>
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
    this.menuAnchor = target instanceof HTMLElement ? target : undefined;
    this.openMenuWorkspaceId = workspaceId;
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!this.managementMode && workspace !== undefined) void this.loadTrust(workspace);
  }

  private handleWorkspaceKeydown(event: KeyboardEvent, workspace: Workspace): void {
    this.reorder.consumeClick();
    if (this.treeLayout && event.target === event.currentTarget && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft") {
        if (this.isExpanded(workspace)) this.branchCollapsed = true;
        else void this.onFocusPreviousSection?.();
      } else if (this.isExpanded(workspace)) void this.onFocusNextSection?.();
      else if (this.selected?.id === workspace.id) this.branchCollapsed = false;
      else this.onSelect?.(workspace);
      return;
    }
    if (event.key === "Escape" && this.openMenuWorkspaceId === workspace.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuWorkspaceId = undefined;
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => { this.selectWorkspace(workspace); },
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  private selectWorkspace(workspace: Workspace): void {
    if (this.treeLayout && this.selected?.id === workspace.id) this.branchCollapsed = !this.branchCollapsed;
    else this.onSelect?.(workspace);
  }

  private isExpanded(workspace: Workspace): boolean {
    return this.treeLayout && this.selected?.id === workspace.id && !this.branchCollapsed;
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  static override styles = [listStyles, sidebarListStyles, css`
    @layer pi-web-base {
    .workspace-menu-trust { display: flex; flex-direction: column; gap: 3px; padding: 4px 2px; }
    .workspace-menu-trust-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .workspace-menu-trust label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .workspace-menu-trust input { cursor: pointer; }
    .workspace-trust-link { color: var(--pi-accent); font-size: 12px; text-align: right; white-space: nowrap; }
    .workspace-trust-error { color: var(--pi-danger, #c0392b); line-height: 1.3; }

    }
  `];
}

function workspacePrimaryLabel(workspace: Workspace): string {
  const label = workspace.branch ?? workspace.label;
  return workspace.isMain ? messages.t("mainLabel", { label }) : label;
}

function workspaceMenuId(workspaceId: string): string {
  return `workspace-menu-${encodeURIComponent(workspaceId)}`;
}
