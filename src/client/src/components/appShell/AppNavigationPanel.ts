import { stylesheetIntegrationCapability } from "../../plugins/styles";
import "../../plugins/uiPresentation";
import type { UiPresentationRuntime } from "../../plugins/uiPresentationRuntime";
import type { UiPresentationActionV1, UiPresentationContextV1 } from "../../../../plugin-api";
import { t } from "../../i18n.js";
import { uiButtonStyles } from "../ui/controlStyles";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { NavigationSectionResizeController, type ResizableNavigationSection } from "../../appShell/navigationSectionResizeController";
import type { NavigationSectionMeasurement } from "./NavigationSectionResizeHandle";
import "./NavigationSectionResizeHandle";
import { renderPanelToggleButton } from "./panelToggleButton";
import type { SessionList } from "../SessionList";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine, MachineHealth, Project, SessionActivity, SessionInfo, SessionStatus, Workspace, WorkspaceActivity } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import type { SessionLabelItem, WorkspaceLabelItem } from "../../plugins/types";
import { selectedMachineId } from "../../controllers/types";
import type { NavigationSection } from "../../appShell/navigationState";
import { NAVIGATION_SECTION_ORDER } from "../../appShell/navigationState";
import { EMPTY_UNREAD_PRESENCE, type UnreadPresence } from "../../unreadPresence";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "../MachineList";
import "../MachineSwitcher";
import type { ProjectList } from "../ProjectList";
import type { WorkspaceList } from "../WorkspaceList";
import "../ProjectList";
import "../WorkspaceList";
import "../SessionList";

export type NavigationFocusTarget = NavigationSection | "chat";

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) presentationRuntime: UiPresentationRuntime | undefined;
  @property({ attribute: false }) presentationContext: UiPresentationContextV1 = { mode: "normal" };
  @property({ attribute: false }) selectedMachine?: Machine;
  /** PWA display mode: surfaces the single-machine identity in the header. */
  @property({ type: Boolean }) locationIndicator = false;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineActivities: Record<string, Record<string, WorkspaceActivity>> = {};
  @property({ attribute: false }) machineStatusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) pinnedSessionIds: string[] = [];
  @property({ attribute: false }) pinnedRootIds: string[] = [];
  @property({ type: Boolean }) workspaceSelectionVisible = true;
  @property({ attribute: false }) onMoveProject?: (project: Project, direction: -1 | 1) => void;
  @property({ attribute: false }) onMoveWorkspace?: (workspace: Workspace, direction: -1 | 1) => void;
  @property({ attribute: false }) onMoveSessionPin?: (session: SessionInfo, direction: -1 | 1) => void;
  @property({ attribute: false }) onTogglePanel?: () => void;
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) workspaceActivities: Record<string, WorkspaceActivity> = {};
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sendingPrompts: Record<string, true> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadPresence: UnreadPresence = EMPTY_UNREAD_PRESENCE;
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) sessionLabelItems: (session: SessionInfo) => SessionLabelItem[] = () => [];
  @property({ attribute: false }) refreshControl: unknown;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) compact = false;
  @property({ type: Boolean }) showBrand = true;
  @property({ type: Boolean }) managementMode = false;
  @property({ type: Boolean }) machinesCollapsed = false;
  @property({ type: Boolean }) projectsCollapsed = false;
  @property({ type: Boolean }) workspacesCollapsed = false;
  @property({ type: Boolean }) sessionsCollapsed = false;
  @property({ type: Number }) startingSessionCount = 0;
  @property({ type: Boolean }) canStartSession = false;
  @property({ type: Boolean }) canDeleteArchivedSessions = false;
  @property({ type: Boolean }) canReloadSessions = false;
  @property({ type: Boolean }) canCleanupSessions = false;
  @property({ type: Boolean }) authoritativeSessionPersistence = false;
  @property({ type: String }) archivedDeleteUnavailableMessage = t("ui.appNavigationPanel.updateAndRestartPiWebOnThisMachine2", "Update and restart Pi-Web on this machine before deleting archived sessions.");
  @property({ type: String }) cleanupUnavailableMessage = t("ui.appNavigationPanel.updateAndRestartPiWebOnThisMachine", "Update and restart Pi-Web on this machine before cleaning up sessions.");
  @property({ attribute: false }) onShowActions?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onShowSettings?: () => void;
  @property({ attribute: false }) onToggleMachines?: () => void;
  @property({ attribute: false }) onToggleProjects?: () => void;
  @property({ attribute: false }) onToggleWorkspaces?: () => void;
  @property({ attribute: false }) onToggleSessions?: () => void;
  @property({ attribute: false }) onSelectProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onCloseProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onDeleteWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onStartSession?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onSearchSessions?: () => void;
  @property({ attribute: false }) onToggleSessionPin?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessionWithDescendants?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteCachedNewSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRenameSession?: (session: SessionInfo, name: string) => void | Promise<void>;
  @property({ attribute: false }) onDetachParentSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionRead?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionsRead?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onReloadSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onCleanupSessions?: () => void | Promise<void>;
  @property({ attribute: false }) onArchivedCollapsed?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onFocusNavigationTarget?: (target: NavigationFocusTarget) => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;

  private readonly sectionSizes = new NavigationSectionResizeController(this);

  @state() private sectionMeasurements: Record<ResizableNavigationSection, NavigationSectionMeasurement> = {
    projects: { height: 44, maxHeight: 44 },
    workspaces: { height: 44, maxHeight: 44 },
  };

  private layoutObserver: ResizeObserver | undefined;

  private observedLayoutElements: Element[] = [];
  private unsubscribePresentation: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.subscribePresentation();
    if (typeof ResizeObserver !== "undefined") {
      this.layoutObserver = new ResizeObserver(() => { this.refreshSectionMeasurements(); });
      this.requestUpdate();
    }
  }

  override disconnectedCallback(): void {
    this.unsubscribePresentation?.();
    this.unsubscribePresentation = undefined;
    this.layoutObserver?.disconnect();
    this.layoutObserver = undefined;
    this.observedLayoutElements = [];
    this.clearTreeCache();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("presentationRuntime")) this.subscribePresentation();
    const layout = this.presentationRuntime?.navigationLayout();
    if (layout === undefined) {
      this.removeAttribute("data-navigation-layout");
      this.clearTreeCache();
    }
    else this.setAttribute("data-navigation-layout", layout);
  }

  private subscribePresentation(): void {
    this.unsubscribePresentation?.();
    this.unsubscribePresentation = this.isConnected ? this.presentationRuntime?.subscribe(() => { this.requestUpdate(); }) : undefined;
  }

  private presentationActionKey = "";
  private presentationActionSource: UiPresentationContextV1 | undefined;
  private presentationActionContext: UiPresentationContextV1 = { mode: "normal" };

  private navigationPresentationContext(): UiPresentationContextV1 {
    const key = JSON.stringify([this.canStartSession, this.onStartSession !== undefined, this.onSearchSessions !== undefined, this.managementMode, this.onAddProject !== undefined, this.onShowSettings !== undefined]);
    if (key === this.presentationActionKey && this.presentationActionSource === this.presentationContext) return this.presentationActionContext;
    const actions: UiPresentationActionV1[] = [];
    if (this.onStartSession !== undefined) actions.push({ id: "new-task", label: t("client.sessionController.new.session.c57c30", "New session"), disabled: !this.canStartSession, run: () => this.onStartSession?.() });
    if (this.onSearchSessions !== undefined) actions.push({ id: "search", label: t("ui.sessionSearchDialog.searchSessions", "Search sessions"), run: () => { this.onSearchSessions?.(); } });
    if (!this.managementMode && this.onAddProject !== undefined) actions.push({ id: "add-project", label: t("client.actions.add.project.8964f5", "Add project"), run: () => { this.onAddProject?.(); } });
    if (this.onShowSettings !== undefined) actions.push({ id: "settings", label: t("ui.settingsDialog.settings", "Settings"), run: () => { this.onShowSettings?.(); } });
    this.presentationActionKey = key;
    this.presentationActionSource = this.presentationContext;
    this.presentationActionContext = Object.freeze({ ...this.presentationContext, actions: Object.freeze(actions) });
    return this.presentationActionContext;
  }

  protected override updated(): void {
    if (this.layoutObserver === undefined) return;
    const elements = [this, ...this.renderRoot.querySelectorAll("header, machine-list, project-list, workspace-list, session-list")];
    if (elements.length === this.observedLayoutElements.length && elements.every((element, index) => element === this.observedLayoutElements[index])) return;
    this.layoutObserver.disconnect();
    for (const element of elements) this.layoutObserver.observe(element);
    this.observedLayoutElements = elements;
  }

  private refreshSectionMeasurements(): void {
    const projects = this.measureSection("projects");
    const workspaces = this.measureSection("workspaces");
    if (projects.height === this.sectionMeasurements.projects.height && projects.maxHeight === this.sectionMeasurements.projects.maxHeight
      && workspaces.height === this.sectionMeasurements.workspaces.height && workspaces.maxHeight === this.sectionMeasurements.workspaces.maxHeight) return;
    this.sectionMeasurements = { projects, workspaces };
  }

  private sectionSizeStyle(section: ResizableNavigationSection): Record<string, string> {
    const height = this.sectionSizes.height(section);
    return this.compact || height === undefined ? {} : { "--navigation-section-height": `${String(height)}px` };
  }

  private renderSectionResizeHandle(section: ResizableNavigationSection) {
    if (this.compact) return null;
    return html`<navigation-section-resize-handle
      slot=${section === "projects" ? "project-resize" : "workspace-resize"}
      .sectionLabel=${section === "projects" ? t("ui.projectList.projects", "Projects") : t("ui.workspaceList.workspaces", "Workspaces")}
      .controls=${`navigation-${section}`}
      .measurement=${this.sectionMeasurements[section]}
      .onResize=${(height: number) => { this.sectionSizes.resize(section, height); }}
      .onReset=${() => { this.sectionSizes.reset(section); }}
    ></navigation-section-resize-handle>`;
  }

  private measureSection(section: ResizableNavigationSection): NavigationSectionMeasurement {
    const target = this.renderRoot.querySelector<HTMLElement>(`#navigation-${section}`);
    const height = target?.getBoundingClientRect().height ?? 44;
    // Leave other sections where they are and preserve at least a session heading.
    const sessionsHeight = this.sessionList?.getBoundingClientRect().height ?? 44;
    return { height, maxHeight: Math.max(44, height + sessionsHeight - 44) };
  }

  @query("machine-list") private machineList?: KeyboardNavigableSection;
  @query("machine-switcher") private machineSwitcher?: KeyboardNavigableSection;
  @query("project-list") private projectList?: ProjectList;
  private get workspaceList(): WorkspaceList | undefined {
    return this.renderRoot.querySelector<WorkspaceList>("workspace-list")
      ?? this.renderRoot.querySelector<ProjectList>("project-list")?.shadowRoot?.querySelector<WorkspaceList>("workspace-list") ?? undefined;
  }

  private get sessionList(): SessionList | undefined {
    return this.renderRoot.querySelector<SessionList>("session-list")
      ?? this.workspaceList?.shadowRoot?.querySelector<SessionList>("session-list")
      ?? this.renderRoot.querySelector<ProjectList>("project-list")?.shadowRoot?.querySelector<SessionList>("session-list") ?? undefined;
  }

  automaticSessionCandidates(sessions: SessionInfo[]): SessionInfo[] {
    if (this.presentationRuntime?.navigationLayout() !== "tree" && this.sessionsCollapsed) return [];
    return this.sessionList?.automaticSessionCandidates(sessions) ?? [];
  }

  async focusSection(section: NavigationSection): Promise<boolean> {
    await this.updateComplete;
    await this.projectList?.updateComplete;
    if (this.presentationRuntime?.navigationLayout() === "tree" && (section === "workspaces" || section === "sessions")) {
      await this.projectList?.revealSelectedBranch();
      if (section === "sessions") await this.workspaceList?.revealSelectedBranch();
    }
    if (section === "sessions") await this.workspaceList?.updateComplete;
    switch (section) {
      case "machines": return await this.focusNavigableSection(this.compact ? this.machineList : this.machineSwitcher);
      case "projects": return await this.focusNavigableSection(this.projectList);
      case "workspaces": return this.workspaceSelectionVisible && await this.focusNavigableSection(this.workspaceList);
      case "sessions": return await this.focusNavigableSection(this.sessionList);
    }
  }

  // Stable child inputs delegate at invocation time, never capturing old props.
  private readonly childCallbacks = {
    moveProject: (project: Project, direction: -1 | 1) => this.onMoveProject?.(project, direction),
    moveWorkspace: (workspace: Workspace, direction: -1 | 1) => this.onMoveWorkspace?.(workspace, direction),
    moveSessionPin: (session: SessionInfo, direction: -1 | 1) => this.onMoveSessionPin?.(session, direction),
    toggleProjects: () => { this.onToggleProjects?.(); },
    selectProject: (project: Project) => this.onSelectProject?.(project),
    closeProject: (project: Project) => this.onCloseProject?.(project),
    toggleWorkspaces: () => { this.onToggleWorkspaces?.(); },
    selectWorkspace: (workspace: Workspace) => this.onSelectWorkspace?.(workspace),
    deleteWorkspace: (workspace: Workspace) => this.onDeleteWorkspace?.(workspace),
    toggleSessions: () => { this.onToggleSessions?.(); },
    archivedCollapsed: () => this.onArchivedCollapsed?.(),
    startSession: () => this.onStartSession?.(),
    selectSession: (session: SessionInfo) => this.onSelectSession?.(session),
    searchSessions: () => this.onSearchSessions?.(),
    toggleSessionPin: (session: SessionInfo) => this.onToggleSessionPin?.(session),
    renameSession: (session: SessionInfo, name: string) => this.onRenameSession?.(session, name),
    archiveSession: (session: SessionInfo) => this.onArchiveSession?.(session),
    archiveSessionWithDescendants: (session: SessionInfo) => this.onArchiveSessionWithDescendants?.(session),
    archiveSessions: (sessions: SessionInfo[]) => this.onArchiveSessions?.(sessions),
    restoreSession: (session: SessionInfo) => this.onRestoreSession?.(session),
    deleteCachedNewSession: (session: SessionInfo) => this.onDeleteCachedNewSession?.(session),
    deleteArchivedSession: (session: SessionInfo) => this.onDeleteArchivedSession?.(session),
    deleteArchivedSessions: (sessions: SessionInfo[]) => this.onDeleteArchivedSessions?.(sessions),
    detachParentSession: (session: SessionInfo) => this.onDetachParentSession?.(session),
    markSessionRead: (session: SessionInfo) => this.onMarkSessionRead?.(session),
    markSessionsRead: (sessions: SessionInfo[]) => this.onMarkSessionsRead?.(sessions),
    reloadSession: (session: SessionInfo) => this.onReloadSession?.(session),
    cleanupSessions: () => this.onCleanupSessions?.(),
    previousFromProjects: () => { this.focusPreviousFrom("projects"); },
    nextFromProjects: () => { this.focusNextFrom("projects"); },
    previousFromWorkspaces: () => { this.focusPreviousFrom("workspaces"); },
    nextFromWorkspaces: () => { this.focusNextFrom("workspaces"); },
    previousFromSessions: () => { this.focusPreviousFrom("sessions"); },
    nextFromSessions: () => { this.focusNextFrom("sessions"); },
    cancelKeyboardNavigation: () => { this.cancelKeyboardNavigation(); },
  };

  override render() {
    const treeLayout = this.presentationRuntime?.navigationLayout() === "tree";
    const showMachines = shouldShowMachinesSection(this.machines);
    const showMachineSwitcher = !this.managementMode || showMachines || this.locationIndicator;
    const showHeaderActions = this.refreshControl !== undefined || this.onShowActions !== undefined;
    const showHeader = this.showBrand || showMachineSwitcher || showHeaderActions || this.onTogglePanel !== undefined;
    return html`
      <pi-web-ui-presentation region="navigation" .runtime=${this.presentationRuntime} .context=${this.navigationPresentationContext()}>
      ${showHeader ? html`<header slot="header">
        ${renderPanelToggleButton("navigation", false, this.onTogglePanel)}
        ${showMachineSwitcher ? html`
          <machine-switcher
            .machines=${this.machines}
            .selected=${this.selectedMachine}
            .locationIndicator=${this.locationIndicator}
            .statuses=${this.machineStatuses}
            .activities=${this.machineActivities}
            .unreadMachineIds=${this.unreadPresence.machines}
            .statusSnapshots=${this.machineStatusSnapshots}
            .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
            .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
            .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
            .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
          ></machine-switcher>
        ` : null}
        ${showHeaderActions ? html`<div class="header-actions">
          ${this.refreshControl}
          ${this.onShowActions === undefined ? null : html`
            <button type="button" class="ui-button actions-button" title="${t("client.actions.show.actions.a514ad", "Show actions")}" aria-label="${t("client.actions.show.actions.a514ad", "Show actions")}" @click=${() => { this.onShowActions?.(); }}>
              <svg class="actions-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 2 4 14h7l-1 8 10-13h-7V2Z"></path></svg>
              <span class="actions-label">${t("ui.appNavigationPanel.actions", "Actions")}</span>
            </button>
          `}
        </div>` : null}
      </header>` : null}
      ${this.compact && showMachines ? html`
        <machine-list
          slot="machines"
          .machines=${this.machines}
          .selected=${this.selectedMachine}
          .statuses=${this.machineStatuses}
          .activities=${this.machineActivities}
          .unreadMachineIds=${this.unreadPresence.machines}
          .statusSnapshots=${this.machineStatusSnapshots}
          .collapsible=${this.collapsible}
          .collapsed=${this.machinesCollapsed}
          .onToggleCollapsed=${() => { this.onToggleMachines?.(); }}
          .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
          .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
          .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
          .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
        ></machine-list>
      ` : null}
      ${this.renderProjectList(treeLayout)}
      ${treeLayout ? nothing : html`
        ${this.projectsCollapsed ? null : this.renderSectionResizeHandle("projects")}
        ${this.workspaceSelectionVisible ? html`${this.renderWorkspaceList(false)}${this.workspacesCollapsed ? null : this.renderSectionResizeHandle("workspaces")}` : null}
        ${this.renderSessionList(false)}
      `}
      </pi-web-ui-presentation>
    `;
  }

  private renderProjectList(treeLayout: boolean) {
    return html`<project-list
        slot="projects"
        .machineId=${this.selectedMachine?.id ?? "local"}
        id="navigation-projects"
        style=${styleMap(this.sectionSizeStyle("projects"))}
        ?data-manual-size=${!this.compact && this.sectionSizes.height("projects") !== undefined}
        .projects=${this.projects}
        .selected=${this.selectedProject}
        .activities=${this.workspaceActivities}
        .workspacesByProjectId=${this.workspacesByProjectId}
        .unreadProjectIds=${this.unreadPresence.projects}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .collapsible=${!treeLayout && this.collapsible}
        .collapsed=${!treeLayout && this.projectsCollapsed}
        .managementMode=${this.managementMode}
        .treeLayout=${treeLayout}
        .selectedChildren=${treeLayout ? this.treeChildren() : undefined}
        .onToggleCollapsed=${this.childCallbacks.toggleProjects}
        .onSelect=${this.childCallbacks.selectProject}
        .onClose=${this.childCallbacks.closeProject}
        .onMove=${this.managementMode || this.onMoveProject === undefined ? undefined : this.childCallbacks.moveProject}
        .onFocusPreviousSection=${this.childCallbacks.previousFromProjects}
        .onFocusNextSection=${this.childCallbacks.nextFromProjects}
        .onCancelKeyboardNavigation=${this.childCallbacks.cancelKeyboardNavigation}
      ></project-list>`;
  }

  private treeChildInputs: readonly unknown[] = [];
  private treeChildContent: TemplateResult | undefined;

  private clearTreeCache(): void {
    if (this.treeChildContent === undefined) return;
    this.treeChildInputs = [];
    this.treeChildContent = undefined;
    this.filteredWorkspaceSource = undefined;
    this.filteredWorkspaces = [];
    this.filteredSessionSource = undefined;
    this.filteredSessions = [];
  }

  private treeChildren(): TemplateResult {
    const inputs = [this.selectedMachine?.id, this.selectedProject?.id, this.selectedWorkspace, this.workspaceSelectionVisible,
      this.workspaces, this.workspaceActivities, this.deletingWorkspaceIds, this.unreadPresence.workspaces,
      this.selectedMachineStatusSnapshot(), this.collapsible, this.workspacesCollapsed, this.workspaceLabelItems, this.managementMode,
      this.onMoveWorkspace === undefined, this.sessions, this.pinnedSessionIds, this.pinnedRootIds, this.onMoveSessionPin === undefined,
      this.sessionStatuses, this.sessionActivities, this.sendingPrompts, this.unreadSessionIds, this.selectedSession, this.sessionLabelItems,
      this.startingSessionCount, this.canStartSession, this.canDeleteArchivedSessions, this.canReloadSessions, this.canCleanupSessions,
      this.authoritativeSessionPersistence, this.archivedDeleteUnavailableMessage, this.cleanupUnavailableMessage, this.sessionsCollapsed];
    if (this.treeChildContent !== undefined && inputs.every((value, index) => value === this.treeChildInputs[index])) return this.treeChildContent;
    this.treeChildInputs = inputs;
    this.treeChildContent = this.selectedProject === undefined ? html``
      : this.workspaceSelectionVisible ? this.renderWorkspaceList(true)
      : this.selectedWorkspace?.projectId === this.selectedProject.id ? this.renderSessionList(true) : html``;
    return this.treeChildContent;
  }

  private filteredWorkspaces: Workspace[] = [];
  private filteredWorkspaceSource: Workspace[] | undefined;
  private filteredWorkspaceProject: string | undefined;

  private treeWorkspaces(): Workspace[] {
    if (this.filteredWorkspaceSource !== this.workspaces || this.filteredWorkspaceProject !== this.selectedProject?.id) {
      this.filteredWorkspaceSource = this.workspaces;
      this.filteredWorkspaceProject = this.selectedProject?.id;
      this.filteredWorkspaces = this.workspaces.filter((workspace) => workspace.projectId === this.selectedProject?.id);
    }
    return this.filteredWorkspaces;
  }

  private filteredSessions: SessionInfo[] = [];
  private filteredSessionSource: SessionInfo[] | undefined;
  private filteredSessionWorkspace: string | undefined;

  private treeSessions(): SessionInfo[] {
    const path = this.selectedWorkspace?.projectId === this.selectedProject?.id ? this.selectedWorkspace?.path : undefined;
    if (this.filteredSessionSource !== this.sessions || this.filteredSessionWorkspace !== path) {
      this.filteredSessionSource = this.sessions;
      this.filteredSessionWorkspace = path;
      this.filteredSessions = path === undefined ? [] : this.sessions.filter((session) => session.cwd === path);
    }
    return this.filteredSessions;
  }

  private renderWorkspaceList(treeLayout: boolean) {
    return html`<workspace-list
        slot="workspaces"
        id="navigation-workspaces"
        style=${styleMap(this.sectionSizeStyle("workspaces"))}
        ?data-manual-size=${!this.compact && this.sectionSizes.height("workspaces") !== undefined}
        .machineId=${this.selectedMachine?.id ?? "local"}
        .managementMode=${this.managementMode}
        .workspaces=${treeLayout ? this.treeWorkspaces() : this.workspaces}
        .selected=${treeLayout && this.selectedWorkspace?.projectId !== this.selectedProject?.id ? undefined : this.selectedWorkspace}
        .treeLayout=${treeLayout}
        .selectedChildren=${treeLayout ? this.renderSessionList(true) : undefined}
        .activities=${this.workspaceActivities}
        .deletingWorkspaceIds=${this.deletingWorkspaceIds}
        .unreadWorkspaceIds=${this.unreadPresence.workspaces}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .collapsible=${!treeLayout && this.collapsible}
        .collapsed=${!treeLayout && this.workspacesCollapsed}
        .workspaceLabelItems=${this.workspaceLabelItems}
        .onToggleCollapsed=${this.childCallbacks.toggleWorkspaces}
        .onSelect=${this.childCallbacks.selectWorkspace}
        .onDelete=${this.childCallbacks.deleteWorkspace}
        .onMove=${this.managementMode || this.onMoveWorkspace === undefined ? undefined : this.childCallbacks.moveWorkspace}
        .onFocusPreviousSection=${this.childCallbacks.previousFromWorkspaces}
        .onFocusNextSection=${this.childCallbacks.nextFromWorkspaces}
        .onCancelKeyboardNavigation=${this.childCallbacks.cancelKeyboardNavigation}
      ></workspace-list>`;
  }

  private renderSessionList(treeLayout: boolean) {
    return html`<session-list
        slot="sessions"
        .externalScroll=${treeLayout}
        .scopeKey=${sessionListScopeKey(this.selectedMachine?.id, this.selectedWorkspace?.id)}
        .sessions=${treeLayout ? this.treeSessions() : this.sessions}
        .pinnedSessionIds=${this.pinnedSessionIds}
        .pinnedRootIds=${this.pinnedRootIds}
        .onMovePin=${this.managementMode || this.onMoveSessionPin === undefined ? undefined : this.childCallbacks.moveSessionPin}
        .statuses=${this.sessionStatuses}
        .activities=${this.sessionActivities}
        .sessionFlags=${this.selectedMachineStatusSnapshot()?.sessions}
        .sending=${this.sendingPrompts}
        .unreadSessionIds=${this.unreadSessionIds}
        .selected=${treeLayout && this.selectedSession?.cwd !== this.selectedWorkspace?.path ? undefined : this.selectedSession}
        .sessionLabelItems=${this.sessionLabelItems}
        .startingCount=${this.startingSessionCount}
        .canStart=${this.canStartSession}
        .canDeleteArchived=${this.canDeleteArchivedSessions}
        .canReload=${this.canReloadSessions}
        .canCleanup=${this.canCleanupSessions}
        .authoritativeSessionPersistence=${this.authoritativeSessionPersistence}
        .archivedDeleteUnavailableMessage=${this.archivedDeleteUnavailableMessage}
        .cleanupUnavailableMessage=${this.cleanupUnavailableMessage}
        .collapsible=${!treeLayout && this.collapsible}
        .collapsed=${!treeLayout && this.sessionsCollapsed}
        .onToggleCollapsed=${this.childCallbacks.toggleSessions}
        .onArchivedCollapsed=${this.childCallbacks.archivedCollapsed}
        .onStart=${this.childCallbacks.startSession}
        .onSelect=${this.childCallbacks.selectSession}
        .onSearch=${this.childCallbacks.searchSessions}
        .onTogglePin=${this.childCallbacks.toggleSessionPin}
        .onArchive=${this.childCallbacks.archiveSession}
        .onArchiveWithDescendants=${this.childCallbacks.archiveSessionWithDescendants}
        .onArchiveMany=${this.childCallbacks.archiveSessions}
        .onRestore=${this.childCallbacks.restoreSession}
        .onDelete=${this.childCallbacks.deleteCachedNewSession}
        .onDeleteArchived=${this.childCallbacks.deleteArchivedSession}
        .onDeleteArchivedMany=${this.childCallbacks.deleteArchivedSessions}
        .onRename=${this.childCallbacks.renameSession}
        .onDetachParent=${this.childCallbacks.detachParentSession}
        .onMarkRead=${this.childCallbacks.markSessionRead}
        .onMarkReadMany=${this.childCallbacks.markSessionsRead}
        .onReload=${this.childCallbacks.reloadSession}
        .onCleanup=${this.childCallbacks.cleanupSessions}
        .onFocusPreviousSection=${this.childCallbacks.previousFromSessions}
        .onFocusNextSection=${this.childCallbacks.nextFromSessions}
        .onCancelKeyboardNavigation=${this.childCallbacks.cancelKeyboardNavigation}
      ></session-list>`;
  }

  private selectedMachineStatusSnapshot(): MachineStatusSnapshot | undefined {
    return this.machineStatusSnapshots[selectedMachineId({ selectedMachine: this.selectedMachine })];
  }

  private async focusNavigableSection(section: KeyboardNavigableSection | undefined): Promise<boolean> {
    if (section === undefined) return false;
    return await section.focusSelectedOrFirst();
  }

  private focusPreviousFrom(section: NavigationSection): void {
    const target = previousVisibleNavigationTarget(section, this.machines, this.workspaceSelectionVisible);
    if (target !== undefined) void this.onFocusNavigationTarget?.(target);
  }

  private focusNextFrom(section: NavigationSection): void {
    void this.onFocusNavigationTarget?.(nextVisibleNavigationTarget(section, this.machines, this.workspaceSelectionVisible));
  }

  private cancelKeyboardNavigation(): void {
    void this.onCancelKeyboardNavigation?.();
  }

  static override styles = [uiButtonStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; container: navigation-panel / inline-size; }
    :host([compact]) { flex: 1 1 auto; }
    header { flex: 0 0 auto; display: flex; align-items: stretch; min-height: 44px; gap: 0; padding: 0; border-bottom: 1px solid var(--pi-border); }
    machine-switcher { flex: 1 1 auto; min-width: 0; }
    :host([compact]) header { display: none; }
    .header-actions { flex: 0 0 auto; display: flex; align-items: stretch; gap: 0; border-inline-start: 1px solid var(--pi-border-muted); }
    .header-actions > * + * { border-inline-start: 1px solid var(--pi-border-muted); }
    .panel-toggle { border-inline-end: 1px solid var(--pi-border-muted); }
    .actions-icon { flex: 0 0 auto; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    @container navigation-panel (max-width: 400px) {
      .actions-label { display: none; }
      .actions-button { min-width: 44px; padding-inline: 0; }
    }
    /* Projects and workspaces default to content height capped at a third of
       the area below the header, matching sessions when both lists are long.
       Explicit heights survive content/navigation changes; flex shrink only
       constrains them when the viewport cannot fit every section's minimum.
       Sessions take the remaining space. */
    machine-list, project-list, workspace-list, session-list { box-sizing: border-box; flex: 1 1 0px; min-height: 0; overflow: hidden; border-bottom: 1px solid var(--pi-border-muted); }
    project-list:not([collapsed]), workspace-list:not([collapsed]) { flex: 0 1 auto; max-height: calc(100% / 3); min-height: 44px; }
    project-list[data-manual-size]:not([collapsed]), workspace-list[data-manual-size]:not([collapsed]) { flex-basis: var(--navigation-section-height); max-height: none; }
    session-list:not([collapsed]) { min-height: 44px; }
    :host([compact]) project-list:not([collapsed]), :host([compact]) workspace-list:not([collapsed]) { flex: 1 1 0px; max-height: none; }
    /* A collapsed heading already owns its separator; do not add a second line. */
    machine-list[collapsed],
    project-list[collapsed],
    workspace-list[collapsed],
    session-list[collapsed] { flex: 0 0 auto; min-height: auto; overflow: hidden; border-bottom: 0; }
  `];
}

function sessionListScopeKey(machineId: string | undefined, workspaceId: string | undefined): string {
  return JSON.stringify([machineId ?? "", workspaceId ?? ""]);
}

export function shouldShowMachinesSection(machines: readonly Machine[]): boolean {
  return machines.length > 1;
}

function previousVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[], workspaceSelectionVisible = true): NavigationSection | undefined {
  const sections = visibleNavigationSections(machines, workspaceSelectionVisible);
  return sections[sections.indexOf(section) - 1];
}

function nextVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[], workspaceSelectionVisible = true): NavigationFocusTarget {
  const sections = visibleNavigationSections(machines, workspaceSelectionVisible);
  return sections[sections.indexOf(section) + 1] ?? "chat";
}

// Only a machine choice makes the machines section navigable: with a single
// machine the switcher is a static identity, and compact mode has no list.
function visibleNavigationSections(machines: readonly Machine[], workspaceSelectionVisible = true): NavigationSection[] {
  return NAVIGATION_SECTION_ORDER.filter((section) => (section !== "machines" || shouldShowMachinesSection(machines))
    && (section !== "workspaces" || workspaceSelectionVisible));
}
