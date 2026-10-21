import { t } from "../i18n";
import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { renderNavigationMenuIcon } from "./tabIcons";
import { workspacePanelStyles } from "./shared";
import { pinnedNavigationTabs } from "../navigationPreferences";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

type WorkspacePanelBadge = string | number | TemplateResult | undefined;

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() error = "";
  @property() tool: QualifiedContributionId | undefined;
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideToolTabs = false;
  @property({ attribute: false }) pinnedIds: string[] = [];
  @property({ attribute: false }) onShowNavigation?: () => void;
  @property({ type: Boolean }) hiddenActiveDestination = false;
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @query(".workspace-header-strip") private workspaceHeaderStrip?: HTMLElement | null;
  @state() private workspaceHeaderCanScrollLeft = false;
  @state() private workspaceHeaderCanScrollRight = false;

  private observedWorkspaceHeaderStrip: HTMLElement | undefined;
  private workspaceHeaderResizeObserver: ResizeObserver | undefined;
  private readonly onWorkspaceHeaderScroll = () => {
    this.updateWorkspaceHeaderScrollState();
  };

  override firstUpdated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override updated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override disconnectedCallback(): void {
    this.workspaceHeaderResizeObserver?.disconnect();
    this.workspaceHeaderResizeObserver = undefined;
    this.observedWorkspaceHeaderStrip = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.error !== "" ? { title: t("ui.main.110fc6609529", "Navigation destination unavailable"), body: this.error } : this.emptyState ?? {
      title: t("ui.workspacePanel.selectWorkspace", "Select workspace"),
      body: t("ui.main.272d152c38f6", "Choose a workspace to use its tools."),
    }, true);
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      title: t("ui.workspacePanel.workspaceToolsUnavailable", "Workspace tools unavailable"),
      body: t("ui.workspacePanel.trySelectingTheWorkspaceAgain", "Try selecting the workspace again."),
    }, true);
    const visiblePanels = this.panels;
    // An unresolved route may leave a valid remembered tool, but its content is not displayed.
    const selectedPanel = this.error !== "" ? undefined
      : this.tool === undefined ? visiblePanels[0] : visiblePanels.find((panel) => panel.id === this.tool);
    const pinnedPanels = pinnedNavigationTabs(visiblePanels, this.pinnedIds);
    return html`
      ${this.hideToolTabs ? null : html`
        <header>
          <div class=${this.workspaceHeaderFrameClass()}>
            <div class="workspace-header-strip" @scroll=${this.onWorkspaceHeaderScroll}>
              <div class="tabs">
                ${pinnedPanels.map((panel) => {
                  const selected = selectedPanel?.id === panel.id;
                  const badge = panel.badge?.(context);
                  const ariaLabel = this.panelTabAriaLabel(panel, badge);
                  return html`
                    <button class=${this.panelTabClass(panel, selected)} title=${ariaLabel} aria-label=${ariaLabel} aria-pressed=${String(selected)} @click=${() => { this.onSelectTool(panel.id); }}>
                      ${this.renderPanelTabContent(panel, badge)}
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>
          ${this.renderNavigationButton(this.hiddenActiveDestination || (selectedPanel !== undefined && !pinnedPanels.some((panel) => panel.id === selectedPanel.id)))}
        </header>
      `}
      ${this.error !== "" ? this.renderEmptyState({ title: t("ui.main.110fc6609529", "Navigation destination unavailable"), body: this.error }) : selectedPanel === undefined ? this.renderEmptyState({
        title: this.tool === undefined ? t("ui.workspacePanel.noWorkspaceToolsAvailable", "No workspace tools available") : t("ui.main.8e931a1bb102", "Workspace panel unavailable: {arg0}", { arg0: this.tool }),
      }) : html`
        <div class="panel-content">
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  private panelTabClass(panel: QualifiedWorkspacePanelContribution, selected: boolean): string {
    return [
      ...(panel.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  private panelTabAriaLabel(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): string {
    if (typeof badge !== "string" && typeof badge !== "number") return panel.title;
    const trimmedBadge = String(badge).trim();
    return trimmedBadge === "" ? panel.title : `${panel.title}, ${trimmedBadge}`;
  }

  private renderPanelTabContent(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): TemplateResult {
    return html`
      ${panel.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${panel.icon}</span>`}
      <span class="tab-label">${panel.title}</span>
      ${this.isEmptyBadge(badge) ? null : html`<span class="tab-badge">${badge}</span>`}
    `;
  }

  private isEmptyBadge(badge: WorkspacePanelBadge): boolean {
    return badge === undefined || badge === "";
  }

  private renderNavigationButton(hiddenActiveDestination = false) {
    return this.onShowNavigation === undefined ? null : html`<button type="button" class=${`navigation-menu-button${hiddenActiveDestination ? " selected" : ""}`} title="${t("ui.main.99aaea15ca9e", "Open Navigation")}" aria-label="${t("ui.main.99aaea15ca9e", "Open Navigation")}" aria-haspopup="dialog" @click=${this.onShowNavigation}>${renderNavigationMenuIcon()}</button>`;
  }

  private renderEmptyState(state: WorkspacePanelEmptyState, showNavigation = false): TemplateResult {
    return html`
      ${showNavigation && !this.hideToolTabs ? html`<header>${this.renderNavigationButton()}</header>` : null}
      <section class="empty-state" role=${this.error === "" ? "status" : "alert"}>
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  private workspaceHeaderFrameClass(): string {
    return `workspace-header-scroll-frame${this.workspaceHeaderCanScrollLeft ? " can-scroll-left" : ""}${this.workspaceHeaderCanScrollRight ? " can-scroll-right" : ""}`;
  }

  private observeWorkspaceHeaderStrip(): void {
    const strip = this.workspaceHeaderStripElement();
    if (this.observedWorkspaceHeaderStrip === strip) return;
    this.workspaceHeaderResizeObserver?.disconnect();
    this.observedWorkspaceHeaderStrip = strip;
    this.workspaceHeaderResizeObserver = undefined;
    if (strip === undefined || typeof ResizeObserver === "undefined") return;
    this.workspaceHeaderResizeObserver = new ResizeObserver(() => {
      this.updateWorkspaceHeaderScrollState();
    });
    this.workspaceHeaderResizeObserver.observe(strip);
  }

  private updateWorkspaceHeaderScrollState(): void {
    const strip = this.workspaceHeaderStripElement();
    const maxScrollLeft = strip === undefined ? 0 : Math.max(0, strip.scrollWidth - strip.clientWidth);
    const canScrollLeft = strip !== undefined && strip.scrollLeft > 1;
    const canScrollRight = strip !== undefined && maxScrollLeft - strip.scrollLeft > 1;
    if (this.workspaceHeaderCanScrollLeft !== canScrollLeft) this.workspaceHeaderCanScrollLeft = canScrollLeft;
    if (this.workspaceHeaderCanScrollRight !== canScrollRight) this.workspaceHeaderCanScrollRight = canScrollRight;
  }

  private workspaceHeaderStripElement(): HTMLElement | undefined {
    const strip = this.workspaceHeaderStrip;
    return strip instanceof HTMLElement ? strip : undefined;
  }

  static override styles = workspacePanelStyles;
}
