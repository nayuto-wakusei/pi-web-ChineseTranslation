import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import type { Project, Workspace, WorkspaceActivity } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { projectActivityIndicator } from "../workspaceActivity";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import { ListMenuController } from "./ListMenuController";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { sidebarListStyles } from "./sidebarListStyles";
import "./FolderProjectTrust";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) projects: Project[] = [];
  @property() machineId = "local";
  @property({ attribute: false }) selected?: Project;
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) unreadProjectIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean }) managementMode = false;
  @property({ type: Boolean, reflect: true, attribute: "tree-layout" }) treeLayout = false;
  @property({ attribute: false }) selectedChildren: TemplateResult | undefined;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onMove?: (project: Project, direction: -1 | 1) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  private readonly menu = new ListMenuController(this);
  @state() private branchCollapsed = false;

  private focusedControl: HTMLElement | undefined;
  private focusAfterReorder: HTMLElement | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("projects")) this.focusAfterReorder = this.focusedControl;
    if (changed.has("treeLayout")) this.menu.close();
    if (changed.has("machineId") || changed.has("selected") && (changed.get("selected")?.id !== this.selected?.id || changed.get("selected")?.path !== this.selected?.path)) this.branchCollapsed = false;
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
      <section>
        <h2 class="ui-toolbar">${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.projects.length === 0 ? html`
              <div class="empty-list" role="status">
                <strong>${this.managementMode ? t("ui.projectList.noAccessibleProjects", "No accessible projects") : t("ui.main.a3dba20f21a7", "No projects")}</strong>
                <small>${this.managementMode ? t("ui.projectList.createAProjectInTheAiPlatformThen", "Create a project in the AI platform, then refresh this page.") : t("ui.main.eb20389c7aba", "Add a project from the Actions menu.")}</small>
              </div>
            ` : repeat(this.projects, (project) => project.id, (project, index) => {
              const row = html`
              <div
                class=${`action-row ${this.selected?.id === project.id ? "selected" : ""}`}
                tabindex="0"
                @focusin=${(event: FocusEvent) => { this.focusedControl = event.target instanceof HTMLElement ? event.target : undefined; }}
                @focusout=${() => { this.focusedControl = undefined; }}
                title=${project.path}
                @click=${(event: MouseEvent) => { activateSelectableRow(event, () => { this.selectProject(project); }); }}
                @keydown=${(event: KeyboardEvent) => { this.handleProjectKeydown(event, project); }}
              >
                <div class="action-main">
                  ${this.treeLayout ? html`<button type="button" class="ui-button ui-button--icon tree-disclosure" aria-label=${project.name} aria-expanded=${String(this.isExpanded(project))} @click=${(event: MouseEvent) => { event.stopPropagation(); this.selectProject(project); }}><span aria-hidden="true">${this.isExpanded(project) ? "▾" : "▸"}</span></button>` : nothing}
                  <span class="workspace-primary"><span class="workspace-primary-label">${project.name}</span></span><small>${project.path}</small>
                  ${this.renderActivity(project)}
                </div>
                <div class="action-menu">
                  <button class="ui-button ui-button--icon action-menu-toggle" title="${t("ui.projectList.projectActions", "Project actions")}" aria-label=${t("ui.projectList.actionsFor", "Actions for {name}", { name: project.name })} @click=${(event: MouseEvent) => { event.stopPropagation(); this.menu.toggle(project.id, event.currentTarget); }}>⋯</button>
                  ${this.menu.isOpen(project.id) ? html`
                    <div popover="auto" class="ui-menu action-menu-panel" style=${this.menu.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
                      ${this.onMove === undefined || this.managementMode ? null : html`
                        <button class="ui-button ui-menu-item" data-move ?disabled=${index === 0} @click=${() => { this.onMove?.(project, -1); }}>${t("ui.navigation.moveUp", "Move up")}</button>
                        <button class="ui-button ui-menu-item" data-move ?disabled=${index === this.projects.length - 1} @click=${() => { this.onMove?.(project, 1); }}>${t("ui.navigation.moveDown", "Move down")}</button>
                      `}
                      ${this.managementMode ? null : html`<folder-project-trust .machineId=${this.machineId} .project=${project}></folder-project-trust>`}
                      <button class="ui-button ui-menu-item" title="${t("ui.projectList.closeProject", "Close project")}" @click=${() => { this.close(project); }}>${t("ui.common.close", "Close")}</button>
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
    if (!this.collapsible) return t("client.actions.project.79f326", "Project");
    const selectedSummary = this.selected?.name ?? t("ui.projectList.noProjectSelected", "No project selected");
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="ui-button ui-toolbar-title section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${t("client.actions.project.79f326", "Project")}</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.projects.length}</small></button>`;
  }

  private renderActivity(project: Project) {
    const flags = this.statusSnapshot?.projects[project.id];
    const kind = this.statusSnapshot === undefined ? projectActivityIndicator(project, this.workspacesByProjectId[project.id] ?? [], this.activities) : statusActivityKind(flags);
    const unreadLabel = this.statusSnapshot === undefined ? (this.unreadProjectIds.has(project.id) ? t("ui.projectList.unreadSessionsInThisProject", "Unread sessions in this project") : undefined) : (hasStatusUnread(flags) ? t("ui.projectList.unreadSessionsInThisProject", "Unread sessions in this project") : undefined);
    return renderActionActivityIndicator(kind, kind === "terminal" ? t("ui.projectList.projectTerminalActive", "Project terminal active") : t("ui.projectList.projectActive", "Project active"), unreadLabel);
  }

  private close(project: Project) {
    this.menu.close();
    if (confirm(t("ui.projectList.closeThisOnlyRemovesItFromPiWeb", "Close {name}?\n\nThis only removes it from PI WEB. The project folder will not be changed.", { name: project.name }))) this.onClose?.(project);
  }

  static override styles = [listStyles, sidebarListStyles];
}
