import type { TemplateResult } from "lit";
import type { AppAction } from "../actions";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeEntry, FileTreeResponse, GitDiffResponse, GitStatusResponse, JsonValue, Machine, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, RunTerminalCommandInput, TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { AppState } from "../appState";
import type { SettingsSection } from "../settingsRoute";
import type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";
import type { ContentRendererContribution } from "../../../plugin-api";
import type { PluginCapability, PluginCapabilityProvision } from "../../../shared/pluginApiTypes";

export type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";
export type HtmlTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
export type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
type MaybePromise<T> = T | Promise<T>;

export interface PiWebPluginRegistration {
  id: PluginId;
  plugin: PiWebPlugin;
  machineId?: string;
  sourcePluginId?: PluginId;
  backendRevision?: string;
  pairedRequestVersion?: 1;
  pairedChannelVersion?: 1;
  machineSpecific?: boolean;
}

export interface WorkspacePluginBinding {
  registrationPluginId: PluginId;
  sourcePluginId: PluginId;
  backendRevision?: string;
  pairedRequestVersion?: 1;
  pairedChannelVersion?: 1;
}

export interface PiWebPlugin {
  apiVersion: 4;
  name: string;
  requires?: readonly PluginCapability[];
  activate: (context: PluginActivationContext) => MaybePromise<PluginActivationResult>;
}

export interface PluginActivationContext {
  readonly apiVersion: 4;
  /** Stable package/source identity, including on federated machines. */
  readonly pluginId: PluginId;
  /** Host-unique identity for qualified contribution references in this runtime. */
  readonly runtimePluginId: PluginId;
  readonly html: HtmlTemplateTag;
  readonly svg: SvgTemplateTag;
  readonly signal: AbortSignal;
  readonly lifetimeSignal: AbortSignal;
}

export interface PluginStartContext {
  readonly capabilities: { readonly resolve: <Value>(capability: PluginCapability<Value>) => Value };
  readonly signal: AbortSignal;
}

export interface PluginActivationResult {
  contributions: PluginContributions;
  provides?: readonly PluginCapabilityProvision[];
  start?(context: PluginStartContext): MaybePromise<void>;
  dispose?(signal: AbortSignal): MaybePromise<void>;
}

export interface PluginContributions {
  contentRenderers?: ContentRendererContribution[];
  actions?: PluginAction[];
  workspacePanels?: WorkspacePanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
  themes?: ThemeContribution[];
  themePairs?: ThemePairContribution[];
}

export type {
  ContentMarkdownRenderRequest,
  ContentRendererContribution,
  ContentRendererInput,
  ContentRendererOption,
  ContentRenderRequest,
  ContentRenderingCapability,
  ContentTextRenderRequest,
} from "../../../plugin-api";

export interface PluginMachine {
  id: string;
  name: string;
  kind: Machine["kind"];
}

export type { WorkspaceFilesCapabilityV1, WorkspaceFileReferenceOptions, WorkspaceFileRequestOptions, WorkspaceFileUploadOptions, WorkspaceFileUploadTask } from "../../../plugin-api";
export type { WorkspaceInvalidation, WorkspaceInvalidationReason, WorkspaceResource } from "../../../plugin-api";
export type { WorkspacePanelNavigationV1, ContributionQueryValue } from "../../../plugin-api";

export interface WorkspaceFiles {
  readFile(path: string, options?: import("../../../plugin-api").WorkspaceFileRequestOptions): Promise<FileContentResponse>;
  readOptionalFile?(path: string): Promise<FileContentResponse | undefined>;
  listFiles(path: string, options?: import("../../../plugin-api").WorkspaceFileRequestOptions): Promise<FileTreeResponse>;
  writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
  deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
  moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
}

export interface WorkspaceBackend {
  request(operation: string, input: JsonValue): Promise<JsonValue>;
}

export interface PluginPeerRequestOptions {
  readonly signal?: AbortSignal;
}

export interface PluginPeerChannel {
  readonly closed: Promise<{ readonly code: number; readonly reason: string; readonly wasClean: boolean }>;
  send(data: JsonValue): void;
  close(reason?: string): void;
}

export interface PluginPeerChannelOptions {
  readonly signal?: AbortSignal;
  readonly onData: (data: JsonValue) => void;
}

export interface PluginPeer {
  request?(operation: string, input: JsonValue, options?: PluginPeerRequestOptions): Promise<JsonValue>;
  openChannel?(operation: string, input: JsonValue, options: PluginPeerChannelOptions): Promise<PluginPeerChannel>;
}

export interface WorkspaceHost {
  requestRender(): void;
}

export interface WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state: AppState;
  files: WorkspaceFiles;
  backend?: WorkspaceBackend;
  peer?: PluginPeer;
  host: WorkspaceHost;
}

export type WorkspaceTerminalCommandInput = Omit<RunTerminalCommandInput, "workspace">;

export interface WorkspacePanelTerminal {
  open(options?: { terminalId?: string | undefined }): void;
  runCommand(input: WorkspaceTerminalCommandInput): Promise<TerminalCommandRunHandle>;
}

export interface PiWebUnstableRuntimeContext {
  terminalCommandRuns: TerminalCommandRunsInternalRuntime;
  openSettings?: (section?: SettingsSection) => void;
}

export interface TerminalCommandRunsInternalRuntime {
  runCommand(input: RunTerminalCommandInput): Promise<TerminalCommandRunHandle>;
  listCommandRuns(filter?: TerminalCommandRunFilter): Promise<TerminalCommandRun[]>;
  getCommandRun(runId: string): Promise<TerminalCommandRun | undefined>;
  open(options?: { terminalId?: string | undefined }): void;
}

export interface PluginPromptEditor {
  insertText(text: string): void;
  getText(): string;
  getSelection(): { start: number; end: number; text: string } | null;
}

export interface PluginNavigationDestination {
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  view?: "navigation" | "chat" | "workspace";
  tool?: QualifiedContributionId;
}

export interface PluginRuntimeContext {
  navigate: (destination: PluginNavigationDestination) => Promise<void>;
  state: AppState;
  prompt: PluginPromptEditor;
  piWebUnstable?: PiWebUnstableRuntimeContext;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  addMachine: () => void | Promise<void>;
  refreshSelectedMachine: () => void | Promise<void>;
  removeSelectedMachine: () => void | Promise<void>;
  openSelectedMachine: () => void | Promise<void>;
  configureAuth: () => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  openThemePicker: () => void;
  openModelPicker: () => void | Promise<void>;
  openThinkingLevelPicker: () => void | Promise<void>;
  selectMainView: (view: AppState["mainView"]) => void;
  selectWorkspaceTool: (tool: QualifiedContributionId) => void;
  openTerminal: (options?: { terminalId?: string | undefined }) => void;
  refreshFiles: () => void | Promise<void>;
  refreshGit: () => void | Promise<void>;
  /** Invalidate plugin workspace-panel data for the selected workspace. */
  refreshWorkspacePanels?: (panelId?: QualifiedContributionId) => void | Promise<void>;
  refreshAppData: () => void | Promise<void>;
  checkForPiWebUpdates?: () => void | Promise<void>;
  reloadPage: () => void;
  deleteWorkspace: (workspace?: Workspace) => void | Promise<void>;
  startSession: () => void | Promise<void>;
  archiveSession: () => void | Promise<void>;
  reloadSession: () => void | Promise<void>;
  deleteCachedNewSession: () => void | Promise<void>;
  stopActiveWork: () => void | Promise<void>;
}

export interface PluginAction {
  id: LocalContributionId;
  title: string;
  description?: string;
  shortcut?: string;
  /** Former qualified action ids whose saved shortcut preference should still apply. */
  shortcutAliases?: QualifiedContributionId[];
  group?: string;
  enabled?: (context: PluginRuntimeContext) => boolean;
  /** Explain why a disabled action is visible but unavailable. */
  disabledReason?: (context: PluginRuntimeContext) => string | undefined;
  run: (context: PluginRuntimeContext) => void | Promise<void>;
}

export interface QualifiedPluginAction extends AppAction {
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  shortcutAliases?: QualifiedContributionId[];
}

export interface WorkspacePanelContext extends WorkspaceContext {
  navigate: (destination: PluginNavigationDestination) => Promise<void>;
  navigation?: import("../../../plugin-api").WorkspacePanelNavigationV1;
  prompt: PluginPromptEditor;
  terminal: WorkspacePanelTerminal;
  /**
   * @deprecated Runtime-only compatibility alias for pre-v2 plugins. Use `terminal.open()` instead.
   * This is intentionally not part of the public `@chainingintention/pi-web-cn/plugin-api` declarations.
   */
  openTerminal?: (options?: { terminalId?: string | undefined }) => void;
  piWebUnstable?: Pick<PiWebUnstableRuntimeContext, "terminalCommandRuns">;
  fileTree: FileTreeEntry[];
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  selectedFileLoadError?: string | undefined;
  gitStatus: GitStatusResponse | undefined;
  selectedDiffPath: string | undefined;
  selectedDiff: GitDiffResponse | undefined;
  selectedStagedDiff: GitDiffResponse | undefined;
  gitStale: boolean;
  fileTreeStale: boolean;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  terminalAutoStart: boolean;
  workspaceUploadDefaultFolder: string;
  onRefreshFiles: () => void;
  onExpandDir: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateDirectory: (path: string) => void;
  onMoveSelectedPath: (path: string) => void;
  onDeleteSelectedPath: () => void;
  onDownloadSelectedFile: () => void;
  onSelectDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  onStartWorkspaceUpload: (files: readonly File[], options: { destinationFolder: string; createDirs?: boolean; overwrite?: boolean; selectUploadedFile?: boolean }) => { batchId: string; done: Promise<void> } | undefined;
  onCancelWorkspaceUpload: (batchId: string) => void;
  onClearWorkspaceUpload: (batchId: string) => void;
  onRefreshGit: () => void;
  onSelectDiff: (path: string) => void;
  onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

export type WorkspacePanelIcon = TemplateResult;

export interface WorkspacePanelContribution {
  id: LocalContributionId;
  title: string;
  icon?: WorkspacePanelIcon;
  order?: number;
  /** Former URL tool/view values that should resolve to this panel. */
  routeAliases?: string[];
  navigationAliases?: QualifiedContributionId[];
  visible?: (context: WorkspacePanelContext) => boolean;
  badge?: (context: WorkspacePanelContext) => string | number | TemplateResult | undefined;
  invalidationResources?: readonly import("../../../plugin-api").WorkspaceResource[];
  onInvalidate?: (context: WorkspacePanelContext, invalidation?: import("../../../plugin-api").WorkspaceInvalidation) => void | Promise<void>;
  /** Query that opens this panel on a workspace-relative file path. */
  fileOpenQuery?: (context: WorkspacePanelContext, path: string) => Readonly<Record<string, import("../../../plugin-api").ContributionQueryValue>> | undefined;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

export interface QualifiedWorkspacePanelContribution extends WorkspacePanelContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface WorkspaceLabelContext extends WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state: AppState;
  files: WorkspaceFiles;
  host: WorkspaceHost;
}

export type WorkspaceLabelItem = WorkspaceLabelTextItem | WorkspaceLabelLinkItem | WorkspaceLabelRenderItem;

export interface WorkspaceLabelTextItem {
  type: "text";
  text: string;
  title?: string;
}

export interface WorkspaceLabelLinkItem {
  type: "link";
  text: string;
  href: string;
  title?: string;
  target?: "_blank" | "_self";
}

export interface WorkspaceLabelRenderItem {
  type: "render";
  render: () => TemplateResult;
}

export interface WorkspaceLabelContribution {
  id: LocalContributionId;
  order?: number;
  visible?: (context: WorkspaceLabelContext) => boolean;
  items: (context: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

export type ThemeColorScheme = "dark" | "light";

export type ThemeToken =
  | "--pi-bg"
  | "--pi-surface"
  | "--pi-surface-hover"
  | "--pi-terminal-bg"
  | "--pi-terminal-text"
  | "--pi-border"
  | "--pi-border-muted"
  | "--pi-text"
  | "--pi-text-secondary"
  | "--pi-text-bright"
  | "--pi-muted"
  | "--pi-dim"
  | "--pi-accent"
  | "--pi-accent-border"
  | "--pi-selection-bg"
  | "--pi-success"
  | "--pi-success-border"
  | "--pi-success-bg"
  | "--pi-success-surface"
  | "--pi-success-ring"
  | "--pi-warning"
  | "--pi-warning-border"
  | "--pi-warning-surface"
  | "--pi-danger"
  | "--pi-purple"
  | "--pi-purple-border"
  | "--pi-purple-surface"
  | "--pi-overlay"
  | "--pi-shadow-soft"
  | "--pi-shadow"
  | "--pi-shadow-strong"
  | "--pi-bg-overlay-soft"
  | "--pi-bg-overlay"
  | "--pi-success-bg-overlay"
  | "--pi-terminal-selection";

export type ThemeTokens = Record<ThemeToken, string>;

export interface ThemeContribution {
  id: LocalContributionId;
  name: string;
  description?: string;
  order?: number;
  colorScheme: ThemeColorScheme;
  tokens: ThemeTokens;
}

export interface ThemePairContribution {
  id: LocalContributionId;
  name: string;
  description?: string;
  order?: number;
  light: LocalContributionId;
  dark: LocalContributionId;
}

export interface QualifiedThemeContribution extends ThemeContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
}

export interface QualifiedThemePairContribution extends Omit<ThemePairContribution, "id" | "light" | "dark"> {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  light: QualifiedContributionId;
  dark: QualifiedContributionId;
}

export interface QualifiedWorkspaceLabelContribution extends WorkspaceLabelContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
}
