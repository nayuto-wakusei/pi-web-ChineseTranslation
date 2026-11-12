import { LocalizationController, localization } from "../localization/browser";
import { projectWorkspaceMessages as messages } from "../projectWorkspaceMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Project } from "../api";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot } from "../../../shared/machineStatus";
import { renderCopyIdAction } from "./copyIdAction";
import type { TemplateResult } from "lit";
import type { Workspace, WorkspaceActivity } from "../api";
import { DetailCopyController } from "./detailCopy";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import { ListMenuController } from "./ListMenuController";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { sidebarListStyles } from "./sidebarListStyles";
import "./FolderProjectTrust";
import type { DropPosition } from "./listReorder";
import { ListReorderController } from "./listReorderController";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) machineId = "local";
  @property({ attribute: false }) selected?: Project;
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) unreadProjectIds: ReadonlySet<string> = new Set();
  @property({ type: Boolean }) selectionLoading = false;
  /** Status tree of the machine these projects belong to; absent means no indicators. */
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean }) managementMode = false;
  @property({ type: Boolean, reflect: true, attribute: "tree-layout" }) treeLayout = false;
  @property({ attribute: false }) selectedChildren: TemplateResult | undefined;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onMove?: (project: Project, direction: -1 | 1) => void;
  /** The parent persists a drop relative to a visible neighbor. */
  @property({ attribute: false }) onReorder?: (project: Project, neighbor: Project, position: DropPosition) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  private readonly menu = new ListMenuController(this);
  @state() private branchCollapsed = false;

  private readonly detailCopy = new DetailCopyController(this);
  private focusedControl: HTMLElement | undefined;
  private focusAfterReorder: HTMLElement | undefined;
  private readonly reorder: ListReorderController<Project> = new ListReorderController<Project>(this, {
    items: () => this.projects,
    enabled: () => this.onReorder !== undefined && !this.collapsed && !this.managementMode,
    onDrop: (project, neighbor, position) => { this.onReorder?.(project, neighbor, position); },
    onStart: () => { this.menu.close(); },
    label: (project) => project.name,
  });

  private reorderMembership = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("projects")) this.focusAfterReorder = this.focusedControl;
    if (changed.has("treeLayout")) this.menu.close();
    if (changed.has("machineId") || changed.has("selected") && (changed.get("selected")?.id !== this.selected?.id || changed.get("selected")?.path !== this.selected?.path)) this.branchCollapsed = false;
    const membership = JSON.stringify(this.projects.map(({ id }) => id));
    if (membership !== this.reorderMembership || changed.has("machineId") || this.collapsed || this.onReorder === undefined) this.reorder.cancel();
    this.reorderMembership = membership;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("projects") && this.focusAfterReorder?.isConnected === true) {
      const control = this.focusAfterReorder;
      const target = control instanceof HTMLButtonElement && control.disabled
        ? control.closest(".action-menu-panel")?.querySelector<HTMLElement>("button[data-move]:not(:disabled)")
        : control;
      target?.focus({ preventScroll: true });
    }
    this.focusAfterReorder = undefined;
    if (changed.has("projects")) this.menu.closeIfOpenIdMissing((projectId) => this.projects.some((project) => project.id === projectId));
    if (changed.has("collapsed")) this.menu.closeIf(this.collapsed);
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
      <span class="list-reorder-status" role="status">${this.reorder.announcement}</span>
      <section data-ui-context="projects" data-collapsed=${String(this.collapsed)}>
        <h2 class="ui-toolbar">${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body ui-nav-list" aria-busy=${String(this.selectionLoading)}>
            ${repeat(this.projects, (project) => project.id, (project, index) => {
              const flags = this.statusSnapshot?.projects[project.id];
              const kind = statusActivityKind(flags);
              const unread = hasStatusUnread(flags);
              const current = this.selected?.id === project.id;
              const row = html`
                <div
                  class=${`action-row ui-nav-row ${current ? "selected" : ""} ${this.reorder.rowClass(project.id)}`}
                  data-reorderable=${String(this.onReorder !== undefined)}
                  data-current=${String(current)}
                  aria-current=${current ? "true" : nothing}
                  data-activity=${kind ?? "idle"}
                  data-busy=${String(flags?.[CORE_STATUS_FLAGS.working] === true)}
                  data-unread=${String(unread)}
                  tabindex="0"
                  data-project-id=${project.id}
                  data-reorder-id=${this.onReorder === undefined ? nothing : project.id}
                  @focusin=${(event: FocusEvent) => { this.focusedControl = event.target instanceof HTMLElement ? event.target : undefined; }}
                  @focusout=${() => { this.focusedControl = undefined; }}
                  title=${project.path}
                  @pointerdown=${(event: PointerEvent) => { this.reorder.begin(event, project); }}
                  @lostpointercapture=${(event: PointerEvent) => { this.reorder.handleLostPointerCapture(event); }}
                  @contextmenu=${(event: MouseEvent) => { if (this.reorder.draggingId !== undefined) event.preventDefault(); }}
                  @click=${(event: MouseEvent) => {
                    if (this.reorder.consumeClick()) { event.preventDefault(); event.stopPropagation(); return; }
                    activateSelectableRow(event, () => { this.selectProject(project); });
                  }}
                  @keydown=${(event: KeyboardEvent) => { this.handleProjectKeydown(event, project); }}
                >
                  <div class="action-main ui-nav-row-main">
                  ${this.treeLayout ? html`<button type="button" class="ui-button ui-button--icon tree-disclosure" aria-label=${project.name} aria-expanded=${String(this.isExpanded(project))} @click=${(event: MouseEvent) => { event.stopPropagation(); this.selectProject(project); }}><span aria-hidden="true">${this.isExpanded(project) ? "▾" : "▸"}</span></button>` : nothing}
                    <span class="workspace-primary"><span class="workspace-primary-label ui-nav-row-label"><bdi>${project.name}</bdi></span></span><small class="ui-nav-row-meta"><bdi dir="ltr">${project.path}</bdi></small>
                    ${this.renderActivity(kind, unread)}
                  </div>
                  <div class="action-menu ui-nav-row-actions">
                    <button class="ui-button ui-button--icon action-menu-toggle ui-nav-row-action ui-popup-trigger" aria-expanded=${String(this.menu.isOpen(project.id))} aria-controls=${`project-menu-${encodeURIComponent(project.id)}`} title=${messages.t("projectActions")} aria-label=${messages.t("actionsFor", { name: project.name })} @click=${(event: MouseEvent) => { event.stopPropagation(); this.menu.toggle(project.id, event.currentTarget); }}>⋯</button>
                    ${this.menu.isOpen(project.id) ? html`
                      <div popover="auto" class="action-menu-panel ui-menu ui-menu--grouped ui-nav-row-menu ui-popup-panel" data-ui-context="project-actions" id=${`project-menu-${encodeURIComponent(project.id)}`} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
                        <div class="ui-menu-group" data-menu-group="actions">
                          ${this.onMove === undefined || this.managementMode ? null : html`
                            <button class="ui-button ui-menu-item" data-move ?disabled=${index === 0} @click=${() => { this.onMove?.(project, -1); }}>${messages.t("moveUp")}</button>
                            <button class="ui-button ui-menu-item" data-move ?disabled=${index === this.projects.length - 1} @click=${() => { this.onMove?.(project, 1); }}>${messages.t("moveDown")}</button>
                          `}
                          <button class="ui-button ui-menu-item" title=${messages.t("closeProject")} @click=${() => { this.close(project); }}>${messages.t("closeProject")}</button>
                        </div>
                        ${this.managementMode ? null : html`<div class="ui-menu-group" data-menu-group="options"><folder-project-trust .machineId=${this.machineId} .project=${project}></folder-project-trust></div>`}
                        <div class="ui-menu-group" data-menu-group="details">
                          <dl class="workspace-menu-details ui-menu-details">
                            <div class="workspace-detail-row ui-menu-detail">
                              <dt>${messages.t("path")}</dt>
                              <dd title=${project.path}><bdi dir="ltr" id=${`project-menu-${encodeURIComponent(project.id)}-path`}>${project.path}</bdi>${this.detailCopy.render(JSON.stringify([this.machineId, project.id]), project.path, messages.t("copyPath"))}</dd>
                            </div>
                          </dl>
                          ${renderCopyIdAction("project", project.id, this.detailCopy)}
                        </div>
                      </div>
                    ` : null}
                  </div>
                </div>
              `;
              return this.treeLayout ? html`<div class="project-branch">${row}${this.isExpanded(project) ? html`<div class="tree-children">${this.selectedChildren}</div>` : nothing}</div>` : row;
            })}
          </div>
        `}
      </section>
    `;
  }

  private handleProjectKeydown(event: KeyboardEvent, project: Project): void {
    this.reorder.consumeClick();
    if (this.treeLayout && event.target === event.currentTarget && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft") {
        if (this.isExpanded(project)) this.branchCollapsed = true;
        else void this.onFocusPreviousSection?.();
      } else if (this.isExpanded(project)) void this.onFocusNextSection?.();
      else if (this.selected?.id === project.id) this.branchCollapsed = false;
      else this.onSelect?.(project);
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => { this.selectProject(project); },
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  private selectProject(project: Project): void {
    if (this.treeLayout && this.selected?.id === project.id) this.branchCollapsed = !this.branchCollapsed;
    else this.onSelect?.(project);
  }

  private isExpanded(project: Project): boolean {
    return this.treeLayout && this.selected?.id === project.id && !this.branchCollapsed;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>${messages.t("projects")}</span>`;
    const selectedSummary = this.selected?.name ?? messages.t("noProject");
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="ui-button ui-toolbar-title section-toggle ui-nav-section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${messages.t("projects")}</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count" role=${this.selectionLoading ? "status" : nothing}>${this.selectionLoading ? messages.t("openingProject") : localization.number(this.projects.length)}</small></button>`;
  }

  private renderActivity(kind: ReturnType<typeof statusActivityKind>, unread: boolean) {
    const unreadLabel = unread ? messages.t("projectUnread") : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? messages.t("projectTerminal") : messages.t("projectActive"), unreadLabel);
  }

  private close(project: Project) {
    this.menu.close();
    if (confirm(messages.t("confirmClose", { name: project.name }))) this.onClose?.(project);
  }

  static override styles = [listStyles, sidebarListStyles];
}
