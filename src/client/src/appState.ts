import type { AuthProviderOption, AuthRequestTarget, CommandOption, CommandResult, ExtensionDialogAnswer, ExtensionDialogCloseReason, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingExtensionDialog, PiWebStatusResponse, Project, QueuedSessionMessage, SessionActivity, SessionContentSearchResponse, SessionInfo, SessionModelCatalogEntry, SessionStatus, SessionTreeSnapshot, TerminalCommandRun, Workspace, WorkspaceActivity } from "./api";
import type { ChatLine } from "./components/shared";
import type { MachineStatusSnapshot } from "../../shared/machineStatus";
import type { QualifiedContributionId } from "./plugins/ids";
import type { SelectedSessionNotificationInbox } from "./sessionNotifications";
import type { BrowserErrorMap } from "./browserErrors";
import type { MainView } from "./route";

export interface AppState {
  /** Latest authority result for the selected project; absent while resolving. */
  workspaceResolution?: import("./api").WorkspaceProviderResolution | undefined;
  machines: Machine[];
  selectedMachine: Machine | undefined;
  isLoadingMachines: boolean;
  machineStatuses: Record<string, MachineHealth>;
  machineRuntimes: Record<string, MachineRuntime>;
  /** Latest per-machine status tree published by each machine's daemon. */
  machineStatusSnapshots: Record<string, MachineStatusSnapshot>;
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionInfo[];
  pinnedSessionIds: string[];
  sessionSearchQuery: string;
  sessionSearchResults: SessionContentSearchResponse | undefined;
  isSearchingSessions: boolean;
  sessionSearchError: string;
  sessionSearchTarget: SessionSearchTarget | undefined;
  messages: ChatLine[];
  messagePageStart: number;
  messagePageEnd: number;
  messagePageLeafId?: string | null | undefined;
  messagePageTotal: number;
  isLoadingEarlierMessages: boolean;
  /** Sessions with a prompt upload in flight, keyed by sessionId (client-owned). */
  sendingPrompts: Record<string, true>;
  /** Client-side queued sends waiting for a just-created backend session, keyed by sessionId. */
  clientQueuedSessionMessages: Record<string, QueuedSessionMessage[]>;
  /** Client-initiated session creation requests waiting for the server. */
  startingSessionCount: number;
  isLoadingProjects: boolean;
  isLoadingWorkspaces: boolean;
  selectedProject: Project | undefined;
  selectedWorkspace: Workspace | undefined;
  selectedSession: SessionInfo | undefined;
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  /**
   * The selected session's open extension dialogs, derived from the
   * daemon-owned {@link SessionStatus.pendingDialogs} plus live dialog events.
   * Oldest first; unlike an ask, opening never supersedes, so several dialogs
   * may wait at once.
   */
  pendingDialogs: PendingExtensionDialog[];
  /**
   * Dialogs that closed while their session was selected, kept with the close
   * reason and any answer so the settled card can show what became of the
   * dialog. The card stays until the user dismisses it. The wire outcome is
   * deliberately small, so only a browser that saw the dialog open can show
   * the closed card; deselection and reloads drop these.
   */
  closedDialogs: ClosedExtensionDialog[];
  /** Thinking levels available for the selected session's current model. */
  availableThinkingLevels: readonly string[];
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  workspaceActivities: Record<string, WorkspaceActivity>;
  machineActivities: Record<string, Record<string, WorkspaceActivity>>;
  /** Authoritative projection plus browser-local optimistic overlays for the selected inbox. */
  selectedNotificationInbox: SelectedSessionNotificationInbox | undefined;
  workspacesByProjectId: Record<string, Workspace[]>;
  workspaceDeletionRuns: Record<string, TerminalCommandRun>;
  commandDialog: Extract<CommandResult, { type: "select" }> | undefined;
  treeDialog: SessionTreeSnapshot | undefined;
  modelDialog: { instanceId: number; origin: ModelDialogOrigin; title: string; options: CommandOption[]; catalog?: SessionModelCatalogEntry[]; selectedValue?: string; defaultValue?: string; defaultsLoading?: boolean } | undefined;
  thinkingDialog: { instanceId: number; origin: ModelDialogOrigin; title: string; options: CommandOption[]; selectedValue?: string; defaultValue?: string; defaultsLoading?: boolean } | undefined;
  themeDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  authDialog: AuthDialogState | undefined;
  actionPaletteOpen: boolean;
  projectDialogOpen: boolean;
  machineDialogOpen: boolean;
  workspaceTool: QualifiedContributionId | undefined;
  mainView: MainView;
  piWebStatus: PiWebStatusResponse | undefined;
  /** Browser-local failures retained by their machine/project/workspace/session owner. */
  browserErrors: BrowserErrorMap;
  /** Legacy global browser error surface for unmigrated global operations. */
  error: string;
}

export interface ModelDialogOrigin {
  machineId: string;
  sessionId: string;
  cwd: string;
}

/** A closed extension dialog paired with the record the browser rendered while it was open. */
export interface ClosedExtensionDialog {
  dialog: PendingExtensionDialog;
  reason: ExtensionDialogCloseReason;
  /** Present only when `reason` is `"answered"`. */
  answer?: ExtensionDialogAnswer;
}

export interface AuthDialogTarget extends AuthRequestTarget {
  machineKind?: Machine["kind"];
  projectName?: string;
}

export interface SessionSearchTarget {
  sessionId: string;
  messageIndex: number;
  query: string;
  requestId: number;
}

export type AuthDialogState =
  | { step: "method"; target: AuthDialogTarget }
  | { step: "starting"; target: AuthDialogTarget; title: string; mcpSession: { id: string; cwd: string }; error?: string }
  | { step: "providers"; mode: "login"; authType?: "oauth" | "api_key"; providers: AuthProviderOption[]; target: AuthDialogTarget }
  | { step: "apiKey"; provider: AuthProviderOption; value: string; saving?: boolean; error?: string; target: AuthDialogTarget }
  | { step: "oauth"; flow: OAuthFlowState; responding?: boolean; inputValue?: string; error?: string; target: AuthDialogTarget; mcpSession?: { id: string; cwd: string } }
  | { step: "logout"; providers: AuthProviderOption[]; target: AuthDialogTarget };

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "pinnedSessionIds"
  | "sessionSearchQuery"
  | "sessionSearchResults"
  | "isSearchingSessions"
  | "sessionSearchError"
  | "sessionSearchTarget"
  | "clientQueuedSessionMessages"
  | "startingSessionCount"
  | "selectedNotificationInbox"
  | "treeDialog"
  | "error"
>;

export function resetWorkspaceScopedState(): WorkspaceScopedStateReset {
  return {
    sessions: [],
    pinnedSessionIds: [],
    sessionSearchQuery: "",
    sessionSearchResults: undefined,
    isSearchingSessions: false,
    sessionSearchError: "",
    sessionSearchTarget: undefined,
    clientQueuedSessionMessages: {},
    startingSessionCount: 0,
    selectedNotificationInbox: undefined,
    treeDialog: undefined,
    error: "",
  };
}

export function initialAppState(): AppState {
  return {
    machines: [],
    selectedMachine: undefined,
    isLoadingMachines: false,
    machineStatuses: {},
    machineRuntimes: {},
    machineStatusSnapshots: {},
    projects: [],
    workspaces: [],
    sessions: [],
    pinnedSessionIds: [],
    sessionSearchQuery: "",
    sessionSearchResults: undefined,
    isSearchingSessions: false,
    sessionSearchError: "",
    sessionSearchTarget: undefined,
    messages: [],
    messagePageStart: 0,
    messagePageEnd: 0,
    messagePageTotal: 0,
    isLoadingEarlierMessages: false,
    sendingPrompts: {},
    clientQueuedSessionMessages: {},
    startingSessionCount: 0,
    isLoadingProjects: false,
    isLoadingWorkspaces: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    status: undefined,
    activity: undefined,
    pendingDialogs: [],
    closedDialogs: [],
    availableThinkingLevels: [],
    sessionStatuses: {},
    sessionActivities: {},
    workspaceActivities: {},
    machineActivities: {},
    selectedNotificationInbox: undefined,
    workspacesByProjectId: {},
    workspaceDeletionRuns: {},
    commandDialog: undefined,
    treeDialog: undefined,
    modelDialog: undefined,
    thinkingDialog: undefined,
    themeDialog: undefined,
    authDialog: undefined,
    actionPaletteOpen: false,
    projectDialogOpen: false,
    machineDialogOpen: false,
    workspaceTool: undefined,
    mainView: "chat",
    piWebStatus: undefined,
    browserErrors: {},
    error: "",
  };
}
