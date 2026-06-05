import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Project, Workspace, WorkspaceActivity } from "../api";
import { projectActivityIndicator } from "../workspaceActivity";
import { actionMenuPanelStyle } from "./actionMenu";
import { renderActivityIndicator } from "./activityBadge";
import { activateSelectableRow, activateSelectableRowFromKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

@customElement("project-list")
export class ProjectList extends LitElement {
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) selected?: Project;
  @property({ attribute: false }) activities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @state() private openMenuProjectId: string | undefined;
  @state() private menuStyle = "";
  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuProjectId = undefined;
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
    if (changed.has("projects") && this.openMenuProjectId !== undefined && !this.projects.some((project) => project.id === this.openMenuProjectId)) this.openMenuProjectId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuProjectId = undefined;
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.projects.map((project) => html`
              <div
                class=${`action-row ${this.selected?.id === project.id ? "selected" : ""}`}
                tabindex="0"
                title=${project.path}
                @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(project)); }}
                @keydown=${(event: KeyboardEvent) => { activateSelectableRowFromKeyboard(event, () => this.onSelect?.(project)); }}
              >
                <div class="action-main">
                  <span class="action-name">${project.name}</span><small>${this.renderActivity(project)}${project.path}</small>
                </div>
                <div class="action-menu">
                  <button class="action-menu-toggle" title="项目操作" aria-label=${`${project.name} 的操作`} @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(project.id, event.currentTarget); }}>⋯</button>
                  ${this.openMenuProjectId === project.id ? html`
                    <div class="action-menu-panel" style=${this.menuStyle}>
                      <button title="关闭项目" @click=${() => { this.close(project); }}>关闭</button>
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

  private renderHeading() {
    if (!this.collapsible) return "项目";
    const selectedSummary = this.selected?.name ?? "未选择项目";
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} 项目</span><small class="section-selected" title=${selectedTitle}>${selectedSummary}</small></span><small class="section-count">${this.projects.length}</small></button>`;
  }

  private renderActivity(project: Project) {
    const kind = projectActivityIndicator(project, this.workspacesByProjectId[project.id] ?? [], this.activities);
    return renderActivityIndicator(kind, kind === "terminal" ? "项目终端活跃" : "项目活跃") ?? "";
  }

  private toggleMenu(projectId: string, target: EventTarget | null) {
    if (this.openMenuProjectId === projectId) {
      this.openMenuProjectId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target);
    this.openMenuProjectId = projectId;
  }

  private close(project: Project) {
    this.openMenuProjectId = undefined;
    if (confirm(`关闭 ${project.name}？\n\n这只会从 PI WEB 中移除它，不会修改项目文件夹。`)) this.onClose?.(project);
  }

  static override styles = listStyles;
}
