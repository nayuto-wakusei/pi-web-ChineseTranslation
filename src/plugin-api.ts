import type { TemplateResult } from "lit";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, JsonValue, MachineKind, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, PiWebStatusResponse, PluginCapability, PluginCapabilityProvision, TerminalCommandRunHandle, WorkspaceProviderMetadata, WorkspaceRemovalPresentation, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse } from "./shared/pluginApiTypes.js";

export type {
  FileContentMediaType,
  FileContentResponse,
  FileTreeEntry,
  FileTreeResponse,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MachineKind,
  PiWebComponentStatus,
  PiWebDockerMode,
  PiWebInstallationInfo,
  PiWebInstallationKind,
  PiWebReleaseStatus,
  PiWebServiceComponent,
  PiWebStatusMessage,
  PiWebStatusResponse,
  PiWebStatusSeverity,
  PiWebVersionResponse,
  PluginCapability,
  PluginCapabilityProvision,
  TerminalCommandRun,
  TerminalCommandRunFilter,
  TerminalCommandRunHandle,
  TerminalCommandRunStatus,
  WorkspaceProviderCapabilities,
  WorkspaceProviderMetadata,
  WorkspaceRemovalPresentation,
  WriteWorkspaceFileOptions,
  WriteWorkspaceFileResponse,
  DeleteWorkspaceFileResponse,
  MoveWorkspaceFileOptions,
  MoveWorkspaceFileResponse,
} from "./shared/pluginApiTypes.js";

export type PluginId = string;
export type LocalContributionId = string;
export type QualifiedContributionId = string;
export type HtmlTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
export type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
type MaybePromise<T> = T | Promise<T>;

export interface PiWebPlugin {
  apiVersion: 4;
  name: string;
  requires?: readonly PluginCapability[];
  activate: (context: PluginActivationContext) => MaybePromise<PluginActivationResult>;
}

/** Host-owned frozen values supplied once during browser plugin activation. */
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

export interface PluginCapabilityResolver {
  readonly resolve: <Value>(capability: PluginCapability<Value>) => Value;
}

export interface PluginStartContext {
  readonly capabilities: PluginCapabilityResolver;
  readonly signal: AbortSignal;
}

export interface PluginActivationResult {
  contributions: PluginContributions;
  provides?: readonly PluginCapabilityProvision[];
  start?(context: PluginStartContext): MaybePromise<void>;
  dispose?(signal: AbortSignal): MaybePromise<void>;
}

export interface ContentRendererInput {
  readonly text: string;
  /** Aborted when source, renderer, mode, mounting, or plugin lifetime changes. */
  readonly signal: AbortSignal;
  /** Report asynchronous failure; calls from obsolete renders are ignored. */
  readonly fail: (error: unknown) => void;
}

export interface ContentRendererContribution {
  id: LocalContributionId;
  languages?: readonly string[];
  /** Extensions without a leading dot, matched case-insensitively. */
  fileExtensions?: readonly string[];
  /** Defaults to manual: render is not called until the user chooses 渲染. */
  renderMode?: "manual" | "automatic";
  /** Synchronous Lit template or DOM node; own async work in a component and honor signal. */
  render(input: ContentRendererInput): TemplateResult | Node;
}

export interface ContentRenderRequest {
  machineId: string;
  text: string;
  language?: string;
  filePath?: string;
  truncated?: boolean;
}

export interface ContentRendererOption {
  readonly id: string;
  readonly label: string;
  readonly renderMode: "manual" | "automatic";
}

export type ContentTextRenderRequest = ContentRenderRequest & {
  /** Authorize manual previews; false/omitted retains automatic defaults. Never overrides user 原始. */
  allowManualPreview?: boolean;
} & ({ controls: "external"; rendererId?: string } | { controls?: never; rendererId?: never });

export interface ContentMarkdownRenderRequest {
  machineId: string;
  text: string;
  truncated?: boolean;
  toSafeHtml: (text: string) => string;
  /** Authorize manual fence previews; false/omitted retains automatic defaults. Never overrides user 原始. */
  allowManualPreview?: boolean;
}

/** Host capability token: { pluginId: "pi-web", id: "content-rendering", version: 1, parse }. */
export interface ContentRenderingCapability {
  /** Eligible choices in source plugin ID order, then local contribution ID order. */
  listRenderers(request: ContentRenderRequest): readonly ContentRendererOption[];
  /**
   * Undefined when no renderer claims the complete text.
   * External controls require the caller to provide raw-source access and a renderer chooser.
   * Only external controls accept rendererId; absent or unavailable IDs use the first match.
   * Listing and creating templates never call render.
   */
  renderText(request: ContentTextRenderRequest): TemplateResult | undefined;
  /**
   * The caller supplies its existing trusted HTML sanitizer; policies are not shared.
   * Each eligible fence owns its chooser and 原始 control. Public calls do not store intent.
   */
  renderMarkdown(request: ContentMarkdownRenderRequest): TemplateResult;
}

export interface PluginContributions {
  contentRenderers?: ContentRendererContribution[];
  actions?: PluginAction[];
  workspacePanels?: WorkspacePanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
  themes?: ThemeContribution[];
  themePairs?: ThemePairContribution[];
}

export interface PluginMachine {
  id: string;
  name: string;
  kind: MachineKind;
}

export interface PluginSelectedSession {
  id: string;
  cwd: string;
  name?: string;
  archived: boolean;
  pending: boolean;
}

export interface PluginRuntimeState {
  /** Identity of the currently selected machine. Undefined only on older hosts or before machines load. */
  selectedMachine?: PluginMachine;
  selectedWorkspace?: Workspace;
  selectedSession?: PluginSelectedSession;
  workspaceTool?: string;
  mainView?: "navigation" | "chat" | "workspace";
  piWebStatus?: PiWebStatusResponse;
}

export interface PluginPromptEditor {
  /** Insert text at the current cursor position. Replaces any selection.
   *  If the editor is not focused, focuses it first.
   *  No-op if the editor is not mounted. */
  insertText(text: string): void;
  /** Get the current prompt text content. Returns "" if the editor is not mounted. */
  getText(): string;
  /** Get the current selection range, or null if no selection or editor not mounted. */
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
  state: PluginRuntimeState;
  prompt: PluginPromptEditor;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  configureAuth: () => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  openThemePicker: () => void;
  selectMainView: (view: string) => void;
  selectWorkspaceTool: (tool: QualifiedContributionId) => void;
  openTerminal: (options?: { terminalId?: string | undefined }) => void;
  refreshFiles: () => void | Promise<void>;
  refreshGit: () => void | Promise<void>;
  /** Invalidate plugin workspace-panel data for the selected workspace, optionally targeting one qualified panel id. */
  refreshWorkspacePanels?: (panelId?: QualifiedContributionId) => void | Promise<void>;
  refreshAppData: () => void | Promise<void>;
  /** Force a fresh PI WEB release check on the selected machine. Optional for compatibility with older hosts. */
  checkForPiWebUpdates?: () => void | Promise<void>;
  reloadPage: () => void;
  startSession: () => void | Promise<void>;
  archiveSession: () => void | Promise<void>;
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

/** Host-resolved workspace snapshot exposed to browser plugin callbacks. */
export interface Workspace {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly label: string;
  readonly branch?: string;
  readonly isGitRepo?: boolean;
  readonly isGitWorktree?: boolean;
  readonly isMain: boolean;
  readonly provider?: WorkspaceProviderMetadata;
  readonly removal?: WorkspaceRemovalPresentation;
}

export interface WorkspaceFileRequestOptions {
  readonly signal?: AbortSignal;
}

export interface WorkspaceFileReferenceOptions {
  readonly version?: string;
  /** Legacy alias for version. */
  readonly modifiedAt?: string;
}

export interface WorkspaceFileUploadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly percent: number;
  readonly lengthComputable: boolean;
}

export interface WorkspaceFileUploadOptions {
  readonly destinationFolder?: string;
  readonly createDirs?: boolean;
  readonly onProgress?: (progress: WorkspaceFileUploadProgress) => void;
  /** Legacy alias for destinationFolder. */
  readonly folder?: string;
  readonly overwrite?: boolean;
  readonly signal?: AbortSignal;
}

export interface WorkspaceFileUploadTask {
  readonly path: string;
  readonly completed: Promise<WriteWorkspaceFileResponse>;
  cancel(): void;
}

export interface WorkspaceFiles {
  /** Read a file from the workspace. Works for local and federated machines. */
  readFile(path: string, options?: WorkspaceFileRequestOptions): Promise<FileContentResponse>;
  readOptionalFile?(path: string, options?: WorkspaceFileRequestOptions): Promise<FileContentResponse | undefined>;
  /** List the entries of a workspace directory. Pass "" for the workspace root.
   *  Works for local and federated machines. Rejects when the directory does not
   *  exist or cannot be read, matching readFile error behavior. */
  listFiles(path: string, options?: WorkspaceFileRequestOptions): Promise<FileTreeResponse>;
  /** Write content to a workspace file. Creates intermediate directories by default.
   *  Works for local and federated machines. Auto-refreshes the file explorer after success. */
  writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
  /** Delete a file from the workspace. Idempotent — returns { existed: false } if file doesn't exist.
   *  Deletes the entry itself (for symlinks, removes the symlink not the target). */
  deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
  /** Move or rename a file within the workspace. Unix mv semantics.
   *  Default overwrite: false (safer than writeFile). Auto-refreshes the file explorer after success. */
  moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
}

/** Versioned host files capability used by the bundled Files plugin. */
export interface WorkspaceFilesCapabilityV1 extends WorkspaceFiles {
  readonly capabilityVersion: 1;
  readonly defaultUploadFolder: string;
  readonly maxInlinePreviewBytes: number;
  previewUrl(path: string, options?: WorkspaceFileReferenceOptions): string;
  downloadUrl(path: string, options?: WorkspaceFileReferenceOptions): string;
  uploadFile(file: File, options?: WorkspaceFileUploadOptions): WorkspaceFileUploadTask;
  /** Optional directory operations; older hosts can omit them. Paths stay workspace-relative. */
  createDirectory?(path: string): Promise<{ path: string }>;
  moveDirectory?(fromPath: string, toPath: string): Promise<{ path: string }>;
  deleteDirectory?(path: string): Promise<{ path: string; deleted: true }>;
}

export interface LegacyWorkspaceFiles extends WorkspaceFiles {
  readonly capabilityVersion?: undefined;
}

export type WorkspaceFilesContextValue = LegacyWorkspaceFiles | WorkspaceFilesCapabilityV1;

export type WorkspacePanelFiles = WorkspaceFiles;

/** JSON-only request path to the server module that currently owns this workspace. */
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

export type WorkspacePanelHost = WorkspaceHost;

export interface WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
  files: WorkspaceFilesContextValue;
  /** Present only when this browser entry has a paired active server backend. */
  backend?: WorkspaceBackend;
  peer?: PluginPeer;
  host: WorkspaceHost;
}

export interface WorkspaceTerminalCommandInput {
  title: string;
  command: string;
  metadata?: Record<string, string>;
  open?: boolean;
}

export interface WorkspacePanelTerminal {
  open(options?: { terminalId?: string | undefined }): void;
  runCommand(input: WorkspaceTerminalCommandInput): Promise<TerminalCommandRunHandle>;
}

export type ContributionQueryValue = string | number | boolean | readonly (string | number | boolean)[];

export interface WorkspacePanelNavigationV1 {
  readonly version: 1;
  readonly contributionId: QualifiedContributionId;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  set(key: string, value: ContributionQueryValue | undefined | null, options?: { replace?: boolean | undefined }): void;
}

export interface WorkspacePanelContext extends WorkspaceContext {
  navigate: (destination: PluginNavigationDestination) => Promise<void>;
  navigation?: WorkspacePanelNavigationV1;
  prompt: PluginPromptEditor;
  terminal: WorkspacePanelTerminal;
}

export type WorkspacePanelIcon = TemplateResult;

export type WorkspaceResource = "workspace.files";
export type WorkspaceInvalidationReason = "manual" | "mutation" | "agent-activity";

export interface WorkspaceInvalidation {
  readonly reason: WorkspaceInvalidationReason;
  readonly resources: readonly WorkspaceResource[];
}

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
  /** Called when the host invalidates workspace-panel data. */
  invalidationResources?: readonly WorkspaceResource[];
  onInvalidate?: (context: WorkspacePanelContext, invalidation?: WorkspaceInvalidation) => void | Promise<void>;
  /** Query that opens this panel on a workspace-relative file path. */
  fileOpenQuery?: (context: WorkspacePanelContext, path: string) => Readonly<Record<string, ContributionQueryValue>> | undefined;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

export interface WorkspaceLabelContext extends WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
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
export type ThemeTokens = Record<string, string>;

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
