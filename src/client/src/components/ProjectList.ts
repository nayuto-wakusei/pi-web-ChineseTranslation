import { t } from "../i18n";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Project, Workspace, WorkspaceActivity } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { projectActivityIndicator } from "../workspaceActivity";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import { ListMenuController } from "./ListMenuController";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) selected?: Project;
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) unreadProjectIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean }) managementMode = false;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  private readonly menu = new ListMenuController(this);

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("projects")) this.menu.closeIfOpenIdMissing((projectId) => this.projects.some((project) => project.id === projectId));
    if (changed.has("collapsed")) this.menu.closeIf(this.collapsed);
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.projects.length === 0 ? html`
              <div class="empty-list" role="status">
                <strong>${this.managementMode ? t("ui.projectList.noAccessibleProjects", "No accessible projects") : t("ui.main.a3dba20f21a7", "No projects")}</strong>
                <small>${this.managementMode ? t("ui.projectList.createAProjectInTheAiPlatformThen", "Create a project in the AI platform, then refresh this page.") : t("ui.main.eb20389c7aba", "Add a project from the Actions menu.")}</small>
              </div>
            ` : this.projects.map((project) => html`
              <div
                class=${`action-row ${this.selected?.id === project.id ? "selected" : ""}`}
                tabindex="0"
                title=${project.path}
                @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(project)); }}
                @keydown=${(event: KeyboardEvent) => { this.handleProjectKeydown(event, project); }}
              >
                <div class="action-main">
                  <span class="workspace-primary"><span class="workspace-primary-label">${project.name}</span></span><small>${project.path}</small>
                  ${this.renderActivity(project)}
                </div>
                <div class="action-menu">
                  <button class="action-menu-toggle" title="${t("ui.projectList.projectActions", "Project actions")}" aria-label=${t("ui.projectList.actionsFor", "Actions for {name}", { name: project.name })} @click=${(event: MouseEvent) => { event.stopPropagation(); this.menu.toggle(project.id, event.currentTarget); }}>⋯</button>
                  ${this.menu.isOpen(project.id) ? html`
                    <div class="action-menu-panel" style=${this.menu.menuStyle}>
                      <button title="${t("ui.projectList.closeProject", "Close project")}" @click=${() => { this.close(project); }}>${t("ui.common.close", "Close")}</button>
                    </div>
                  ` : null}
                </div>
              </div>
            `)}
          </div>
        `}
      </section>
    `;
  }

  private handleProjectKeydown(event: KeyboardEvent, project: Project): void {
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(project),
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  private renderHeading() {
    if (!this.collapsible) return t("client.actions.project.79f326", "Project");
    const selectedSummary = this.selected?.name ?? t("ui.projectList.noProjectSelected", "No project selected");
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${t("client.actions.project.79f326", "Project")}</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.projects.length}</small></button>`;
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

  static override styles = listStyles;
}
