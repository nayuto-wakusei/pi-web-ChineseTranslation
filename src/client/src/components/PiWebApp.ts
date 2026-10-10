import { css, LitElement, html, type TemplateResult } from "lit";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings } from "./deprecatedAgentInputsBanner";
import { customElement, query, state } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { configApi, effectiveWorkspaceUploadFolder, normalAuthApi, sessionsApi, setApiScope, terminalsApi, workspacesApi, workspaceEffectiveUploadFolder, type ApiScope, type AskUserSubmission, type CommandOption, type ExtensionDialogAnswer, type Machine, type MachineHealth, type NormalAuthStatusResponse, type PiWebConfigValues, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionContentSearchMatch, type SessionInfo, type SessionModel, type SessionModelCatalogEntry, type SessionModelScopeMode, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { AppAction } from "../actions";
import { initialAppState, type AppState, type ModelDialogOrigin } from "../appState";
import { browserErrorContext, browserErrorScopeKey, BrowserErrorReporter, clearBrowserError, machineBrowserErrorScope, projectBrowserErrorScope, visibleBrowserErrors, workspaceBrowserErrorScope, type BrowserError, type BrowserErrorScope } from "../browserErrors";
import { isSessionActive } from "../../../shared/activity";
import { workspaceDeleteOperation } from "../../../shared/workspaceDeletion";
import { isKnownThinkingLevel, thinkingLevelDescription, thinkingLevelDisplayLabel } from "../../../shared/thinkingLevels";
import { ActivityController } from "../controllers/activityController";
import { AuthController } from "../controllers/authController";
import { FileExplorerController } from "../controllers/fileExplorerController";
import { GitController } from "../controllers/gitController";
import { MachineController } from "../controllers/machineController";
import { MachineStatusController } from "../controllers/machineStatusController";
import { ProjectController, type ProjectTrustChoice } from "../controllers/projectController";
import { ProjectActivityOwnershipCoordinator } from "../controllers/projectActivityOwnershipCoordinator";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { SessionController, type PendingSessionStartNavigation } from "../controllers/sessionController";
import { SessionNotificationController } from "../controllers/sessionNotificationController";
import { WorkspaceController } from "../controllers/workspaceController";
import { emptyMachineNavigationSnapshot, machineNavigationSnapshotFromState, routeFromMachineNavigationSnapshot, SessionStorageMachineNavigationMemory, type MachineNavigationSnapshot, type WorkspaceRouteSurface } from "../controllers/machineNavigationMemory";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageTerminalSelectionMemory } from "../controllers/terminalSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { composerShortcutActions } from "../composerShortcuts";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { selectedMachineId, type NavigationDestinationOptions, type NavigationFreshness, type NavigationScope, type NavigationSelection } from "../controllers/types";
import { markdownWorkspaceContext, type WorkspaceFileOpenRequest } from "../formatting/workspaceLinks";
import { machineSessionKey } from "../machineKeys";
import { sessionCleanupRequestKey, sessionCleanupUnavailableMessage } from "../sessionCleanupUi";
import { selectedNotificationView } from "../sessionNotifications";
import { SessionUnreadController } from "../sessionUnread";
import { deriveUnreadPresence, EMPTY_UNREAD_PRESENCE, sameUnreadPresence, type UnreadPresence } from "../unreadPresence";
import { initialSessionWarningVisibilityState, reconcileSessionWarningVisibility, toggleSessionWarnings } from "../sessionWarningVisibility";
import { RealtimeSocket, SessionSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import { ServerNoticesController, visibleServerNotices } from "../serverNotices";
import type { ServerNotice } from "../../../shared/apiTypes";
import { HttpRequestError } from "../api/http";
import { isManagementEmbedMode } from "../api/managementEmbed";
import { hasAuthoritativeSessionPersistence as runtimeHasAuthoritativeSessionPersistence } from "../sessionPersistence";
import type { PluginMachine, PluginNavigationDestination, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext, WorkspacePanelTerminal, WorkspacePluginBinding, WorkspaceTerminalCommandInput, PiWebPluginRegistration } from "../plugins/types";
import type { ExternalPluginLoadResult } from "../plugins/external";
import { CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { corePlugin } from "../plugins/core";
import { themePackPlugin } from "../plugins/themes";
import { PluginRegistry, installPluginRuntimeScope, installWorkspaceLabelScope, installWorkspacePanelScope, type BrowserPluginLifecyclePhase, type PluginRegistrationFailure } from "../plugins/registry";
import { createPluginPeer, createPluginWorkspaceBackend } from "../plugins/workspaceBackend";
import { createWorkspaceFiles } from "../plugins/workspaceFiles";
import { createWorkspacePanelNavigation } from "../plugins/workspacePanelNavigation";
import type { WorkspaceInvalidation } from "../plugins/types";
import { REQUIRED_TERMINAL_BROWSER_FACADE_CAPABILITY, requiredTerminalUnavailableError, type RequiredTerminalBrowserComposition, type WorkspaceContributionNavigationV1 } from "../plugins/requiredTerminalFacade";
import { REQUIRED_TERMINAL_PLUGIN_ID, type TerminalPluginMode } from "../../../shared/requiredTerminalPlugin";
import { machineScopedBundledPluginId } from "../../../shared/machinePluginIds";
import { MachinePluginLoadCoordinator } from "../plugins/machinePluginLoadCoordinator";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { contributionQueryFromRecord, patchContributionQueryRecord, readContributionQueryRecord, writeContributionQueryRecord, type ContributionQueryRecord } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { BrowserResumeController } from "../appShell/browserResumeController";
import { NavigationSectionsController, type NavigationSection } from "../appShell/navigationState";
import { PanelCollapseController, mainViewClass } from "../appShell/panelCollapseController";
import { PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { isCreatingSessionId, readRoute, resolveWorkspacePanelRouteValue, routeMatchesSessionCreation, writeRoute, type AppRoute, type ParsedAppRoute } from "../route";
import { availableNavigationTabs, hasHiddenActiveNavigationTab, loadNavigationPreferences, pinnedNavigationTabs, saveNavigationPreferences, selectedNavigationTab, type NavigationPreferences } from "../navigationPreferences";
import { readSettingsSection, writeSettingsSection, type SettingsSection } from "../settingsRoute";
import { effectiveWorkspaceAttachmentsFolder, workspaceEffectiveAttachmentsFolder } from "../api/workspaceAttachments";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { canDeleteWorkspace, isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, pendingWorkspaceDeletionIds, targetWorkspaceIdForRun, workspaceDeletionRunFilter, workspaceRemovalConfirmation } from "../workspaceDeletion";
import "./MachineList";
import "./ProjectList";
import "./WorkspaceList";
import { unreadSessionCount } from "./SessionList";
import "./SessionCleanupDialog";
import "./SessionSearchDialog";
import "./SessionTreeNavigator";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import "./ModelPicker";
import "./ActionPalette";
import "./AuthDialog";
import "./NormalAuthDialog";
import type { NormalAuthDialogMode, NormalAuthPasswordForm } from "./NormalAuthDialog";
import "./ProjectDialog";
import "./MachineDialog";
import type { MachineDialogSubmit } from "./MachineDialog";
import { deepActiveElement, focusElement, hasRenderedModal } from "./modalLayerRegistry";
import "./SettingsDialog";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppMobileMainTabs";
import type { AppMobileMainTab, AppMobileMainTabIcon } from "./appShell/AppMobileMainTabs";
import "./appShell/NavigationDialog";
import { shouldShowMachinesSection, type AppNavigationPanel, type NavigationFocusTarget } from "./appShell/AppNavigationPanel";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRefreshControl";
import { errorBanner } from "./errorBanner";

const appStyles = css`
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: 100dvh; box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: 14px system-ui, sans-serif; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: minmax(360px, 42vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1fr) 1px var(--workspace-panel-width); grid-template-rows: minmax(0, 1fr); height: 100%; max-height: 100%; min-height: 0; overflow: hidden; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 8px 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 4px 8px; font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  app-mobile-main-tabs { display: none; }
  .mobile-tabs-frame { position: relative; display: none; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
  .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
  .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
  .mobile-navigation-tab, .mobile-navigation-panel { display: none; }
  .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-badge { display: inline-block; min-width: 14px; margin-left: 4px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  .navigation-panel-edge, .workspace-panel-edge { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
  .navigation-panel-edge { grid-column: 2; }
  .workspace-panel-edge { grid-column: 4; }
  .navigation-panel-edge-button, .workspace-panel-edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
  .navigation-panel-edge-button:hover, .navigation-panel-edge-button:focus-visible, .workspace-panel-edge-button:hover, .workspace-panel-edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
  .shell.navigation-panel-collapsed .navigation-panel-edge-button { transform: translateX(calc(50% - .5px)); }
  .shell.workspace-panel-collapsed .workspace-panel-edge-button { transform: translateX(calc(-50% + .5px)); }
  .navigation-panel-edge-icon, .workspace-panel-edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  @media (min-width: 1181px) {
    .shell > aside, .shell > .navigation-panel-edge, .shell > main, .shell > .workspace-panel-edge, .shell > workspace-panel { grid-row: 1; height: 100%; max-height: 100%; }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    aside { grid-row: 1 / 3; }
    .navigation-panel-edge { grid-row: 1 / 3; }
    main { grid-column: 3; grid-row: 1 / 3; }
    app-mobile-main-tabs { display: block; flex: 0 0 auto; min-width: 0; }
    .mobile-tabs-frame { display: flex; }
    .shell.workspace-view main { grid-row: 1; min-height: auto; }
    .shell.workspace-view > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
    .shell:not(.workspace-view) > workspace-panel { display: none; }
    .workspace-panel-edge { display: none; }
    main.workspace-view chat-view, main.workspace-view prompt-editor, main.workspace-view status-bar,
    main.workspace-view .empty { display: none; }
    main.workspace-view { overflow: hidden; }
  }
  @media (max-width: 760px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside, .navigation-panel-edge { display: none; }
    main, .shell.workspace-view > workspace-panel { grid-column: 1; }
    .context-bar { display: flex; }
    .mobile-navigation-tab { display: block; }
    main.navigation-view chat-view, main.navigation-view prompt-editor, main.navigation-view status-bar,
    main.navigation-view .empty { display: none; }
    main.navigation-view .mobile-navigation-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    main.navigation-view .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  }
  status-bar { flex: 0 0 auto; }
  chat-view { flex: 1 1 0; min-height: 0; max-height: 100%; overflow: hidden; contain: size layout; }
  prompt-editor { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  .empty { margin: auto; color: var(--pi-muted); }
  .error { padding: 10px 16px; border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }
`;


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
const SELECTED_SESSION_REFRESH_MS = 5_000;
const PI_WEB_STATUS_DEFER_MS = 750;
const REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000] as const;
const NAVIGATION_SCOPES = ["machine", "project", "workspace", "session", "tool", "view"] as const;
const ROUTE_SELECTION_SCOPE = ["machine", "project", "workspace", "session"] as const;
const WORKSPACE_SURFACE_SCOPE = ["tool", "view"] as const;
const WORKSPACE_DELETION_RECONCILE_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const FILES_PANEL_ALIASES = ["files", "core:workspace.files"] as const;
const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");
const TERMINAL_ROUTE_NAMESPACES = ["pi-web.terminal.workspace.terminal", "core.workspace.terminal"] as const;
const TERMINAL_PANEL_IDS = ["pi-web.terminal:workspace.terminal", "core:workspace.terminal"] as const;
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;
const DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY = "(min-width: 1181px)";

interface SessionCleanupDialogState {
  preview?: SessionCleanupPreviewResponse | undefined;
  previewRequest?: SessionCleanupRequest | undefined;
  result?: SessionCleanupExecuteResponse | undefined;
  loading?: boolean | undefined;
  running?: boolean | undefined;
  error?: string | undefined;
}

@customElement("pi-web-app")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();
  private readonly browserErrors = new BrowserErrorReporter(() => this.state, (patch) => { this.setState(patch); });
  @query("chat-view") private chatView?: ChatView;
  @query("prompt-editor") private promptEditor?: PromptEditor;
  @query("app-navigation-panel") private navigationPanel?: AppNavigationPanel;
  @query("#navigation-panel") private navigationPanelFrame?: HTMLElement;
  @query("#workspace-panel") private workspacePanelFrame?: HTMLElement;

  private readonly apiScope = initializeApiScope();
  private readonly sessionUnread = new SessionUnreadController({
    onChange: (machineId) => {
      this.syncUnreadPresence();
      if (selectedMachineId(this.state) !== machineId) return;
      this.syncUnreadSessionIds();
      this.syncSelectedSessionReadState();
    },
    onBackgroundError: (operation, machineId, error) => {
      console.warn(`Failed to ${operation} session unread state for ${machineId}`, error);
    },
  });
  @state() private unreadSessionIds: ReadonlySet<string> = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
  @state() private unreadPresence: UnreadPresence = EMPTY_UNREAD_PRESENCE;
  private unreadConnected = false;
  private committedChatIdentity: string | undefined;
  private readyChatIdentity: string | undefined;
  private modelDialogInstanceId = 0;
  private modelDialogMutationInFlight = 0;
  private modelDialogRefreshPending = false;
  private modelDialogScopeInvalidation = 0;
  private readonly notifications = new SessionNotificationController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onBackgroundError: (message, error) => { console.warn(message, error); } },
  );
  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    new SessionStorageSessionSelectionMemory(),
    {
      socket: new SessionSocket(this.apiScope),
      notifications: this.notifications,
      captureNavigation: () => this.captureNavigation(),
      beginNavigationOperation: (scope) => this.beginNavigationOperation(scope),
      navigateToSession: (session, options) => this.navigateToSessionFromController(session, options),
      onSelectedSessionReady: ({ machineId, session }) => {
        void this.commitReadyChatAfterRender(machineId, session);
      },
      isPendingSessionStartRouteCurrent: (navigation) => this.isPendingSessionStartRouteCurrent(navigation),
      onPendingSessionStartCommitted: (navigation, session) => { this.commitPendingSessionStartNavigation(navigation, session); },
      onModelScopeChanged: () => {
        this.modelDialogScopeInvalidation += 1;
        void this.refreshOpenModelDialog();
      },
      replacePromptEditorText: async ({ machineId, sessionId, text }) => {
        await this.updateComplete;
        if (selectedMachineId(this.state) !== machineId || this.state.selectedSession?.id !== sessionId) return;
        this.promptEditor?.replaceText(text);
      },
    },
  );
  private readonly projectActivityOwnership = new ProjectActivityOwnershipCoordinator(
    () => this.state,
    (patch) => { this.setState(patch); },
    {
      api: workspacesApi,
      onError: ({ machineId, projectId, error }) => {
        console.warn(`Failed to discover project activity ownership for ${projectId} on ${machineId}`, error);
      },
    },
  );
  private readonly activity = new ActivityController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onActivityApplied: (machineId) => { void this.projectActivityOwnership.handleActivityApplied(machineId); } },
  );
  private readonly machineStatus = new MachineStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
  );
  private readonly auth = new AuthController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (status) => { this.sessions.applySessionStatus(status); },
    { scope: this.apiScope },
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.sessions,
    new SessionStorageWorkspaceSelectionMemory(),
    {
      captureNavigation: () => this.captureNavigation(),
      beginNavigationOperation: (scope) => this.beginNavigationOperation(scope),
      navigateToWorkspace: (workspace, options) => this.navigateToWorkspaceFromController(workspace, options),
    },
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
    {
      onProjectsApplied: (machineId) => { void this.projectActivityOwnership.handleProjectsApplied(machineId); },
      captureNavigation: () => this.captureNavigation(),
      navigateToProject: (project, options) => this.navigateToProjectFromController(project, options),
    },
  );
  private readonly machines = new MachineController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.projects,
    {
      captureNavigation: () => this.captureNavigation(),
      navigateToMachine: (machine, options) => this.selectMachineWithMemory(machine, options),
    },
  );
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onRefreshError: (machineId, error) => { console.warn(`Failed to refresh PI WEB status for ${machineId}`, error); } },
  );
  private readonly files = new FileExplorerController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly git = new GitController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly keyboard = new KeyboardShortcutDispatcher();
  private readonly realtime = new RealtimeSocket(this.apiScope);
  private readonly serverNotices = new ServerNoticesController({
    onChange: (machineId) => {
      if (selectedMachineId(this.state) === machineId) this.requestUpdate();
    },
    onBackgroundError: (operation, machineId, error) => {
      console.warn(`Failed to ${operation} server notices for ${machineId}`, error);
    },
  });
  private readonly machineRealtimeSockets = new Map<string, RealtimeSocket>();
  private readonly unreadRuntimeRefreshes = new Map<string, Promise<void>>();

  private readonly machineNavigation = new SessionStorageMachineNavigationMemory();
  private readonly terminalSelection = new SessionStorageTerminalSelectionMemory();
  private readonly appShell = new AppShellController(this);
  private readonly browserResume = new BrowserResumeController({
    onResumeSignal: () => { this.handleBrowserResumeSignal(); },
    refreshAfterResume: () => this.refreshAfterBrowserResume(),
    onRefreshError: (error) => { console.warn("Failed to refresh after browser resume", error); },
  });
  private readonly panelCollapse = new PanelCollapseController(this);
  private readonly panelResize = new PanelResizeController(this);
  private readonly navigationSections = new NavigationSectionsController(
    this,
    () => this.state,
    () => this.appShell.isMobileNavigationLayout,
  );
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  private piWebStatusTimer: number | undefined;
  private selectedSessionRefreshTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private workspaceDeletionRefreshAbort: AbortController | undefined;
  private workspaceDeletionRefreshScope: string | undefined;
  private workspaceDeletionRefreshQueued = false;
  private workspaceDeletionRefreshGeneration = 0;
  private readonly workspaceDeletionReconcileRetries = new Map<string, { attempt: number; retryAt: number }>();
  private readonly handledWorkspaceDeletionRunIds = new Set<string>();
  private readonly terminalCommandRunRuntimes = new Map<string, TerminalCommandRunsInternalRuntime>();
  private machineNavigationRestoreSeq = 0;
  private navigationSelectionSeq = 0;
  private routeRestoreSeq = 0;
  private workspaceNavigationGeneration = 0;
  private routeSelectionRestoreSeq = 0;
  private navigationGeneration = 0;
  private readonly navigationFieldGenerations: Record<NavigationScope, number> = { machine: 0, project: 0, workspace: 0, session: 0, tool: 0, view: 0 };
  private observedNavigationRoute: ParsedAppRoute | undefined;
  private routeContentOutcome: { destination: string; error: string } | undefined;
  private routeRestoreDepth = 0;
  private restoringRouteTerminalId: string | undefined;
  private pendingRemoteRouteRestore: ParsedAppRoute | undefined;
  private remoteRouteRestoreTimer: number | undefined;
  private remoteRouteRestoreAttempt = 0;
  private remoteRouteRestoreInProgress = false;
  private readonly pluginLoadErrors = new Map<string, string>();
  private readonly requiredTerminalByMachine = new Map<string, RequiredTerminalBrowserComposition>();
  private readonly knownRequiredTerminalByMachine = new Map<string, RequiredTerminalBrowserComposition>();
  private readonly verifiedPluginModeByMachine = new Map<string, TerminalPluginMode>();
  private readonly requiredPluginFailureByMachine = new Map<string, string>();
  private readonly dismissedRequiredPluginFailureByMachine = new Map<string, string>();
  private readonly plugins = new PluginRegistry({ isContributionEnabled: (pluginId, machineId) => this.pluginContributionAvailable(pluginId, machineId) });
  private readonly resetKeyboardSequence = () => { this.keyboard.reset(); };
  private readonly builtInPluginsReady = this.plugins.registerBatch([
    { id: "core", plugin: corePlugin },
    { id: "themes", plugin: themePackPlugin },
  ]).then(({ failures }) => {
    if (failures.length > 0) throw failures[0]?.error;
    this.invalidateWorkspaceSurface();
  });
  private readonly pluginLoads = new MachinePluginLoadCoordinator(
    (label, load, machineId) => this.registerExternalPlugins(label, load, machineId),
    (id, machineSpecific) => this.plugins.shouldLoadRemotePlugin(id, machineSpecific) && !(this.apiScope === "management" && id === "pi-web.terminal"),
  );
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  @state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
  @state() private navigationPreferences: NavigationPreferences = loadNavigationPreferences();
  @state() private navigationDialogOpen = false;
  @state() private isRefreshingApp = false;
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private sessionSearchDialogOpen = false;
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  @state() private normalAuthStatus: NormalAuthStatusResponse | undefined;
  @state() private normalAuthLoading = true;
  @state() private normalAuthError = "";
  @state() private normalAuthDialogMode: NormalAuthDialogMode | undefined;
  @state() private shortcutConfig: PiWebShortcutConfig = {};
  @state() private workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(undefined);
  @state() private workspaceAttachmentsDefaultFolder = effectiveWorkspaceAttachmentsFolder(undefined);
  private sessionWarningVisibility = initialSessionWarningVisibilityState();
  private authenticatedAppRunning = false;
  private normalAuthInitSeq = 0;
  private readonly onPopState = () => {
    this.navigationSelectionSeq += 1;
    this.workspaceNavigationGeneration += 1;
    void this.withChatScrollTransition(async () => {
      this.restoreSettingsRoute();
      await this.restoreRoute(false);
    });
  };
  private readonly onPageShow = () => {
    void this.renegotiateUnreadMachines();
    this.appShell.repairViewportPosition();
    this.retryPendingRemoteRouteRestoreSoon();
  };
  private readonly onSystemLightThemeChange = () => {
    if (this.themePreference.auto) this.applyPreferredTheme(false);
  };
  private get routeRestoreInProgress(): boolean {
    return this.routeRestoreDepth > 0;
  }
  private previousStackedWorkspaceLayout = this.appShell.isStackedWorkspaceLayout;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.isRenderedModalOpen() || this.promptEditor?.ownsKeyboardEvent(event) === true) {
      this.keyboard.reset();
      return;
    }
    if (this.keyboard.handle(event, this.getDefaultActions(), { shortcuts: this.shortcutConfig })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  protected override willUpdate(): void {
    this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
    this.normalizeMainViewForLayoutChange();
    this.syncSessionWarningVisibility();
  }

  protected override updated(): void {
    this.committedChatIdentity = selectedChatIdentity(this.state);
    this.syncSelectedSessionReadState();
  }

  private syncSessionWarningVisibility(): void {
    const session = this.state.selectedSession;
    this.sessionWarningVisibility = reconcileSessionWarningVisibility(
      this.sessionWarningVisibility,
      session === undefined ? undefined : machineSessionKey(selectedMachineId(this.state), session.id),
      this.state.status?.warnings,
    );
  }

  private syncSelectedSessionReadState(): void {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    if (!this.isSessionSeen(machineId, session)) return;
    void this.sessionUnread.acknowledge(machineId, session);
  }

  private markSessionsRead(sessions: readonly SessionInfo[]): void {
    const machineId = selectedMachineId(this.state);
    for (const session of sessions) void this.sessionUnread.acknowledge(machineId, session);
  }

  private async commitReadyChatAfterRender(machineId: string, session: SessionInfo): Promise<void> {
    const identity = unreadChatIdentity(machineId, session);
    await this.updateComplete;
    if (!this.unreadConnected || selectedChatIdentity(this.state) !== identity) return;
    this.readyChatIdentity = identity;
    this.syncSelectedSessionReadState();
  }

  private syncUnreadSessionIds(): void {
    const next = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
    if (!sameStringSet(next, this.unreadSessionIds)) this.unreadSessionIds = next;
  }

  private syncUnreadPresence(): void {
    const next = deriveUnreadPresence({
      machineIds: this.state.machines.map((machine) => machine.id),
      projectionFor: (machineId) => this.sessionUnread.projection(machineId),
      selectedMachineId: selectedMachineId(this.state),
      projects: this.state.projects,
      workspaces: this.state.workspaces,
      workspacesByProjectId: this.state.workspacesByProjectId,
    });
    if (!sameUnreadPresence(next, this.unreadPresence)) this.unreadPresence = next;
  }

  private isSessionSeen(machineId: string, session: SessionInfo): boolean {
    if (!this.unreadConnected) return false;
    const identity = unreadChatIdentity(machineId, session);
    if (selectedChatIdentity(this.state) !== identity
      || this.committedChatIdentity !== identity
      || this.readyChatIdentity !== identity) return false;
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible") return false;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
    }
    if (this.isRenderedModalOpen()) return false;
    if (this.state.mainView === "chat") return true;
    if (this.state.mainView === "navigation") return !this.appShell.isMobileNavigationLayout;
    return this.isDesktopSideBySideLayout();
  }

  private isRenderedModalOpen(): boolean {
    return hasRenderedModal(this.ownerDocument);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.normalAuthInitSeq += 1;
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pageshow", this.onPageShow);
    this.browserResume.connect();
    this.git.connect();
    window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.addEventListener("focusin", this.resetKeyboardSequence);
    window.addEventListener("blur", this.resetKeyboardSequence);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    this.applyPreferredTheme(false);
    void this.initializeNormalAuth(this.normalAuthInitSeq);
  }

  private startAuthenticatedApp(): void {
    if (!this.isConnected || this.authenticatedAppRunning) return;
    this.authenticatedAppRunning = true;
    this.connectRealtime();
    void this.renegotiateUnreadMachines();
    if (this.apiScope === "normal") {
      this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    }
    this.scheduleSelectedSessionRefresh();
    void this.refreshWorkspaceActivity();
    void this.refreshMachineStatusSnapshots();
    void this.loadClientConfig();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute().finally(() => { this.schedulePiWebStatusRefresh(); });
  }

  private async initializeNormalAuth(initSeq: number): Promise<void> {
    if (this.apiScope === "management") {
      if (!this.isConnected || initSeq !== this.normalAuthInitSeq) return;
      this.normalAuthStatus = { configured: true, authenticated: true };
      this.normalAuthLoading = false;
      this.startAuthenticatedApp();
      return;
    }
    this.normalAuthLoading = true;
    this.normalAuthError = "";
    try {
      const status = await normalAuthApi.status();
      if (!this.isConnected || initSeq !== this.normalAuthInitSeq) return;
      this.normalAuthStatus = status;
      if (status.authenticated) this.startAuthenticatedApp();
    } catch (error) {
      if (!this.isConnected || initSeq !== this.normalAuthInitSeq) return;
      this.normalAuthError = `检查普通模式密码失败：${errorMessage(error)}`;
    } finally {
      if (this.isConnected && initSeq === this.normalAuthInitSeq) this.normalAuthLoading = false;
    }
  }

  override disconnectedCallback(): void {
    this.workspaceNavigationGeneration += 1;
    this.normalAuthInitSeq += 1;
    this.authenticatedAppRunning = false;
    this.unreadConnected = false;
    this.committedChatIdentity = undefined;
    this.readyChatIdentity = undefined;
    this.unreadRuntimeRefreshes.clear();
    this.sessionUnread.retainMachines(new Set<string>());
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pageshow", this.onPageShow);
    this.browserResume.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.removeEventListener("focusin", this.resetKeyboardSequence);
    window.removeEventListener("blur", this.resetKeyboardSequence);
    this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
    this.keyboard.reset();
    void this.builtInPluginsReady.catch(() => undefined);
    this.plugins.beginShutdown();
    void this.plugins.dispose();
    this.auth.dispose();
    this.sessions.dispose();
    this.notifications.dispose();
    this.serverNotices.retainMachines(new Set<string>());
    this.realtime.close();
    this.closeMachineActivitySockets();
    this.git.dispose();
    if (this.piWebStatusTimer !== undefined) window.clearInterval(this.piWebStatusTimer);
    this.piWebStatusTimer = undefined;
    if (this.selectedSessionRefreshTimer !== undefined) window.clearTimeout(this.selectedSessionRefreshTimer);
    this.selectedSessionRefreshTimer = undefined;
    this.clearScheduledPiWebStatusRefresh();
    this.cancelWorkspaceDeletionRefresh();
    this.clearPendingRemoteRouteRestore();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (workspaceDeletionScopeKey(previous) !== workspaceDeletionScopeKey(this.state)) {
      this.cancelWorkspaceDeletionRefresh();
      this.state = { ...this.state, workspaceDeletionRuns: {} };
    }
    if (selectedMachineId(previous) !== selectedMachineId(this.state)
      || previous.selectedProject?.id !== this.state.selectedProject?.id
      || previous.selectedWorkspace?.id !== this.state.selectedWorkspace?.id
      || previous.workspaceTool !== this.state.workspaceTool || previous.mainView !== this.state.mainView) {
      this.workspaceNavigationGeneration += 1;
    }
    if (modelValueFromStatus(previous.status) !== modelValueFromStatus(this.state.status) && this.state.modelDialog !== undefined) {
      this.state = { ...this.state, modelDialog: undefined };
    }
    if (selectedChatIdentity(previous) !== selectedChatIdentity(this.state)) {
      this.committedChatIdentity = undefined;
      this.readyChatIdentity = undefined;
    }
    if (machineUnreadInputsChanged(previous, this.state)) this.syncSessionUnreadMachines();
    this.syncUnreadSessionIds();
    this.syncUnreadPresence();
    this.handleActivityTransition(previous, this.state);
    this.handleWorkspaceChange(previous, this.state);
    this.handleMachineChange(previous, this.state);
    if (machineActivitySubscriptionInputsChanged(previous, this.state)) this.syncMachineActivitySubscriptions();
    this.notifications.syncEnvironment(previous, this.state);
  }

  private async loadProjectsAndRestoreRoute() {
    this.restoreSettingsRoute();
    const route = readRoute();
    if (!await this.machines.loadMachines(route.machineId)) {
      this.setRouteContentError(route, this.state.error);
      return;
    }
    if (!this.routeLocationMatchesUrl(route)) {
      await this.projects.loadProjects();
      await this.withChatScrollTransition(() => this.restoreRoute(false));
      await this.refreshWorkspaceDeletionRuns();
      return;
    }
    const initialRouteMachineHealth = this.state.machineStatuses[route.machineId ?? "local"];
    await this.projects.loadProjects();
    if (!this.routeLocationMatchesUrl(route)) {
      await this.withChatScrollTransition(() => this.restoreRoute(false));
      await this.refreshWorkspaceDeletionRuns();
      return;
    }
    if (this.shouldDeferRemoteRouteRestore(route, initialRouteMachineHealth)) this.deferRemoteRouteRestore(route);
    else {
      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false));
      if (this.routeContentError() === "") {
        this.clearPendingRemoteRouteRestore();
        this.rememberCurrentMachineNavigation();
      }
    }
    await this.refreshWorkspaceDeletionRuns();
  }

  private handleBrowserResumeSignal(): void {
    this.appShell.repairViewportPosition();
    this.schedulePiWebStatusRefresh();
    this.retryPendingRemoteRouteRestoreSoon();
  }

  private async refreshAfterBrowserResume(): Promise<void> {
    await this.renegotiateUnreadMachines();
    await Promise.all([
      this.sessions.refreshSelectedSession(),
      this.sessions.refreshCurrentWorkspaceSessions(),
      this.refreshMachineActivities(),
      this.refreshMachineStatusSnapshots(),
      this.refreshWorkspaceDeletionRuns(),
      this.workspaces.refreshSelectedProjectTopology(),
    ]);
  }

  private schedulePiWebStatusRefresh(delayMs = PI_WEB_STATUS_DEFER_MS): void {
    if (this.apiScope === "management") return;
    this.clearScheduledPiWebStatusRefresh();
    this.piWebStatusDeferredTimer = window.setTimeout(() => {
      this.piWebStatusDeferredTimer = undefined;
      void this.piWebStatusController.refresh();
    }, delayMs);
  }

  private clearScheduledPiWebStatusRefresh(): void {
    if (this.piWebStatusDeferredTimer === undefined) return;
    window.clearTimeout(this.piWebStatusDeferredTimer);
    this.piWebStatusDeferredTimer = undefined;
  }

  private async refreshWorkspaceActivity(machineId = selectedMachineId(this.state)): Promise<void> {
    try {
      await this.activity.refresh(machineId);
    } catch (error) {
      console.warn(`Failed to refresh workspace activity for ${machineId}`, error);
    }
  }

  private async refreshMachineActivities(): Promise<void> {
    const machineIds = this.state.machines.length === 0
      ? [selectedMachineId(this.state)]
      : this.state.machines
        .filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id]))
        .map((machine) => machine.id);
    await Promise.all(machineIds.map((machineId) => this.refreshWorkspaceActivity(machineId)));
  }

  /** Poll idle external sessions without overlapping work or waking hidden tabs. */
  private scheduleSelectedSessionRefresh(initSeq = this.normalAuthInitSeq): void {
    if (!this.isConnected || !this.authenticatedAppRunning || initSeq !== this.normalAuthInitSeq) return;
    if (this.selectedSessionRefreshTimer !== undefined) window.clearTimeout(this.selectedSessionRefreshTimer);
    this.selectedSessionRefreshTimer = window.setTimeout(() => {
      this.selectedSessionRefreshTimer = undefined;
      void this.refreshSelectedTranscript().finally(() => { this.scheduleSelectedSessionRefresh(initSeq); });
    }, SELECTED_SESSION_REFRESH_MS);
  }

  private async refreshSelectedTranscript(): Promise<void> {
    const session = this.state.selectedSession;
    const status = this.state.status;
    if (session === undefined || session.archived === true || document.visibilityState !== "visible") return;
    if (status?.isStreaming === true || status?.isCompacting === true || status?.isBashRunning === true || (status?.pendingMessageCount ?? 0) > 0) return;
    await this.sessions.refreshSelectedSession(session.id, { silent: true });
  }

  private async refreshMachineStatusSnapshots(): Promise<void> {
    const machineIds = this.state.machines.length === 0
      ? [selectedMachineId(this.state)]
      : this.state.machines.filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id])).map((machine) => machine.id);
    await Promise.all(machineIds.map(async (machineId) => {
      try { await this.machineStatus.refresh(machineId); }
      catch (error) { console.warn(`Failed to refresh machine status for ${machineId}`, error); }
    }));
  }

  private async loadClientConfig(): Promise<void> {
    if (this.apiScope === "management") return;
    try {
      this.applyClientConfig((await configApi.config()).effectiveConfig);
    } catch (error) {
      console.warn("Failed to load PI WEB config", error);
    }
  }

  private applyClientConfig(config: PiWebConfigValues): void {
    this.shortcutConfig = config.shortcuts ?? {};
    this.workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(config);
    this.workspaceAttachmentsDefaultFolder = effectiveWorkspaceAttachmentsFolder(config);
  }

  private async submitNormalAuth(form: NormalAuthPasswordForm): Promise<void> {
    const mode = this.normalAuthDialogMode ?? this.normalAuthGateMode();
    if (mode === undefined || this.normalAuthLoading) return;
    this.normalAuthLoading = true;
    this.normalAuthError = "";
    try {
      if (mode === "setup") await normalAuthApi.setup(form.password);
      else if (mode === "change") await normalAuthApi.changePassword(form.currentPassword ?? "", form.password);
      else await normalAuthApi.login(form.password);
      const status = await normalAuthApi.status();
      this.normalAuthStatus = status;
      this.normalAuthDialogMode = undefined;
      if (status.authenticated) this.startAuthenticatedApp();
    } catch (error) {
      this.normalAuthError = errorMessage(error);
    } finally {
      this.normalAuthLoading = false;
    }
  }

  private normalAuthGateMode(): NormalAuthDialogMode | undefined {
    if (this.apiScope === "management") return undefined;
    if (this.normalAuthStatus?.authenticated === true) return undefined;
    return this.normalAuthStatus?.configured === true ? "login" : "setup";
  }

  private async refreshAppData(): Promise<void> {
    if (this.isRefreshingApp) return;
    this.isRefreshingApp = true;
    try {
      await Promise.all([
        this.sessions.refreshSelectedSession(),
        this.refreshMachineActivities(),
        this.loadClientConfig(),
        this.refreshWorkspaceDeletionRuns(),
        this.refreshCurrentWorkspaceSurface(),
        this.workspaces.refreshSelectedProjectTopology(),
      ]);
      this.schedulePiWebStatusRefresh();
    } finally {
      this.isRefreshingApp = false;
    }
  }

  private async refreshCurrentWorkspaceSurface(): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    const tool = this.state.mainView !== "chat" && this.state.mainView !== "navigation" ? this.state.mainView : this.state.workspaceTool;
    if (this.isFilesPanel(tool)) await this.files.refreshFiles();
    else if (tool === "core:workspace.git") await this.git.refreshGit();
    else if (this.isTerminalPanel(tool) && workspace !== undefined) await this.refreshActiveTerminals(workspace);
    else await this.invalidateWorkspacePanels(tool);
  }

  private hardReloadApp(): void {
    window.location.reload();
  }

  private async restoreRoute(updateUrl: boolean) {
    const route = readRoute();
    if (this.shouldDeferRemoteRouteRestore(route)) {
      this.deferRemoteRouteRestore(route);
      return;
    }
    await this.restoreRouteFor(route, updateUrl);
    if (this.routeContentError() === "") this.rememberCurrentMachineNavigation();
  }

  private async navigate(destination: PluginNavigationDestination | null): Promise<void> {
    if (destination === null || typeof destination !== "object" || Array.isArray(destination)) throw new TypeError("Navigation destination must be an object");
    for (const key of ["machineId", "projectId", "workspaceId", "sessionId", "tool"] as const) {
      if (destination[key] !== undefined && typeof destination[key] !== "string") throw new TypeError(`Navigation ${key} must be a string`);
    }
    if (destination.view !== undefined && !["navigation", "chat", "workspace"].includes(destination.view)) {
      throw new TypeError("Navigation view must be navigation, chat, or workspace");
    }
    const view = destination.view === "workspace"
      ? destination.tool ?? this.state.workspaceTool
      : destination.view === "navigation" || destination.view === undefined && destination.tool === undefined
        ? undefined
        : destination.view ?? destination.tool;
    this.syncNavigationFreshness();
    writeRoute({
      machineId: destination.machineId ?? selectedMachineId(this.state),
      projectId: destination.projectId,
      workspaceId: destination.workspaceId,
      sessionId: destination.sessionId,
      tool: destination.tool,
      view,
    });
    writeContributionQueryRecord({}, { replace: true });
    this.syncNavigationFreshness();
    await this.restoreRoute(false);
  }

  private async restoreRouteFor(route: ParsedAppRoute, updateUrl: boolean, surface = this.readWorkspaceRouteSurface(route), restoredMainView?: AppState["mainView"], urlPublication: "current-url" | "deferred" = "current-url") {
    this.setRouteContentError(route, "");
    const machineBeforeRestore = selectedMachineId(this.state);
    const routeSurface = route.projectId === undefined || route.projectId === "" ? emptyWorkspaceRouteSurface() : surface;
    const navigation = this.beginNavigationOperation(NAVIGATION_SCOPES);
    const selectionFreshness = this.beginNavigationOperation(ROUTE_SELECTION_SCOPE);
    if (!this.routeMatchesCurrentSelection(route)) this.routeSelectionRestoreSeq += 1;
    const selectionRestoreSeq = this.routeSelectionRestoreSeq;
    const selectionNavigation: NavigationFreshness = {
      ...selectionFreshness,
      isCurrent: () => selectionRestoreSeq === this.routeSelectionRestoreSeq && selectionFreshness.isCurrent(),
    };
    const restoreSeq = ++this.routeRestoreSeq;
    this.routeRestoreDepth += 1;
    this.restoringRouteTerminalId = routeSurface.selectedTerminalId;
    try {
      await this.restoreRouteMachine(route, false);
      const selectedMachinePluginLoad = this.loadPluginsForSelectedMachine();
      const requestedPanelRoute = route.view !== undefined && route.view !== "chat" ? route.view : route.tool;
      if (requestedPanelRoute !== undefined) {
        await this.ensureGatewayPluginsLoaded();
        await selectedMachinePluginLoad;
      }
      if (!selectionNavigation.isCurrent()) return;
      const requestedMachineId = route.machineId ?? "local";
      if (selectedMachineId(this.state) !== requestedMachineId) {
        this.workspaces.clearSelection({ updateUrl: false });
        this.setRouteContentError(route, `找不到机器：${requestedMachineId}`);
        return;
      }
      const workspaceTool = this.resolveWorkspacePanelRoute(route.tool) ?? this.state.workspaceTool;
      const restoredView = restoredMainView ?? (route.view === "chat" || route.view === "navigation" ? route.view
        : route.view === "workspace" ? workspaceTool : this.resolveWorkspacePanelRoute(route.view));
      if (this.isCurrentRouteRestore(restoreSeq, navigation)) this.setState({
        workspaceTool,
        mainView: this.appShell.normalizedMainView(restoredView, route.sessionId !== undefined),
        selectedFilePath: routeSurface.selectedFilePath,
        selectedDiffPath: routeSurface.selectedDiffPath,
        selectedTerminalId: routeSurface.selectedTerminalId,
      });
      if (route.projectId === undefined || route.projectId === "") {
        this.workspaces.clearSelection({ updateUrl: false });
        if (updateUrl && this.isCurrentRouteRestore(restoreSeq, navigation) && urlPublication === "current-url") this.updateUrl();
        return;
      }
      if (this.routeMatchesCurrentSelection(route)) {
        if (!this.isCurrentRouteRestore(restoreSeq, navigation)) return;
        if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
        await this.refreshRestoredWorkspaceTool(workspaceTool, routeSurface.selectedFilePath, routeSurface.contributionQuery, () => this.isCurrentRouteRestore(restoreSeq, navigation));
        if (!this.isCurrentRouteRestore(restoreSeq, navigation)) return;
        this.git.updatePolling();
        if (updateUrl && this.isCurrentRouteRestore(restoreSeq, navigation) && urlPublication === "current-url") this.updateUrl();
        return;
      }
      const project = this.state.projects.find((p) => p.id === route.projectId);
      if (!project) {
        this.workspaces.clearSelection({ updateUrl: false });
        this.setRouteContentError(route, `找不到项目：${route.projectId}`);
        return;
      }
      const loadedWorkspace = urlPublication === "deferred" && this.state.selectedProject?.id === project.id
        ? this.state.workspaces.find((workspace) => workspace.projectId === project.id && workspace.id === route.workspaceId) : undefined;
      const loadedSession = loadedWorkspace !== undefined && this.state.selectedWorkspace?.id === loadedWorkspace.id && route.sessionId !== undefined
        ? this.sessions.preferredSession(loadedWorkspace.path, this.state.sessions, route.sessionId) : undefined;
      if (loadedSession !== undefined) await this.sessions.selectSession(loadedSession, { updateUrl: false, navigation: selectionNavigation });
      else if (loadedWorkspace !== undefined) await this.workspaces.selectWorkspace(loadedWorkspace, { sessionId: route.sessionId, updateUrl: false, navigation: selectionNavigation });
      else await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl: false, navigation: selectionNavigation });
      if (!this.isCurrentRouteRestore(restoreSeq, navigation)) return;
      const selectionError = this.routeSelectionError(route);
      if (selectionError !== "") {
        this.setRouteContentError(route, selectionError);
        return;
      }
      this.setState({ selectedFilePath: routeSurface.selectedFilePath, selectedDiffPath: routeSurface.selectedDiffPath, selectedTerminalId: routeSurface.selectedTerminalId });
      if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
      await this.refreshRestoredWorkspaceTool(this.resolveWorkspacePanelRoute(route.tool), routeSurface.selectedFilePath, routeSurface.contributionQuery, () => this.isCurrentRouteRestore(restoreSeq, navigation));
      if (!this.isCurrentRouteRestore(restoreSeq, navigation)) return;
      this.git.updatePolling();
      if (updateUrl && this.isCurrentRouteRestore(restoreSeq, navigation) && urlPublication === "current-url"
        && this.requestedWorkspacePanelError(route) === "") this.updateUrl();
    } finally {
      this.routeRestoreDepth = Math.max(0, this.routeRestoreDepth - 1);
      if (this.routeRestoreDepth === 0) this.restoringRouteTerminalId = undefined;
      if (selectedMachineId(this.state) !== machineBeforeRestore) this.schedulePiWebStatusRefresh();
    }
  }

  private isCurrentRouteRestore(restoreSeq: number, navigation?: NavigationFreshness): boolean {
    return restoreSeq === this.routeRestoreSeq && (navigation === undefined || navigation.isCurrent());
  }

  private beginNavigationOperation(scope: readonly NavigationScope[]): NavigationFreshness {
    this.syncNavigationFreshness();
    const operation: NavigationFreshness = {
      generation: this.navigationGeneration,
      scope: Object.freeze([...scope]),
      isCurrent: () => this.isNavigationFresh(operation),
    };
    return operation;
  }

  private isNavigationFresh(operation: NavigationFreshness): boolean {
    this.syncNavigationFreshness();
    return operation.scope.every((field) => this.navigationFieldGenerations[field] <= operation.generation);
  }

  private syncNavigationFreshness(): void {
    const route = readRoute();
    const previous = this.observedNavigationRoute;
    if (previous !== undefined) {
      const changedFields = NAVIGATION_SCOPES.filter((field) => navigationRouteValue(previous, field) !== navigationRouteValue(route, field));
      if (changedFields.length > 0) {
        const generation = ++this.navigationGeneration;
        for (const field of changedFields) this.navigationFieldGenerations[field] = generation;
      }
    }
    this.observedNavigationRoute = route;
  }

  private retireNavigationScope(scope: readonly NavigationScope[]): void {
    this.syncNavigationFreshness();
    if (scope.length === 0) return;
    const generation = ++this.navigationGeneration;
    for (const field of scope) this.navigationFieldGenerations[field] = generation;
    this.workspaceNavigationGeneration += 1;
    this.invalidateWorkspaceSurface();
  }

  private retireRouteRestoreForSynchronousNavigation(): void {
    this.retireNavigationScope(WORKSPACE_SURFACE_SCOPE);
    this.routeRestoreSeq += 1;
  }

  private readWorkspaceRouteSurface(route: ParsedAppRoute): WorkspaceRouteSurface {
    if (route.projectId === undefined || route.projectId === "") return emptyWorkspaceRouteSurface();
    return {
      selectedFilePath: readNamespacedString(FILES_ROUTE_NAMESPACE, "file"),
      contributionQuery: readContributionQueryRecord(),
      selectedDiffPath: readNamespacedString(GIT_ROUTE_NAMESPACE, "diff"),
      selectedTerminalId: this.readTerminalRouteId(),
    };
  }

  private routeSelectionError(route: ParsedAppRoute): string {
    if (route.projectId !== undefined && this.state.selectedProject?.id !== route.projectId) return `找不到项目：${route.projectId}`;
    if (route.workspaceId !== undefined && this.state.selectedWorkspace?.id !== route.workspaceId) {
      const scope = projectBrowserErrorScope(route.machineId ?? "local", route.projectId ?? "");
      return this.state.browserErrors[browserErrorScopeKey(scope)]?.message ?? `找不到工作区：${route.workspaceId}`;
    }
    const selectedSessionId = this.state.selectedSession?.id;
    if (route.sessionId !== undefined && selectedSessionId !== route.sessionId && selectedSessionId?.startsWith(route.sessionId) !== true) {
      const scope = workspaceBrowserErrorScope(route.machineId ?? "local", route.projectId ?? "", route.workspaceId ?? "");
      return this.state.browserErrors[browserErrorScopeKey(scope)]?.message ?? `找不到会话：${route.sessionId}`;
    }
    return "";
  }

  private routeContentDestination(route: ParsedAppRoute): string {
    return JSON.stringify([route.machineId ?? "local", route.projectId, route.workspaceId, route.sessionId, route.tool, route.view]);
  }

  private setRouteContentError(route: ParsedAppRoute, error: string): void {
    this.routeContentOutcome = { destination: this.routeContentDestination(route), error };
    this.requestUpdate();
  }

  private routeContentError(): string {
    return this.routeContentOutcome?.destination === this.routeContentDestination(readRoute()) ? this.routeContentOutcome.error : "";
  }

  private isPendingSessionStartRouteCurrent(navigation: PendingSessionStartNavigation): boolean {
    return routeMatchesSessionCreation(readRoute(), navigation);
  }

  private commitPendingSessionStartNavigation(navigation: PendingSessionStartNavigation, session: SessionInfo): void {
    if (!this.isPendingSessionStartRouteCurrent(navigation)) return;
    this.syncNavigationFreshness();
    writeRoute({ ...readRoute(), sessionId: session.id }, { replace: true });
    this.syncNavigationFreshness();
    this.rememberCurrentMachineNavigation();
  }

  private resolveWorkspacePanelRoute(value: string | undefined): QualifiedContributionId | undefined {
    if (value === undefined || value === "chat" || value === "navigation" || value === "workspace") return undefined;
    return resolveWorkspacePanelRouteValue(value, (route) => this.plugins.resolveWorkspacePanelRouteId(route, selectedMachineId(this.state)));
  }

  private filesPanelId(): QualifiedContributionId | undefined {
    for (const alias of FILES_PANEL_ALIASES) {
      const panelId = this.plugins.resolveWorkspacePanelRouteId(alias, selectedMachineId(this.state));
      if (panelId !== undefined) return panelId;
    }
    return undefined;
  }

  private isFilesPanel(tool: string): boolean {
    return FILES_PANEL_ALIASES.some((alias) => alias === tool) || tool === this.filesPanelId();
  }

  private terminalPanelId(): QualifiedContributionId {
    return this.plugins.resolveWorkspacePanelRouteId("terminal", selectedMachineId(this.state))
      ?? this.plugins.resolveWorkspacePanelRouteId("core:workspace.terminal", selectedMachineId(this.state))
      ?? TERMINAL_PANEL_IDS[0];
  }

  private isTerminalPanel(tool: QualifiedContributionId): boolean {
    return TERMINAL_PANEL_IDS.some((id) => id === tool) || tool === this.terminalPanelId();
  }

  private readTerminalRouteId(): string | undefined {
    for (const namespace of TERMINAL_ROUTE_NAMESPACES) {
      const terminalId = readNamespacedString(namespace, "terminal");
      if (terminalId !== undefined) return terminalId;
    }
    return undefined;
  }

  private requestedWorkspacePanelError(route: ParsedAppRoute = readRoute()): string {
    const requestedRoute = route.view !== undefined && route.view !== "chat" && route.view !== "navigation" && route.view !== "workspace" ? route.view : route.tool;
    if (requestedRoute === undefined) return "";
    const requested = this.resolveWorkspacePanelRoute(requestedRoute);
    if (requested !== undefined && this.visibleWorkspacePanels().some((panel) => panel.id === requested)) return "";
    return `工作区工具不可用：${requested ?? requestedRoute}`;
  }

  private shouldDeferRemoteRouteRestore(route: ParsedAppRoute, routeMachineHealth = this.state.machineStatuses[route.machineId ?? "local"]): boolean {
    const machineId = route.machineId ?? "local";
    const machine = this.state.selectedMachine;
    if (machineId === "local" || machine?.id !== machineId || machine.kind !== "remote") return false;
    if (routeMachineHealth?.ok !== false) return false;
    if (route.projectId === undefined || route.projectId === "") return this.state.projects.length === 0;
    return this.state.selectedProject?.id !== route.projectId;
  }

  private deferRemoteRouteRestore(route: ParsedAppRoute): void {
    this.pendingRemoteRouteRestore = route;
    this.remoteRouteRestoreAttempt = 0;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private retryPendingRemoteRouteRestoreSoon(): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.schedulePendingRemoteRouteRestore(0);
  }

  private schedulePendingRemoteRouteRestore(delayMs = remoteRouteRestoreRetryDelay(this.remoteRouteRestoreAttempt)): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.clearPendingRemoteRouteRestoreTimer();
    this.remoteRouteRestoreTimer = window.setTimeout(() => {
      this.remoteRouteRestoreTimer = undefined;
      void this.retryPendingRemoteRouteRestore();
    }, delayMs);
  }

  private async retryPendingRemoteRouteRestore(): Promise<void> {
    if (this.remoteRouteRestoreInProgress) return;
    const route = this.pendingRemoteRouteRestore;
    if (route === undefined) return;
    if (!this.pendingRemoteRouteRestoreStillCurrent(route)) {
      this.clearPendingRemoteRouteRestore();
      return;
    }

    this.remoteRouteRestoreInProgress = true;
    try {
      const machineId = route.machineId ?? "local";
      const scope = machineBrowserErrorScope(machineId);
      const errorBeforeRetry = this.state.browserErrors[browserErrorScopeKey(scope)];
      const hasNewMachineError = () => this.state.browserErrors[browserErrorScopeKey(scope)] !== errorBeforeRetry;
      const health = await this.machines.refreshMachineHealth(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (health?.ok !== true) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.machines.refreshMachineRuntime(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (hasNewMachineError()) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }
      await this.projects.loadProjects();
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (hasNewMachineError()) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false));
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      this.clearPendingRemoteRouteRestore();
      if (this.routeContentError() === "") this.rememberCurrentMachineNavigation();
      await this.refreshWorkspaceDeletionRuns();
    } finally {
      this.remoteRouteRestoreInProgress = false;
    }
  }

  private scheduleNextRemoteRouteRestoreAttempt(route: ParsedAppRoute): void {
    this.remoteRouteRestoreAttempt += 1;
    if (this.remoteRouteRestoreAttempt >= REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length) {
      this.setRemoteRouteRestoreMessage(route, { exhausted: true });
      this.clearPendingRemoteRouteRestore();
      return;
    }
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private setRemoteRouteRestoreMessage(route: ParsedAppRoute, options: { exhausted?: boolean } = {}): void {
    const machineId = route.machineId ?? "local";
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "远程机器";
    const health = this.state.machineStatuses[machineId];
    const scope = machineBrowserErrorScope(machineId);
    const existing = this.state.browserErrors[browserErrorScopeKey(scope)]?.message;
    const detail = health?.error ?? (existing !== undefined && !existing.startsWith(`${machineName} 暂不可用`) && !existing.startsWith(`${machineName} 仍不可用`) ? existing : undefined);
    const prefix = options.exhausted === true
      ? `${machineName} 仍不可用。`
      : `${machineName} 暂不可用，正在重新连接…`;
    this.browserErrors.report(scope, `${prefix}${detail === undefined ? "" : ` ${detail}`}`);
  }

  private pendingRemoteRouteRestoreStillCurrent(route: ParsedAppRoute): boolean {
    const machineId = route.machineId ?? "local";
    return machineId !== "local"
      && this.pendingRemoteRouteRestore === route
      && this.state.selectedMachine?.id === machineId
      && this.state.machines.some((machine) => machine.id === machineId);
  }

  private clearPendingRemoteRouteRestore(): void {
    this.clearPendingRemoteRouteRestoreTimer();
    this.pendingRemoteRouteRestore = undefined;
    this.remoteRouteRestoreAttempt = 0;
  }

  private clearPendingRemoteRouteRestoreTimer(): void {
    if (this.remoteRouteRestoreTimer === undefined) return;
    window.clearTimeout(this.remoteRouteRestoreTimer);
    this.remoteRouteRestoreTimer = undefined;
  }

  private async restoreRouteMachine(route: ParsedAppRoute, updateUrl: boolean): Promise<void> {
    const routeMachineId = route.machineId ?? "local";
    if (this.state.selectedMachine?.id === routeMachineId) return;
    const machine = this.state.machines.find((candidate) => candidate.id === routeMachineId);
    if (machine === undefined) return;
    await this.machines.selectMachine(machine, { updateUrl });
  }

  private routeMatchesCurrentSelection(route: ParsedAppRoute): boolean {
    return (route.machineId ?? "local") === (this.state.selectedMachine?.id ?? "local")
      && route.workspaceId !== undefined
      && route.workspaceId !== ""
      && this.state.selectedProject?.id === route.projectId
      && this.state.selectedWorkspace?.id === route.workspaceId
      && this.state.selectedSession?.id === route.sessionId;
  }

  private async refreshRestoredWorkspaceTool(tool: QualifiedContributionId | undefined, selectedFilePath: string | undefined, contributionQuery?: ContributionQueryRecord, isCurrent: () => boolean = () => true): Promise<void> {
    const machineId = selectedMachineId(this.state);
    const workspace = this.state.selectedWorkspace;
    if (tool !== undefined && this.isFilesPanel(tool)) {
      await this.files.refreshFiles();
      if (!isCurrent() || selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.projectId !== workspace?.projectId || this.state.selectedWorkspace?.id !== workspace?.id) return;
      if (selectedFilePath !== undefined) await this.files.restoreFile(selectedFilePath);
    } else if (tool === "core:workspace.git") await this.git.refreshGit();
    else if (tool !== undefined) await this.invalidateWorkspacePanels(tool, contributionQuery);
  }

  private async withChatScrollTransition(action: () => Promise<void>, shouldComplete: () => boolean = () => true) {
    this.chatView?.saveScrollPosition();
    await action();
    if (!shouldComplete()) return;
    await this.updateComplete;
    if (!shouldComplete()) return;
    await this.chatView?.updateComplete;
    if (!shouldComplete()) return;
    await nextFrame();
    if (!shouldComplete()) return;
    this.chatView?.restoreScrollPosition();
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private shouldAutoFocusPrompt(): boolean {
    return !this.isRenderedModalOpen() && this.appShell.shouldAutoFocusPrompt();
  }

  private async withChatPrependTransition(action: () => Promise<void>) {
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
  }

  private defaultRouteView(): AppState["mainView"] {
    return this.appShell.defaultRouteView();
  }

  private normalizeMainViewForLayoutChange(): void {
    const wasStackedWorkspaceLayout = this.previousStackedWorkspaceLayout;
    const isStackedWorkspaceLayout = this.appShell.isStackedWorkspaceLayout;
    this.previousStackedWorkspaceLayout = isStackedWorkspaceLayout;
    if (wasStackedWorkspaceLayout || !isStackedWorkspaceLayout) return;
    const mainView = this.appShell.normalizedMainView(this.state.mainView, this.state.selectedSession !== undefined);
    if (mainView === this.state.mainView) return;
    this.setState({ mainView });
    this.updateUrl({ replace: true });
  }

  private updateUrl(options?: { replace?: boolean | undefined }, contributionQuery = this.currentContributionQuery()): void {
    this.syncNavigationFreshness();
    const snapshot = machineNavigationSnapshotFromState(this.state, contributionQuery);
    this.machineNavigation.remember(snapshot);
    writeRoute({
      machineId: this.state.selectedMachine?.id,
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
      tool: this.state.workspaceTool,
      view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
    }, options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
    this.syncNavigationFreshness();
  }

  private rememberCurrentMachineNavigation(): void {
    this.machineNavigation.remember(machineNavigationSnapshotFromState(this.state, this.currentContributionQuery()));
  }

  private currentContributionQuery(): ContributionQueryRecord {
    const route = readRoute();
    const workspace = this.state.selectedWorkspace;
    return workspace !== undefined && (route.machineId ?? "local") === selectedMachineId(this.state)
      && route.projectId === workspace.projectId && route.workspaceId === workspace.id ? readContributionQueryRecord() : {};
  }

  private writeMachineNavigationSnapshotToUrl(snapshot: MachineNavigationSnapshot, options?: { replace?: boolean | undefined }): void {
    this.syncNavigationFreshness();
    this.machineNavigation.remember(snapshot);
    writeRoute(routeFromMachineNavigationSnapshot(snapshot), options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
    this.syncNavigationFreshness();
  }

  private writeWorkspaceRouteSurfaceToUrl(surface: WorkspaceRouteSurface): void {
    writeContributionQueryRecord(surface.contributionQuery ?? {}, { replace: true });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", surface.selectedFilePath, { replace: true });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", surface.selectedDiffPath, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACES[0], "terminal", surface.selectedTerminalId, { replace: true });
  }

  private async selectMachineWithMemory(machine: Machine, options: NavigationDestinationOptions & { rememberCurrent?: boolean } = {}): Promise<boolean> {
    if (this.state.selectedMachine?.id === machine.id) return true;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    if (!await this.commitAndRestoreNavigation(snapshot, options)) return false;
    if (seq !== this.machineNavigationRestoreSeq || this.state.selectedMachine?.id !== machine.id) return false;
    if (this.shouldPreserveUnrestoredMachineNavigation(snapshot)) {
      this.machineNavigation.remember(snapshot);
      this.writeMachineNavigationSnapshotToUrl(snapshot, { replace: true });
      return true;
    }
    this.updateUrl({ replace: true }, snapshot.surface.contributionQuery ?? {});
    return true;
  }

  private captureNavigation(): NavigationSelection {
    const route = readRoute();
    return { ...route, machineId: route.machineId ?? "local" };
  }

  private navigationSelectionMatchesUrl(expected: NavigationSelection, selectionOnly = false): boolean {
    const route = readRoute();
    const sessionMatches = route.sessionId === expected.sessionId
      || expected.sessionId !== undefined && !isCreatingSessionId(expected.sessionId) && route.sessionId !== undefined && expected.sessionId.startsWith(route.sessionId);
    return (route.machineId ?? "local") === expected.machineId && route.projectId === expected.projectId
      && route.workspaceId === expected.workspaceId && sessionMatches
      && (selectionOnly || route.tool === expected.tool && route.view === expected.view);
  }

  private routeLocationMatchesUrl(expected: ParsedAppRoute): boolean {
    const route = readRoute();
    return NAVIGATION_SCOPES.every((scope) => navigationRouteValue(expected, scope) === navigationRouteValue(route, scope));
  }

  private async commitAndRestoreNavigation(snapshot: MachineNavigationSnapshot, options: NavigationDestinationOptions = {}): Promise<boolean> {
    if (options.expected !== undefined && !this.navigationSelectionMatchesUrl(options.expected, options.creationHandoff === true)) return false;
    if (options.creationHandoff === true) {
      if (!isCreatingSessionId(options.expected?.sessionId)) return false;
      this.syncNavigationFreshness();
      writeRoute({ ...readRoute(), sessionId: snapshot.sessionId }, { replace: true });
      this.syncNavigationFreshness();
      const restore = this.restoreRouteFor(readRoute(), false, undefined, undefined, "deferred");
      const seq = this.routeRestoreSeq;
      await restore;
      return seq === this.routeRestoreSeq;
    }
    this.writeMachineNavigationSnapshotToUrl(snapshot, { replace: options.replace });
    const restore = this.restoreRouteFor(readRoute(), false, snapshot.surface, snapshot.view, "deferred");
    const seq = this.routeRestoreSeq;
    await restore;
    return seq === this.routeRestoreSeq;
  }

  private async navigateToProjectFromController(project: Project | undefined, options: NavigationDestinationOptions = {}): Promise<boolean> {
    const current = machineNavigationSnapshotFromState(this.state, this.currentContributionQuery());
    const destination = { ...current, projectId: project?.id, workspaceId: undefined, sessionId: undefined, surface: {} };
    if (!await this.commitAndRestoreNavigation(destination, options)) return false;
    if (this.routeContentError() === "") this.updateUrl({ replace: true });
    return true;
  }

  private async navigateToWorkspaceFromController(workspace: Workspace | undefined, options: NavigationDestinationOptions = {}): Promise<boolean> {
    const current = machineNavigationSnapshotFromState(this.state, this.currentContributionQuery());
    const destination = { ...current, projectId: workspace?.projectId, workspaceId: workspace?.id, sessionId: undefined, surface: {} };
    if (!await this.commitAndRestoreNavigation(destination, options)) return false;
    if (this.routeContentError() === "") this.updateUrl({ replace: true });
    return true;
  }

  private async navigateToSessionFromController(session: SessionInfo | undefined, options: NavigationDestinationOptions = {}): Promise<boolean> {
    const current = machineNavigationSnapshotFromState(this.state, this.currentContributionQuery());
    if (!await this.commitAndRestoreNavigation({ ...current, sessionId: session?.id }, options)) return false;
    if (this.routeContentError() === "") this.updateUrl({ replace: true });
    return true;
  }

  private shouldPreserveUnrestoredMachineNavigation(snapshot: MachineNavigationSnapshot): boolean {
    const machineError = this.state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope(selectedMachineId(this.state)))];
    return snapshot.projectId !== undefined && this.state.selectedProject?.id !== snapshot.projectId && (this.state.error !== "" || machineError !== undefined);
  }

  private readonly handleWorkspaceFileOpen = (event: CustomEvent<WorkspaceFileOpenRequest>): void => {
    const workspace = this.state.selectedWorkspace;
    const request = event.detail;
    if (event.defaultPrevented || workspace === undefined || request.machineId !== selectedMachineId(this.state)
      || request.projectId !== workspace.projectId || request.workspaceId !== workspace.id || request.root !== workspace.path) return;
    const panelId = this.filesPanelId();
    if (panelId === undefined) return;
    const query = this.plugins.resolveWorkspaceFileOpen(this.createWorkspacePanelContext(workspace), request.path);
    if (query?.contributionId !== panelId || query.query["file"] !== request.path) return;
    event.preventDefault();
    void this.files.selectFile(request.path);
    this.openWorkspaceTool(panelId);
  };

  private openWorkspaceTool(tool: QualifiedContributionId) {
    const machineId = selectedMachineId(this.state);
    const workspace = this.state.selectedWorkspace;
    if (this.apiScope === "normal" && workspace !== undefined && this.terminalAvailableForMachine(machineId) && tool === this.terminalPanelId()) {
      this.workspaceTerminal("core", workspace, machineId).open();
      return;
    }
    this.publishWorkspaceTool(tool);
  }

  private publishWorkspaceTool(tool: QualifiedContributionId): void {
    this.navigationSelectionSeq += 1;
    this.retireRouteRestoreForSynchronousNavigation();
    this.setState({ workspaceTool: tool, mainView: tool });
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(tool);
    this.git.updatePolling();
  }

  private openTerminal(options?: { terminalId?: string | undefined }): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace !== undefined) this.workspaceTerminal("core", workspace, selectedMachineId(this.state)).open(options);
  }

  private workspaceTerminal(
    origin: string,
    workspace: Workspace,
    machineId: string,
    isCurrent?: () => boolean,
  ): WorkspacePanelTerminal {
    if (this.apiScope === "management") {
      return Object.freeze({
        open: () => undefined,
        runCommand: (input: WorkspaceTerminalCommandInput) => this.terminalCommandRunsForOrigin(origin, machineId).runCommand({ ...input, workspace }),
      });
    }
    const composition = this.requiredTerminalByMachine.get(machineId);
    const peer = composition === undefined ? undefined : createPluginPeer(composition.binding, workspace, machineId);
    if (composition === undefined || peer === undefined) {
      const error = requiredTerminalUnavailableError(machineId);
      return Object.freeze({
        open: () => { if (isCurrent?.() !== false) this.setState({ error: error.message }); },
        runCommand: () => Promise.reject(error),
      });
    }
    const createTerminal = (): WorkspacePanelTerminal => {
      const expectedUrl = window.location.href;
      const generation = this.workspaceNavigationGeneration;
      return composition.facade.createWorkspaceTerminal({
        origin,
        registrationPluginId: composition.binding.registrationPluginId,
        workspace,
        peer,
        host: { navigateWorkspaceContribution: (targetWorkspace, navigation) =>
          this.navigateRuntimeWorkspaceContribution(machineId, targetWorkspace, navigation, expectedUrl, generation) },
      });
    };
    const contextIsCurrent = (surfaceSensitive: boolean) => {
      const route = readRoute();
      return selectedMachineId(this.state) === machineId && (isCurrent === undefined
        || (this.state.selectedProject?.id === workspace.projectId && this.state.selectedWorkspace?.id === workspace.id
          && (route.machineId ?? "local") === machineId && route.projectId === workspace.projectId && route.workspaceId === workspace.id
          && (!surfaceSensitive || isCurrent())));
    };
    return Object.freeze({
      open: (options?: { terminalId?: string | undefined }) => {
        if (contextIsCurrent(true)) createTerminal().open(options);
      },
      runCommand: (input: WorkspaceTerminalCommandInput) => contextIsCurrent(input.open === true)
        ? createTerminal().runCommand(input)
        : Promise.reject(new Error("工作区面板上下文已失效")),
    });
  }

  private async navigateRuntimeWorkspaceContribution(
    machineId: string,
    workspace: Workspace,
    navigation: WorkspaceContributionNavigationV1,
    expectedUrl: string,
    generation: number,
  ): Promise<void> {
    if (window.location.href !== expectedUrl || generation !== this.workspaceNavigationGeneration || this.apiScope === "management") return;
    const sameWorkspace = selectedMachineId(this.state) === machineId
      && this.state.selectedProject?.id === workspace.projectId && this.state.selectedWorkspace?.id === workspace.id;
    const contributionQuery = patchContributionQueryRecord(
      sameWorkspace ? readContributionQueryRecord() : {},
      navigation.contributionId,
      navigation.navigationAliases ?? [],
      navigation.query,
    );
    if (!sameWorkspace) {
      if (!this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
      const destination: AppRoute = {
        machineId, projectId: workspace.projectId, workspaceId: workspace.id, sessionId: undefined,
        tool: navigation.contributionId, view: navigation.contributionId,
      };
      writeRoute(destination);
      writeContributionQueryRecord(contributionQuery, { replace: true });
      await this.restoreRouteFor(destination, false, { contributionQuery }, navigation.contributionId);
      return;
    }
    this.publishWorkspaceTool(navigation.contributionId);
    writeContributionQueryRecord(contributionQuery, { replace: true });
    this.rememberCurrentMachineNavigation();
    this.requestUpdate();
  }

  private terminalCommandRunsForOrigin(origin: string, machineId = selectedMachineId(this.state)): TerminalCommandRunsInternalRuntime {
    const key = machineScopedKey(machineId, origin);
    const existing = this.terminalCommandRunRuntimes.get(key);
    if (existing !== undefined) return existing;
    if (this.apiScope === "normal") {
      const runtime: TerminalCommandRunsInternalRuntime = {
        runCommand: ({ workspace, ...input }) => this.workspaceTerminal(origin, workspace, machineId).runCommand(input),
        listCommandRuns: (filter) => this.listTerminalCommandRuns(machineId, filter),
        getCommandRun: async (runId) => (await this.listTerminalCommandRuns(machineId)).find((run) => run.id === runId),
        open: (options) => { if (selectedMachineId(this.state) === machineId) this.openTerminal(options); },
      };
      this.terminalCommandRunRuntimes.set(key, runtime);
      return runtime;
    }
    const runtime = createTerminalCommandRunsRuntime(origin, {
      api: {
        runTerminalCommand: (runtimeOrigin, input) => terminalsApi.runTerminalCommand(runtimeOrigin, input, machineId),
        listCommandRuns: (filter) => terminalsApi.listCommandRuns(filter, machineId),
        getCommandRun: (runId) => terminalsApi.getCommandRun(runId, machineId),
      },
      openTerminal: () => undefined,
    });
    this.terminalCommandRunRuntimes.set(key, runtime);
    return runtime;
  }

  private async listTerminalCommandRuns(machineId: string, filter?: Parameters<TerminalCommandRunsInternalRuntime["listCommandRuns"]>[0]): Promise<TerminalCommandRun[]> {
    const composition = this.requiredTerminalByMachine.get(machineId);
    if (composition === undefined) throw requiredTerminalUnavailableError(machineId);
    if (selectedMachineId(this.state) !== machineId) return [];
    const projectId = filter?.projectId ?? this.state.selectedProject?.id;
    const workspaces = projectId === this.state.selectedProject?.id ? this.state.workspaces : this.state.workspacesByProjectId[projectId ?? ""];
    const targets = (workspaces ?? []).filter((workspace) => filter?.workspaceId === undefined || workspace.id === filter.workspaceId);
    const runs = await Promise.all(targets.map((workspace) => {
      const peer = createPluginPeer(composition.binding, workspace, machineId);
      if (peer === undefined) throw requiredTerminalUnavailableError(machineId);
      return composition.facade.listCommandRuns({ peer, filter: {
        ...(filter?.terminalId === undefined ? {} : { terminalId: filter.terminalId }),
        ...(filter?.statuses === undefined ? {} : { statuses: filter.statuses }),
        ...(filter?.metadata === undefined ? {} : { metadata: filter.metadata }),
      } });
    }));
    return runs.flat();
  }

  private selectTerminal(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    this.rememberSelectedTerminal(terminalId);
    this.setState({ selectedTerminalId: terminalId });
    this.rememberCurrentMachineNavigation();
    this.writeSelectedTerminalToUrl(terminalId, options);
  }

  private rememberSelectedTerminal(terminalId: string | undefined): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    if (terminalId === undefined) this.terminalSelection.forgetWorkspace(this.terminalWorkspaceKey(workspace));
    else this.terminalSelection.rememberTerminal(this.terminalWorkspaceKey(workspace), terminalId);
  }

  private writeSelectedTerminalToUrl(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACES[0], "terminal", terminalId, options);
  }

  private terminalWorkspaceKey(workspace: Workspace): string {
    return `${selectedMachineId(this.state)}:${workspace.path}`;
  }

  private selectMainView(view: AppState["mainView"] | "workspace", options: { invalidateNavigationSelection?: boolean } = {}) {
    if (view === "workspace") {
      this.openWorkspaceTool(this.state.workspaceTool);
      return;
    }
    if (view !== "navigation" && view !== "chat") {
      this.openWorkspaceTool(view);
      return;
    }
    if (options.invalidateNavigationSelection !== false) this.navigationSelectionSeq += 1;
    this.retireRouteRestoreForSynchronousNavigation();
    this.setState({ mainView: view });
    this.updateUrl();
    this.git.updatePolling();
  }

  private openSettings(section: SettingsSection = "general"): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private closeSettings(): void {
    this.settingsSection = undefined;
    writeSettingsSection(undefined);
  }

  private navigateSettings(section: SettingsSection): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private restoreSettingsRoute(): void {
    this.settingsSection = readSettingsSection();
  }

  private handleWorkspaceChange(previous: AppState, next: AppState) {
    if (previous.selectedWorkspace?.id === next.selectedWorkspace?.id) return;
    const selectedTerminalId = this.routeRestoreInProgress ? this.restoringRouteTerminalId : next.selectedWorkspace === undefined ? undefined : this.terminalSelection.latestTerminalId(this.terminalWorkspaceKey(next.selectedWorkspace));
    this.setState({ activeTerminalCount: 0, selectedTerminalId });
    if (!this.routeRestoreInProgress) {
      this.rememberCurrentMachineNavigation();
      this.writeSelectedTerminalToUrl(selectedTerminalId, { replace: true });
    }
    this.sessions.updatePolling();
    if (next.selectedWorkspace === undefined) return;
    void this.sessions.refreshPinnedSessions(next.selectedWorkspace.path, selectedMachineId(this.state));
    void this.refreshActiveTerminals(next.selectedWorkspace);
    void this.refreshWorkspaceDeletionRuns();
    this.refreshSelectedWorkspaceTool(next.workspaceTool);
    this.git.updatePolling();
  }

  private syncSessionUnreadMachines(): void {
    if (!this.unreadConnected) {
      this.sessionUnread.retainMachines(new Set<string>());
      return;
    }
    const machineIds = new Set(this.state.machines.map((machine) => machine.id));
    this.sessionUnread.retainMachines(machineIds);
    for (const machineId of machineIds) {
      const runtime = this.state.machineRuntimes[machineId];
      if (runtime === undefined) continue;
      const capability = this.unreadRuntimeRefreshes.has(machineId) || !runtime.ok
        ? "unknown"
        : "supported";
      if (this.sessionUnread.setCapability(machineId, capability)) void this.sessionUnread.refresh(machineId);
    }
  }

  private async renegotiateUnreadMachines(): Promise<void> {
    if (!this.unreadConnected) return;
    const machineIds = new Set(this.state.machines.map((machine) => machine.id));
    machineIds.add(selectedMachineId(this.state));
    await Promise.all([...machineIds].map(async (machineId) => { await this.renegotiateUnreadMachine(machineId); }));
  }

  private renegotiateUnreadMachine(machineId: string): Promise<void> {
    const existing = this.unreadRuntimeRefreshes.get(machineId);
    if (existing !== undefined) return existing;
    this.sessionUnread.setCapability(machineId, "unknown");
    let refreshed = false;
    const refresh = Promise.resolve().then(async () => {
      refreshed = await this.machines.refreshMachineRuntime(machineId) !== undefined;
    });
    this.unreadRuntimeRefreshes.set(machineId, refresh);
    const finishRefresh = () => {
      if (this.unreadRuntimeRefreshes.get(machineId) !== refresh) return;
      this.unreadRuntimeRefreshes.delete(machineId);
      if (!this.unreadConnected) return;
      if (refreshed) this.syncSessionUnreadMachines();
      else this.sessionUnread.setCapability(machineId, "unknown");
    };
    void refresh.then(finishRefresh, finishRefresh);
    return refresh;
  }

  private connectRealtime(): void {
    const machineId = selectedMachineId(this.state);
    this.realtime.connect(
      (event) => { this.handleRealtimeEvent(machineId, event); },
      () => {
        // Live broadcasts are not replayed after a connection gap.
        void this.sessions.refreshCurrentWorkspaceSessions(machineId);
        void this.renegotiateUnreadMachine(machineId);
        if (this.apiScope === "normal") void this.serverNotices.refresh(machineId);
        const workspace = this.state.selectedWorkspace;
        if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
        void this.refreshWorkspaceActivity(machineId);
        void this.machineStatus.refresh(machineId).catch((error: unknown) => { console.warn(`Failed to refresh machine status for ${machineId}`, error); });
      },
      machineId,
    );
  }

  private syncMachineActivitySubscriptions(): void {
    const desiredMachineIds = this.machineActivitySubscriptionIds();
    for (const [machineId, socket] of this.machineRealtimeSockets.entries()) {
      if (desiredMachineIds.has(machineId)) continue;
      socket.close();
      this.machineRealtimeSockets.delete(machineId);
    }
    for (const machineId of desiredMachineIds) {
      if (this.machineRealtimeSockets.has(machineId)) continue;
      const socket = new RealtimeSocket(this.apiScope);
      socket.connect(
        (event) => { this.handleMachineActivityEvent(machineId, event); },
        () => {
          void this.renegotiateUnreadMachine(machineId);
          void this.refreshWorkspaceActivity(machineId);
          void this.machineStatus.refresh(machineId).catch((error: unknown) => { console.warn(`Failed to refresh machine status for ${machineId}`, error); });
        },
        machineId,
      );
      this.machineRealtimeSockets.set(machineId, socket);
    }
  }

  private closeMachineActivitySockets(): void {
    for (const socket of this.machineRealtimeSockets.values()) socket.close();
    this.machineRealtimeSockets.clear();
  }

  private machineActivitySubscriptionIds(): Set<string> {
    const selected = selectedMachineId(this.state);
    return new Set(this.state.machines
      .filter((machine) => machine.id !== selected)
      .filter((machine) => shouldSubscribeToMachineActivity(machine, this.state.machineStatuses[machine.id]))
      .map((machine) => machine.id));
  }

  private handleMachineActivityEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity, machineId);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
  }

  private handleRealtimeEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "notices.updated") this.serverNotices.applyEvent(machineId, event);
    else if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
    else if (isTerminalEvent(event)) {
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else this.sessions.applyGlobalEvent(event);
  }

  private async refreshActiveTerminals(workspace: Workspace): Promise<void> {
    if (this.apiScope === "management") return;
    await this.plugins.invalidateWorkspacePanels(this.createWorkspacePanelContext(workspace), this.terminalPanelId());
  }

  private handleActivityTransition(previous: AppState, next: AppState) {
    const wasActive = isActive(previous);
    const nowActive = isActive(next);
    if (wasActive && !nowActive) {
      this.setState({ fileTreeStale: true, gitStale: true });
      this.refreshSelectedWorkspaceTool(this.state.workspaceTool);
      const workspace = next.selectedWorkspace;
      if (workspace !== undefined && selectedMachineId(previous) === selectedMachineId(next)
        && previous.selectedWorkspace?.id === workspace.id && previous.selectedWorkspace.projectId === workspace.projectId) {
        void this.invalidateWorkspaceResources(workspace, pluginMachineFromState(next), { reason: "agent-activity", resources: ["workspace.files"] });
      }
    }
  }

  private handleMachineChange(previous: AppState, next: AppState): void {
    if ((previous.selectedMachine?.id ?? "local") === (next.selectedMachine?.id ?? "local")) return;
    this.projectActivityOwnership.handleSelectedMachineChanged();
    const pendingMachineId = this.pendingRemoteRouteRestore?.machineId ?? "local";
    if (pendingMachineId !== (next.selectedMachine?.id ?? "local")) this.clearPendingRemoteRouteRestore();
    this.sessions.clearActiveSession();
    this.realtime.close();
    this.connectRealtime();
    this.sessionCleanupDialog = undefined;
    this.setState({ piWebStatus: undefined });
    this.sessions.updatePolling();
    this.git.updatePolling();
    void this.loadPluginsForSelectedMachine();
  }

  private refreshSelectedWorkspaceTool(tool: QualifiedContributionId): void {
    if (this.isFilesPanel(tool)) void this.files.refreshFiles();
    else if (tool === "core:workspace.git") void this.git.refreshGit();
    else void this.invalidateWorkspacePanels(tool);
  }

  @state() private workspaceSurfaceRevision = 0;

  private invalidateWorkspaceSurface(): void {
    this.workspaceSurfaceRevision += 1;
  }

  private workspaceSurfaceInputs(): unknown[] {
    // Workspace plugins consume runtime state, not the live transcript.
    // Plugin-owned data invalidates through host.requestRender().
    const state = this.state;
    return [
      state.selectedMachine, state.selectedWorkspace, state.selectedSession,
      state.workspaceTool, state.mainView, state.piWebStatus, this.appShell.isMobileNavigationLayout,
      state.selectedProject, state.projects, state.workspaces,
      state.isLoadingProjects, state.isLoadingWorkspaces, this.requestedWorkspacePanelError(),
      this.workspaceUploadDefaultFolder, this.workspaceSurfaceRevision,
      this.navigationPreferences, this.appShell.isMobileNavigationLayout, this.appShell.isDesktopSideBySideLayout,
      // The retained core fallback also consumes local file/Git state.
      state.fileTree, state.expandedDirs, state.selectedFilePath, state.selectedFileContent,
      state.selectedFileLoadError, state.fileTreeStale, state.workspaceUploadBatches,
      state.gitStatus, state.selectedDiffPath, state.selectedDiff, state.selectedStagedDiff, state.gitStale,
      state.activeTerminalCount, state.selectedTerminalId,
      window.location.href,
    ];
  }

  private renderWorkspacePanel() {
    const workspace = this.state.selectedWorkspace;
    const panelContext = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
    const emptyState = workspace === undefined ? this.workspacePanelEmptyState() : undefined;
    return html`
      <workspace-panel
        id="workspace-panel"
        .workspace=${workspace}
        .panelContext=${panelContext}
        .emptyState=${emptyState}
        .tool=${this.state.workspaceTool}
        .panels=${this.visibleWorkspacePanels()}
        .error=${this.requestedWorkspacePanelError()}
        .pinnedIds=${this.navigationPreferences.pinnedIds}
        .onShowNavigation=${this.showNavigation}
        .hiddenActiveDestination=${this.hiddenActiveNavigationDestination()}
        .onSelectTool=${(tool: QualifiedContributionId) => { this.openWorkspaceTool(tool); }}
      ></workspace-panel>
    `;
  }

  private renderNavigationPanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("navigation");
    return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        resizeLabel="调整导航面板大小"
        expandLabel="展开导航面板"
        collapseLabel="折叠导航面板"
        .collapsed=${this.panelCollapse.navigationPanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("navigation")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleNavigationPanel(); }}
        .onResizeStart=${() => this.startPanelResize("navigation")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("navigation", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("navigation"); }}
      ></app-panel-edge-control>
    `;
  }

  private renderWorkspacePanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("workspace");
    return html`
      <app-panel-edge-control
        side="workspace"
        controls="workspace-panel"
        resizeLabel="调整工作区面板大小"
        expandLabel="展开工作区面板"
        collapseLabel="折叠工作区面板"
        .collapsed=${this.panelCollapse.workspacePanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleWorkspacePanel(); }}
        .onResizeStart=${() => this.startPanelResize("workspace")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("workspace", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("workspace"); }}
      ></app-panel-edge-control>
    `;
  }

  private startPanelResize(side: ResizablePanelSide): number {
    if (side === "navigation") this.panelCollapse.expandNavigationPanel();
    else this.panelCollapse.expandWorkspacePanel();
    return this.measuredPanelWidth(side) ?? this.panelResize.panelWidth(side);
  }

  private resizablePanelConstraints(side: ResizablePanelSide): PanelResizeConstraints {
    const constraints = this.panelResize.constraints(side);
    return {
      ...constraints,
      maxWidth: this.resizablePanelMaxWidth(side, constraints),
    };
  }

  private resizablePanelMaxWidth(side: ResizablePanelSide, constraints: PanelResizeConstraints): number {
    const shellWidth = this.getBoundingClientRect().width || (typeof window === "undefined" ? 0 : window.innerWidth);
    if (shellWidth <= 0) return constraints.maxWidth;

    const otherPanelWidth = this.oppositeResizablePanelWidth(side);
    const maxWidth = Math.floor(shellWidth - otherPanelWidth - PANEL_EDGE_COLUMNS_WIDTH_PX - MIN_RESIZABLE_CHAT_WIDTH_PX);
    return Math.max(constraints.minWidth, Math.min(constraints.maxWidth, maxWidth));
  }

  private oppositeResizablePanelWidth(side: ResizablePanelSide): number {
    const otherSide: ResizablePanelSide = side === "navigation" ? "workspace" : "navigation";
    if (this.isResizablePanelCollapsedOrStacked(otherSide)) return 0;
    return this.measuredPanelWidth(otherSide) ?? this.panelResize.panelWidth(otherSide);
  }

  private isResizablePanelCollapsedOrStacked(side: ResizablePanelSide): boolean {
    if (side === "navigation") return this.panelCollapse.navigationPanelCollapsed;
    return this.panelCollapse.workspacePanelCollapsed || !this.isDesktopSideBySideLayout();
  }

  private isDesktopSideBySideLayout(): boolean {
    if (typeof window === "undefined" || !("matchMedia" in window)) return true;
    return window.matchMedia(DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY).matches;
  }

  private measuredPanelWidth(side: ResizablePanelSide): number | undefined {
    const element = side === "navigation" ? this.navigationPanelFrame : this.workspacePanelFrame;
    const width = element?.getBoundingClientRect().width;
    return width === undefined || width <= 0 ? undefined : width;
  }

  private resetResizablePanel(side: ResizablePanelSide): void {
    this.panelResize.resetPanel(side);
  }

  private resetResizablePanels(): void {
    this.panelResize.resetPanels();
  }

  private canDeleteArchivedSessions(): boolean {
    return true;
  }

  private canReloadSessions(): boolean {
    return this.selectedMachineRuntime()?.ok === true;
  }

  private canClearServerQueue(): boolean {
    return this.selectedMachineRuntime()?.ok === true;
  }

  private canCleanupSessions(): boolean {
    const runtime = this.selectedMachineRuntime();
    if (this.apiScope === "management" && this.state.selectedProject === undefined) return false;
    return runtime?.ok === true;
  }

  private hasAuthoritativeSessionPersistence(): boolean {
    return runtimeHasAuthoritativeSessionPersistence(this.selectedMachineRuntime());
  }

  private supportsWorkspaceFileSuggestions(machineId = selectedMachineId(this.state)): boolean {
    if (machineId === "local") return true;
    return this.state.machineRuntimes[machineId]?.ok === true;
  }

  private archivedDeleteUnavailableMessage(): string {
    const machineName = this.state.selectedMachine?.name ?? "此机器";
    return `请更新并重启 ${machineName} 上的 Pi-Web 后再删除已归档会话。`;
  }

  private sessionCleanupUnavailableMessage(): string {
    return sessionCleanupUnavailableMessage(this.state.selectedMachine?.name);
  }

  private selectedMachineRuntime() {
    return this.state.machineRuntimes[selectedMachineId(this.state)];
  }

  private openSessionCleanupDialog(): void {
    this.sessionCleanupDialog = { error: "" };
  }

  private openSessionSearchDialog(): void {
    this.sessions.searchSessions("");
    this.sessionSearchDialogOpen = true;
  }

  private closeSessionSearchDialog(): void {
    this.sessionSearchDialogOpen = false;
    this.sessions.searchSessions("");
  }

  private async selectSessionSearchMatch(session: SessionInfo, match: SessionContentSearchMatch): Promise<void> {
    const query = this.state.sessionSearchQuery.trim();
    this.sessionSearchDialogOpen = false;
    await this.selectNavigationItem("sessions", "chat", () => this.sessions.selectSearchMatch(session, match, query));
  }

  private closeSessionCleanupDialog(): void {
    this.sessionCleanupDialog = undefined;
  }

  private async previewSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const scopedRequest = this.sessionCleanupRequestForCurrentProject(request);
    if (!this.canCleanupSessions()) {
      this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), error: this.sessionCleanupUnavailableMessage(), preview: undefined, previewRequest: undefined, result: undefined, loading: false };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), loading: true, error: "", preview: undefined, previewRequest: undefined, result: undefined };
    try {
      const preview = await sessionsApi.cleanupPreview(scopedRequest, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview, previewRequest: scopedRequest, result: undefined, loading: false, error: "" };
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, loading: false, error: `预览清理失败：${errorMessage(error)}` };
    }
  }

  private async runSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const scopedRequest = this.sessionCleanupRequestForCurrentProject(request);
    const dialog = this.sessionCleanupDialog;
    if (dialog?.preview === undefined || sessionCleanupRequestKey(dialog.previewRequest) !== sessionCleanupRequestKey(scopedRequest)) {
      this.sessionCleanupDialog = { ...(dialog ?? {}), error: "运行清理前请先预览。" };
      return;
    }
    if (!this.canCleanupSessions()) {
      this.sessionCleanupDialog = { ...dialog, error: this.sessionCleanupUnavailableMessage(), running: false };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...dialog, running: true, error: "" };
    try {
      const result = await sessionsApi.cleanup(scopedRequest, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview: result, previewRequest: scopedRequest, result, running: false, error: "" };
      await this.sessions.applySessionCleanupResult(result, machineId);
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, running: false, error: `运行清理失败：${errorMessage(error)}` };
    }
  }

  private sessionCleanupRequestForCurrentProject(request: SessionCleanupRequest): SessionCleanupRequest {
    if (this.apiScope !== "management") return request;
    const project = this.state.selectedProject;
    const projectCwds = project === undefined
      ? []
      : this.state.workspaces.filter((workspace) => workspace.projectId === project.id).map((workspace) => workspace.path);
    const requestedCwds = request.projectCwds ?? projectCwds;
    const allowedCwds = new Set(projectCwds);
    return {
      ...request,
      projectId: project?.id ?? "",
      projectCwds: requestedCwds.filter((cwd) => allowedCwds.has(cwd)),
    };
  }

  // Stable callbacks keep transcript deltas from invalidating navigation children.
  private readonly navigationActions = {
    toggleMachines: () => { this.navigationSections.toggle("machines"); },
    selectMachine: (machine: Machine) => this.selectNavigationItem("machines", "projects", () => this.selectMachineWithMemory(machine)),
    removeMachine: (machine: Machine) => { void this.removeMachine(machine); },
    showActions: () => { this.setState({ actionPaletteOpen: true }); },
    toggleProjects: () => { this.navigationSections.toggle("projects"); },
    toggleWorkspaces: () => { this.navigationSections.toggle("workspaces"); },
    toggleSessions: () => { this.navigationSections.toggle("sessions"); },
    selectProject: (project: Project) => this.selectNavigationItem("projects", "workspaces", () => this.navigateToProjectFromController(project)),
    closeProject: (project: Project) => this.projects.closeProject(project.id),
    selectWorkspace: (workspace: Workspace) => this.selectNavigationItem("workspaces", "sessions", () => this.navigateToWorkspaceFromController(workspace)),
    deleteWorkspace: (workspace: Workspace) => { void this.deleteWorkspace(workspace); },
    archivedCollapsed: () => { void this.sessions.clearSelectionAfterArchivedCollapse(); },
    startSession: () => this.startSessionFromNavigation(),
    selectSession: (session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.navigateToSessionFromController(session)),
    markSessionRead: (session: SessionInfo) => { this.markSessionsRead([session]); },
    markSessionsRead: (sessions: SessionInfo[]) => { this.markSessionsRead(sessions); },
    searchSessions: () => { this.openSessionSearchDialog(); },
    toggleSessionPin: (session: SessionInfo) => { this.sessions.togglePinned(session); },
    archiveSession: (session: SessionInfo) => this.sessions.archiveSession(session),
    archiveSessionWithDescendants: (session: SessionInfo) => this.sessions.archiveSessionWithDescendants(session),
    archiveSessions: (sessions: SessionInfo[]) => this.sessions.archiveSessions(sessions),
    restoreSession: (session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.sessions.restoreSession(session)),
    deleteCachedNewSession: (session: SessionInfo) => this.sessions.deleteCachedNewSession(session),
    deleteArchivedSession: (session: SessionInfo) => this.sessions.deleteArchivedSessions([session]),
    deleteArchivedSessions: (sessions: SessionInfo[]) => this.sessions.deleteArchivedSessions(sessions),
    renameSession: (session: SessionInfo, name: string) => this.sessions.renameSession(session, name),
    detachParentSession: (session: SessionInfo) => this.sessions.detachParent(session),
    reloadSession: (session: SessionInfo) => this.sessions.reloadSession(session),
    cleanupSessions: () => { this.openSessionCleanupDialog(); },
    focusNavigationTarget: (target: NavigationFocusTarget) => { void this.focusNavigationTarget(target); },
    cancelKeyboardNavigation: () => { void this.focusChatComposer(); },
  };

  private renderNavigationPanel() {
    return html`
      <app-navigation-panel
        .machines=${this.state.machines}
        .selectedMachine=${this.state.selectedMachine}
        .locationIndicator=${this.appShell.isPwaDisplayMode}
        .machineStatuses=${this.state.machineStatuses}
        .machineStatusSnapshots=${this.state.machineStatusSnapshots}
        .machineActivities=${this.state.machineActivities}
        .machinesCollapsed=${this.navigationSections.isCollapsed("machines")}
        .onToggleMachines=${this.navigationActions.toggleMachines}
        .onSelectMachine=${this.navigationActions.selectMachine}
        .onRemoveMachine=${this.navigationActions.removeMachine}
        .projects=${this.state.projects}
        .selectedProject=${this.state.selectedProject}
        .workspaceActivities=${this.state.workspaceActivities}
        .workspacesByProjectId=${this.state.workspacesByProjectId}
        .workspaces=${this.state.workspaces}
        .selectedWorkspace=${this.state.selectedWorkspace}
        .deletingWorkspaceIds=${pendingWorkspaceDeletionIds(this.state.workspaceDeletionRuns)}
        .sessions=${this.state.sessions}
        .pinnedSessionIds=${this.state.pinnedSessionIds}
        .sessionStatuses=${this.state.sessionStatuses}
        .sessionActivities=${this.state.sessionActivities}
        .sendingPrompts=${this.state.sendingPrompts}
        .unreadSessionIds=${this.unreadSessionIds}
        .unreadPresence=${this.unreadPresence}
        .selectedSession=${this.state.selectedSession}
        .startingSessionCount=${this.state.startingSessionCount}
        .canStartSession=${!!this.state.selectedWorkspace}
        .canDeleteArchivedSessions=${this.canDeleteArchivedSessions()}
        .canReloadSessions=${this.canReloadSessions()}
        .canCleanupSessions=${this.canCleanupSessions()}
        .authoritativeSessionPersistence=${this.hasAuthoritativeSessionPersistence()}
        .archivedDeleteUnavailableMessage=${this.archivedDeleteUnavailableMessage()}
        .cleanupUnavailableMessage=${this.sessionCleanupUnavailableMessage()}
        .collapsible=${true}
        .compact=${this.appShell.isMobileNavigationLayout}
        .showBrand=${this.apiScope !== "management"}
        .managementMode=${this.apiScope === "management"}
        .projectsCollapsed=${this.navigationSections.isCollapsed("projects")}
        .workspacesCollapsed=${this.navigationSections.isCollapsed("workspaces")}
        .sessionsCollapsed=${this.navigationSections.isCollapsed("sessions")}
        .workspaceLabelItems=${guard(this.workspaceSurfaceInputs(), () => (workspace: Workspace) => this.workspaceLabelItems(workspace))}
        .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
        .onShowActions=${this.apiScope === "management" ? undefined : this.navigationActions.showActions}
        .onToggleProjects=${this.navigationActions.toggleProjects}
        .onToggleWorkspaces=${this.navigationActions.toggleWorkspaces}
        .onToggleSessions=${this.navigationActions.toggleSessions}
        .onSelectProject=${this.navigationActions.selectProject}
        .onCloseProject=${this.navigationActions.closeProject}
        .onSelectWorkspace=${this.navigationActions.selectWorkspace}
        .onDeleteWorkspace=${this.navigationActions.deleteWorkspace}
        .onArchivedCollapsed=${this.navigationActions.archivedCollapsed}
        .onStartSession=${this.navigationActions.startSession}
        .onSelectSession=${this.navigationActions.selectSession}
        .onMarkSessionRead=${this.navigationActions.markSessionRead}
        .onMarkSessionsRead=${this.navigationActions.markSessionsRead}
        .onSearchSessions=${this.navigationActions.searchSessions}
        .onToggleSessionPin=${this.navigationActions.toggleSessionPin}
        .onArchiveSession=${this.navigationActions.archiveSession}
        .onArchiveSessionWithDescendants=${this.navigationActions.archiveSessionWithDescendants}
        .onArchiveSessions=${this.navigationActions.archiveSessions}
        .onRestoreSession=${this.navigationActions.restoreSession}
        .onDeleteCachedNewSession=${this.navigationActions.deleteCachedNewSession}
        .onDeleteArchivedSession=${this.navigationActions.deleteArchivedSession}
        .onDeleteArchivedSessions=${this.navigationActions.deleteArchivedSessions}
        .onRenameSession=${this.navigationActions.renameSession}
        .onDetachParentSession=${this.navigationActions.detachParentSession}
        .onReloadSession=${this.navigationActions.reloadSession}
        .onCleanupSessions=${this.navigationActions.cleanupSessions}
        .onFocusNavigationTarget=${this.navigationActions.focusNavigationTarget}
        .onCancelKeyboardNavigation=${this.navigationActions.cancelKeyboardNavigation}
      ></app-navigation-panel>
    `;
  }

  private openNavigationSection(section: NavigationSection): void {
    this.navigationSections.open(section, () => { this.selectMainView("navigation"); });
  }

  private async selectNavigationItem(section: NavigationSection, nextTarget: NavigationFocusTarget, action: () => Promise<unknown>): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;
    let navigationAccepted: unknown;

    await this.withChatScrollTransition(async () => {
      this.navigationSections.advanceAfterSelection(section);
      navigationAccepted = await action();
    }, isCurrentSelection);

    if (!isCurrentSelection() || navigationAccepted === false) return;
    await this.focusNavigationTarget(nextTarget, isCurrentSelection);
  }

  private async startSessionFromNavigation(): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;

    this.navigationSections.advanceAfterSelection("sessions");
    await this.startSessionAndOpenChat(isCurrentSelection);
  }

  private async startSessionAndOpenChat(shouldComplete: () => boolean = () => true): Promise<void> {
    const navigationSeq = this.navigationSelectionSeq;
    const workspace = this.state.selectedWorkspace;
    const machineId = selectedMachineId(this.state);
    if (workspace === undefined) return;
    const isCurrent = () => navigationSeq === this.navigationSelectionSeq
      && shouldComplete()
      && selectedMachineId(this.state) === machineId
      && this.state.selectedProject?.id === workspace.projectId
      && this.state.selectedWorkspace?.id === workspace.id;
    if (!isCurrent()) return;
    let focus: Promise<void> | undefined;
    const start = this.sessions.startSession(async () => {
      if (!isCurrent()) return false;
      focus = this.focusChatComposer(isCurrent);
      await focus;
      return isCurrent();
    }).catch((error: unknown) => {
      if (isCurrent()) this.browserErrors.report(workspaceBrowserErrorScope(machineId, workspace.projectId, workspace.id), String(error));
    });
    if (focus !== undefined) await focus.catch(() => undefined);
    if (!isCurrent()) return;
    void start;
  }

  private async focusNavigationTarget(target: NavigationFocusTarget, shouldComplete: () => boolean = () => true): Promise<void> {
    const navigationSeq = this.navigationSelectionSeq;
    const isCurrent = () => navigationSeq === this.navigationSelectionSeq && shouldComplete();
    if (!isCurrent()) return;
    if (target === "chat") {
      await this.focusChatComposer(isCurrent);
      return;
    }
    await this.focusNavigationSection(target, isCurrent);
  }

  private async focusNavigationSection(section: NavigationSection, shouldComplete: () => boolean = () => true): Promise<void> {
    const navigationSeq = this.navigationSelectionSeq;
    const isCurrent = () => navigationSeq === this.navigationSelectionSeq && shouldComplete();
    if (!isCurrent()) return;
    if (section === "machines" && !shouldShowMachinesSection(this.state.machines)) {
      await this.focusNavigationSection("projects", isCurrent);
      return;
    }
    this.panelCollapse.expandNavigationPanel();
    if (this.appShell.isMobileNavigationLayout) this.selectMainView("navigation", { invalidateNavigationSelection: false });
    this.navigationSections.expand(section);
    await this.updateComplete;
    if (!isCurrent()) return;
    await nextFrame();
    if (!isCurrent()) return;
    await this.navigationPanel?.focusSection(section);
  }

  private async focusChatComposer(shouldComplete: () => boolean = () => true): Promise<void> {
    const navigationSeq = this.navigationSelectionSeq;
    const isCurrent = () => navigationSeq === this.navigationSelectionSeq && shouldComplete();
    if (!isCurrent()) return;
    if (this.state.mainView !== "chat") this.selectMainView("chat", { invalidateNavigationSelection: false });
    await this.updateComplete;
    if (!isCurrent()) return;
    await nextFrame();
    if (!isCurrent() || this.isRenderedModalOpen()) return;
    this.promptEditor?.focusInput();
  }

  private async navigateSessionTree(targetId: string, summaryChoice: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const originMachineId = selectedMachineId(this.state);
    const originSessionId = this.state.selectedSession?.id;
    const result = await this.sessions.navigateTree(targetId, summaryChoice);
    if (!result.cancelled
      && originSessionId !== undefined
      && selectedMachineId(this.state) === originMachineId
      && this.state.selectedSession?.id === originSessionId) {
      await this.focusChatComposer();
    }
    return result;
  }

  private forkSessionTree(entryId: string): Promise<SessionTreeForkResult> {
    return this.sessions.forkFromTree(entryId);
  }

  private closeSessionTreeNavigator(): void {
    this.sessions.closeTreeDialog();
    void this.focusChatComposer();
  }

  private renderSessionTreeNavigator(state: AppState) {
    return state.treeDialog === undefined ? null : html`
      <session-tree-navigator
        .tree=${state.treeDialog}
        .onNavigate=${(targetId: string, summaryChoice: SessionTreeSummaryChoice) => this.navigateSessionTree(targetId, summaryChoice)}
        .onFork=${(entryId: string) => this.forkSessionTree(entryId)}
        .onAbort=${() => this.sessions.abortTreeNavigation()}
        .onCancel=${() => { this.closeSessionTreeNavigator(); }}
      ></session-tree-navigator>
    `;
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    return this.plugins.getWorkspacePanels().filter((panel) => panel.visible?.(context) ?? true);
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.isLoadingProjects) {
      return {
        title: "正在加载项目…",
        body: "正在查找你已添加到 PI WEB 的项目。",
      };
    }
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            title: "还没有项目",
            body: "使用“操作 → 添加项目”添加文件夹。选择工作区后，工作区工具会显示在这里。",
          }
        : {
            title: "选择项目",
            body: "从侧边栏选择一个项目，然后选择工作区来查看文件、Git 或终端。",
          };
    }
    if (this.state.isLoadingWorkspaces) {
      return {
        title: "正在加载工作区…",
        body: `正在为 ${project.name} 准备工作区工具。`,
      };
    }
    if (this.state.workspaces.length === 0) {
      return {
      title: "未找到工作区",
      body: `${project.name} 没有可用工作区。请尝试重新选择该项目，或重新添加它。`,
      };
    }
    return {
      title: "选择工作区",
      body: `选择 ${project.name} 中的工作区，以查看文件、Git 或终端。`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.routeContentError() !== "") return this.routeContentError();
    if (this.state.isLoadingProjects) return "正在加载项目…";
    if (this.state.selectedWorkspace !== undefined) return "选择或启动会话。";
    if (this.state.selectedProject !== undefined) return "选择工作区以启动会话。";
    if (this.state.projects.length === 0) return "添加项目以启动会话。";
    return "选择项目和工作区以开始会话。";
  }

  private mobilePanelBadge(panel: QualifiedWorkspacePanelContribution): unknown {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return undefined;
    return panel.badge?.(this.createWorkspacePanelContext(workspace));
  }

  private mobilePanelIcon(panel: QualifiedWorkspacePanelContribution): AppMobileMainTabIcon | undefined {
    switch (panel.id) {
      case "files:workspace.files": return "files";
      case "core:workspace.files": return "files";
      case "core:workspace.git": return "git";
      case "pi-web.terminal:workspace.terminal": return "terminal";
      case "core:workspace.terminal": return "terminal";
      default: return undefined;
    }
  }

  private workspaceLabelItems(workspace: Workspace): WorkspaceLabelItem[] {
    return this.plugins.getWorkspaceLabelItems(this.createWorkspaceLabelContext(workspace));
  }

  private createWorkspaceLabelContext(workspace: Workspace): WorkspaceLabelContext {
    const machine = pluginMachineFromState(this.state);
    const createContext = (binding: WorkspacePluginBinding): WorkspaceLabelContext => {
      const backend = createPluginWorkspaceBackend(binding, workspace, machine.id);
      const peer = createPluginPeer(binding, workspace, machine.id);
      return installWorkspaceLabelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machine),
        ...(backend === undefined ? {} : { backend }),
        ...(peer === undefined ? {} : { peer }),
        host: this.createWorkspaceHost(),
      }, createContext);
    };
    return createContext(coreWorkspacePluginBinding());
  }

  private createWorkspaceFiles(workspace: Workspace, machine: PluginMachine): WorkspaceFiles {
    const machineId = machine.id;
    const files = createWorkspaceFiles(workspacesApi, workspace, machineId, () => {
      if (selectedMachineId(this.state) === machineId && this.state.selectedWorkspace?.id === workspace.id && this.state.selectedWorkspace.projectId === workspace.projectId) void this.files.refreshFiles();
    }, {
      defaultUploadFolder: workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadDefaultFolder),
      onInvalidate: (invalidation) => { void this.invalidateWorkspaceResources(workspace, machine, invalidation); },
    });
    return {
      ...files,
      readOptionalFile: (path: string) => workspacesApi.optionalWorkspaceFile(workspace.projectId, workspace.id, path, machineId),
    };
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.invalidateWorkspaceSurface(); },
    };
  }

  private createWorkspacePanelContext(workspace: Workspace, machine = pluginMachineFromState(this.state), restoredQuery?: ContributionQueryRecord): WorkspacePanelContext {
    const machineId = machine.id;
    const createContext = (binding: WorkspacePluginBinding, contributionId?: QualifiedContributionId, aliases: readonly QualifiedContributionId[] = []): WorkspacePanelContext => {
      // Session selection does not retire a panel in the same workspace.
      const navigation = this.beginNavigationOperation(WORKSPACE_SURFACE_SCOPE);
      const generation = this.workspaceNavigationGeneration;
      const isCurrent = () => {
        const route = readRoute();
        return navigation.isCurrent() && generation === this.workspaceNavigationGeneration && selectedMachineId(this.state) === machineId
          && this.state.selectedProject?.id === workspace.projectId && this.state.selectedWorkspace?.id === workspace.id
          && (route.machineId ?? "local") === machineId && route.projectId === workspace.projectId && route.workspaceId === workspace.id;
      };
      const terminalCommandRuns = this.terminalCommandRunsForOrigin(binding.registrationPluginId, machineId);
      const backend = createPluginWorkspaceBackend(binding, workspace, machineId);
      const peer = createPluginPeer(binding, workspace, machineId);
      return installWorkspacePanelScope({
        navigate: (destination) => isCurrent() ? this.navigate(destination) : Promise.resolve(),
        ...(contributionId === undefined ? {} : { navigation: createWorkspacePanelNavigation(contributionId, aliases, isCurrent, () => {
          this.rememberCurrentMachineNavigation();
          this.requestUpdate();
        }, restoredQuery === undefined ? undefined : contributionQueryFromRecord(restoredQuery, contributionId, aliases)) }),
        machine,
        workspace,
        ...(backend === undefined ? {} : { backend }),
        ...(peer === undefined ? {} : { peer }),
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machine),
        prompt: this.createPromptEditor(),
        terminal: this.workspaceTerminal(binding.registrationPluginId, workspace, machineId, isCurrent),
        openTerminal: (options) => { this.workspaceTerminal(binding.registrationPluginId, workspace, machineId, isCurrent).open(options); },
        host: this.createWorkspaceHost(),
        piWebUnstable: { terminalCommandRuns },
        fileTree: this.state.fileTree,
        expandedDirs: this.state.expandedDirs,
        selectedFilePath: this.state.selectedFilePath,
        selectedFileContent: this.state.selectedFileContent,
        selectedFileLoadError: this.state.selectedFileLoadError,
        fileTreeStale: this.state.fileTreeStale,
        gitStatus: this.state.gitStatus,
        selectedDiffPath: this.state.selectedDiffPath,
        selectedDiff: this.state.selectedDiff,
        selectedStagedDiff: this.state.selectedStagedDiff,
        gitStale: this.state.gitStale,
        activeTerminalCount: this.state.activeTerminalCount,
        selectedTerminalId: this.state.selectedTerminalId,
        terminalAutoStart: false,
        workspaceUploadDefaultFolder: workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadDefaultFolder),
        onRefreshFiles: () => { void this.files.refreshFiles(); },
        onCreateFile: (path: string) => { void this.files.createFile(path); },
        onCreateDirectory: (path: string) => { void this.files.createDirectory(path); },
        onMoveSelectedPath: (path: string) => { void this.files.moveSelectedPath(path); },
        onDeleteSelectedPath: () => { void this.files.deleteSelectedPath(); },
        onDownloadSelectedFile: () => { void this.files.downloadSelectedFile(); },
        onExpandDir: (path: string) => { void this.files.expandDir(path); },
        onSelectDirectory: (path: string) => { this.files.selectDirectory(path); },
        onSelectFile: (path: string) => { void this.files.selectFile(path); },
        onStartWorkspaceUpload: (files, options) => this.files.startWorkspaceUpload(files, options),
        onCancelWorkspaceUpload: (batchId) => { this.files.cancelWorkspaceUpload(batchId); },
        onClearWorkspaceUpload: (batchId) => { this.files.clearWorkspaceUpload(batchId); },
        onRefreshGit: () => { void this.git.refreshGit(); },
        onSelectDiff: (path: string) => { void this.git.selectDiff(path); },
        onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => { this.selectTerminal(terminalId, options); },
      }, createContext);
    };
    return createContext({ registrationPluginId: "core", sourcePluginId: "core" });
  }

  private invalidateWorkspacePanels(panelId?: QualifiedContributionId, restoredQuery?: ContributionQueryRecord): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return Promise.resolve();
    return this.plugins.invalidateWorkspacePanels(this.createWorkspacePanelContext(workspace, pluginMachineFromState(this.state), restoredQuery), panelId);
  }

  private invalidateWorkspaceResources(workspace: Workspace, machine: PluginMachine, invalidation: WorkspaceInvalidation): Promise<void> {
    return this.plugins.invalidateWorkspaceResources(this.createWorkspacePanelContext(workspace, machine), invalidation);
  }

  private getActions(): AppAction[] {
    return applyActiveShortcutPreferences(this.getDefaultActions(), this.shortcutConfig);
  }

  private shortcutSettingsActions(): AppAction[] {
    return [...composerShortcutActions(), ...this.getDefaultActions()];
  }

  private getDefaultActions(): AppAction[] {
    return [...this.plugins.getActions(this.createPluginRuntimeContext()), ...this.normalAuthActions(), ...this.sessionActions(), ...this.navigationFocusActions(), ...this.panelLayoutActions()];
  }

  private normalAuthActions(): AppAction[] {
    if (this.apiScope === "management") return [];
    return [
      {
        id: "app.normal-auth.change-password",
        title: "修改普通模式密码",
        description: "更改进入普通模式所需的本地密码",
        group: "偏好设置",
        enabled: this.normalAuthStatus?.authenticated === true,
        run: () => { this.normalAuthDialogMode = "change"; this.normalAuthError = ""; },
      },
    ];
  }

  private sessionActions(): AppAction[] {
    const canCleanup = this.canCleanupSessions();
    return [
      {
        id: "app.sessions.cleanup",
        title: "清理会话",
        description: "预览并手动清理所选机器上的空闲或已归档会话",
        group: "会话",
        ...(canCleanup ? {} : { enabled: false, disabledReason: this.sessionCleanupUnavailableMessage() }),
        run: () => { this.openSessionCleanupDialog(); },
      },
    ];
  }

  private panelLayoutActions(): AppAction[] {
    return [
      {
        id: "app.layout.reset-navigation-panel-size",
        title: "重置导航面板宽度",
        description: "将导航面板恢复为默认宽度",
        group: "视图",
        run: () => { this.resetResizablePanel("navigation"); },
      },
      {
        id: "app.layout.reset-workspace-panel-size",
        title: "重置工作区面板宽度",
        description: "将工作区面板恢复为默认宽度",
        group: "视图",
        run: () => { this.resetResizablePanel("workspace"); },
      },
      {
        id: "app.layout.reset-panel-sizes",
        title: "重置面板宽度",
        description: "将所有侧边面板恢复为默认宽度",
        group: "视图",
        run: () => { this.resetResizablePanels(); },
      },
    ];
  }

  private navigationFocusActions(): AppAction[] {
    return [
      {
        id: "app.navigation.open",
        title: "打开导航",
        description: "搜索目标并管理固定标签",
        group: "导航",
        run: this.showNavigation,
      },
      {
        id: "app.navigation.focus-machines",
        title: "聚焦机器",
        description: "将键盘焦点移到机器选择器",
        shortcut: "mod+g m",
        group: "导航",
        run: () => this.focusNavigationSection("machines"),
      },
      {
        id: "app.navigation.focus-projects",
        title: "聚焦项目",
        description: "将键盘焦点移到项目列表",
        shortcut: "mod+g p",
        group: "导航",
        run: () => this.focusNavigationSection("projects"),
      },
      {
        id: "app.navigation.focus-workspaces",
        title: "聚焦工作区",
        description: "将键盘焦点移到工作区列表",
        shortcut: "mod+g w",
        group: "导航",
        run: () => this.focusNavigationSection("workspaces"),
      },
      {
        id: "app.navigation.focus-sessions",
        title: "聚焦会话",
        description: "将键盘焦点移到会话列表",
        shortcut: "mod+g s",
        group: "导航",
        run: () => this.focusNavigationSection("sessions"),
      },
    ];
  }

  private ensureGatewayPluginsLoaded(): Promise<void> {
    return this.pluginLoads.ensureGatewayLoaded().then(() => undefined);
  }

  private async loadPluginsForSelectedMachine(): Promise<void> {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote") return;
    await this.loadPluginsForMachine(machine);
  }

  private async loadPluginsForMachine(machine: Machine): Promise<void> {
    await this.pluginLoads.loadForMachine(machine);
  }

  private async registerExternalPlugins(label: string, load: () => Promise<ExternalPluginLoadResult>, machineId = "local"): Promise<boolean> {
    const urlAtLoad = window.location.href;
    try {
      await this.builtInPluginsReady;
      const result = await load();
      if (this.apiScope === "management") {
        const allowed = (entry: { id: string; sourcePluginId?: string }) => (entry.sourcePluginId ?? entry.id) !== REQUIRED_TERMINAL_PLUGIN_ID;
        const declarations = result.declarations.filter(allowed);
        const batch = await this.plugins.registerBatch(result.registrations.filter(allowed), { declarations, failures: externalRegistryFailures(result, declarations) });
        for (const failure of batch.failures) console.warn(`Failed to register PI WEB plugin ${failure.declaration.id} (${failure.phase})`, failure.error);
        this.applyPreferredTheme(false);
        this.invalidateWorkspaceSurface();
        return batch.failures.length === 0;
      }
      if (result.terminalMode === "recovery-disabled") {
        this.clearRequiredTerminal(machineId);
        this.verifiedPluginModeByMachine.set(machineId, "recovery-disabled");
        this.clearRequiredPluginFailure(machineId);
      }
      const loadErrors = result.failures.map((failure) => errorMessage(failure.error));
      this.pluginLoadErrors.delete(machineId);
      if (loadErrors.length > 0) this.pluginLoadErrors.set(machineId, loadErrors.join("\n"));
      let complete = result.failures.length === 0;
      for (const failure of result.failures) {
        console.warn(`Failed to load PI WEB plugin ${failure.entry.id} (${failure.entry.module})`, failure.error);
      }
      const declarations = result.declarations;
      const registryImportFailures = externalRegistryFailures(result, declarations);
      const requiredTerminalLoadFailure = result.terminalMode === "required"
        ? result.failures.find(({ entry }) => entry.id === REQUIRED_TERMINAL_PLUGIN_ID)
        : undefined;
      if (requiredTerminalLoadFailure !== undefined) {
        this.verifiedPluginModeByMachine.delete(machineId);
        this.clearRequiredTerminal(machineId);
        this.reconcilePluginLoadSelection(urlAtLoad);
        this.applyPreferredTheme(false);
        this.setRequiredPluginFailure(machineId, `必需的终端插件加载失败：${errorMessage(requiredTerminalLoadFailure.error)}。请打开设置查看恢复指引。`);
        this.requestUpdate();
        return false;
      }

      const terminalRuntimeId = machineId === "local"
        ? REQUIRED_TERMINAL_PLUGIN_ID
        : machineScopedBundledPluginId(machineId, REQUIRED_TERMINAL_PLUGIN_ID);
      if (result.terminalMode === "required") {
        let terminalFailurePhase: BrowserPluginLifecyclePhase = "validate";
        try {
          const terminalRegistration = result.registrations.find(({ id }) => id === terminalRuntimeId);
          if (this.plugins.hasPlugin(terminalRuntimeId)) {
            const known = this.knownRequiredTerminalByMachine.get(machineId);
            if (known === undefined) throw new Error("Required Terminal browser capability was not retained after activation");
            if (terminalRegistration !== undefined) {
              const requiredBinding = requiredTerminalPluginBinding(terminalRegistration, machineId);
              if (!sameWorkspacePluginBinding(known.binding, requiredBinding)) {
                throw new Error("Required Terminal revision changed after browser activation; reload PI WEB to activate the new paired revision");
              }
            }
            this.requiredTerminalByMachine.set(machineId, known);
          } else {
            if (terminalRegistration === undefined) throw new Error("Required Terminal browser registration is unavailable");
            const requiredBinding = requiredTerminalPluginBinding(terminalRegistration, machineId);
            const terminalDeclaration = declarations.find(({ id }) => id === terminalRuntimeId);
            if (terminalDeclaration === undefined) throw new Error("Required Terminal browser declaration is unavailable");
            const terminalBatch = await this.plugins.registerBatch([terminalRegistration], {
              declarations: [terminalDeclaration],
              failures: registryImportFailures.filter(({ declaration }) => declaration.id === terminalRuntimeId),
              requiredCapabilities: [{
                registrationPluginId: terminalRuntimeId,
                capability: REQUIRED_TERMINAL_BROWSER_FACADE_CAPABILITY,
              }],
            });
            const terminalFailure = terminalBatch.failures.find(({ declaration }) => declaration.id === terminalRuntimeId);
            if (terminalFailure !== undefined) {
              terminalFailurePhase = terminalFailure.phase;
              throw terminalFailure.error;
            }
            const facade = this.plugins.resolveCapability(terminalRuntimeId, REQUIRED_TERMINAL_BROWSER_FACADE_CAPABILITY);
            const composition = Object.freeze({ binding: requiredBinding, facade });
            this.knownRequiredTerminalByMachine.set(machineId, composition);
            this.requiredTerminalByMachine.set(machineId, composition);
          }
        } catch (error) {
          complete = false;
          console.warn(`Failed to register PI WEB plugin ${terminalRuntimeId} during ${terminalFailurePhase}`, error);
          this.verifiedPluginModeByMachine.delete(machineId);
          this.clearRequiredTerminal(machineId);
          this.setRequiredPluginFailure(machineId, `必需的终端插件在浏览器 ${terminalFailurePhase} 阶段失败：${errorMessage(error)}。请打开设置查看恢复指引。`);
        }
      }

      if (result.terminalMode !== "required" || this.terminalAvailableForMachine(machineId)) {
        const ordinaryRegistrations = result.registrations.filter(({ id }) => id !== terminalRuntimeId);
        const ordinaryDeclarations = declarations.filter(({ id }) => id !== terminalRuntimeId);
        const ordinaryBatch = await this.plugins.registerBatch(ordinaryRegistrations, {
          declarations: ordinaryDeclarations,
          failures: registryImportFailures.filter(({ declaration }) => declaration.id !== terminalRuntimeId),
        });
        for (const failure of ordinaryBatch.failures) {
          if (failure.phase === "import") continue;
          complete = false;
          loadErrors.push(errorMessage(failure.error));
          this.pluginLoadErrors.set(machineId, loadErrors.join("\n"));
          console.warn(`Failed to register PI WEB plugin ${failure.declaration.id} during ${failure.phase}`, failure.error);
        }
      }

      if (result.terminalMode === "required" && (!this.plugins.hasPlugin(terminalRuntimeId) || !this.terminalAvailableForMachine(machineId))) {
        complete = false;
        this.verifiedPluginModeByMachine.delete(machineId);
        this.clearRequiredTerminal(machineId);
        if (!this.requiredPluginFailureByMachine.has(machineId)) {
          this.setRequiredPluginFailure(machineId, "插件激活后必需的终端插件仍不可用。请打开设置查看恢复指引。");
        }
      } else if (result.terminalMode === "required") {
        this.verifiedPluginModeByMachine.set(machineId, "required");
        this.clearRequiredPluginFailure(machineId);
      }
      this.reconcilePluginLoadSelection(urlAtLoad);
      this.applyPreferredTheme(false);
      this.invalidateWorkspaceSurface();
      return complete;
    } catch (error) {
      console.warn(`Failed to load ${label}`, error);
      this.pluginLoadErrors.set(machineId, errorMessage(error));
      this.verifiedPluginModeByMachine.delete(machineId);
      this.clearRequiredTerminal(machineId);
      this.reconcilePluginLoadSelection(urlAtLoad);
      this.applyPreferredTheme(false);
      this.setRequiredPluginFailure(machineId, `加载 ${label} 失败：${errorMessage(error)}`);
      this.invalidateWorkspaceSurface();
      return false;
    }
  }

  private reconcilePluginLoadSelection(urlAtLoad: string): void {
    if (window.location.href === urlAtLoad) this.invalidateWorkspaceSurface();
  }

  private setRequiredPluginFailure(machineId: string, message: string): void {
    this.requiredPluginFailureByMachine.set(machineId, message);
    this.dismissedRequiredPluginFailureByMachine.delete(machineId);
    if (selectedMachineId(this.state) === machineId) this.requestUpdate();
  }

  private clearRequiredPluginFailure(machineId: string): void {
    if (!this.requiredPluginFailureByMachine.delete(machineId)) return;
    this.dismissedRequiredPluginFailureByMachine.delete(machineId);
    if (selectedMachineId(this.state) === machineId) this.requestUpdate();
  }

  private displayedError(): string {
    if (this.state.error !== "") return this.state.error;
    const machineId = selectedMachineId(this.state);
    const failure = this.requiredPluginFailureByMachine.get(machineId);
    return failure !== undefined && this.dismissedRequiredPluginFailureByMachine.get(machineId) !== failure
      ? failure
      : "";
  }

  private dismissDisplayedError(): void {
    if (this.state.error !== "") {
      this.setState({ error: "" });
      return;
    }
    const machineId = selectedMachineId(this.state);
    const failure = this.requiredPluginFailureByMachine.get(machineId);
    if (failure === undefined) return;
    this.dismissedRequiredPluginFailureByMachine.set(machineId, failure);
    this.requestUpdate();
  }

  private clearRequiredTerminal(machineId: string): void {
    this.requiredTerminalByMachine.delete(machineId);
    this.invalidateWorkspaceSurface();
    this.pluginLoads.invalidateMachine(machineId);
    if (selectedMachineId(this.state) !== machineId) return;
    this.cancelWorkspaceDeletionRefresh();
    this.setState({ workspaceDeletionRuns: {} });
  }

  private terminalAvailableForMachine(machineId: string): boolean {
    return this.requiredTerminalByMachine.has(machineId);
  }

  private pluginContributionAvailable(pluginId: string, effectiveMachineId: string | undefined): boolean {
    if (pluginId === "core" || pluginId === "themes" || this.apiScope === "management") return true;
    // Machine-using callbacks are rechecked against the live selection so a
    // closure captured on another healthy machine cannot act after a switch.
    if (effectiveMachineId !== undefined && effectiveMachineId !== selectedMachineId(this.state)) return false;
    // Undefined is reserved for intentional app-global theme evaluation.
    const machineId = effectiveMachineId ?? "local";
    const mode = this.verifiedPluginModeByMachine.get(machineId);
    const terminalRuntimeId = machineId === "local"
      ? REQUIRED_TERMINAL_PLUGIN_ID
      : machineScopedBundledPluginId(machineId, REQUIRED_TERMINAL_PLUGIN_ID);
    if (pluginId === terminalRuntimeId) return mode === "required" && this.terminalAvailableForMachine(machineId);
    return mode === "recovery-disabled" || (mode === "required" && this.terminalAvailableForMachine(machineId));
  }

  private createPromptEditor(): PluginPromptEditor {
    return {
      insertText: (text: string) => {
        const editor = this.promptEditor?.view;
        if (!editor) return;
        if (!editor.hasFocus) editor.focus();
        const sel = editor.state.selection.main;
        editor.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
      },
      getText: () => {
        return this.promptEditor?.view?.state.doc.toString() ?? "";
      },
      getSelection: () => {
        const editor = this.promptEditor?.view;
        if (!editor) return null;
        const sel = editor.state.selection.main;
        if (sel.empty) return null;
        return { start: sel.from, end: sel.to, text: editor.state.sliceDoc(sel.from, sel.to) };
      },
    };
  }

  private createPluginRuntimeContext(): PluginRuntimeContext {
    const createContext = (origin: string): PluginRuntimeContext => installPluginRuntimeScope({
      state: this.state,
      prompt: this.createPromptEditor(),
      piWebUnstable: {
        terminalCommandRuns: this.terminalCommandRunsForOrigin(origin),
        openSettings: (section) => { this.openSettings(section); },
      },
      openActionPalette: () => { this.setState({ actionPaletteOpen: true }); },
      focusPrompt: () => { void this.focusChatComposer(); },
      addProject: () => { this.setState({ projectDialogOpen: true }); },
      addMachine: () => { this.openMachineDialog(); },
      refreshSelectedMachine: async () => {
        await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
      },
      removeSelectedMachine: () => this.removeMachine(),
      openSelectedMachine: () => { this.openSelectedMachine(); },
      configureAuth: () => this.auth.openLogin(),
      logoutAuth: () => this.auth.openLogout(),
      openThemePicker: () => { this.openThemeDialog(); },
      openModelPicker: () => this.openModelDialog(),
      openThinkingLevelPicker: () => this.openThinkingDialog(),
      selectMainView: (view) => { this.selectMainView(view); },
      navigate: (destination) => this.navigate(destination),
      selectWorkspaceTool: (tool) => { this.openWorkspaceTool(tool); },
      openTerminal: (options) => { this.openTerminal(options); },
      refreshFiles: async () => {
        const workspace = this.state.selectedWorkspace;
        const machine = pluginMachineFromState(this.state);
        await this.files.refreshFiles();
        if (workspace !== undefined) await this.invalidateWorkspaceResources(workspace, machine, { reason: "manual", resources: ["workspace.files"] });
      },
      refreshGit: () => this.git.refreshGit(),
      refreshWorkspacePanels: (panelId) => this.invalidateWorkspacePanels(panelId),
      refreshAppData: () => this.refreshAppData(),
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      reloadPage: () => { this.hardReloadApp(); },
      deleteWorkspace: (workspace) => this.deleteWorkspace(workspace),
      startSession: () => this.withChatScrollTransition(() => this.startSessionAndOpenChat()),
      archiveSession: () => this.sessions.archiveSession(),
      reloadSession: () => this.sessions.reloadSession(),
      deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
      stopActiveWork: () => this.sessions.stopActiveWork(),
    }, createContext);
    return createContext("core");
  }

  private async deleteWorkspace(workspace = this.state.selectedWorkspace): Promise<void> {
    if (workspace === undefined) return;
    const machineId = selectedMachineId(this.state);
    const scope = workspaceBrowserErrorScope(machineId, workspace.projectId, workspace.id);
    if (!canDeleteWorkspace(workspace)) {
      this.browserErrors.report(scope, "当前工作区不支持移除");
      return;
    }
    if (isWorkspaceDeletionPending(this.state, workspace)) return;
    const removal = workspace.removal;
    const confirmation = workspaceRemovalConfirmation(workspace);
    if (removal === undefined || confirmation === undefined || !confirm(confirmation)) return;
    const navigation = this.beginNavigationOperation(NAVIGATION_SCOPES);

    try {
      const run = await workspacesApi.deleteWorkspace(workspace.projectId, workspace.id, removal.precondition, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      if (!this.recordWorkspaceDeletionRun(run, machineId)) return;
      const commandWorkspace = await this.workspaceForCommandRun(run, machineId);
      if (selectedMachineId(this.state) !== machineId || !navigation.isCurrent()) return;
      if (commandWorkspace !== undefined) this.workspaceTerminal("core", commandWorkspace, machineId).open({ terminalId: run.terminalId });
    } catch (error) {
      await this.reportWorkspaceRemovalFailure(workspace, machineId, scope, error);
    }
  }

  private async reportWorkspaceRemovalFailure(workspace: Workspace, machineId: string, scope: BrowserErrorScope, error: unknown): Promise<void> {
    const message = errorMessage(error);
    if (this.apiScope === "management" || !(error instanceof HttpRequestError) || message.startsWith("Session daemon unavailable:")) {
      this.browserErrors.report(scope, `启动工作区删除失败：${message}`);
      return;
    }

    const expectedNoticeMessage = `工作区移除失败：${message}`;
    const hasNotice = () => this.serverNotices.hasNotice(machineId, (notice) => {
      const context = notice.context ?? {};
      return notice.source === workspaceDeleteOperation
        && notice.message === expectedNoticeMessage
        && context["projectId"] === workspace.projectId
        && context["workspaceId"] === workspace.id;
    });
    if (!hasNotice()) await this.serverNotices.refresh(machineId);
    if (!hasNotice()) this.browserErrors.report(scope, `启动工作区删除失败：${message}`);
  }

  private async workspaceForCommandRun(run: TerminalCommandRun, machineId: string): Promise<Workspace | undefined> {
    let workspaces = this.state.selectedProject?.id === run.projectId ? this.state.workspaces : this.state.workspacesByProjectId[run.projectId];
    if (workspaces === undefined || workspaces.length === 0) workspaces = await this.workspaces.refreshProjectWorkspaces(run.projectId, machineId);
    if (selectedMachineId(this.state) !== machineId || this.state.selectedProject?.id !== run.projectId) return undefined;
    return workspaces.find((workspace) => workspace.id === run.workspaceId);
  }

  private recordWorkspaceDeletionRun(run: TerminalCommandRun, machineId: string): boolean {
    if (selectedMachineId(this.state) !== machineId || this.state.selectedProject?.id !== run.projectId) return false;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return false;
    this.setState({ workspaceDeletionRuns: { ...this.state.workspaceDeletionRuns, [workspaceId]: run } });
    this.updateWorkspaceDeletionPolling();
    return true;
  }

  private async refreshWorkspaceDeletionRuns(): Promise<void> {
    const machineId = selectedMachineId(this.state);
    const project = this.state.selectedProject;
    const scope = workspaceDeletionScopeKey(this.state);
    if (project === undefined || scope === undefined || (this.apiScope === "normal" && !this.terminalAvailableForMachine(machineId))) {
      this.cancelWorkspaceDeletionRefresh();
      this.setState({ workspaceDeletionRuns: {} });
      return;
    }
    if (this.workspaceDeletionRefreshAbort !== undefined) {
      if (this.workspaceDeletionRefreshScope === scope) {
        this.workspaceDeletionRefreshQueued = true;
        return;
      }
      this.cancelWorkspaceDeletionRefresh();
    }
    const controller = new AbortController();
    const generation = ++this.workspaceDeletionRefreshGeneration;
    this.workspaceDeletionRefreshAbort = controller;
    this.workspaceDeletionRefreshScope = scope;
    try {
      const initiallyTrackedRuns = Object.values(this.state.workspaceDeletionRuns).filter((run) => run.projectId === project.id);
      for (const run of initiallyTrackedRuns) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId, project.id, generation, controller);
      }
      if (!this.workspaceDeletionRefreshIsCurrent(machineId, project.id, generation, controller)) return;
      const pendingRuns = Object.values(this.state.workspaceDeletionRuns).filter((run) => run.projectId === project.id && isWorkspaceDeletionRunPending(run));
      if (initiallyTrackedRuns.length > 0 && pendingRuns.length === 0) return;
      const filter = workspaceDeletionRunFilter();
      const queryWorkspaces: Pick<Workspace, "id" | "projectId">[] = pendingRuns.length === 0
        ? this.state.workspaces.filter((workspace) => workspace.projectId === project.id)
        : [...new Map(pendingRuns.map((run) => [run.workspaceId, { id: run.workspaceId, projectId: run.projectId }])).values()];
      const composition = this.apiScope === "management" ? undefined : this.requiredTerminalByMachine.get(machineId);
      const results = await Promise.allSettled(queryWorkspaces.map(async (workspace) => {
        if (this.apiScope === "management") {
          return terminalsApi.listCommandRuns({ ...filter, projectId: project.id, workspaceId: workspace.id }, machineId, { signal: controller.signal });
        }
        const peer = composition === undefined ? undefined : createPluginPeer(composition.binding, workspace, machineId);
        if (peer === undefined || composition === undefined) throw requiredTerminalUnavailableError(machineId);
        return composition.facade.listCommandRuns({ peer, filter: { metadata: filter.metadata }, signal: controller.signal });
      }));
      if (!this.workspaceDeletionRefreshIsCurrent(machineId, project.id, generation, controller)) return;
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const successfulRuns = results.filter((result): result is PromiseFulfilledResult<TerminalCommandRun[]> => result.status === "fulfilled");
      if (successfulRuns.length === 0 && failures.length > 0) throw failures[0]?.reason;
      for (const failure of failures) console.warn("Failed to query workspace deletion runs for one workspace", failure.reason);
      const failedWorkspaceIds = new Set(results.flatMap((result, index) => {
        const failedWorkspace = result.status === "rejected" ? queryWorkspaces[index] : undefined;
        return failedWorkspace === undefined ? [] : [failedWorkspace.id];
      }));
      const retainedPendingRuns = Object.values(this.state.workspaceDeletionRuns).filter((run) =>
        run.projectId === project.id && isWorkspaceDeletionRunPending(run) && failedWorkspaceIds.has(run.workspaceId));
      const discoveredRuns = [...successfulRuns.flatMap((result) => result.value), ...retainedPendingRuns]
        .filter((run) => !this.handledWorkspaceDeletionRunIds.has(machineScopedKey(machineId, run.id)));
      const latestRuns = latestWorkspaceDeletionRuns(discoveredRuns);
      this.setState({ workspaceDeletionRuns: latestRuns });
      for (const run of Object.values(latestRuns)) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId, project.id, generation, controller);
      }
    } catch (error) {
      if (!controller.signal.aborted && this.workspaceDeletionRefreshIsCurrent(machineId, project.id, generation, controller)) console.warn("Failed to refresh workspace deletion runs", error);
    } finally {
      if (this.workspaceDeletionRefreshAbort === controller) {
        this.workspaceDeletionRefreshAbort = undefined;
        this.workspaceDeletionRefreshScope = undefined;
        const refreshQueued = this.workspaceDeletionRefreshQueued;
        this.workspaceDeletionRefreshQueued = false;
        if (refreshQueued && workspaceDeletionScopeKey(this.state) === scope) {
          if (this.workspaceDeletionPollTimer !== undefined) window.clearTimeout(this.workspaceDeletionPollTimer);
          this.workspaceDeletionPollTimer = undefined;
          queueMicrotask(() => {
            if (generation === this.workspaceDeletionRefreshGeneration && workspaceDeletionScopeKey(this.state) === scope) void this.refreshWorkspaceDeletionRuns();
          });
        } else this.updateWorkspaceDeletionPolling();
      }
    }
  }

  private workspaceDeletionRefreshIsCurrent(machineId: string, projectId: string, generation: number, controller: AbortController): boolean {
    return this.workspaceDeletionRefreshAbort === controller && !controller.signal.aborted
      && generation === this.workspaceDeletionRefreshGeneration && selectedMachineId(this.state) === machineId
      && this.state.selectedProject?.id === projectId;
  }

  private cancelWorkspaceDeletionRefresh(): void {
    this.workspaceDeletionRefreshGeneration += 1;
    this.workspaceDeletionRefreshAbort?.abort(new DOMException("Workspace deletion scope changed", "AbortError"));
    this.workspaceDeletionRefreshAbort = undefined;
    this.workspaceDeletionRefreshScope = undefined;
    this.workspaceDeletionRefreshQueued = false;
    this.workspaceDeletionReconcileRetries.clear();
    if (this.workspaceDeletionPollTimer !== undefined) window.clearTimeout(this.workspaceDeletionPollTimer);
    this.workspaceDeletionPollTimer = undefined;
  }

  private updateWorkspaceDeletionPolling(): void {
    const machineId = selectedMachineId(this.state);
    const now = Date.now();
    let nextDelay = Number.POSITIVE_INFINITY;
    for (const run of Object.values(this.state.workspaceDeletionRuns)) {
      const runKey = machineScopedKey(machineId, run.id);
      if (this.handledWorkspaceDeletionRunIds.has(runKey)) continue;
      if (isWorkspaceDeletionRunPending(run)) {
        nextDelay = Math.min(nextDelay, 1_000);
        continue;
      }
      const retryAt = this.workspaceDeletionReconcileRetries.get(runKey)?.retryAt ?? now;
      nextDelay = Math.min(nextDelay, Math.max(0, retryAt - now));
    }
    if (Number.isFinite(nextDelay) && this.workspaceDeletionPollTimer === undefined) {
      this.workspaceDeletionPollTimer = window.setTimeout(() => {
        this.workspaceDeletionPollTimer = undefined;
        void this.refreshWorkspaceDeletionRuns();
      }, nextDelay);
      return;
    }
    if (!Number.isFinite(nextDelay) && this.workspaceDeletionPollTimer !== undefined) {
      window.clearTimeout(this.workspaceDeletionPollTimer);
      this.workspaceDeletionPollTimer = undefined;
    }
  }

  private async handleCompletedWorkspaceDeletionRun(run: TerminalCommandRun, machineId: string, projectId: string, generation: number, controller: AbortController): Promise<void> {
    if (!this.workspaceDeletionRefreshIsCurrent(machineId, projectId, generation, controller)) return;
    const runKey = machineScopedKey(machineId, run.id);
    if (this.handledWorkspaceDeletionRunIds.has(runKey)) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    if (run.status === "succeeded") {
      const retry = this.workspaceDeletionReconcileRetries.get(runKey);
      if (retry !== undefined && retry.retryAt > Date.now()) return;
      const errorScope = workspaceBrowserErrorScope(machineId, run.projectId, workspaceId);
      try {
        await this.workspaces.refreshAfterWorkspaceDeleted(run.projectId, workspaceId, machineId, {
          signal: controller.signal,
          isCurrent: () => this.workspaceDeletionRefreshIsCurrent(machineId, projectId, generation, controller),
        });
      } catch (error) {
        if (!this.workspaceDeletionRefreshIsCurrent(machineId, projectId, generation, controller)) return;
        const attempt = (retry?.attempt ?? 0) + 1;
        const delay = WORKSPACE_DELETION_RECONCILE_RETRY_DELAYS_MS[Math.min(attempt - 1, WORKSPACE_DELETION_RECONCILE_RETRY_DELAYS_MS.length - 1)] ?? 10_000;
        this.workspaceDeletionReconcileRetries.set(runKey, { attempt, retryAt: Date.now() + delay });
        this.browserErrors.report(errorScope, `工作区移除成功，但刷新工作区列表失败：${errorMessage(error)}。正在重试…`);
        return;
      }
      if (!this.workspaceDeletionRefreshIsCurrent(machineId, projectId, generation, controller)) return;
      this.workspaceDeletionReconcileRetries.delete(runKey);
      this.handledWorkspaceDeletionRunIds.add(runKey);
      this.browserErrors.discard(errorScope);
      this.setState({ workspaceDeletionRuns: omitWorkspaceDeletionRun(this.state.workspaceDeletionRuns, workspaceId) });
      return;
    }
    if (run.status === "failed") {
      this.workspaceDeletionReconcileRetries.delete(runKey);
      this.handledWorkspaceDeletionRunIds.add(runKey);
    }
  }

  private openMachineDialog(): void {
    this.setState({ machineDialogOpen: true, error: "" });
  }

  private async submitMachineDialog(input: MachineDialogSubmit): Promise<void> {
    const machine = await this.machines.addMachine(input);
    if (machine !== undefined) {
      this.setState({ machineDialogOpen: false });
      this.schedulePiWebStatusRefresh();
    }
  }

  private async removeMachine(machine: Machine | undefined = this.state.selectedMachine): Promise<void> {
    if (machine === undefined || machine.kind === "local") return;
    if (!window.confirm(`移除 ${machine.name}？\n\n这只会从当前 PI WEB 网关移除它。`)) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) this.machineNavigation.forget(machine.id);
    if (wasSelected && fallback !== undefined) await this.selectMachineWithMemory(fallback, { rememberCurrent: false });
  }

  private openSelectedMachine(): void {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote" || machine.baseUrl === undefined) return;
    window.open(machine.baseUrl, "_blank", "noopener,noreferrer");
  }

  private runAction(action: AppAction): void {
    void Promise.resolve()
      .then(() => action.run())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Action failed: ${action.id}`, error);
        this.browserErrors.report({ kind: "global" }, `操作失败：${message}`);
      });
  }

  private async openModelDialog() {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const origin: ModelDialogOrigin = { machineId: selectedMachineId(this.state), sessionId: session.id, cwd: session.cwd };
    const { models, catalog } = await this.loadModelDialogData();
    if (!this.modelDialogOriginIsCurrent(origin)) return;
    const selectedValue = this.currentModelValue();
    this.setState({
      modelDialog: {
        instanceId: ++this.modelDialogInstanceId,
        origin,
        title: "选择模型",
        ...(selectedValue === undefined ? {} : { selectedValue }),
        options: this.modelDialogOptions(models),
        ...(catalog === undefined ? {} : { catalog }),
        defaultsLoading: true,
      },
    });
    void this.loadSessionDefaultPins(origin, "model");
  }

  private async loadModelDialogData(): Promise<{ models: SessionModel[]; catalog?: SessionModelCatalogEntry[] }> {
    for (;;) {
      const invalidation = this.modelDialogScopeInvalidation;
      const [models, catalog] = await Promise.all([
        this.sessions.listModels(),
        this.apiScope === "normal" ? this.sessions.listModelCatalog() : Promise.resolve(undefined),
      ]);
      if (invalidation === this.modelDialogScopeInvalidation) return { models, ...(catalog === undefined ? {} : { catalog }) };
    }
  }

  private async refreshOpenModelDialog(): Promise<void> {
    if (this.modelDialogMutationInFlight > 0) {
      this.modelDialogRefreshPending = true;
      return;
    }
    const dialog = this.currentModelDialog();
    if (dialog === undefined) return;
    const { origin, instanceId } = dialog;
    const { models, catalog } = await this.loadModelDialogData();
    if (this.modelDialogMutationInFlight > 0 || this.state.modelDialog?.instanceId !== instanceId || !this.modelDialogOriginIsCurrent(origin)) return;
    const refreshedDialog = { ...dialog, options: this.modelDialogOptions(models), ...(catalog === undefined ? {} : { catalog }) };
    const selectedValue = this.currentModelValue();
    if (selectedValue === undefined) delete refreshedDialog.selectedValue;
    else refreshedDialog.selectedValue = selectedValue;
    this.setState({ modelDialog: refreshedDialog });
  }

  private currentModelValue(): string | undefined {
    return modelValueFromStatus(this.state.status);
  }

  private modelDialogOptions(models: readonly Pick<SessionModel, "provider" | "id">[]): CommandOption[] {
    const selectedValue = this.currentModelValue();
    return models.map((model) => {
      const provider = model.provider ?? "";
      const id = model.id ?? "";
      const value = `${provider}/${id}`;
      return { value, label: `${id}${value === selectedValue ? " ✓ 当前" : ""}`, description: provider };
    });
  }

  private async pickModel(value: string) {
    this.setState({ modelDialog: undefined });
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    await this.sessions.setModel(value.slice(0, slash), value.slice(slash + 1));
  }

  private openThemeDialog() {
    const themes = this.plugins.getThemes();
    const resolution = this.resolveCurrentThemePreference(themes);
    const selectedThemeId = resolution.selectedTheme?.id;
    const autoValue = this.themePreference.auto ? THEME_AUTO_OFF_VALUE : THEME_AUTO_ON_VALUE;
    this.setState({
      themeDialog: {
        title: "选择主题",
        selectedValue: selectedThemeId === undefined ? autoValue : `${THEME_OPTION_PREFIX}${selectedThemeId}`,
        options: [
          {
            value: autoValue,
            label: `自动 ${this.themePreference.auto ? "✓ 开启" : "关闭"}`,
            description: this.autoThemeDescription(resolution),
          },
          ...themes.map((theme) => ({
            value: `${THEME_OPTION_PREFIX}${theme.id}`,
            label: this.themeOptionLabel(theme, selectedThemeId),
            description: this.themeOptionDescription(theme),
          })),
        ],
      },
    });
  }

  private pickTheme(value: string) {
    this.setState({ themeDialog: undefined });
    if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
      const selectedThemeId = this.resolveCurrentThemePreference().selectedTheme?.id;
      if (selectedThemeId === undefined) return;
      this.themePreference = { themeId: selectedThemeId, auto: value === THEME_AUTO_ON_VALUE };
      this.applyPreferredTheme(true);
      return;
    }
    if (!value.startsWith(THEME_OPTION_PREFIX)) return;
    const themeId = value.slice(THEME_OPTION_PREFIX.length);
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
    this.applyPreferredTheme(true);
  }

  private applyPreferredTheme(persist: boolean): void {
    const theme = this.resolveCurrentThemePreference().activeTheme;
    if (theme === undefined) return;
    this.activeThemeId = theme.id;
    applyPiWebTheme(theme);
    if (persist) writeStoredThemePreference(this.themePreference);
  }

  private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
    return resolveThemePreference({
      themes,
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
  }

  private themePairForTheme(themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
    return findThemePairForTheme(this.plugins.getThemePairs(), themeId);
  }

  private systemPrefersLight(): boolean {
    return this.systemLightThemeMedia?.matches ?? false;
  }

  private autoThemeDescription(resolution: ThemePreferenceResolution): string {
    if (!this.themePreference.auto) return "当所选主题有配对主题时，跟随系统明暗偏好。";
    if (resolution.selectedTheme === undefined) return "当所选主题有配对主题时，跟随系统明暗偏好。";
    if (resolution.selectedThemePair === undefined) return "已开启，但所选主题没有明暗配对，因此会保持当前主题。";
    return `已开启 · ${resolution.selectedThemePair.name} 跟随系统${this.systemPrefersLight() ? "浅色" : "深色"}偏好。`;
  }

  private themeOptionLabel(theme: QualifiedThemeContribution, selectedThemeId: QualifiedContributionId | undefined): string {
    const markers = [
      ...(theme.id === selectedThemeId ? ["已选择"] : []),
      ...(theme.id === this.activeThemeId && theme.id !== selectedThemeId ? ["生效中"] : []),
    ];
    return markers.length === 0 ? theme.name : `${theme.name} ✓ ${markers.join(" · ")}`;
  }

  private themeOptionDescription(theme: QualifiedThemeContribution): string {
    const parts: string[] = [theme.colorScheme];
    if (this.themePairForTheme(theme.id) !== undefined) parts.push("自动配对");
    if (theme.description !== undefined) parts.push(theme.description);
    return parts.join(" · ");
  }

  private async openThinkingDialog() {
    const origin: ModelDialogOrigin = this.state.selectedSession === undefined
      ? { machineId: selectedMachineId(this.state), sessionId: "", cwd: "" }
      : { machineId: selectedMachineId(this.state), sessionId: this.state.selectedSession.id, cwd: this.state.selectedSession.cwd };
    const levels = await this.sessions.listThinkingLevels();
    if (!this.modelDialogOriginIsCurrent(origin)) return;
    const current = this.state.status?.thinkingLevel ?? "off";
    this.setState({
      thinkingDialog: {
        instanceId: ++this.modelDialogInstanceId,
        origin,
        title: "选择思考级别",
        selectedValue: current,
        defaultsLoading: true,
        options: levels.map((level) => { const description = thinkingLevelDescription(level); return { value: level, label: `${thinkingLevelDisplayLabel(level)}${level === current ? " ✓ 当前" : ""}`, ...(description === undefined ? {} : { description }) }; }),
      },
    });
    void this.loadSessionDefaultPins(origin, "thinking");
  }

  private async loadSessionDefaultPins(origin: ModelDialogOrigin, kind: "model" | "thinking"): Promise<void> {
    const instanceId = kind === "model" ? this.state.modelDialog?.instanceId : this.state.thinkingDialog?.instanceId;
    const defaults = await this.sessions.getSessionDefaults();
    if (kind === "model") {
      const dialog = this.state.modelDialog;
      if (dialog === undefined || dialog.instanceId !== instanceId || !this.modelDialogOriginIsCurrent(origin)) return;
      const defaultValue = defaults?.defaultProvider !== undefined && defaults.defaultModel !== undefined
        ? `${defaults.defaultProvider}/${defaults.defaultModel}`
        : undefined;
      this.setState({ modelDialog: { ...dialog, defaultsLoading: false, ...(defaultValue === undefined ? {} : { defaultValue }) } });
      return;
    }
    const dialog = this.state.thinkingDialog;
    if (dialog === undefined || dialog.instanceId !== instanceId || !this.modelDialogOriginIsCurrent(origin)) return;
    this.setState({
      thinkingDialog: {
        ...dialog,
        defaultsLoading: false,
        ...(defaults?.defaultThinkingLevel === undefined ? {} : { defaultValue: defaults.defaultThinkingLevel }),
      },
    });
  }

  private async pinSessionDefault(kind: "model" | "thinking", value: string): Promise<void> {
    const pinnedDialog = kind === "model" ? this.state.modelDialog : this.state.thinkingDialog;
    if (pinnedDialog === undefined || !this.modelDialogOriginIsCurrent(pinnedDialog.origin)) return;
    const { instanceId, origin } = pinnedDialog;
    if (kind === "model") {
      const separator = value.indexOf("/");
      if (separator <= 0) return;
      const defaults = await this.sessions.setSessionDefaults({ provider: value.slice(0, separator), modelId: value.slice(separator + 1) });
      const dialog = this.state.modelDialog;
      if (defaults?.defaultProvider === undefined || defaults.defaultModel === undefined
        || dialog?.instanceId !== instanceId || !this.modelDialogOriginIsCurrent(origin)) return;
      this.setState({ modelDialog: { ...dialog, defaultValue: `${defaults.defaultProvider}/${defaults.defaultModel}`, defaultsLoading: false } });
      return;
    }
    if (!isKnownThinkingLevel(value)) return;
    const defaults = await this.sessions.setSessionDefaults({ thinkingLevel: value });
    const dialog = this.state.thinkingDialog;
    if (defaults?.defaultThinkingLevel === undefined
      || dialog?.instanceId !== instanceId || !this.modelDialogOriginIsCurrent(origin)) return;
    this.setState({ thinkingDialog: { ...dialog, defaultValue: defaults.defaultThinkingLevel, defaultsLoading: false } });
  }

  private async pickThinking(value: string) {
    this.setState({ thinkingDialog: undefined });
    if (value !== "") await this.sessions.setThinkingLevel(value);
  }

  private sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, folder?: string): void {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (!hasAttachments && streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return;
    if (!hasAttachments && streamingBehavior === undefined && (text.trim() === "/model" || text.trim() === "/scoped-models")) {
      void this.openModelDialog();
      return;
    }
    void this.sessions.send(text, streamingBehavior, attachments, delivery, folder);
  }

  // Stable handler identities for child components. Inlined arrow closures
  // would be a fresh reference on every render, forcing Lit to re-commit the
  // bindings each time the app re-renders; bound class fields keep them constant.
  private readonly handleSendPrompt = (text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, folder?: string): void => {
    this.sendPrompt(text, streamingBehavior, attachments, delivery, folder);
  };

  private readonly handleStopActiveWork = (): void => {
    void this.sessions.stopActiveWork();
  };

  private readonly handleClearServerQueue = (): void => {
    void this.sessions.clearServerQueue();
  };

  private readonly handleMessageAction = (entryId: string, action: "fork" | "back") => this.sessions.actOnMessage(entryId, action);

  private readonly handleDismissWarning = (dismissId: string): void => {
    void this.sessions.dismissWarning(dismissId);
  };

  private readonly handleSubmitAsk = (askId: string, submission: AskUserSubmission): Promise<void> => this.sessions.submitAsk(askId, submission);

  private readonly handleAnswerDialog = (dialogId: string, value: ExtensionDialogAnswer): Promise<void> => this.sessions.answerDialog(dialogId, value);

  private readonly handleCancelDialog = (dialogId: string): Promise<void> => this.sessions.cancelDialog(dialogId);

  private readonly handleDismissClosedDialog = (dialogId: string): void => {
    this.sessions.dismissClosedDialog(dialogId);
  };

  private readonly handleDismissNotification = (notificationId: string): void => {
    void this.notifications.dismissNotification(notificationId);
  };

  private readonly handleDismissAllNotifications = (): void => {
    void this.notifications.dismissAll();
  };

  private readonly handleToggleWarnings = (): void => {
    const next = toggleSessionWarnings(this.sessionWarningVisibility);
    if (next === this.sessionWarningVisibility) return;
    this.sessionWarningVisibility = next;
    this.requestUpdate();
  };

  private readonly handleSelectModel = (): void => {
    void this.openModelDialog();
  };

  private readonly handleToggleModelEnabled = async (provider: string, modelId: string, enabled: boolean): Promise<void> => {
    if (this.apiScope !== "normal") return;
    const dialog = this.currentModelDialog();
    if (dialog === undefined) return;
    this.modelDialogMutationInFlight += 1;
    try {
      this.applyModelDialogCatalog(dialog, await this.sessions.setModelEnabled(provider, modelId, enabled));
    } finally {
      this.finishModelDialogMutation();
    }
  };

  private readonly handleSetModelScope = async (mode: SessionModelScopeMode): Promise<void> => {
    if (this.apiScope !== "normal") return;
    const dialog = this.currentModelDialog();
    if (dialog === undefined) return;
    this.modelDialogMutationInFlight += 1;
    try {
      this.applyModelDialogCatalog(dialog, await this.sessions.setModelScope(mode));
    } finally {
      this.finishModelDialogMutation();
    }
  };

  private finishModelDialogMutation(): void {
    this.modelDialogMutationInFlight -= 1;
    if (this.modelDialogMutationInFlight !== 0 || !this.modelDialogRefreshPending) return;
    this.modelDialogRefreshPending = false;
    void this.refreshOpenModelDialog();
  }

  private currentModelDialog(): NonNullable<AppState["modelDialog"]> | undefined {
    const dialog = this.state.modelDialog;
    if (dialog !== undefined && this.modelDialogOriginIsCurrent(dialog.origin)) return dialog;
    if (dialog !== undefined) this.setState({ modelDialog: undefined });
    return undefined;
  }

  private modelDialogOriginIsCurrent(origin: ModelDialogOrigin): boolean {
    const session = this.state.selectedSession;
    return session !== undefined && origin.machineId === selectedMachineId(this.state) && origin.sessionId === session.id && origin.cwd === session.cwd;
  }

  private applyModelDialogCatalog(dialog: NonNullable<AppState["modelDialog"]>, catalog: SessionModelCatalogEntry[] | undefined): void {
    if (catalog === undefined || this.state.modelDialog?.instanceId !== dialog.instanceId || !this.modelDialogOriginIsCurrent(dialog.origin)) return;
    this.setState({ modelDialog: { ...dialog, catalog, options: this.modelDialogOptions(catalog.filter((entry) => entry.enabled)) } });
  }

  private readonly handleSelectThinking = (): void => {
    void this.openThinkingDialog();
  };

  private renderChatView(state: AppState, session: SessionInfo) {
    return html`
      <chat-view .contentRendering=${this.plugins.chatContentRendering} .contentRendererVersion=${this.plugins.contentRendererVersion} .machineId=${selectedMachineId(state)} @workspace-file-open=${this.handleWorkspaceFileOpen} .workspaceContext=${markdownWorkspaceContext(selectedMachineId(state), state.selectedWorkspace, session)} .sessionId=${session.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .searchTarget=${state.sessionSearchTarget} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .clientQueuedMessages=${state.clientQueuedSessionMessages[session.id] ?? []} .status=${state.status} .activity=${state.activity} .pendingAsk=${state.pendingAsk} .pendingDialogs=${state.pendingDialogs} .closedDialogs=${state.closedDialogs} .onAnswerDialog=${this.handleAnswerDialog} .onCancelDialog=${this.handleCancelDialog} .onDismissClosedDialog=${this.handleDismissClosedDialog} .askDraftSessionId=${machineSessionKey(selectedMachineId(state), session.id)} .onSubmitAsk=${this.handleSubmitAsk} .notificationInbox=${selectedNotificationView(state.selectedNotificationInbox)} .canClearServerQueue=${this.canClearServerQueue()} .onClearServerQueue=${this.handleClearServerQueue} .onMessageAction=${this.handleMessageAction} .messageActionsDisabled=${session.archived === true || state.sendingPrompts[session.id] === true || isSessionActive(state.status, state.activity)} .onDismissWarning=${this.handleDismissWarning} .onDismissNotification=${this.handleDismissNotification} .onDismissAllNotifications=${this.handleDismissAllNotifications} .warningsVisible=${!this.sessionWarningVisibility.collapsed} .onToggleWarnings=${this.handleToggleWarnings} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())}></chat-view>
    `;
  }

  private renderStatusBar(state: AppState) {
    const warningCount = this.sessionWarningVisibility.warningCount;
    return html`
      <status-bar .status=${state.status} .warningCount=${warningCount} .warningsExpanded=${warningCount > 0 && !this.sessionWarningVisibility.collapsed} .onToggleWarnings=${this.handleToggleWarnings}></status-bar>
    `;
  }

  private renderContextBar() {
    if (!this.appShell.isMobileNavigationLayout) return null;
    return html`
      <app-context-bar
        .machines=${this.state.machines}
        .machine=${this.state.selectedMachine}
        .locationIndicator=${this.appShell.isPwaDisplayMode}
        .project=${this.state.selectedProject}
        .workspace=${this.state.selectedWorkspace}
        .session=${this.state.selectedSession}
        .refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}
        .onOpenSection=${(section: NavigationSection) => { this.openNavigationSection(section); }}
        .onShowNavigation=${this.showNavigation}
        .hiddenActiveDestination=${this.hiddenActiveNavigationDestination(
          this.availableNavigationTabs(),
          this.navigationPreferences.mobileCollapsed ? [] : pinnedNavigationTabs(this.availableNavigationTabs(), this.navigationPreferences.pinnedIds),
        )}
        .onShowActions=${this.apiScope === "management" ? undefined : () => { this.setState({ actionPaletteOpen: true }); }}
      ></app-context-bar>
    `;
  }

  private renderMobileMainTabs() {
    if (this.appShell.isMobileNavigationLayout && this.navigationPreferences.mobileCollapsed) return null;
    const availableTabs = this.availableNavigationTabs();
    const tabs = pinnedNavigationTabs(availableTabs, this.navigationPreferences.pinnedIds);
    const selectedTab = this.selectedNavigationTab();
    return html`
      <app-mobile-main-tabs
        .tabs=${tabs}
        .selectedTab=${selectedTab}
        .hiddenActiveDestination=${this.hiddenActiveNavigationDestination(availableTabs, tabs, selectedTab)}
        .onShowNavigation=${this.showNavigation}
        .onSelect=${(view: AppState["mainView"]) => { this.selectMainView(view); }}
      ></app-mobile-main-tabs>
    `;
  }

  private availableNavigationTabs(): AppMobileMainTab[] {
    return availableNavigationTabs(this.mobileMainTabs(), {
      mobile: this.appShell.isMobileNavigationLayout,
      sideBySide: this.appShell.isDesktopSideBySideLayout,
    });
  }

  private selectedNavigationTab(): AppState["mainView"] | undefined {
    const panels = this.visibleWorkspacePanels();
    return selectedNavigationTab(
      this.state.mainView,
      panels.find((panel) => panel.id === this.state.workspaceTool)?.id ?? panels[0]?.id,
      this.appShell.isDesktopSideBySideLayout,
      this.routeContentError() !== "" || this.requestedWorkspacePanelError() !== "",
    );
  }

  private hiddenActiveNavigationDestination(
    availableTabs = this.availableNavigationTabs(),
    visibleTabs = pinnedNavigationTabs(availableTabs, this.navigationPreferences.pinnedIds),
    selectedTab = this.selectedNavigationTab(),
  ): boolean {
    return hasHiddenActiveNavigationTab(availableTabs, visibleTabs, selectedTab);
  }

  private mobileMainTabs(): AppMobileMainTab[] {
    const unreadCount = unreadSessionCount(this.state.sessions, this.unreadSessionIds);
    return [
      {
        id: "navigation",
        label: "会话",
        icon: "navigation",
        className: "navigation-tab",
        ...(unreadCount === 0 ? {} : { badge: unreadCount, badgeLabel: `${String(unreadCount)} unread`, badgeTone: "unread" }),
      },
      { id: "chat", label: "聊天", icon: "chat" },
      ...this.visibleWorkspacePanels().map((panel): AppMobileMainTab => {
        const icon = panel.icon ?? this.mobilePanelIcon(panel);
        return {
          id: panel.id,
          label: panel.title,
          ...(icon === undefined ? {} : { icon }),
          badge: this.mobilePanelBadge(panel),
        };
      }),
    ];
  }

  private navigationOpener: HTMLElement | undefined;
  private readonly showNavigation = () => {
    const active = deepActiveElement(this.ownerDocument);
    this.navigationOpener = active instanceof HTMLElement ? active : undefined;
    this.navigationDialogOpen = true;
  };
  private readonly closeNavigation = () => {
    this.navigationDialogOpen = false;
    const opener = this.navigationOpener;
    this.navigationOpener = undefined;
    void this.updateComplete.then(() => {
      if (this.navigationDialogOpen || hasRenderedModal(this.ownerDocument)) return;
      if (opener !== undefined && focusElement(opener)) return;
      const restored = deepActiveElement(this.ownerDocument);
      if (restored instanceof HTMLElement && restored !== this && restored !== this.ownerDocument.body
        && restored !== this.ownerDocument.documentElement && focusElement(restored)) return;
      for (const host of this.renderRoot.querySelectorAll("app-context-bar, app-mobile-main-tabs, workspace-panel")) {
        const button = host.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="打开导航"]');
        if (button !== null && button !== undefined && focusElement(button)) return;
      }
    });
  };
  private readonly changeNavigationPreferences = (preferences: NavigationPreferences) => {
    this.navigationPreferences = preferences;
    saveNavigationPreferences(preferences);
  };

  private renderAppRefresh() {
    return html`<app-refresh-control .onReload=${() => { this.hardReloadApp(); }}></app-refresh-control>`;
  }

  private renderServerNoticeBanners(): TemplateResult | null {
    const machineId = selectedMachineId(this.state);
    const projection = this.serverNotices.projection(machineId);
    const notices = projection?.status === "fresh" ? visibleServerNotices(projection.notices, browserErrorContext(this.state)) : [];
    if (notices.length === 0) return null;
    return html`${notices.map((notice: ServerNotice) => errorBanner(notice.message, () => {
      void this.serverNotices.dismiss(machineId, notice.id);
    }, notice.severity))}`;
  }

  private renderBrowserErrorBanners(state: AppState): TemplateResult | null {
    const errors = visibleBrowserErrors(state.browserErrors, browserErrorContext(state));
    if (errors.length === 0) return null;
    return html`${errors.map((error) => errorBanner(error.message, () => { this.dismissBrowserError(error); }))}`;
  }

  private dismissBrowserError(error: BrowserError): void {
    const browserErrors = clearBrowserError(this.state.browserErrors, error.scope, error.message);
    if (browserErrors !== this.state.browserErrors) this.setState({ browserErrors });
  }

  override render() {
    const state = this.state;
    const gateMode = this.normalAuthGateMode();
    if (this.apiScope === "normal" && (gateMode !== undefined || this.normalAuthStatus === undefined)) {
      return this.renderNormalAuthDialog(gateMode ?? "login");
    }
    return html`
      <div class=${this.panelCollapse.shellClass(state.mainView)} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigationPanel()}</aside>
        ${this.renderNavigationPanelEdgeControl()}
        <main class=${mainViewClass(state.mainView)}>
          ${this.renderContextBar()}
          ${guard([...this.workspaceSurfaceInputs(), state.sessions, this.unreadSessionIds, this.unreadPresence], () => this.renderMobileMainTabs())}
          ${this.renderServerNoticeBanners()}
          ${this.apiScope === "management" ? null : deprecatedAgentInputsBanner(deprecatedAgentInputsWarnings(state.machines, state.machineRuntimes))}
          ${errorBanner(this.displayedError(), () => { this.dismissDisplayedError(); })}
          ${this.renderBrowserErrorBanners(state)}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigationPanel() : null}</div>
          ${state.selectedSession && this.routeContentError() === "" ? html`
            ${this.renderChatView(state, state.selectedSession)}
            <prompt-editor .shortcutConfig=${this.shortcutConfig} .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .machineId=${selectedMachineId(state)} .projectId=${state.selectedWorkspace?.projectId} .workspaceId=${state.selectedWorkspace?.id} .workspaceScopedFileSuggestions=${this.supportsWorkspaceFileSuggestions()} .attachmentsFolder=${workspaceEffectiveAttachmentsFolder(state.selectedWorkspace?.effectiveConfig, this.workspaceAttachmentsDefaultFolder)} .disabled=${state.selectedSession.archived === true} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${state.status?.isStreaming === true || state.status?.isBashRunning === true || state.status?.isCompacting === true || (state.status?.pendingMessageCount ?? 0) > 0} .status=${state.status} .availableThinkingLevels=${state.availableThinkingLevels} .sending=${state.sendingPrompts[state.selectedSession.id] === true} .onSend=${this.handleSendPrompt} .onStop=${this.handleStopActiveWork} .onSelectModel=${this.handleSelectModel} .onSelectThinking=${this.handleSelectThinking}></prompt-editor>
            ${this.renderStatusBar(state)}
            ${state.commandDialog !== undefined ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog === undefined ? null : state.modelDialog.catalog === undefined
              ? html`<command-picker title=${state.modelDialog.title} .searchable=${true} .options=${state.modelDialog.options} .selectedValue=${state.modelDialog.selectedValue} .defaultValue=${state.modelDialog.defaultValue} .defaultsLoading=${state.modelDialog.defaultsLoading === true} .onPick=${(value: string) => { void this.pickModel(value); }} .onSetDefault=${(value: string) => this.pinSessionDefault("model", value)} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></command-picker>`
              : html`<model-picker title=${state.modelDialog.title} .options=${state.modelDialog.options} .catalog=${state.modelDialog.catalog} .selectedValue=${state.modelDialog.selectedValue} .defaultValue=${state.modelDialog.defaultValue} .defaultsLoading=${state.modelDialog.defaultsLoading === true} .onPick=${(value: string) => { void this.pickModel(value); }} .onSetDefault=${(value: string) => this.pinSessionDefault("model", value)} .onToggleEnabled=${this.handleToggleModelEnabled} .onSetScope=${this.handleSetModelScope} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></model-picker>`}
            ${state.thinkingDialog !== undefined ? html`<command-picker title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .defaultValue=${state.thinkingDialog.defaultValue} .defaultsLoading=${state.thinkingDialog.defaultsLoading === true} .onPick=${(value: string) => { void this.pickThinking(value); }} .onSetDefault=${(value: string) => this.pinSessionDefault("thinking", value)} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : html`<div class=${this.routeContentError() === "" ? "empty" : "empty route-target-error"} role=${this.routeContentError() === "" ? "status" : "alert"}>${this.sessionEmptyMessage()}</div>`}
        </main>
        ${this.renderWorkspacePanelEdgeControl()}
        ${guard(this.workspaceSurfaceInputs(), () => this.renderWorkspacePanel())}
        ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onApiKeyInput=${(value: string) => { this.auth.updateApiKey(value); }} .onSaveApiKey=${() => { void this.auth.saveApiKey(); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
        ${this.navigationDialogOpen ? html`<navigation-dialog
          .tabs=${this.availableNavigationTabs()}
          .pinUniverse=${this.mobileMainTabs().map((tab) => tab.id)}
          .selectedTab=${this.selectedNavigationTab()}
          .preferences=${this.navigationPreferences}
          .onPreferencesChange=${this.changeNavigationPreferences}
          .onSelect=${(view: AppState["mainView"]) => { this.selectMainView(view); }}
          .onClose=${this.closeNavigation}
        ></navigation-dialog>` : null}
        ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
        ${this.renderSessionTreeNavigator(state)}
        ${state.projectDialogOpen ? html`<project-dialog .machineId=${selectedMachineId(state)} .managementMode=${this.apiScope === "management"} .onSubmit=${(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => this.projects.addProject(path, create, trust)} .onCancel=${() => { this.setState({ projectDialogOpen: false }); }}></project-dialog>` : null}
        ${state.machineDialogOpen ? html`<machine-dialog .error=${state.error} .onSubmit=${(input: MachineDialogSubmit) => this.submitMachineDialog(input)} .onCancel=${() => { this.setState({ machineDialogOpen: false }); }}></machine-dialog>` : null}
        ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .canCleanup=${this.canCleanupSessions()} .unavailableMessage=${this.sessionCleanupUnavailableMessage()} .preview=${this.sessionCleanupDialog.preview} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
        ${this.sessionSearchDialogOpen ? html`<session-search-dialog .query=${state.sessionSearchQuery} .response=${state.sessionSearchResults} .searching=${state.isSearchingSessions} .error=${state.sessionSearchError} .onSearch=${(query: string) => { this.sessions.searchSessions(query); }} .onSelect=${(session: SessionInfo, match: SessionContentSearchMatch) => { void this.selectSessionSearchMatch(session, match); }} .onClose=${() => { this.closeSessionSearchDialog(); }}></session-search-dialog>` : null}
        ${state.themeDialog !== undefined ? html`<command-picker title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
        ${this.settingsSection !== undefined ? html`<settings-dialog .section=${this.settingsSection} .machine=${state.selectedMachine} .machineRuntime=${this.selectedMachineRuntime()} .actions=${this.shortcutSettingsActions()} .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }} .onClose=${() => { this.closeSettings(); }} .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }}></settings-dialog>` : null}
        ${this.normalAuthDialogMode === "change" ? this.renderNormalAuthDialog("change") : null}
      </div>
    `;
  }

  private renderNormalAuthDialog(mode: NormalAuthDialogMode) {
    return html`
      <normal-auth-dialog
        .mode=${mode}
        .loading=${this.normalAuthLoading}
        .error=${this.normalAuthError}
        .onSubmit=${(form: NormalAuthPasswordForm) => { void this.submitNormalAuth(form); }}
        .onCancel=${() => { this.normalAuthDialogMode = undefined; this.normalAuthError = ""; }}
      ></normal-auth-dialog>
    `;
  }

  static override styles = appStyles;
}

function modelValueFromStatus(status: AppState["status"]): string | undefined {
  const provider = status?.model?.provider;
  const id = status?.model?.id;
  return provider !== undefined && id !== undefined ? `${provider}/${id}` : undefined;
}

function initializeApiScope(): ApiScope {
  const scope: ApiScope = isManagementEmbedMode() ? "management" : "normal";
  setApiScope(scope);
  return scope;
}

function pluginMachineFromState(state: Pick<AppState, "selectedMachine">): PluginMachine {
  const machine = state.selectedMachine;
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "本机", kind: "local" };
}

function coreWorkspacePluginBinding(): WorkspacePluginBinding {
  return { registrationPluginId: "core", sourcePluginId: "core" };
}

function unreadChatIdentity(machineId: string, session: Pick<SessionInfo, "id" | "cwd">): string {
  return JSON.stringify([machineId, session.id, session.cwd]);
}

function selectedChatIdentity(state: Pick<AppState, "selectedMachine" | "selectedSession">): string | undefined {
  const session = state.selectedSession;
  return session === undefined ? undefined : unreadChatIdentity(selectedMachineId(state), session);
}

function machineUnreadInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines || previous.machineRuntimes !== next.machineRuntimes;
}

function machineActivitySubscriptionInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines
    || previous.machineStatuses !== next.machineStatuses
    || (previous.selectedMachine?.id ?? "local") !== (next.selectedMachine?.id ?? "local");
}

function shouldSubscribeToMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  return shouldRefreshMachineActivity(machine, health);
}

function shouldRefreshMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  if (machine.kind === "local") return true;
  const status = health?.status ?? machine.status;
  return status === undefined || status === "unknown" || status === "online";
}

function patchChangesState(state: AppState, patch: Partial<AppState>): boolean {
  return Object.entries(patch).some(([key, value]) => Reflect.get(state, key) !== value);
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isActive(state: Pick<AppState, "status" | "activity">): boolean {
  return isSessionActive(state.status, state.activity);
}

function isTerminalEvent(event: BrowserRealtimeEvent): event is TerminalUiEvent {
  return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}

function emptyWorkspaceRouteSurface(): WorkspaceRouteSurface {
  return {};
}

function navigationRouteValue(route: ParsedAppRoute, scope: NavigationScope): string | undefined {
  switch (scope) {
    case "machine": return route.machineId ?? "local";
    case "project": return route.projectId;
    case "workspace": return route.workspaceId;
    case "session": return route.sessionId;
    case "tool": return route.tool;
    case "view": return route.view;
  }
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
}

function workspaceDeletionScopeKey(state: Pick<AppState, "selectedMachine" | "selectedProject">): string | undefined {
  const projectId = state.selectedProject?.id;
  if (projectId === undefined) return undefined;
  return JSON.stringify([state.selectedMachine?.id ?? "local", projectId]);
}

function remoteRouteRestoreRetryDelay(attempt: number): number {
  const index = Math.min(attempt, REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length - 1);
  return REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[index] ?? 30_000;
}

function externalRegistryFailures(
  result: ExternalPluginLoadResult,
  declarations: ExternalPluginLoadResult["declarations"],
): PluginRegistrationFailure[] {
  return result.failures.flatMap((failure) => {
    const declaration = declarations.find((candidate) => (candidate.sourcePluginId ?? candidate.id) === failure.entry.id);
    return declaration === undefined ? [] : [{ declaration, phase: "import" as const, error: failure.error }];
  });
}

function sameWorkspacePluginBinding(left: WorkspacePluginBinding, right: WorkspacePluginBinding): boolean {
  return left.registrationPluginId === right.registrationPluginId
    && left.sourcePluginId === right.sourcePluginId
    && left.backendRevision === right.backendRevision
    && left.pairedRequestVersion === right.pairedRequestVersion
    && left.pairedChannelVersion === right.pairedChannelVersion;
}

function requiredTerminalPluginBinding(registration: PiWebPluginRegistration, machineId: string): WorkspacePluginBinding {
  const expectedRuntimeId = machineId === "local"
    ? REQUIRED_TERMINAL_PLUGIN_ID
    : machineScopedBundledPluginId(machineId, REQUIRED_TERMINAL_PLUGIN_ID);
  const machineScopeMatches = machineId === "local"
    ? registration.machineId === undefined && registration.sourcePluginId === undefined
    : registration.machineId === machineId && registration.sourcePluginId === REQUIRED_TERMINAL_PLUGIN_ID;
  if (registration.id !== expectedRuntimeId
    || !machineScopeMatches
    || registration.machineSpecific !== true
    || (registration.manifestSource !== undefined && registration.manifestSource !== "bundled")
    || (registration.manifestScope !== undefined && registration.manifestScope !== "bundled")
    || registration.backendRevision === undefined
    || registration.pairedRequestVersion !== 1
    || registration.pairedChannelVersion !== 1) {
    throw new Error("Required Terminal browser entry does not have bundled identity, machine scope, and matching peer request/channel capabilities");
  }
  return Object.freeze({
    registrationPluginId: registration.id,
    sourcePluginId: REQUIRED_TERMINAL_PLUGIN_ID,
    backendRevision: registration.backendRevision,
    pairedRequestVersion: 1,
    pairedChannelVersion: 1,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omitWorkspaceDeletionRun(runs: Record<string, TerminalCommandRun>, workspaceId: string): Record<string, TerminalCommandRun> {
  return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}
