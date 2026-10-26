import { stylesheetIntegrationCapability } from "../../plugins/styles";
import "../../plugins/uiPresentation";
import type { UiPresentationRuntime } from "../../plugins/uiPresentationRuntime";
import type { UiPresentationContextV1 } from "../../../../plugin-api";
import { t } from "../../i18n";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine, Project, SessionInfo, Workspace } from "../../api";
import { browserGatewayDisplayUrl, machineIconUrl } from "../../instanceIdentity";
import { shortSessionId } from "../../sessionLabels";
import { renderNavigationMenuIcon } from "../tabIcons";
import type { NavigationSection } from "../../appShell/navigationState";

@customElement("app-context-bar")
export class AppContextBar extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) presentationRuntime: UiPresentationRuntime | undefined;
  @property({ attribute: false }) presentationContext: UiPresentationContextV1 = { mode: "normal" };
  @property({ attribute: false }) machine?: Machine;
  /** PWA display mode: surfaces the machine location identity in the breadcrumb. */
  @property({ type: Boolean }) locationIndicator = false;
  @property({ attribute: false }) project?: Project;
  @property({ type: Boolean }) workspaceSelectionVisible = true;
  @property({ attribute: false }) workspace?: Workspace;
  @property({ attribute: false }) session?: SessionInfo;
  @property({ attribute: false }) refreshControl: unknown;
  @property({ attribute: false }) onOpenSection?: (section: NavigationSection) => void;
  @property({ attribute: false }) onShowActions?: () => void;
  @property({ attribute: false }) onShowNavigation?: () => void;
  @property({ type: Boolean }) hiddenActiveDestination = false;
  @query(".context-items") private contextItems?: HTMLElement | null;
  @state() private canScrollLeft = false;
  @state() private canScrollRight = false;
  private observedContextItems: HTMLElement | undefined;
  private contextItemsResizeObserver: ResizeObserver | undefined;

  override disconnectedCallback(): void {
    this.contextItemsResizeObserver?.disconnect();
    this.contextItemsResizeObserver = undefined;
    this.observedContextItems = undefined;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    this.observeContextItems();
    this.updateScrollState();
  }

  override updated(): void {
    this.observeContextItems();
    this.updateScrollState();
  }

  override render() {
    const machine = displayMachine(this.machine, this.machines);
    const machineChoice = this.machines.length > 1;
    // The chip is a machine picker whenever a choice exists; the location
    // identity it carries is a PWA-only affordance (the browser shows the URL).
    const machineChipClass = machine === undefined ? "context-chip machine-chip empty" : "context-chip machine-chip";
    const projectLabel = projectContextLabel(this.project);
    const workspaceLabel = workspaceContextLabel(this.workspace);
    const sessionLabel = sessionContextLabel(this.session);
    return html`
      <pi-web-ui-presentation region="context-bar" .runtime=${this.presentationRuntime} .context=${this.presentationContext}>
      <nav slot="content" class=${this.contextBarClass()} aria-label="${t("ui.appContextBar.currentLocation", "Current location")}">
        <span class="context-bar-label">${t("ui.appContextBar.location", "Location")}</span>
        <ol class="context-items" @scroll=${this.onContextScroll}>
            <li class="context-item">
              ${machineChoice ? html`
                <button type="button" class=${machineChipClass} title=${machineContextTitle(machine)} aria-label=${t("ui.appContextBar.machineOpenMachineSelection", "Machine: {machineLabel}. Open machine selection.", { machineLabel: machineContextLabel(machine) })} @click=${() => { this.onOpenSection?.("machines"); }}>
                  ${this.renderMachineChipContent(machine, this.locationIndicator)}
                </button>
              ` : html`
                <!-- No machine choice: the chip is the instance identity, not a control. -->
                <span class="${machineChipClass} static" title=${machineContextTitle(machine)}>
                  ${this.renderMachineChipContent(machine, this.locationIndicator)}
                </span>
              `}
            </li>
          <li class="context-item">
            <button type="button" class=${this.project === undefined ? "context-chip empty" : "context-chip"} title=${projectContextTitle(this.project)} aria-label=${t("ui.appContextBar.projectOpenProjectSelection", "Project: {projectLabel}. Open project selection.", { projectLabel: projectLabel })} @click=${() => { this.onOpenSection?.("projects"); }}>
              <span class="context-kind">${t("client.actions.project.79f326", "Project")}</span>
              <span class="context-value">${projectLabel}</span>
            </button>
          </li>
          ${this.workspaceSelectionVisible ? html`<li class="context-item">
            <button type="button" class=${this.workspace === undefined ? "context-chip empty" : "context-chip"} title=${workspaceContextTitle(this.workspace)} aria-label=${t("ui.appContextBar.workspaceOpenWorkspaceSelection", "Workspace: {workspaceLabel}. Open workspace selection.", { workspaceLabel: workspaceLabel })} @click=${() => { this.onOpenSection?.("workspaces"); }}>
              <span class="context-kind">${t("bundled.workspace-tasks.workspace.379798", "Workspace")}</span>
              <span class="context-value">${workspaceLabel}</span>
            </button>
          </li>` : null}
          <li class="context-item">
            <button type="button" class=${this.session === undefined ? "context-chip empty" : "context-chip"} title=${sessionContextTitle(this.session)} aria-label=${t("ui.appContextBar.sessionOpenSessionSelection", "Session: {sessionLabel}. Open session selection.", { sessionLabel: sessionLabel })} @click=${() => { this.onOpenSection?.("sessions"); }}>
              <span class="context-kind">${t("ui.sessionSearchDialog.sessions", "Sessions")}</span>
              <span class="context-value">${sessionLabel}</span>
            </button>
          </li>
        </ol>
        ${this.hasContextActions() ? html`<div class="context-actions">${this.onShowNavigation === undefined ? null : html`<button type="button" class=${`context-action-button${this.hiddenActiveDestination ? " selected" : ""}`} title="${t("ui.main.99aaea15ca9e", "Open Navigation")}" aria-label="${t("ui.main.99aaea15ca9e", "Open Navigation")}" aria-haspopup="dialog" aria-pressed=${String(this.hiddenActiveDestination)} @click=${this.onShowNavigation}>${renderNavigationMenuIcon()}</button>`}${this.renderActionsButton()}${this.refreshControl}</div>` : null}
      </nav>
      </pi-web-ui-presentation>
    `;
  }

  private renderMachineChipContent(machine: Machine | undefined, locationIndicator: boolean) {
    if (machine === undefined) return html`<span class="context-value">${t("ui.machineList.noMachineSelected", "No machine selected")}</span>`;
    // Browser mode keeps the chip a plain machine picker; the location identity
    // (favicon and host) only shows where the browser chrome does not.
    if (!locationIndicator) return html`<span class="context-value">${machineSelectionLabel(machine)}</span>`;
    const detail = machineContextDetail(machine, browserGatewayDisplayUrl());
    return html`
      <img class="context-chip-icon" src=${machineIconUrl(machine)} alt="" @error=${this.hideBrokenIcon} />
      ${this.machines.length > 1 ? html`<span class="context-value">${machineContextLabel(machine)}</span>` : null}
      ${detail === undefined ? null : html`<span class=${this.machines.length > 1 ? "context-detail" : "context-value"}>${detail}</span>`}
    `;
  }

  private readonly hideBrokenIcon = (event: Event): void => {
    if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.style.display = "none";
  };

  private renderActionsButton() {
    if (this.onShowActions === undefined) return null;
    return html`
      <button type="button" class="context-action-button" title="${t("client.actions.show.actions.a514ad", "Show actions")}" aria-label="${t("client.actions.show.actions.a514ad", "Show actions")}" @click=${(event: MouseEvent) => { event.stopPropagation(); this.onShowActions?.(); }}>
        <svg class="context-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13 2 4 14h7l-1 8 10-13h-7V2Z"></path>
        </svg>
      </button>
    `;
  }

  private contextBarClass(): string {
    const classes = ["context-bar"];
    if (this.canScrollLeft) classes.push("can-scroll-left");
    if (this.canScrollRight) classes.push("can-scroll-right");
    return classes.join(" ");
  }

  private hasContextActions(): boolean {
    return this.refreshControl !== undefined || this.onShowActions !== undefined || this.onShowNavigation !== undefined;
  }

  private observeContextItems(): void {
    const contextItems = this.contextItemsElement();
    if (this.observedContextItems === contextItems) return;
    this.contextItemsResizeObserver?.disconnect();
    this.observedContextItems = contextItems;
    this.contextItemsResizeObserver = undefined;
    if (contextItems === undefined || typeof ResizeObserver === "undefined") return;
    this.contextItemsResizeObserver = new ResizeObserver(() => {
      this.updateScrollState();
    });
    this.contextItemsResizeObserver.observe(contextItems);
  }

  private updateScrollState(): void {
    const contextItems = this.contextItemsElement();
    const maxScrollLeft = contextItems === undefined ? 0 : Math.max(0, contextItems.scrollWidth - contextItems.clientWidth);
    const canScrollLeft = contextItems !== undefined && contextItems.scrollLeft > 1;
    const canScrollRight = contextItems !== undefined && maxScrollLeft - contextItems.scrollLeft > 1;
    if (this.canScrollLeft !== canScrollLeft) this.canScrollLeft = canScrollLeft;
    if (this.canScrollRight !== canScrollRight) this.canScrollRight = canScrollRight;
  }

  private contextItemsElement(): HTMLElement | undefined {
    const contextItems = this.contextItems;
    return contextItems instanceof HTMLElement ? contextItems : undefined;
  }

  private readonly onContextScroll = () => {
    this.updateScrollState();
  };

  static override styles = css`
    @layer pi-web-base {
    /* Keep the refresh menu in this shadow tree above the following mobile tab strip. */
    :host { position: relative; z-index: 20; flex: 0 0 auto; min-width: 0; }
    .context-bar { position: relative; flex: 0 0 auto; min-width: 0; min-height: 44px; display: flex; align-items: stretch; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .context-bar.can-scroll-left .context-items { box-shadow: inset 8px 0 6px -8px var(--pi-shadow-strong); }
    .context-bar.can-scroll-right .context-items { box-shadow: inset -8px 0 6px -8px var(--pi-shadow-strong); }
    .context-bar.can-scroll-left.can-scroll-right .context-items { box-shadow: inset 8px 0 6px -8px var(--pi-shadow-strong), inset -8px 0 6px -8px var(--pi-shadow-strong); }
    .context-bar-label { display: none; }
    .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; margin: 0; padding: 0; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: none; }
    .context-items::-webkit-scrollbar { display: none; }
    .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
    .context-item + .context-item { border-inline-start: 1px solid var(--pi-border-muted); }
    .context-actions { position: relative; flex: 0 0 auto; z-index: 3; display: flex; align-items: stretch; border-inline-start: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .context-action-button { box-sizing: border-box; width: 44px; min-height: 44px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); padding: 0; line-height: 1; }
    .context-actions > * + * { border-inline-start: 1px solid var(--pi-border-muted); }
    .context-action-button.selected { background: var(--pi-selection-bg); }
    .context-action-button:hover { background: var(--pi-surface-hover); }
    .context-action-button:focus-visible, button.context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .context-action-icon { width: 18px; height: 18px; fill: currentColor; pointer-events: none; }
    .context-chip { box-sizing: border-box; flex: 0 0 auto; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); padding: 0 12px; font: inherit; text-align: left; }
    .context-chip-icon { flex: 0 0 auto; width: 14px; height: 14px; }
    .context-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: 11px; }
    button.context-chip:hover { background: var(--pi-surface-hover); }
    .context-chip.empty { color: var(--pi-muted); }
    .context-kind { display: none; }
    .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
    button { cursor: pointer; }

    }
  `;
}

/**
 * The machine chip always shows the machine the UI acts on, falling back to
 * the local machine before an explicit selection lands.
 */
function displayMachine(machine: Machine | undefined, machines: readonly Machine[]): Machine | undefined {
  return machine ?? machines.find((candidate) => candidate.id === "local") ?? machines[0];
}

function machineContextLabel(machine: Machine | undefined): string {
  return machine?.name ?? t("ui.machineList.noMachineSelected", "No machine selected");
}

/** The plain picker label used in browser mode, where the chip carries no location identity. */
function machineSelectionLabel(machine: Machine): string {
  return `${machine.name}${machine.kind === "remote" ? t("ui.appContextBar.remote", " · Remote") : ""}`;
}

/**
 * The host the machine is reached at: the serving gateway for the local
 * machine (what a PWA hides), the remote host otherwise.
 */
export function machineContextDetail(machine: Machine, gatewayDisplay: string): string | undefined {
  if (machine.kind === "local" || machine.baseUrl === undefined) return gatewayDisplay;
  try {
    return new URL(machine.baseUrl).host;
  } catch {
    return undefined;
  }
}

function machineContextTitle(machine: Machine | undefined): string {
  return machine === undefined ? t("ui.machineList.noMachineSelected", "No machine selected") : machine.baseUrl ?? machine.name;
}

function projectContextLabel(project: Project | undefined): string {
  return project?.name ?? t("ui.projectList.noProjectSelected", "No project selected");
}

function projectContextTitle(project: Project | undefined): string {
  return project === undefined ? t("ui.projectList.noProjectSelected", "No project selected") : `${project.name} — ${project.path}`;
}

function workspaceContextLabel(workspace: Workspace | undefined): string {
  return workspace === undefined ? t("ui.workspaceList.noWorkspaceSelected", "No workspace selected") : `${workspace.label}${workspace.isMain ? t("ui.appContextBar.mainWorkspace", " · Main workspace") : ""} · ${workspace.path}`;
}

function workspaceContextTitle(workspace: Workspace | undefined): string {
  return workspace === undefined ? t("ui.workspaceList.noWorkspaceSelected", "No workspace selected") : `${workspace.label}${workspace.isMain ? t("ui.appContextBar.mainWorkspace", " · Main workspace") : ""} — ${workspace.path}`;
}

function sessionContextLabel(session: SessionInfo | undefined): string {
  const name = session?.name?.trim();
  const firstMessage = session?.firstMessage.trim();
  return name !== undefined && name !== "" ? name : firstMessage !== undefined && firstMessage !== "" ? firstMessage : session === undefined ? t("ui.sessionList.noSessionSelected", "No session selected") : shortSessionId(session.id);
}

function sessionContextTitle(session: SessionInfo | undefined): string {
  return session === undefined ? t("ui.sessionList.noSessionSelected", "No session selected") : session.path;
}
