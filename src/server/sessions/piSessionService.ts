import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  getAgentDir,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  ModelRuntime,
  readStoredCredential,
  SessionManager,
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type EditToolDetails,
  type EditToolOptions,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ResourceDiagnostic,
  type ToolDefinition,
  type ToolsOptions,
} from "@earendil-works/pi-coding-agent";
import type { ClientArchiveSessionsResponse, ClientCommand, ClientCommandResult, ClientMessagePage, ClientSession, ClientSessionCleanupExecuteResponse, ClientSessionCleanupPreviewResponse, ClientSessionContentSearchResponse, ClientSessionModel, ClientSessionStatus, ClientSessionTreeNavigateRequest, ClientSessionTreeNavigateResult, ClientThinkingLevel, SessionPinResponse, SessionPinnedIdsResponse, SessionStreamSnapshot } from "../types.js";
import { projectBrowserMessage } from "../browserMessageProjection.js";
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { eventScopeFromManagementContext, managementContextKey, NORMAL_SESSION_EVENT_SCOPE } from "../realtime/sessionEventScope.js";
import { BUILTIN_COMMANDS } from "./builtinCommands.js";
import { SessionCommandService } from "./sessionCommandService.js";
import { projectSessionTree, type ProjectableSessionTreeNode } from "./sessionTreeProjection.js";
import { SessionArchiveStore, type ArchivedSessionRecord, type ArchiveSessionInput } from "./sessionArchiveStore.js";
import { findArchiveCandidateByIdOrPrefix, planSessionArchiveTree } from "./sessionArchiveTree.js";
import type { ActiveSession } from "./sessionRuntimeStore.js";
import { deterministicSessionName, fallbackSessionName, generateShortSessionName } from "./sessionNameGenerator.js";
import { computeEditPreview, type EditPreviewResult } from "./editPreview.js";
import { attachmentsToInlineImages, saveAttachmentsToWorkspace } from "./attachmentService.js";
import { parsePromptAttachments } from "../../shared/promptAttachments.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, SESSION_UNREAD_LIMIT } from "../../shared/apiTypes.js";
import type { AskUserCloseResponse, AskUserOutcome, AskUserSubmission, ExtensionDialogAnswer, ExtensionDialogCloseResponse, ExtensionDialogKind, ExtensionDialogOutcome, SavedPromptAttachment, SessionBulkArchiveResponse, SessionBulkDeleteArchivedResponse, SessionBulkFailure, SessionBulkMutationRef, SessionNotificationCatalogSnapshot, SessionNotificationClearReason, SessionNotificationDismissAllRequest, SessionNotificationDismissRequest, SessionNotificationInboxSnapshot, SessionUnreadAcknowledgeRequest, SessionUnreadCatalogSnapshot, SessionWarning } from "../../shared/apiTypes.js";
import type { SessionRouteLookup, SessionRouteRef } from "./sessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { SessionPinStore, type SessionPinScope } from "./sessionPinStore.js";
import { SessionActivityCoordinator } from "./sessionActivityCoordinator.js";
import { searchSessionContent } from "./sessionContentSearch.js";

import { type AuthChange } from "./authService.js";
import { canonicalizeStoredCwd, cwdPathsEqual } from "../workingDirectory.js";
import { readSessionHeaderSummary, type SessionHeaderSummary } from "./sessionFileHeader.js";
import { countOutOfListingChildren, locateOutOfListingParents, type SessionHeaderReader } from "./parentSessionLocator.js";
import { siblingWorkspaceCwds, type ProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS, piWebDataDir } from "../../config.js";
import { createScopedSettingsManager, resolveSettingsScopeDirectory, type SessionSettingsMode } from "./projectSettingsScope.js";
import { createAskUserToolDefinition, type AskUserInvocation, type AskUserToolDeps } from "./askUserTool.js";
import { PendingAskStore, renderAskUserAnswersText, type PendingAskCloseResult, type PendingAskOpenResult } from "./pendingAskStore.js";
import { PendingExtensionDialogStore, type ExtensionDialogCancelReason } from "./pendingExtensionDialogStore.js";
import { ExtensionDialogWaiters, effectiveExtensionDialogTimeoutMs, extensionDialogCancelValue } from "./extensionDialogWaiters.js";
import { createSpawnSessionToolDefinition, type SpawnSessionInvocation, type SpawnSessionResult } from "./spawnSessionTool.js";
import { createSubsessionToolDefinitions, type SpawnSubsessionInvocation, type SpawnSubsessionResult, type SubsessionCheckResult, type SubsessionReadQuery, type SubsessionReadResult, type SubsessionStatus, type SubsessionSummary, type SubsessionToolDeps } from "./spawnSubsessionTool.js";
import { buildTranscriptView } from "./subsessionTranscript.js";
import { planSessionCleanup, summarizeSessionCleanupExecution, type NormalizedSessionCleanupRequest, type SessionCleanupPlan } from "./sessionCleanup.js";
import type { SpawnTargetDecision, SpawnTargetResolver } from "./spawnTargetResolver.js";
import { createManagedAgentToolOptions, createManagedPythonToolDefinition } from "./managementAgentTools.js";
import { PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR, managementAgentToolNames, withRuntimeCreationEnvironment, writeManagementPermissionSystemPolicy } from "./managementPermissionSystem.js";
import { SessionNotificationStore, type SessionNotificationGeneration, type SessionNotificationMutation } from "./sessionNotificationStore.js";
import { plainTextTheme } from "./plainTextTheme.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "./sessionUnreadStore.js";
import {
  archiveCandidateFromActiveSession,
  archiveCandidateFromArchivedRecord,
  archiveCandidateFromListEntry,
  archiveInputFromActiveSession,
  archiveInputFromCandidate,
  archiveInputFromListEntry,
  clientSessionFromArchivedRecord,
  compareArchivedRecords,
  type WorkspaceArchiveCandidate,
} from "./sessionArchiveMapping.js";
import { getBoolean, getProperty, getString, toClientEvent } from "./sessionUiEvents.js";

/**
 * Minimal structured-logging seam, shaped like Fastify's logger so sessiond can
 * pass `app.log` directly. Defaults to a no-op so the service stays usable
 * without booting a server (e.g. in tests).
 */
export interface PiSessionLogger {
  info(details: Record<string, unknown>, message: string): void;
}

const noopLogger: PiSessionLogger = { info() { /* no-op */ } };
const DEFAULT_UNREAD_PUBLICATION_RETRY_MS = 1_000;
/**
 * User-facing names for the two phases of session startup PI WEB can prove it
 * is inside: it awaits exactly one call for each, so the phase is a fact rather
 * than a guess. Deliberately free of internal symbol names and file paths.
 */
const STARTUP_PHASE_RUNTIME = "正在启动 Pi 会话";
const STARTUP_PHASE_EXTENSIONS = "正在加载会话扩展";
/**
 * Appended to whichever phase is running when a background provider catalog
 * refresh happens to be in flight. It is stated as a concurrent fact, never as
 * the cause: PI WEB can verify that a refresh is running, but not that this
 * particular startup is waiting on it.
 */
const STARTUP_CONCURRENT_CATALOG_REFRESH = "服务商模型列表正在刷新";
const MAX_UNREAD_PUBLICATION_RETRY_MS = 30_000;
const MAX_PENDING_UNREAD_MUTATIONS = SESSION_UNREAD_LIMIT + 1;

function noop(): void {
  // Intentionally empty default unsubscribe callback.
}

function spawnTargetError(decision: Extract<SpawnTargetDecision, { allowed: false }>): Error {
  if (decision.reason === "not-registered") return new Error("派生会话不在已注册项目中");
  return new Error(`cwd 必须是此项目的工作区。允许的路径：${decision.allowedCwds.join(", ")}`);
}

function modelSpecOf(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Parse a strict `provider/model-id` spec: split on the first `/` (model ids
 * may themselves contain `/`) and require both parts to be non-empty.
 */
function parseModelSpec(spec: string): { provider: string; modelId: string } | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/**
 * Error for a spawn-tool model spec that matched nothing. States the facts —
 * the bad spec and the required format — with deliberately no model list
 * (a list would invite guesses). The agent loop turns the throw into an
 * error tool result; how to recover is the agent's call.
 */
function unknownSpawnModelError(modelSpec: string): Error {
  return new Error(`未找到模型“${modelSpec}”。请传入精确的“provider/model-id”。`);
}

function authLossWarningKey(sessionId: string, eventScope: string, provider: string, modelId: string): string {
  return `${eventScope}:${sessionId}:${provider}/${modelId}`;
}

function sessionIdFromLookup(ref: PiSessionLookup): string {
  return typeof ref === "string" ? ref : ref.id;
}

function isPiSessionRef(ref: PiSessionLookup): ref is PiSessionRef {
  return typeof ref !== "string";
}

type ManagedActiveSession = ActiveSession<PiSessionRuntime> & { managementContextKey: string | undefined; eventScope: string };

interface ManagedStartupSession {
  session: PiAgentSession;
  managementContextKey: string | undefined;
  eventScope: string;
}

interface PendingSessionOpen {
  sessionId: string;
  promise: Promise<ManagedActiveSession>;
}

function lookupMatchesActiveSession(ref: PiSessionLookup, active: ActiveSession<PiSessionRuntime>): boolean {
  return !isPiSessionRef(ref) || cwdPathsEqual(active.runtime.cwd, ref.cwd);
}

function lookupMatchesStartupSession(ref: PiSessionLookup, session: PiAgentSession): boolean {
  return !isPiSessionRef(ref) || cwdPathsEqual(session.sessionManager.getCwd(), ref.cwd);
}

function activeSessionKey(sessionId: string, eventScope: string): string {
  return `${eventScope}\0${sessionId}`;
}

type QueuedPromptKind = "steer" | "followUp";

interface QueuedPrompt {
  kind: QueuedPromptKind;
  text: string;
  images?: ImageContent[];
  echoUserMessage?: boolean;
}

interface DeferredSubsessionNotification {
  parentId: string;
  childId: string;
  text: string;
}

interface TreeExclusiveOperationTarget {
  sessionId: string;
  session?: PiAgentSession;
  runtime?: PiSessionRuntime;
}

type PiTreeNavigationOptions =
  | { summarize: false }
  | { summarize: true; customInstructions?: string };

function sessionTreeNavigationOptions(request: ClientSessionTreeNavigateRequest): PiTreeNavigationOptions {
  switch (request.summary.mode) {
    case "none":
      return { summarize: false };
    case "default":
      return { summarize: true };
    case "custom": {
      const customInstructions = request.summary.instructions.trim();
      if (customInstructions === "") throw new Error("Custom branch-summary instructions are required");
      if (customInstructions.length > SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
        throw new Error(`Custom branch-summary instructions must be at most ${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} characters`);
      }
      return { summarize: true, customInstructions };
    }
  }
}

function decrementWeakCount<Key extends object>(counts: WeakMap<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

function decrementMapCount<Key>(counts: Map<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

interface TrackedSubsessionLink {
  parentSessionId: string;
  childSessionId: string;
  childSessionFile?: string;
  parentSessionFile?: string;
  cwd?: string;
}

interface PersistedParentSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
  spawnedSessionFile?: string;
  cwd?: string;
}

interface PersistedChildSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
}

type SessionCreationProvenance = "tracked-subsession";

interface StartSessionOptions {
  parentSession?: string;
  managementContext?: ManagementEmbedContext;
  initialModel?: AgentModel;
  /**
   * Thinking level for the brand new session; omit to resolve from settings
   * and Pi defaults. Pi clamps it to the initial model's capabilities.
   */
  initialThinkingLevel?: ClientThinkingLevel;
  /**
   * Opaque label, echoed on this construction's startup progress so a browser
   * row with no session id yet can recognise its own.
   */
  startupToken?: string;
}

interface InternalStartSessionOptions extends StartSessionOptions {
  creationProvenance?: SessionCreationProvenance;
}

function requirePromptText(value: unknown): string {
  if (typeof value !== "string") throw new Error("提示文本为必填项");
  return value;
}

function parsePromptStreamingBehavior(value: unknown): QueuedPromptKind | undefined {
  if (value === undefined) return undefined;
  if (value === "steer" || value === "followUp") return value;
  throw new Error('Prompt streamingBehavior must be "steer" or "followUp"');
}

type SessionArchiveRepository = Pick<SessionArchiveStore, "list" | "get" | "archive" | "restore" | "isArchived"> & {
  archiveMany?: (sessions: readonly ArchiveSessionInput[]) => Promise<ArchivedSessionRecord[]>;
  deleteArchived?: (sessionId: string) => Promise<void>;
  deleteArchivedMany?: (sessionIds: readonly string[]) => Promise<string[]>;
};

export type PiSessionRef = SessionRouteRef;
type PiSessionLookup = SessionRouteLookup;

export interface PiSessionListEntry {
  id: string;
  path: string;
  cwd: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
  name?: string;
  parentSessionPath?: string;
}


interface BulkSessionLookupContext {
  sessionsByCwd: Map<string, PiSessionListEntry[]>;
  allSessions?: readonly PiSessionListEntry[];
}

interface WorkspaceSessionListing {
  sessions: ClientSession[];
  entriesById: Map<string, PiSessionListEntry>;
  archivedById: Map<string, ArchivedSessionRecord>;
}

interface BulkArchivePlanItem {
  input: ArchiveSessionInput;
  active?: ManagedActiveSession;
}

interface BulkDeletePlanItem {
  record: ArchivedSessionRecord;
}

type AgentModel = NonNullable<SpawnSessionInvocation["model"]>;

export interface PiSessionManager {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getBranch(): unknown[];
  getEntries?(): readonly unknown[];
  getTree?(): readonly ProjectableSessionTreeNode[];
  getLeafId(): string | null;
  getHeader?(): { parentSession?: string } | null | undefined;
  appendCustomEntry?(customType: string, data?: unknown): string;
}

export interface PiSessionManagerGateway {
  list(cwd: string): Promise<PiSessionListEntry[]>;
  create(cwd: string, options?: { parentSession?: string }): PiSessionManager;
  /**
   * Legacy id-only lookup surface for older clients. This intentionally searches
   * only Pi's default session store, because custom session directories require
   * a cwd-scoped lookup.
   */
  listAll?(): Promise<PiSessionListEntry[]>;
  open(path: string): PiSessionManager;
}

interface PiExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

interface PiExtensionBindings {
  uiContext?: ExtensionUIContext;
  mode?: "rpc";
  onError?: (error: PiExtensionError) => void;
}

export interface PiAgentSession {
  modelRuntime: PiSessionModelRuntime;
  settingsManager: {
    getWarnings(): { anthropicExtraUsage?: boolean };
    setWarnings(warnings: { anthropicExtraUsage?: boolean }): void;
  };
  sessionManager: PiSessionManager;
  scopedModels: readonly { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[];
  sessionId: string;
  sessionFile: string | undefined;
  sessionName: string | undefined;
  messages: readonly unknown[];
  readonly state: { readonly streamingMessage?: unknown };
  model: AgentModel | undefined;
  thinkingLevel: ClientThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  extensionRunner: {
    getRegisteredCommands(): readonly { invocationName: string; description?: string }[];
    getUIContext(): ExtensionUIContext;
    setUIContext(uiContext?: ExtensionUIContext, mode?: "rpc"): void;
  };
  promptTemplates: readonly { name: string; description?: string }[];
  resourceLoader: { getSkills(): { skills: readonly { name: string; description?: string }[] } };
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: PiExtensionBindings): Promise<void>;
  compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }>;
  getUserMessagesForForking(): readonly { entryId: string; text: string }[];
  getSessionStats(): { sessionId: string; totalMessages: number; userMessages: number; assistantMessages: number; toolCalls: number; tokens: ClientSessionStatus["tokens"]; cost: number };
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  getContextUsage(): ClientSessionStatus["contextUsage"] | undefined;
  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] }): Promise<void>;
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }): Promise<{ output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
  navigateTree?(targetId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: unknown }>;
  abortBranchSummary?(): void;
  abort(): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  setModel(model: AgentModel): Promise<void>;
  cycleModel(direction?: "forward" | "backward"): Promise<{ model: AgentModel } | undefined>;
  getAvailableThinkingLevels(): ClientThinkingLevel[];
  setThinkingLevel(level: ClientThinkingLevel): void;
  cycleThinkingLevel(): ClientThinkingLevel | undefined;
  setSessionName(name: string): void;
  /**
   * Narrow re-expression of `AgentSession.agent` (an `@earendil-works/pi-agent-core`
   * `Agent`), exposing only `streamFunction` — the resolved-auth/headers/retry "call
   * this model" function pi's own compaction/branch-summarization code uses
   * internally. Lets callers (e.g. session title generation) issue one-off model
   * calls without depending on pi-ai's deprecated `/compat` provider registry or
   * leaking the full `Agent`/`AgentSession` surface.
   */
  agent: { streamFunction: StreamFn };
}

export interface PiSessionModelRuntime {
  refresh(): Promise<unknown>;
  getAvailable(): Promise<readonly AgentModel[]>;
  getModel(provider: string, modelId: string): AgentModel | undefined;
  hasConfiguredAuth(provider: string): boolean;
}

export interface PiSessionRuntime {
  readonly cwd: string;
  readonly session: PiAgentSession;
  /**
   * Live, runtime-scoped diagnostics/services used to compute session warnings.
   *
   * These mirror the SDK runtime and are recomputed whenever the runtime is
   * (re)built. `undefined` on lightweight/test runtimes that do not carry SDK
   * services; callers must treat missing sources as "no warnings".
   */
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: AgentSessionServices;
  setRebindSession(rebindSession?: (session: PiAgentSession) => Promise<void>): void;
  fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }>;
  dispose(): Promise<void>;
}

type PiCreateRuntimeFactoryOptions = Parameters<CreateAgentSessionRuntimeFactory>[0] & {
  managementContext?: ManagementEmbedContext;
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
  delegationToolsEnabled?: boolean;
};
type PiCreateAgentSessionRuntimeFactory = (options: PiCreateRuntimeFactoryOptions) => ReturnType<CreateAgentSessionRuntimeFactory>;

interface AgentContextFilesResult {
  agentsFiles: { path: string; content: string }[];
}

const GLOBAL_AGENT_CONTEXT_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);

export function filterManagedGlobalContextFiles(cwd: string, agentDir: string, base: AgentContextFilesResult): AgentContextFilesResult {
  return {
    agentsFiles: base.agentsFiles.filter((file) => {
      const filename = basename(file.path);
      if (!GLOBAL_AGENT_CONTEXT_FILE_NAMES.has(filename)) return true;
      const fileDir = dirname(file.path);
      if (cwdPathsEqual(fileDir, agentDir)) return false;
      return pathInsideOrEqual(cwd, fileDir);
    }),
  };
}

function pathInsideOrEqual(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  const childRelativePath = relative(normalizedParent, normalizedChild);
  return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

interface CreateSessionRuntimeOptions extends Pick<InternalStartSessionOptions, "managementContext" | "initialModel" | "initialThinkingLevel" | "creationProvenance" | "startupToken"> {
  notificationGeneration?: SessionNotificationGeneration;
  notifications?: "enabled" | "disabled";
  /**
   * What the user asked for, so startup progress can say "Creating" instead of
   * "Opening". Only `startSession()` creates a brand new session; every other
   * caller opens an existing one, so "open" is the default.
   */
  startupIntent?: "create" | "open";
}

/**
 * Read-only view of the background catalog refresher, so session startup can
 * state what it is concurrent with without being able to influence it.
 */
export interface CatalogRefreshStatus {
  isRefreshInFlight(): boolean;
}

/**
 * Publishes what a session startup is waiting on while it waits. Every call is
 * synchronous and event-only, so reporting never adds an await to session
 * creation and leaves no per-session state to unwind if creation fails.
 */
interface SessionStartupProgressReporter {
  report(phase: string): void;
  end(): void;
}

type NotificationClosePolicy =
  | { kind: "clear"; reason: SessionNotificationClearReason }
  | { kind: "defer" };

const CLEAR_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "clear", reason: "runtime-close" };
const DEFER_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "defer" };

function resourceDiagnosticToWarning(diagnostic: ResourceDiagnostic, source: string): SessionWarning {
  return {
    severity: diagnostic.type === "error" ? "error" : "warning",
    message: diagnostic.message,
    source,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
  };
}

function runtimeDiagnosticToWarning(diagnostic: AgentSessionRuntimeDiagnostic): SessionWarning {
  return { severity: diagnostic.type, message: diagnostic.message, source: "runtime" };
}

/**
 * Minimal structural view of a runtime's warning sources: the runtime setup
 * diagnostics plus the resource loader's per-collection diagnostics and
 * extension load errors. Narrowed to just what {@link collectRuntimeWarnings}
 * reads so the real SDK runtime and lightweight test doubles both satisfy it.
 */
export interface RuntimeWarningSources {
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: {
    resourceLoader: {
      getSkills(): { diagnostics: readonly ResourceDiagnostic[] };
      getPrompts(): { diagnostics: readonly ResourceDiagnostic[] };
      getThemes(): { diagnostics: readonly ResourceDiagnostic[] };
      getExtensions(): { errors: readonly { path: string; error: string }[] };
    };
  };
}

/**
 * Compute the live warnings for a runtime by re-reading its current resource
 * loader diagnostics, extension load errors, and runtime setup diagnostics.
 *
 * This mimics the TUI recomputing warnings on every (re)bind: it reads the
 * runtime's current state rather than a cached snapshot, so a rebuilt runtime
 * yields fresh warnings. Runtimes without SDK services (e.g. test fakes)
 * contribute no warnings.
 */
export function collectRuntimeWarnings(runtime: RuntimeWarningSources): SessionWarning[] {
  const warnings: SessionWarning[] = [];
  for (const diagnostic of runtime.diagnostics ?? []) warnings.push(runtimeDiagnosticToWarning(diagnostic));
  const resourceLoader = runtime.services?.resourceLoader;
  if (resourceLoader !== undefined) {
    for (const diagnostic of resourceLoader.getSkills().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "skill"));
    for (const diagnostic of resourceLoader.getPrompts().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "prompt"));
    for (const diagnostic of resourceLoader.getThemes().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "theme"));
    for (const error of resourceLoader.getExtensions().errors) {
      warnings.push({ severity: "error", message: `${error.path}: ${error.error}`, source: "extension", path: error.path });
    }
  }
  return warnings;
}

/**
 * Verbatim TUI wording for the Anthropic subscription-auth billing notice. Kept
 * character-for-character in sync with `ANTHROPIC_SUBSCRIPTION_AUTH_WARNING` in
 * the SDK's interactive mode so the browser shows the same message the TUI does.
 */
const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
  "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

/** Mirror of the SDK TUI `isAnthropicSubscriptionAuthKey` (subscription API keys start with `sk-ant-oat`). */
function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

/**
 * Dismiss id for the Anthropic subscription-auth billing notice. This is `pi`'s
 * own `WarningSettings` key verbatim (`anthropicExtraUsage`): we carry the
 * coupling `pi` already defines rather than inventing a parallel vocabulary, and
 * {@link dismissSessionWarning} maps it back to `setWarnings`.
 */
const ANTHROPIC_EXTRA_USAGE_DISMISS_ID = "anthropicExtraUsage";

/**
 * Port of the TUI `maybeWarnAboutAnthropicSubscriptionAuth` gate/trigger, computed
 * live from the session's current model, stored Anthropic credential, and warning
 * settings. Returns the billing warning when the active provider is `anthropic`
 * and auth is a subscription credential (stored `oauth`, or an `sk-ant-oat` API
 * key), unless suppressed via `getWarnings().anthropicExtraUsage === false`.
 *
 * The stored credential is read synchronously (matching the TUI's `oauth` branch
 * and the documented `sk-ant-oat` key trigger) so warnings stay part of the
 * synchronous live status computation.
 */
export function anthropicSubscriptionWarning(
  session: Pick<PiAgentSession, "model" | "settingsManager">,
  authPath?: string,
): SessionWarning | undefined {
  if (session.settingsManager.getWarnings().anthropicExtraUsage === false) return undefined;
  if (session.model?.provider !== "anthropic") return undefined;
  const credential = readStoredCredential("anthropic", authPath);
  if (credential === undefined) return undefined;
  const isSubscriptionAuth = credential.type === "oauth"
    ? true
    : isAnthropicSubscriptionAuthKey(credential.key);
  if (!isSubscriptionAuth) return undefined;
  return {
    severity: "warning",
    message: ANTHROPIC_SUBSCRIPTION_AUTH_WARNING,
    source: "anthropic",
    dismiss: { id: ANTHROPIC_EXTRA_USAGE_DISMISS_ID },
  };
}

/**
 * Durably suppress a dismissable session warning by mapping its opaque dismiss
 * id back to the concrete `pi` suppression it represents. Only known ids are
 * honored; unknown ids throw so a stale/forged client cannot silently no-op.
 *
 * This is the single place provider-specific suppression lives: the wire type,
 * parser, and UI stay agnostic. Adding a future dismissable warning is a
 * server-only change here plus a `dismiss` id on its producer.
 */
export function dismissSessionWarning(
  session: Pick<PiAgentSession, "settingsManager">,
  dismissId: string,
): void {
  if (dismissId !== ANTHROPIC_EXTRA_USAGE_DISMISS_ID) {
    throw new Error(`Unknown session warning dismiss id: ${dismissId}`);
  }
  session.settingsManager.setWarnings({ ...session.settingsManager.getWarnings(), anthropicExtraUsage: false });
}

interface CreateAgentRuntimeOptions {
  cwd: string;
  agentDir: string;
  sessionManager: PiSessionManager;
  delegationToolsEnabled: boolean;
  managementContext?: ManagementEmbedContext;
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
}

type CreateAgentRuntime = (createRuntime: PiCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions) => Promise<PiSessionRuntime>;

function defaultCreateAgentRuntime(createRuntime: PiCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions): Promise<PiSessionRuntime> {
  if (!(options.sessionManager instanceof SessionManager)) throw new Error("Default runtime creation requires an SDK SessionManager");
  const runtimeFactory = createRuntimeWithContextAndOneShotSessionOptions(
    createRuntime,
    options.managementContext,
    options.initialModel,
    options.initialThinkingLevel,
    options.delegationToolsEnabled,
  );
  return createAgentSessionRuntime(runtimeFactory, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
  });
}

function createRuntimeWithContextAndOneShotSessionOptions(
  createRuntime: PiCreateAgentSessionRuntimeFactory,
  managementContext: ManagementEmbedContext | undefined,
  initialModel: AgentModel | undefined,
  initialThinkingLevel: ClientThinkingLevel | undefined,
  delegationToolsEnabled: boolean,
): CreateAgentSessionRuntimeFactory {
  // These inherited options belong only to the session being spawned. A later
  // runtime replacement restores its own model and thinking level from disk.
  let pendingInitialModel = initialModel;
  let pendingInitialThinkingLevel = initialThinkingLevel;
  let pendingDelegationToolsEnabled: boolean | undefined = delegationToolsEnabled;
  return async (options) => {
    const model = pendingInitialModel;
    const thinkingLevel = pendingInitialThinkingLevel;
    const toolsEnabled = pendingDelegationToolsEnabled;
    pendingInitialModel = undefined;
    pendingInitialThinkingLevel = undefined;
    pendingDelegationToolsEnabled = undefined;
    return createRuntime({
      ...options,
      ...(managementContext === undefined ? {} : { managementContext }),
      ...(model === undefined ? {} : { initialModel: model }),
      ...(thinkingLevel === undefined ? {} : { initialThinkingLevel: thinkingLevel }),
      ...(toolsEnabled === undefined ? {} : { delegationToolsEnabled: toolsEnabled }),
    });
  };
}

type ScopedSpawnSessionInvocation = SpawnSessionInvocation & { managementContext?: ManagementEmbedContext };
type ScopedSpawnSubsessionInvocation = SpawnSubsessionInvocation & { managementContext?: ManagementEmbedContext };
type SpawnSessionFn = (input: ScopedSpawnSessionInvocation) => Promise<SpawnSessionResult>;
type ScopedSubsessionToolDeps = Omit<SubsessionToolDeps, "spawn"> & {
  spawn(input: ScopedSpawnSubsessionInvocation): Promise<SpawnSubsessionResult>;
};

type ResolveSettingsScopeDirectory = (cwd: string, mode: SessionSettingsMode) => Promise<string>;

function createDefaultRuntimeFactory(
  normalModelRuntimeForCwd: (cwd: string) => Promise<ModelRuntime>,
  managementModelRuntime: () => Promise<ModelRuntime>,
  resolveSettingsScope: ResolveSettingsScopeDirectory,
  spawn?: SpawnSessionFn,
  subsessions?: ScopedSubsessionToolDeps,
  askUser?: AskUserToolDeps,
): PiCreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, managementContext, initialModel, initialThinkingLevel, delegationToolsEnabled = true }) => {
    const scopedModelRuntime = managementContext === undefined ? await normalModelRuntimeForCwd(cwd) : await managementModelRuntime();
    if (managementContext !== undefined) {
      return createManagementRuntimeFactory(scopedModelRuntime, resolveSettingsScope, spawn, subsessions, askUser, managementContext)({
        cwd,
        agentDir,
        sessionManager,
        delegationToolsEnabled,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        ...(initialModel === undefined ? {} : { initialModel }),
        ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
      });
    }

    const settingsManager = await createScopedSettingsManager({
      cwd,
      scopeDirectory: await resolveSettingsScope(cwd, "normal"),
      globalAgentDir: agentDir,
    });
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime: scopedModelRuntime, settingsManager });
    const customTools = createPiWebCustomToolDefinitions(cwd, delegationToolsEnabled, spawn, subsessions, askUser);
    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      customTools,
      ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
      ...(initialModel === undefined ? {} : { model: initialModel }),
      ...(initialThinkingLevel === undefined ? {} : { thinkingLevel: initialThinkingLevel }),
    });
    return { ...result, services, diagnostics: services.diagnostics };
  };
}

function createManagementRuntimeFactory(
  modelRuntime: ModelRuntime,
  resolveSettingsScope: ResolveSettingsScopeDirectory,
  spawn: SpawnSessionFn | undefined,
  subsessions: ScopedSubsessionToolDeps | undefined,
  askUser: AskUserToolDeps | undefined,
  managementContext: ManagementEmbedContext,
): PiCreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, initialModel, initialThinkingLevel, delegationToolsEnabled = true }) => {
    const policyAgentDir = await writeManagementPermissionSystemPolicy(agentDir, cwd, managementContext);
    return withRuntimeCreationEnvironment({ [PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR]: policyAgentDir }, async () => {
      const settingsManager = await createScopedSettingsManager({
        cwd,
        scopeDirectory: await resolveSettingsScope(cwd, "management"),
        globalAgentDir: agentDir,
      });
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          agentsFilesOverride: (base) => filterManagedGlobalContextFiles(cwd, agentDir, base),
        },
      });
      const managedToolOptions = createManagedAgentToolOptions(cwd);
      const scopedSpawn = spawn === undefined
        ? undefined
        : (input: SpawnSessionInvocation) => spawn({ ...input, managementContext });
      const scopedSubsessions = subsessions === undefined
        ? undefined
        : {
            ...subsessions,
            spawn: (input: SpawnSubsessionInvocation) => subsessions.spawn({ ...input, managementContext }),
          };
      const customTools = [
        ...managedAgentToolDefinitions(cwd, managedToolOptions),
        createManagedPythonToolDefinition(cwd, managementContext),
        ...(delegationToolsEnabled && scopedSpawn !== undefined ? [defineTool(createSpawnSessionToolDefinition(cwd, { spawn: scopedSpawn }))] : []),
        ...(delegationToolsEnabled && scopedSubsessions !== undefined ? createSubsessionToolDefinitions(cwd, scopedSubsessions).map((tool) => defineTool(tool)) : []),
        ...(askUser === undefined ? [] : [createAskUserToolDefinition(askUser)]),
      ];
      const options = {
        services,
        sessionManager,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        customTools,
        tools: managementAgentToolNames(managementContext),
        ...(initialModel === undefined ? {} : { model: initialModel }),
        ...(initialThinkingLevel === undefined ? {} : { thinkingLevel: initialThinkingLevel }),
      };
      const result = await createAgentSessionFromServices(options);
      return { ...result, services, diagnostics: services.diagnostics };
    });
  };
}

type PiWebEditToolDetails = EditToolDetails | { preview: EditPreviewResult } | undefined;

export function createPiWebCustomToolDefinitions(
  cwd: string,
  delegationEnabled: boolean,
  spawn?: SpawnSessionFn,
  subsessions?: SubsessionToolDeps,
  askUser?: AskUserToolDeps,
): ToolDefinition[] {
  return [
    ...managedAgentToolDefinitions(cwd),
    ...(delegationEnabled && spawn !== undefined ? [defineTool(createSpawnSessionToolDefinition(cwd, { spawn }))] : []),
    ...(delegationEnabled && subsessions !== undefined ? createSubsessionToolDefinitions(cwd, subsessions).map((tool) => defineTool(tool)) : []),
    ...(askUser === undefined ? [] : [createAskUserToolDefinition(askUser)]),
  ];
}

function managedAgentToolDefinitions(cwd: string, options?: ToolsOptions): ToolDefinition[] {
  if (options === undefined) return [createPiWebEditToolDefinition(cwd)];
  return [
    defineTool(createReadToolDefinition(cwd, options.read)),
    createPiWebEditToolDefinition(cwd, options.edit),
    defineTool(createWriteToolDefinition(cwd, options.write)),
    defineTool(createGrepToolDefinition(cwd, options.grep)),
    defineTool(createFindToolDefinition(cwd, options.find)),
    defineTool(createLsToolDefinition(cwd, options.ls)),
  ];
}

function createPiWebEditToolDefinition(cwd: string, options?: EditToolOptions) {
  const editTool = createEditToolDefinition(cwd, options);
  return defineTool<typeof editTool.parameters, PiWebEditToolDetails>({
    name: editTool.name,
    label: editTool.label,
    description: editTool.description,
    ...(editTool.promptSnippet === undefined ? {} : { promptSnippet: editTool.promptSnippet }),
    ...(editTool.promptGuidelines === undefined ? {} : { promptGuidelines: editTool.promptGuidelines }),
    parameters: editTool.parameters,
    ...(editTool.renderShell === undefined ? {} : { renderShell: editTool.renderShell }),
    ...(editTool.prepareArguments === undefined ? {} : { prepareArguments: editTool.prepareArguments }),
    ...(editTool.executionMode === undefined ? {} : { executionMode: editTool.executionMode }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const preview = await computeEditPreview(params.path, params.edits, cwd);
      if (signal?.aborted !== true) {
        onUpdate?.({ content: [{ type: "text", text: "Edit preview computed." }], details: { preview } });
      }
      return editTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export interface PiSessionServiceDependencies {
  archiveStore?: SessionArchiveRepository;
  pinStore?: SessionPinStore;
  agentDir?: string;
  /**
   * PI WEB data directory used for mode×project preference overrides
   * (`defaultThinkingLevel`, default model). Defaults to `piWebDataDir()`.
   */
  dataDir?: string;
  /**
   * Resolve the registered project path for a session cwd. Used to isolate
   * preference overrides between projects (and between normal vs management
   * modes). Return `undefined` when no unique project applies (management
   * orphan scopes).
   */
  projectPathForCwd?: (cwd: string) => Promise<string | undefined>;
  sessionManager?: PiSessionManagerGateway;
  createRuntime?: PiCreateAgentSessionRuntimeFactory;
  createAgentRuntime?: CreateAgentRuntime;
  modelRuntime?: ModelRuntime;
  /** Resolve the normal-mode model runtime for a session cwd. */
  normalModelRuntimeForCwd?: (cwd: string) => Promise<ModelRuntime>;
  managementModelRuntime?: ModelRuntime;
  heartbeatIntervalMs?: number;
  workspaceActivity?: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity">;
  /**
   * When provided, `spawn_session` is available to sessions whose creation
   * provenance permits delegation, scoped to the project's workspaces.
   * Omit to keep the capability disabled.
   */
  spawnTargets?: SpawnTargetResolver;
  /**
   * When provided, session listings report related sessions living in sibling
   * workspaces of the same project: where an out-of-workspace parent is, and how
   * many children a listed session has elsewhere. Omit to list each workspace in
   * isolation.
   */
  projectWorkspaces?: ProjectWorkspaceCwds;
  /**
   * Beta: when true (and `spawnTargets` is provided), the tracked-subsession
   * tools are available to sessions whose creation provenance permits
   * delegation. Off by default so the capability can ship in main without
   * being exposed in releases.
   */
  subsessionsEnabled?: boolean;
  /**
   * When true, `ask_user` is available to every session, so an agent can post a
   * question set to the browser. Independent of the delegation capabilities: the
   * questions reach the user of the asking session, not another session.
   */
  askUserEnabled?: boolean;
  /** Daemon-lifetime open-ask state; defaults to an in-memory store in tests. */
  pendingAskStore?: PendingAskStore;
  /** Daemon-lifetime open-dialog state; defaults to an in-memory store in tests. */
  pendingExtensionDialogStore?: PendingExtensionDialogStore;
  /**
   * How long an extension dialog with no extension-set `timeout` waits for an
   * answer before the daemon auto-cancels it; `0` waits forever. A tuning
   * knob, not a gate: extension dialogs are always on.
   */
  extensionDialogsTimeoutMs?: number;
  /** Structured logger for notable runtime events (e.g. spawns). */
  logger?: PiSessionLogger;
  /** Clock seam for cleanup planning tests. */
  now?: () => Date;
  /** Daemon-lifetime notification state, injected by sessiond in production. */
  notificationStore?: SessionNotificationStore;
  /** Durable daemon-owned unread state; defaults to an in-memory store in tests. */
  unreadStore?: SessionUnreadStore;
  /** Initial retry delay for durable unread publication failures. */
  unreadPublicationRetryDelayMs?: number;
  /**
   * Lets session startup report that provider model lists are refreshing while
   * a session is being constructed. Omit to report the startup phase alone.
   */
  catalogRefreshStatus?: CatalogRefreshStatus;
}

export class PiSessionService {
  private readonly active = new Map<string, ManagedActiveSession>();
  private readonly runtimeBySession = new WeakMap<PiAgentSession, PiSessionRuntime>();
  private readonly pendingSessionOpens = new Map<string, PendingSessionOpen>();
  /** Sessions whose extension binding is parked on a `session_start` dialog. */
  private readonly startupSessions = new Map<string, ManagedStartupSession>();
  private readonly activities = new SessionActivityCoordinator();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly commandService: SessionCommandService<PiAgentSession>;
  /** Runtime-identity gate held while Pi may await abandoned-branch summarization. */
  private readonly treeNavigations = new WeakSet<PiAgentSession>();
  /** Counts async operations that may append an entry before they settle. */
  private readonly sessionEntryMutationCounts = new WeakMap<PiAgentSession, number>();
  /** Runtime/session-identity reservations for operations that must not overlap tree navigation. */
  private readonly treeExclusiveRuntimeOperationCounts = new WeakMap<PiSessionRuntime, number>();
  private readonly treeExclusiveSessionOperationCounts = new Map<string, number>();
  private readonly deferredSubsessionNotifications = new WeakMap<PiAgentSession, DeferredSubsessionNotification[]>();
  private readonly deferredGeneratedSessionNames = new WeakMap<PiAgentSession, string>();
  private readonly compactionPromptQueues = new Map<string, QueuedPrompt[]>();
  private readonly compactionDrainTimers = new Map<string, NodeJS.Timeout>();
  private readonly authLossWarnings = new Set<string>();
  /** Tracked subsession id -> the parent session id that spawned it. */
  private readonly subsessionParents = new Map<string, string>();
  /** Parent session id -> the set of tracked subsession ids it spawned. */
  private readonly subsessionChildren = new Map<string, Set<string>>();
  /** Tracked subsession id -> persisted recovery details for the child. */
  private readonly subsessionLinks = new Map<string, TrackedSubsessionLink>();
  /** Parent id/file identities whose persisted links have already been loaded. */
  private readonly subsessionHydratedParents = new Set<string>();
  /** Session file path -> its parsed header. Headers are written once, so successful reads are cached. */
  private readonly sessionHeaderCache = new Map<string, SessionHeaderSummary>();
  /**
   * Tracked subsession id -> whether a completion notification is armed.
   * Armed when the child starts working; firing on completion disarms it so a
   * child that works again (and stops again) notifies the parent each time.
   */
  private readonly subsessionNotifyArmed = new Map<string, boolean>();
  private readonly archiveStore: SessionArchiveRepository;
  private readonly pinStore: SessionPinStore;
  private readonly agentDir: string;
  private readonly dataDir: string;
  private readonly projectPathForCwd: ((cwd: string) => Promise<string | undefined>) | undefined;
  private readonly sessionManager: PiSessionManagerGateway;
  private readonly createRuntime: PiCreateAgentSessionRuntimeFactory;
  private readonly createAgentRuntime: CreateAgentRuntime;
  private readonly normalModelRuntimeForCwd: (cwd: string) => Promise<ModelRuntime>;
  private readonly managementModelRuntime: () => Promise<ModelRuntime>;
  private readonly workspaceActivity: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity"> | undefined;
  private readonly spawnTargets: SpawnTargetResolver | undefined;
  private readonly projectWorkspaces: ProjectWorkspaceCwds | undefined;
  private readonly logger: PiSessionLogger;
  private readonly now: () => Date;
  private readonly notificationStore: SessionNotificationStore;
  private readonly notificationGenerationBySession = new WeakMap<PiAgentSession, SessionNotificationGeneration>();
  private readonly unreadStore: SessionUnreadStore;
  private readonly pendingAskStore: PendingAskStore;
  private readonly pendingExtensionDialogStore: PendingExtensionDialogStore;
  private readonly extensionDialogsTimeoutMs: number;
  /** The parked extension Promise resolvers behind the store's open dialogs. */
  private readonly dialogWaiters = new ExtensionDialogWaiters();
  private readonly catalogRefreshStatus: CatalogRefreshStatus | undefined;
  private readonly unreadPublicationRetryInitialMs: number;
  private readonly pendingUnreadMutations: SessionUnreadMutation[] = [];
  private unreadPublication: Promise<void> | undefined;
  private unreadPublicationFailure: unknown;
  private unreadPublicationFlushRequested = false;
  private unreadPublicationRetryTimer: NodeJS.Timeout | undefined;
  private unreadPublicationRetryDelayMs: number;
  private unreadPublicationStopped = false;

  constructor(private readonly events: SessionEventHub, deps: PiSessionServiceDependencies) {
    this.archiveStore = deps.archiveStore ?? new SessionArchiveStore();
    this.pinStore = deps.pinStore ?? new SessionPinStore(join(deps.dataDir ?? piWebDataDir(), "session-pins.json"));
    this.agentDir = deps.agentDir ?? getAgentDir();
    this.dataDir = deps.dataDir ?? piWebDataDir();
    this.projectPathForCwd = deps.projectPathForCwd;
    this.sessionManager = deps.sessionManager ?? createPiSessionManagerGateway({
      agentDir: this.agentDir,
      env: process.env,
      sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"],
    });
    let defaultModelRuntime: Promise<ModelRuntime> | undefined;
    const resolveDefaultModelRuntime = () => {
      defaultModelRuntime ??= deps.modelRuntime === undefined ? ModelRuntime.create() : Promise.resolve(deps.modelRuntime);
      return defaultModelRuntime;
    };
    this.normalModelRuntimeForCwd = deps.normalModelRuntimeForCwd ?? resolveDefaultModelRuntime;
    const managementModelRuntime = deps.managementModelRuntime;
    this.managementModelRuntime = managementModelRuntime === undefined
      ? resolveDefaultModelRuntime
      : () => Promise.resolve(managementModelRuntime);
    this.spawnTargets = deps.spawnTargets;
    this.projectWorkspaces = deps.projectWorkspaces;
    this.logger = deps.logger ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.notificationStore = deps.notificationStore ?? new SessionNotificationStore();
    this.unreadStore = deps.unreadStore ?? new SessionUnreadStore();
    this.pendingAskStore = deps.pendingAskStore ?? new PendingAskStore();
    this.pendingExtensionDialogStore = deps.pendingExtensionDialogStore ?? new PendingExtensionDialogStore();
    this.extensionDialogsTimeoutMs = deps.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS;
    this.catalogRefreshStatus = deps.catalogRefreshStatus;
    this.unreadPublicationRetryInitialMs = Math.max(
      0,
      deps.unreadPublicationRetryDelayMs ?? DEFAULT_UNREAD_PUBLICATION_RETRY_MS,
    );
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
    // Subsessions are a beta capability gated behind their own flag, and they
    // also require the spawn capability (they share its project-scope resolver).
    const subsessionsActive = this.spawnTargets !== undefined && deps.subsessionsEnabled === true;
    this.createRuntime = deps.createRuntime ?? createDefaultRuntimeFactory(
      this.normalModelRuntimeForCwd,
      this.managementModelRuntime,
      (cwd, mode) => this.resolveSettingsScopeDirectory(cwd, mode),
      this.spawnTargets === undefined ? undefined : (input) => this.spawnSession(input),
      !subsessionsActive ? undefined : {
        spawn: (input) => this.spawnSubsession(input),
        list: (parentSessionId, parentSessionFile) => this.listSubsessions(parentSessionId, parentSessionFile),
        check: (parentSessionId, sessionId, parentSessionFile) => this.checkSubsession(parentSessionId, sessionId, parentSessionFile),
        read: (parentSessionId, sessionId, query, parentSessionFile) => this.readSubsession(parentSessionId, sessionId, query, parentSessionFile),
      },
      deps.askUserEnabled === true ? { open: (input) => this.openAsk(input) } : undefined,
    );
    this.createAgentRuntime = deps.createAgentRuntime ?? defaultCreateAgentRuntime;
    this.workspaceActivity = deps.workspaceActivity;
    this.heartbeat = setInterval(() => { this.publishHeartbeats(); }, deps.heartbeatIntervalMs ?? 2000);
    this.commandService = new SessionCommandService(
      (sessionId, eventScope) => this.getActiveForCommand(sessionId, eventScope),
      (sessionId, text, eventScope) => this.submitCommandPrompt(sessionId, text, eventScope),
      events,
      {
        onCompactionStart: (session) => {
          this.beginSessionEntryMutation(session, "compact the session");
          this.publishActivity(session, "正在压缩上下文", "active");
          this.publishStatus(session);
        },
        onCompactionEnd: (session, result, detail) => {
          this.endSessionEntryMutation(session);
          this.publishActivity(session, result === "success" ? "上下文压缩完成" : "上下文压缩失败", result === "success" ? "idle" : "error", detail);
          this.publishStatus(session);
        },
        reloadSession: (session) => this.reloadSessionRuntime(session),
        getSessionTree: (session) => {
          if (typeof session.sessionManager.getTree !== "function" || typeof session.navigateTree !== "function") return undefined;
          return projectSessionTree(session.sessionManager.getTree(), session.sessionManager.getLeafId());
        },
        hasActiveWork: (session) => this.hasActiveWork(session),
        isTreeNavigationActive: (session) => this.treeNavigations.has(session),
        runSessionReplacement: (session, operation) => {
          const runtime = this.activeRuntimeForSession(session);
          return this.runTreeExclusiveOperation(
            [{ sessionId: session.sessionId, session, ...(runtime === undefined ? {} : { runtime }) }],
            "Stop current session activity before replacing the session",
            operation,
          );
        },
      },
      { listSessionNames: (cwd) => this.listSessionNames(cwd) },
    );
  }

  activeCount(): number {
    return this.active.size;
  }

  private async resolveSettingsScopeDirectory(cwd: string, mode: SessionSettingsMode): Promise<string> {
    const projectPath = this.projectPathForCwd === undefined ? undefined : await this.projectPathForCwd(cwd);
    return resolveSettingsScopeDirectory({
      dataDir: this.dataDir,
      cwd,
      mode,
      ...(projectPath === undefined ? {} : { projectPath }),
    });
  }

  async cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupPreviewResponse> {
    return previewResponseFromPlan(await this.cleanupPlan(request));
  }

  async cleanup(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupExecuteResponse> {
    const plan = await this.cleanupPlan(request);
    if (plan.deleteRecords.length > 0 && this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const archiveInputs: ArchiveSessionInput[] = [];
    const readyArchiveInputs: ArchiveSessionInput[] = [];
    const deleteRecords: ArchivedSessionRecord[] = [];
    const readyDeleteRecords: ArchivedSessionRecord[] = [];
    const skippedBusySessionIds = new Set(plan.skippedBusySessionIds);

    for (const input of plan.archiveInputs) {
      if (this.activeSessionHasWork(input.sessionId)) {
        skippedBusySessionIds.add(input.sessionId);
        continue;
      }
      await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" });
      readyArchiveInputs.push(input);
    }
    await this.archiveStoreArchiveMany(readyArchiveInputs);
    archiveInputs.push(...readyArchiveInputs);
    await this.forgetUnreadSessions(readyArchiveInputs);

    for (const record of plan.deleteRecords) {
      if (this.activeSessionHasWork(record.sessionId)) {
        skippedBusySessionIds.add(record.sessionId);
        continue;
      }
      await this.closeActive(record.sessionId, { kind: "clear", reason: "delete" });
      readyDeleteRecords.push(record);
    }
    await this.ensureArchivedRecordsMoved(readyDeleteRecords);
    const deletedSessionIds = new Set(await this.archiveStoreDeleteArchivedMany(readyDeleteRecords.map((record) => record.sessionId)));
    deleteRecords.push(...readyDeleteRecords.filter((record) => deletedSessionIds.has(record.sessionId)));
    await this.forgetUnreadSessions(deleteRecords);

    return summarizeSessionCleanupExecution({
      archiveInputs,
      deleteRecords,
      thresholds: plan.thresholds,
      generatedAt: plan.generatedAt,
      skippedBusySessionIds: [...skippedBusySessionIds],
    });
  }

  async dispose(): Promise<void> {
    this.unreadPublicationStopped = true;
    this.clearUnreadPublicationRetry();
    clearInterval(this.heartbeat);
    this.clearCompactionDrainTimers();
    // Same startup-park hazard as closeActive(): settle `session_start` dialogs
    // of sessions still binding extensions before awaiting their pending opens.
    for (const startup of this.startupSessions.values()) this.endSessionExtensionDialogs(startup.session);
    const pendingOpens = this.pendingSessionOpenPromises();
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const activeSessions = Array.from(new Set(this.active.values()));
    for (const active of activeSessions) {
      this.forgetUnreadActivity(active.runtime.session);
      this.pendingAskStore.forgetSession(active.runtime.session.sessionId);
      this.endSessionExtensionDialogs(active.runtime.session);
    }
    this.active.clear();
    this.pendingSessionOpens.clear();
    this.startupSessions.clear();
    this.activities.clear();
    this.compactionPromptQueues.clear();
    this.authLossWarnings.clear();
    this.subsessionParents.clear();
    this.subsessionChildren.clear();
    this.subsessionLinks.clear();
    this.subsessionHydratedParents.clear();
    this.subsessionNotifyArmed.clear();
    this.sessionHeaderCache.clear();
    this.notificationStore.clearAll("service-dispose");
    await Promise.all(activeSessions.map(async (active) => {
      active.unsubscribe();
      this.workspaceActivity?.removeSession(active.runtime.session.sessionId, active.runtime.session.sessionManager.getCwd(), active.eventScope);
      await active.runtime.session.abort();
      await active.runtime.dispose();
    }));
    await this.publishUnreadMutations([]);
  }

  async list(cwd: string, managementContext?: ManagementEmbedContext): Promise<ClientSession[]> {
    return (await this.listWorkspaceSessions(cwd, managementContext)).sessions;
  }

  async search(cwd: string, query: string, managementContext?: ManagementEmbedContext): Promise<ClientSession[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery === "") return this.list(cwd, managementContext);
    const { sessions } = await this.searchCandidates(cwd, normalizedQuery, managementContext);
    return sessions;
  }

  async searchContent(cwd: string, query: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionContentSearchResponse> {
    const normalizedQuery = query.trim();
    if (normalizedQuery === "") return { results: [], matchCount: 0, truncated: false };
    const maxMatches = 200;
    const { listing, sessions } = await this.searchCandidates(cwd, normalizedQuery.toLocaleLowerCase(), managementContext);
    const results: ClientSessionContentSearchResponse["results"] = [];
    let matchCount = 0;
    for (const session of sessions) {
      const remaining = maxMatches - results.reduce((count, result) => count + result.matches.length, 0);
      const messages = this.searchableSessionHistory(session, listing, managementContext);
      const view = searchSessionContent(messages, normalizedQuery, Math.max(1, remaining));
      matchCount += view.matchCount;
      if (remaining > 0 && view.matches.length > 0) results.push({ session, matches: view.matches.slice(0, remaining) });
    }
    return { results, matchCount, truncated: matchCount > maxMatches };
  }

  async listPinned(cwd: string, managementContext?: ManagementEmbedContext): Promise<SessionPinnedIdsResponse> {
    const listing = await this.listWorkspaceSessions(cwd, managementContext);
    const scope = sessionPinScope(cwd, managementContext);
    const sessionIds = await this.pinStore.prune(scope, new Set(listing.sessions.map((session) => session.id)));
    return { sessionIds };
  }

  async setPinned(ref: SessionRouteLookup, pinned: boolean, managementContext?: ManagementEmbedContext): Promise<SessionPinResponse> {
    if (typeof ref === "string" || ref.cwd === "") throw new Error("置顶会话必须提供工作区");
    const sessions = await this.list(ref.cwd, managementContext);
    const session = sessions.find((candidate) => candidate.id === ref.id);
    if (session === undefined) throw new Error("未找到会话");
    if (session.archived !== true && session.persisted === false) throw new Error("只能置顶已持久化会话");
    await this.pinStore.set(sessionPinScope(ref.cwd, managementContext), session.id, pinned);
    return { pinned };
  }

  private async listWorkspaceSessions(cwd: string, managementContext?: ManagementEmbedContext): Promise<WorkspaceSessionListing> {
    if (managementContext === undefined) await this.normalModelRuntimeForCwd(cwd);
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const archivedForCwd = await Promise.all(
      archivedRecords
        .filter((record) => record.cwd === cwd)
        .map((record) => this.ensureArchivedSessionMoved(record, sessionsById.get(record.sessionId))),
    );
    const archivedById = new Map(archivedForCwd.map((record) => [record.sessionId, record]));
    for (const record of archivedForCwd) {
      this.publishNotificationMutations(this.notificationStore.clearSession(record.sessionId, "archive-reconcile"));
    }
    const unarchivedSessions = sessions.filter((session) => !archivedById.has(session.id)).map(clientSessionFromListEntry);
    const reconcilableSessionIds = this.reconcilableSessionIds(cwd, unarchivedSessions.map((session) => session.id), archivedById);
    this.workspaceActivity?.reconcileSessionActivity(cwd, reconcilableSessionIds, eventScopeFromManagementContext(managementContext));
    if (managementContext === undefined) {
      await this.publishUnreadMutations(this.unreadStore.reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds));
    }
    const archivedSessions = archivedForCwd
      .sort(compareArchivedRecords)
      .map((record) => clientSessionFromArchivedRecord(record, sessionsById.get(record.sessionId)))
      .filter(isDefined);
    return {
      sessions: await this.withRelatedSessionsElsewhere([...unarchivedSessions, ...archivedSessions], cwd),
      entriesById: new Map(sessions.map((session) => [session.id, session])),
      archivedById,
    };
  }

  /**
   * Annotate a listing with the session relationships that cross workspace
   * boundaries: where an out-of-listing parent lives, and how many children a
   * listed session has in sibling workspaces.
   *
   * Both directions are best-effort. An unreadable parent header or a sibling
   * workspace that cannot be listed leaves the session unannotated rather than
   * failing the listing, and the browser falls back to its generic states.
   */
  private async withRelatedSessionsElsewhere(sessions: readonly ClientSession[], cwd: string): Promise<ClientSession[]> {
    const [parentLocations, childCounts] = await Promise.all([
      locateOutOfListingParents(sessions, cwd, this.readCachedSessionHeader),
      this.countChildrenInSiblingWorkspaces(sessions, cwd),
    ]);
    return sessions.map((session) => {
      const parent = session.parentSessionPath === undefined ? undefined : parentLocations.get(session.parentSessionPath);
      const childrenElsewhere = childCounts.get(session.path);
      if (parent === undefined && childrenElsewhere === undefined) return session;
      const annotated = { ...session };
      if (parent !== undefined) {
        annotated.parentSessionId = parent.parentSessionId;
        annotated.parentSessionCwd = parent.parentSessionCwd;
      }
      if (childrenElsewhere !== undefined) annotated.childSessionsElsewhere = childrenElsewhere;
      return annotated;
    });
  }

  /**
   * Count children of the listed sessions that live in other workspaces of the
   * same project.
   *
   * Only sibling workspaces are scanned: agents may only spawn into workspaces
   * of the spawning session's own project, so that bounds where a child can be.
   * Listing is skipped entirely when no project-workspace locator is configured
   * or the cwd belongs to no registered project.
   */
  private async countChildrenInSiblingWorkspaces(sessions: readonly ClientSession[], cwd: string): Promise<Map<string, number>> {
    if (this.projectWorkspaces === undefined || sessions.length === 0) return new Map();
    try {
      const siblingCwds = await siblingWorkspaceCwds(this.projectWorkspaces, cwd);
      if (siblingCwds.length === 0) return new Map();
      const listings = await Promise.all(siblingCwds.map(async (siblingCwd): Promise<string[]> => {
        const entries = await this.sessionManager.list(siblingCwd);
        return entries.flatMap((entry) => entry.parentSessionPath === undefined ? [] : [entry.parentSessionPath]);
      }));
      return countOutOfListingChildren(sessions, listings.flat());
    } catch (error: unknown) {
      this.logger.info(
        { cwd, error: error instanceof Error ? error.message : String(error) },
        "failed to count child sessions in sibling workspaces",
      );
      return new Map();
    }
  }

  /**
   * Read a session file header, memoized per path. Pi writes the header once at
   * session creation, so a successful read stays valid for the process lifetime;
   * failures are not cached so a session file that appears later is picked up.
   */
  private readonly readCachedSessionHeader: SessionHeaderReader = async (sessionFile) => {
    const cached = this.sessionHeaderCache.get(sessionFile);
    if (cached !== undefined) return cached;
    const header = await readSessionHeaderSummary(sessionFile);
    if (header !== undefined) this.sessionHeaderCache.set(sessionFile, header);
    return header;
  };

  async start(cwd: string, options: StartSessionOptions = {}): Promise<ClientSession> {
    if (options.managementContext === undefined) await this.normalModelRuntimeForCwd(cwd);
    return this.startSession(cwd, options);
  }

  private async startSession(cwd: string, options: InternalStartSessionOptions): Promise<ClientSession> {
    const active = await this.create(
      this.sessionManager.create(cwd, options.parentSession === undefined ? undefined : { parentSession: options.parentSession }),
      cwd,
      {
        ...(options.managementContext === undefined ? {} : { managementContext: options.managementContext }),
        ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
        ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
        ...(options.creationProvenance === undefined ? {} : { creationProvenance: options.creationProvenance }),
        ...(options.startupToken === undefined ? {} : { startupToken: options.startupToken }),
        startupIntent: "create",
      },
    );
    const { session } = active.runtime;
    const created: ClientSession = {
      id: session.sessionId,
      path: session.sessionFile ?? "",
      cwd,
      persisted: sessionFileExists(session.sessionFile),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: session.messages.length,
      firstMessage: "",
      // Include the parent so listeners can nest the new session in the tree
      // immediately, instead of showing it flat until the next reload.
      ...(options.parentSession === undefined ? {} : { parentSessionPath: options.parentSession }),
    };
    // Broadcast so other clients (and the spawning agent's UI) can add the new
    // session to their list without a manual reload.
    this.events.publishGlobal({ type: "session.created", session: created }, active.eventScope);
    return created;
  }

  /**
   * Start a new session on behalf of a LLM and deliver an initial prompt to it.
   * The target cwd is constrained to a workspace of the same registered project
   * as the spawning session so the new session is visible in the web UI.
   */
  async spawnSession(input: ScopedSpawnSessionInvocation): Promise<SpawnSessionResult> {
    if (this.spawnTargets === undefined) throw new Error("派生会话已禁用");
    const decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, input.cwd);
    if (!decision.allowed) throw spawnTargetError(decision);
    // A model spec overrides the inherited model. Only a spec triggers a
    // spawning-session lookup; the default path must not depend on it.
    let model = input.model;
    if (input.modelSpec !== undefined) {
      model = await this.resolveSpawnModel(
        { id: input.spawningSessionId, cwd: input.spawningCwd },
        input.modelSpec,
        input.managementContext,
      );
    }
    const created = await this.start(decision.cwd, {
      ...(model === undefined ? {} : { initialModel: model }),
      ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
      ...(input.managementContext === undefined ? {} : { managementContext: input.managementContext }),
    });
    const modelUsed = this.activeForLookup(created.id, input.managementContext)?.runtime.session.model;
    await this.prompt(created.id, input.prompt, undefined, undefined, {
      ...(input.managementContext === undefined ? {} : { managementContext: input.managementContext }),
    });
    this.logger.info(
      { spawningCwd: input.spawningCwd, sessionId: created.id, cwd: decision.cwd, promptLength: input.prompt.length },
      "spawn_session started a new session",
    );
    return {
      sessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
    };
  }

  /**
   * Start a *tracked* child session on behalf of a LLM. Identical to
   * {@link spawnSession} in how the target cwd is resolved, but the child
   * records its parent (so it shows in the session tree) and is registered so
   * the parent is notified when it stops working and can inspect it later.
   */
  async spawnSubsession(input: ScopedSpawnSubsessionInvocation): Promise<SpawnSubsessionResult> {
    if (this.spawnTargets === undefined) throw new Error("派生会话已禁用");
    const decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, input.cwd);
    if (!decision.allowed) throw spawnTargetError(decision);
    // A model spec overrides the inherited model and is resolved against the
    // parent's model runtime; only a spec triggers that lookup.
    const model = input.modelSpec === undefined
      ? input.model
      : await this.resolveSpawnModel(
          { id: input.parentSessionId, cwd: input.spawningCwd },
          input.modelSpec,
          input.managementContext,
        );
    const created = await this.startSession(decision.cwd, {
      ...(input.parentSessionFile === undefined ? {} : { parentSession: input.parentSessionFile }),
      ...(model === undefined ? {} : { initialModel: model }),
      ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
      ...(input.managementContext === undefined ? {} : { managementContext: input.managementContext }),
      creationProvenance: "tracked-subsession",
    });
    const modelUsed = this.activeForLookup(created.id, input.managementContext)?.runtime.session.model;
    const parentSessionFile = nonEmptyString(input.parentSessionFile);
    const link: TrackedSubsessionLink = {
      parentSessionId: input.parentSessionId,
      childSessionId: created.id,
      ...(created.path === "" ? {} : { childSessionFile: created.path }),
      ...(parentSessionFile === undefined ? {} : { parentSessionFile }),
      cwd: decision.cwd,
    };
    await this.registerVerifiedSubsession(link);
    this.persistSubsessionLink(link);
    this.persistSubsessionChildMarker(input.parentSessionId, created.id);
    await this.prompt(created.id, input.prompt, undefined, undefined, {
      ...(input.managementContext === undefined ? {} : { managementContext: input.managementContext }),
    });
    this.logger.info(
      { parentSessionId: input.parentSessionId, sessionId: created.id, cwd: decision.cwd, promptLength: input.prompt.length },
      "spawn_subsession started a tracked child session",
    );
    return {
      sessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
    };
  }

  /**
   * The models a session may pick from: its scoped set when model-scoped,
   * otherwise the runtime's available snapshot. Refreshes the runtime catalog
   * first so callers see newly configured providers and models.
   */
  private async sessionModelCandidates(session: PiAgentSession): Promise<readonly AgentModel[]> {
    await session.modelRuntime.refresh();
    return session.scopedModels.length > 0
      ? session.scopedModels.map((scoped) => scoped.model)
      : await session.modelRuntime.getAvailable();
  }

  /**
   * Resolve a strict `provider/model-id` spec from a spawn tool against the
   * *spawning* session's model runtime, using the same candidates
   * {@link setModel} offers plus a direct runtime lookup as fallback. Unknown
   * or malformed specs throw; the agent loop turns that into an error tool
   * result the spawning agent can retry from.
   */
  private async resolveSpawnModel(
    spawningSession: PiSessionLookup,
    modelSpec: string,
    managementContext?: ManagementEmbedContext,
  ): Promise<AgentModel> {
    const session = await this.getOrOpen(spawningSession, managementContext);
    const parsed = parseModelSpec(modelSpec);
    const candidates = await this.sessionModelCandidates(session);
    const model = parsed === undefined
      ? undefined
      : candidates.find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.modelId)
        ?? session.modelRuntime.getModel(parsed.provider, parsed.modelId);
    if (model === undefined) throw unknownSpawnModelError(modelSpec);
    return model;
  }

  /**
   * Register the question set an agent wants the user to answer as the session's
   * open ask. Deliberately does not wait for the user: `ask_user` terminates the
   * run and the submitted answers come back later as a follow-up message.
   *
   * Rejected question sets throw {@link PendingAskValidationError}, which the
   * agent loop reports to the model as an error tool result.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- async so a rejected question set becomes a rejection rather than a synchronous throw from a promise-returning method.
  async openAsk(input: AskUserInvocation): Promise<PendingAskOpenResult> {
    const result = this.pendingAskStore.open(input);
    // A supersede closes the earlier ask, so the browsers watching it must hear
    // that before they hear about its replacement.
    if (result.superseded !== undefined) this.publishAskClosed(input.sessionId, result.superseded);
    this.events.publish(input.sessionId, { type: "ask.opened", ask: result.ask });
    this.publishStatusForSessionId(input.sessionId);
    return result;
  }

  /**
   * Record the user's answers to the session's open ask and hand them to the
   * model. The answers travel as a system-authored custom message rather than a
   * user message, so they are not attributed to the human in the transcript;
   * they still wake an idle session (`triggerTurn`) and queue behind in-flight
   * work (`deliverAs: "followUp"`), which is how the run that `ask_user`
   * terminated continues.
   */
  async submitAsk(ref: PiSessionLookup, askId: string, submission: AskUserSubmission): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    // Checked before the store closes the ask so a refused delivery cannot
    // discard answers the user already submitted.
    this.assertTreeNavigationInactive(session, "answer questions");
    return this.closeAsk(session, this.pendingAskStore.submit(session.sessionId, askId, submission));
  }

  /**
   * Close the open ask without answers. The model is still told, naming every
   * question as unanswered: it was promised a follow-up message and would
   * otherwise wait for one that never comes.
   */
  async cancelAsk(ref: PiSessionLookup, askId: string): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "dismiss questions");
    return this.closeAsk(session, this.pendingAskStore.cancel(session.sessionId, askId));
  }

  /**
   * Publish and deliver a closed ask. A stale close is reported rather than
   * thrown: losing the race against a supersede, another browser, or a session
   * that went away is ordinary, and the returned status tells the browser what
   * the session's open ask is now.
   */
  private async closeAsk(session: PiAgentSession, result: PendingAskCloseResult): Promise<AskUserCloseResponse> {
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishAskClosed(session.sessionId, outcome);
    await this.runSessionEntryMutation(session, "deliver answers to your questions", () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      { triggerTurn: true, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  private publishAskClosed(sessionId: string, outcome: AskUserOutcome): void {
    this.events.publish(sessionId, { type: "ask.closed", askId: outcome.askId, reason: outcome.reason });
  }

  /**
   * Void the session's open ask because the user sent a chat message instead of
   * answering it. Every browser closes the card as cancelled, and the model is
   * told — without being woken — so the notice rides into the turn the message
   * itself triggers rather than becoming a turn of its own.
   */
  private async voidOpenAskForUserMessage(session: PiAgentSession): Promise<void> {
    const outcome = this.pendingAskStore.cancelOpen(session.sessionId);
    if (outcome === undefined) return;
    this.publishAskClosed(session.sessionId, outcome);
    await this.runSessionEntryMutation(session, "void the open questions", () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      { triggerTurn: false, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
  }

  /**
   * Record the user's answer to an open extension dialog and resolve the
   * extension's parked Promise with it. Unlike an ask, nothing is delivered to
   * the model: the waiter is extension code inside an already in-flight run
   * (or an idle handler), so no custom message and no turn are triggered.
   */
  async answerDialog(ref: PiSessionLookup, dialogId: string, value: ExtensionDialogAnswer, managementContext?: ManagementEmbedContext): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref, managementContext);
    const result = this.pendingExtensionDialogStore.answer(this.dialogSessionKey(session), dialogId, value);
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishDialogClosed(session, outcome);
    // `value` is what the store validated and recorded as the outcome's answer.
    this.dialogWaiters.settleWithAnswer(dialogId, value);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /** Close an open extension dialog without an answer; the extension's wait settles with its kind's cancel value. */
  async cancelDialog(ref: PiSessionLookup, dialogId: string, managementContext?: ManagementEmbedContext): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref, managementContext);
    const result = this.pendingExtensionDialogStore.cancel(this.dialogSessionKey(session), dialogId, "cancelled");
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishDialogClosed(session, outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /**
   * Implement one `ctx.ui.select()`/`confirm()`/`input()` call from extension
   * code: open the store record, tell the browsers, and park a Promise that
   * settles when the browser answers or cancels, the extension's own
   * `signal`/`timeout` dismisses the dialog, the daemon default timeout
   * elapses, or the runtime goes away. `store.open` validates the dialog, so a
   * malformed one rejects the extension's call rather than rendering garbage.
   * `async` so a rejected dialog becomes a rejection rather than a synchronous
   * throw from a promise-returning method.
   */
  private async openExtensionDialog(
    session: PiAgentSession,
    request: { kind: ExtensionDialogKind; title: string; message?: string | undefined; options?: string[] | undefined; placeholder?: string | undefined },
    opts: ExtensionUIDialogOptions | undefined,
  ): Promise<boolean | string | undefined> {
    const signal = opts?.signal;
    // A pre-aborted signal dismisses the dialog before it ever opens.
    if (signal?.aborted === true) return extensionDialogCancelValue(request.kind);
    const timeoutMs = effectiveExtensionDialogTimeoutMs(opts?.timeout, this.extensionDialogsTimeoutMs);
    const dialog = this.pendingExtensionDialogStore.open({
      sessionId: this.dialogSessionKey(session),
      kind: request.kind,
      title: request.title,
      ...(request.message === undefined ? {} : { message: request.message }),
      ...(request.options === undefined ? {} : { options: request.options }),
      ...(request.placeholder === undefined ? {} : { placeholder: request.placeholder }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      runScoped: session.isStreaming,
    });
    this.events.publish(session.sessionId, { type: "dialog.opened", dialog }, this.eventScopeForSession(session));
    this.publishStatus(session);
    return this.dialogWaiters.park(dialog, {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(signal === undefined ? {} : { signal }),
      onTrigger: (reason) => {
        if (this.closeExtensionDialogFromTrigger(session, dialog.dialogId, reason)) this.publishStatus(session);
      },
    });
  }

  /**
   * Close a dialog whose wait ended without the browser (timeout, signal
   * abort, run end, runtime teardown) and settle its parked Promise. Returns
   * whether this call closed the dialog; a stale close means a browser answer
   * or an earlier trigger already settled everything.
   */
  private closeExtensionDialogFromTrigger(session: PiAgentSession, dialogId: string, reason: ExtensionDialogCancelReason): boolean {
    const result = this.pendingExtensionDialogStore.cancel(this.dialogSessionKey(session), dialogId, reason);
    if (result.status !== "closed") return false;
    this.publishDialogClosed(session, result.outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    return true;
  }

  /**
   * Settle the session's run-scoped dialogs as `"aborted"`. Runs at
   * abort-request time (a user abort parks the agent loop behind the dialog
   * handler, so `agent_end` would never arrive on its own) and again from
   * the `agent_end` observer as the run-crash backstop — the store makes the
   * second settlement a stale no-op. Idle-opened dialogs (a `session_start`
   * probe, say) are not run-scoped and survive, because their waiter
   * outlives the run.
   */
  private abortRunScopedExtensionDialogs(session: PiAgentSession): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(this.dialogSessionKey(session))) {
      if (dialog.runScoped) closedAny = this.closeExtensionDialogFromTrigger(session, dialog.dialogId, "aborted") || closedAny;
    }
    if (closedAny) this.publishStatus(session);
  }

  /**
   * Settle every dialog of the session as `"session-ended"`: the runtime
   * whose extension code is parked on them is being closed, replaced, or
   * disposed, so those Promises would otherwise never settle.
   */
  private endSessionExtensionDialogs(session: PiAgentSession): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(this.dialogSessionKey(session))) {
      closedAny = this.closeExtensionDialogFromTrigger(session, dialog.dialogId, "session-ended") || closedAny;
    }
    // Publishes only while the session is still (or already re-)registered as
    // active, so teardown paths stay silent and runtime replacement refreshes.
    if (closedAny) this.publishStatus(session);
  }

  private publishDialogClosed(session: PiAgentSession, outcome: ExtensionDialogOutcome): void {
    this.events.publish(session.sessionId, {
      type: "dialog.closed",
      dialogId: outcome.dialogId,
      reason: outcome.reason,
      ...(outcome.answer === undefined ? {} : { answer: outcome.answer }),
    }, this.eventScopeForSession(session));
  }

  /** Summaries of the tracked subsessions spawned by `parentSessionId`. */
  async listSubsessions(parentSessionId: string, parentSessionFile?: string): Promise<SubsessionSummary[]> {
    const parentFile = nonEmptyString(parentSessionFile);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile);
    const childIds = this.subsessionChildren.get(parentSessionId);
    if (childIds === undefined) return [];
    const authorizedChildIds = [...childIds].filter((childId) => this.subsessionLinkBelongsToParent(parentSessionId, parentFile, childId));
    return Promise.all(authorizedChildIds.map(async (childId) => ({ sessionId: childId, ...(await this.subsessionSummaryFields(childId)) })));
  }

  /** Status and final result of a subsession, scoped to the caller's children. */
  async checkSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<SubsessionCheckResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile);
    const messages = historyMessages(session);
    return {
      sessionId,
      cwd: session.sessionManager.getCwd(),
      status: this.subsessionStatus(session),
      finalText: finalAssistantText(messages),
      messageCount: messages.length,
    };
  }

  /** Filtered, paginated transcript of a subsession, scoped to the caller's children. */
  async readSubsession(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string): Promise<SubsessionReadResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile);
    const view = buildTranscriptView(historyMessages(session), query);
    return {
      sessionId,
      cwd: session.sessionManager.getCwd(),
      status: this.subsessionStatus(session),
      ...view,
    };
  }

  /** Open a session after verifying it is one of the caller's tracked children. */
  private async openSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<PiAgentSession> {
    const parentFile = nonEmptyString(parentSessionFile);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile);
    if (this.subsessionParents.get(sessionId) !== parentSessionId || !this.subsessionLinkBelongsToParent(parentSessionId, parentFile, sessionId)) {
      throw new Error(`Session ${sessionId} is not one of your subsessions`);
    }
    return this.getOrOpenTrackedSubsession(sessionId);
  }

  private subsessionLinkBelongsToParent(parentSessionId: string, parentSessionFile: string | undefined, childSessionId: string): boolean {
    const link = this.subsessionLinks.get(childSessionId);
    if (link?.parentSessionId !== parentSessionId) return false;
    return parentSessionFile === undefined || trackedLinkParentFileMatches(link, parentSessionFile);
  }

  private activeChildForSubsessionLink(link: TrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    return this.activeSessionsForId(link.childSessionId).find((active) => activeSessionFileMatches(active, link.childSessionFile));
  }

  private activeParentForSubsessionLink(link: TrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    return this.activeSessionsForId(link.parentSessionId).find((active) => activeSessionFileMatches(active, link.parentSessionFile));
  }

  private subsessionLinkForActiveChild(session: PiAgentSession): TrackedSubsessionLink | undefined {
    const childId = session.sessionId;
    const parentId = this.subsessionParents.get(childId);
    const link = this.subsessionLinks.get(childId);
    if (parentId === undefined || link?.parentSessionId !== parentId) return undefined;
    return sessionFileMatches(session, link.childSessionFile) ? link : undefined;
  }

  private async registerVerifiedSubsession(link: TrackedSubsessionLink): Promise<void> {
    const { childSessionId, parentSessionId } = link;
    const previousParentId = this.subsessionParents.get(childSessionId);
    if (previousParentId !== undefined && previousParentId !== parentSessionId) {
      const previousChildren = this.subsessionChildren.get(previousParentId);
      previousChildren?.delete(childSessionId);
      if (previousChildren?.size === 0) this.subsessionChildren.delete(previousParentId);
    }

    this.subsessionParents.set(childSessionId, parentSessionId);
    const children = this.subsessionChildren.get(parentSessionId) ?? new Set<string>();
    children.add(childSessionId);
    this.subsessionChildren.set(parentSessionId, children);

    this.subsessionLinks.set(childSessionId, link);
    if (!this.subsessionNotifyArmed.has(childSessionId)) this.subsessionNotifyArmed.set(childSessionId, false);

    const cwd = this.cwdForVerifiedSubsession(link);
    await this.publishUnreadMutations(this.unreadStore.excludeSession(childSessionId, cwd));
  }

  private cwdForVerifiedSubsession(link: TrackedSubsessionLink): string {
    const activeCwd = this.activeChildForSubsessionLink(link)?.runtime.session.sessionManager.getCwd();
    const linkedCwd = nonEmptyString(activeCwd) ?? nonEmptyString(link.cwd);
    if (linkedCwd !== undefined) return canonicalizeStoredCwd(linkedCwd);

    const childSessionFile = link.childSessionFile;
    if (childSessionFile !== undefined) {
      try {
        return canonicalizeStoredCwd(this.sessionManager.open(childSessionFile).getCwd());
      } catch (error: unknown) {
        throw new Error("Could not resolve cwd for verified tracked sub-session", { cause: error });
      }
    }
    throw new Error("Could not resolve cwd for verified tracked sub-session");
  }

  private unregisterSubsession(childSessionId: string): void {
    const parentSessionId = this.subsessionParents.get(childSessionId);
    this.subsessionParents.delete(childSessionId);
    this.subsessionLinks.delete(childSessionId);
    this.subsessionNotifyArmed.delete(childSessionId);
    if (parentSessionId === undefined) return;
    const children = this.subsessionChildren.get(parentSessionId);
    children?.delete(childSessionId);
    if (children?.size === 0) this.subsessionChildren.delete(parentSessionId);
  }

  private persistSubsessionLink(link: TrackedSubsessionLink): void {
    const parent = this.activeParentForSubsessionLink(link)?.runtime.session;
    if (parent === undefined) return;
    if (parent.sessionManager.appendCustomEntry === undefined) return;
    try {
      parent.sessionManager.appendCustomEntry(SUBSESSION_LINK_CUSTOM_TYPE, persistedParentSubsessionLinkData(link));
    } catch (error: unknown) {
      this.logger.info(
        { parentSessionId: link.parentSessionId, sessionId: link.childSessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to persist subsession link",
      );
    }
  }

  private persistSubsessionChildMarker(parentSessionId: string, childSessionId: string): void {
    const child = this.activeForSessionId(childSessionId)?.runtime.session;
    if (child === undefined) return;
    if (child.sessionManager.appendCustomEntry === undefined) return;
    try {
      child.sessionManager.appendCustomEntry(SUBSESSION_CHILD_LINK_CUSTOM_TYPE, persistedChildSubsessionLinkData(parentSessionId, childSessionId));
    } catch (error: unknown) {
      this.logger.info(
        { parentSessionId, sessionId: childSessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to persist subsession child marker",
      );
    }
  }

  private async hydrateSubsessionsForParent(parentSessionId: string, parentSessionFile?: string): Promise<void> {
    const hydrationKey = subsessionHydratedParentKey(parentSessionId, parentSessionFile);
    if (this.subsessionHydratedParents.has(hydrationKey)) return;

    const activeParent = this.activeForSessionId(parentSessionId);
    if (activeParent !== undefined && (parentSessionFile === undefined || activeSessionFileMatches(activeParent, parentSessionFile))) {
      const activeParentFile = nonEmptyString(activeParent.runtime.session.sessionFile);
      const complete = await this.registerPersistedSubsessionLinks(
        parentSessionId,
        activeParent.runtime.session.sessionManager,
        activeParentFile,
      );
      if (complete) this.subsessionHydratedParents.add(hydrationKey);
      return;
    }

    if (parentSessionFile === undefined) return;
    if ((await readSessionHeaderSummary(parentSessionFile))?.id !== parentSessionId) return;

    let parentManager: PiSessionManager;
    try {
      parentManager = this.sessionManager.open(parentSessionFile);
    } catch {
      return;
    }
    const complete = await this.registerPersistedSubsessionLinks(parentSessionId, parentManager, parentSessionFile);
    if (complete) this.subsessionHydratedParents.add(hydrationKey);
  }

  private async registerPersistedSubsessionLinks(parentSessionId: string, parentManager: PiSessionManager, parentSessionFile: string | undefined): Promise<boolean> {
    // Parent custom links are the authoritative recovery record: verify the
    // exact live child file/header before tracking. Do not negatively cache a
    // scan while a candidate child is temporarily unavailable.
    const entries = parentManager.getEntries?.() ?? parentManager.getBranch();
    let complete = true;
    for (const entry of entries) {
      const link = parsePersistedParentSubsessionLink(entry);
      if (link?.spawnedBySessionId !== parentSessionId) continue;
      const verified = await this.verifiedSubsessionLinkFromParentLink(parentSessionId, parentSessionFile, link);
      if (verified === undefined) {
        complete = false;
        continue;
      }
      await this.registerVerifiedSubsession(verified);
    }
    return complete;
  }

  private async verifiedSubsessionLinkFromParentLink(parentSessionId: string, parentSessionFile: string | undefined, link: PersistedParentSubsessionLink): Promise<TrackedSubsessionLink | undefined> {
    if (parentSessionFile === undefined) return undefined;
    if (link.spawnedBySessionId !== parentSessionId) return undefined;
    if (!(await this.parentLinkHasValidChildTarget(parentSessionFile, link))) return undefined;
    return trackedSubsessionLinkFromParentLink(parentSessionId, link, parentSessionFile);
  }

  private async parentLinkHasValidChildTarget(parentSessionFile: string, link: PersistedParentSubsessionLink): Promise<boolean> {
    return link.spawnedSessionFile !== undefined
      && await sessionFileHeaderMatches(link.spawnedSessionFile, { sessionId: link.spawnedSessionId, parentSessionFile });
  }

  private async recoverSubsessionTrackingForOpenedSession(session: PiAgentSession): Promise<void> {
    const link = await this.verifiedSubsessionLinkFromOpenedChild(session);
    if (link === undefined) return;
    await this.registerVerifiedSubsession(link);
  }

  private verifiedSubsessionLinkFromOpenedChild(session: PiAgentSession): Promise<TrackedSubsessionLink | undefined> {
    return verifiedTrackedSubsessionLink(this.sessionManager, {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionManager: session.sessionManager,
      cwd: session.sessionManager.getCwd(),
    });
  }

  private async getOrOpenTrackedSubsession(sessionId: string): Promise<PiAgentSession> {
    const link = this.subsessionLinks.get(sessionId);
    if (link === undefined) throw new Error("Session not found");

    const active = this.activeChildForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    if (link.childSessionFile !== undefined) {
      if (!(await sessionFileHeaderMatches(link.childSessionFile, { sessionId, parentSessionFile: link.parentSessionFile }))) throw new Error("Session not found");
      const sessionManager = this.sessionManager.open(link.childSessionFile);
      return (await this.create(sessionManager, link.cwd ?? sessionManager.getCwd())).runtime.session;
    }

    throw new Error("Session not found");
  }

  private async subsessionSummaryFields(childSessionId: string): Promise<{ cwd: string; status: SubsessionStatus }> {
    const link = this.subsessionLinks.get(childSessionId);
    const active = link === undefined ? undefined : this.activeChildForSubsessionLink(link);
    if (active !== undefined) {
      return { cwd: active.runtime.cwd, status: this.subsessionStatus(active.runtime.session) };
    }
    if (link?.childSessionFile !== undefined && (await sessionFileHeaderMatches(link.childSessionFile, { sessionId: childSessionId, parentSessionFile: link.parentSessionFile }))) {
      return { cwd: link.cwd ?? "", status: "idle" };
    }
    if (link?.cwd !== undefined) return { cwd: link.cwd, status: "unknown" };
    return { cwd: "", status: "unknown" };
  }

  private subsessionStatus(session: PiAgentSession): SubsessionStatus {
    if (this.hasActiveWork(session)) return "working";
    if (this.activityForSession(session)?.phase === "error") return "error";
    return "idle";
  }

  private workingSubsessionIds(parentSessionId: string): string[] {
    const childIds = this.subsessionChildren.get(parentSessionId);
    if (childIds === undefined) return [];
    return [...childIds].filter((childId) => {
      const link = this.subsessionLinks.get(childId);
      const active = link === undefined ? undefined : this.activeChildForSubsessionLink(link);
      return active !== undefined && this.hasActiveWork(active.runtime.session);
    });
  }

  /**
   * Drive parent notifications from a tracked child's status. Arms a pending
   * notification while the child is working, and when it stops fires a single
   * follow-up message to the parent via {@link prompt} (which queues if the
   * parent is busy and delivers immediately when it is idle).
   */
  private updateSubsessionTracking(session: PiAgentSession): void {
    const link = this.subsessionLinkForActiveChild(session);
    if (link === undefined) return;
    const childId = link.childSessionId;
    if (this.hasActiveWork(session)) {
      this.subsessionNotifyArmed.set(childId, true);
      return;
    }
    if (this.subsessionNotifyArmed.get(childId) !== true) return;
    this.subsessionNotifyArmed.set(childId, false);
    const status: SubsessionStatus = this.activityForSession(session)?.phase === "error" ? "error" : "idle";
    const finalText = finalAssistantText(historyMessages(session));
    const outputSection = formatSubsessionNotificationOutput(childId, finalText);
    const workingIds = this.workingSubsessionIds(link.parentSessionId);
    const next = workingIds.length === 0
      ? "No other tracked subsessions are working."
      : `Still working: ${workingIds.join(", ")}. Continue working, or call yield_to_subsessions alone and last at the next join point. Further completion notices arrive automatically; do not poll.`;
    const text = `Subsession ${childId} stopped working (${status}).\n${next}\n\n${outputSection}`;
    void this.notifyParentOfSubsession(link.parentSessionId, childId, text);
  }

  private async getOrOpenParentForSubsession(parentSessionId: string, childSessionId: string): Promise<PiAgentSession> {
    const link = this.subsessionLinks.get(childSessionId);
    if (link?.parentSessionId !== parentSessionId) throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);

    const active = this.activeParentForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    const parentSessionFile = link.parentSessionFile;
    if (parentSessionFile === undefined) throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);
    if ((await readSessionHeaderSummary(parentSessionFile))?.id !== parentSessionId) {
      throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);
    }
    const sessionManager = this.sessionManager.open(parentSessionFile);
    return (await this.create(sessionManager, sessionManager.getCwd())).runtime.session;
  }

  /**
   * Deliver a subsession-completion notice to the parent as a system-authored
   * custom message rather than a user message, so it is not attributed to the
   * human in the transcript. It still wakes an idle parent (`triggerTurn`) and
   * queues behind in-flight work (`deliverAs: "followUp"`), preserving the
   * established "queue if busy, send and act if idle" behavior.
   */
  private async notifyParentOfSubsession(parentId: string, childId: string, text: string): Promise<void> {
    try {
      const session = await this.getOrOpenParentForSubsession(parentId, childId);
      if (this.treeNavigations.has(session)) {
        const pending = this.deferredSubsessionNotifications.get(session) ?? [];
        pending.push({ parentId, childId, text });
        this.deferredSubsessionNotifications.set(session, pending);
        return;
      }
      await this.deliverSubsessionNotification(session, { parentId, childId, text });
    } catch (error: unknown) {
      this.logSubsessionNotificationFailure(parentId, childId, error);
    }
  }

  async messages(ref: PiSessionLookup, page?: { before?: number; limit?: number }, managementContext?: ManagementEmbedContext): Promise<unknown[] | ClientMessagePage> {
    const session = await this.getOrOpen(ref, managementContext);
    return pageMessagesAtSafeBoundary(historyMessages(session), page);
  }

  async status(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    return this.statusFromSession(await this.sessionForStatusOrDialogClose(ref, managementContext));
  }

  private async searchCandidates(cwd: string, normalizedQuery: string, managementContext?: ManagementEmbedContext): Promise<{ listing: WorkspaceSessionListing; sessions: ClientSession[] }> {
    const listing = await this.listWorkspaceSessions(cwd, managementContext);
    const matches = await Promise.all(listing.sessions.map(async (session) => {
      const entry = listing.entriesById.get(session.id);
      const archived = listing.archivedById.get(session.id);
      const archivedText = archived?.archivePath === undefined ? "" : await readArchivedSessionText(archived.archivePath);
      const haystack = [session.id, session.name ?? "", session.firstMessage, entry?.allMessagesText ?? "", archivedText].join("\n").toLocaleLowerCase();
      return haystack.includes(normalizedQuery) ? session : undefined;
    }));
    return { listing, sessions: matches.filter(isDefined) };
  }

  private searchableSessionHistory(session: ClientSession, listing: WorkspaceSessionListing, managementContext?: ManagementEmbedContext): unknown[] {
    const eventScope = eventScopeFromManagementContext(managementContext);
    const active = this.activeForSessionIdAndScope(session.id, eventScope);
    if (active !== undefined && cwdPathsEqual(active.runtime.cwd, session.cwd)) return historyMessages(active.runtime.session);
    const path = listing.archivedById.get(session.id)?.archivePath ?? listing.entriesById.get(session.id)?.path;
    return path === undefined ? [] : historyMessagesFromManager(this.sessionManager.open(path));
  }

  async streamSnapshot(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<SessionStreamSnapshot> {
    const session = await this.getOrOpen(ref, managementContext);
    const eventScope = this.eventScopeForSession(session);
    const seq = this.events.currentSeq(session.sessionId, eventScope);
    const streamingMessage = session.state.streamingMessage;
    const partial = streamingMessage === undefined || streamingMessage === null
      ? null
      : projectBrowserMessage(streamingMessage);
    return { seq, partial };
  }

  async availableModels(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionModel[]> {
    const session = await this.getOrOpen(ref, managementContext);
    const models = await this.sessionModelCandidates(session);
    return models.map(modelToClientModel);
  }

  async setModel(ref: PiSessionLookup, provider: string, modelId: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.assertTreeNavigationInactive(session, "change models");
    const candidates = await this.sessionModelCandidates(session);
    this.assertTreeNavigationInactive(session, "change models");
    const model = candidates.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      ?? session.modelRuntime.getModel(provider, modelId);
    if (model === undefined) throw new Error(`未找到模型：${provider}/${modelId}`);
    await this.runSessionEntryMutation(session, "change models", () => session.setModel(model));
    this.publishActivity(session, `模型：${model.id}`, "idle", model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleModel(ref: PiSessionLookup, direction: "forward" | "backward", managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    const result = await this.runSessionEntryMutation(session, "change models", () => session.cycleModel(direction));
    if (result === undefined) throw new Error(session.scopedModels.length > 0 ? "作用域内只有一个模型" : "只有一个可用模型");
    this.publishActivity(session, `模型：${result.model.id}`, "idle", result.model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async availableThinkingLevels(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientThinkingLevel[]> {
    const session = await this.getOrOpen(ref, managementContext);
    return session.getAvailableThinkingLevels();
  }

  async setThinkingLevel(ref: PiSessionLookup, level: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.assertTreeNavigationInactive(session, "change the thinking level");
    // pi owns the valid set; validate against the session's live levels rather
    // than a hardcoded union so this stays correct if pi changes the set.
    const available = session.getAvailableThinkingLevels();
    const match = available.find((candidate) => candidate === level);
    if (match === undefined) throw new Error(`无效的思考级别：${level}`);
    await this.runSessionEntryMutation(session, "change the thinking level", () => {
      session.setThinkingLevel(match);
      return Promise.resolve();
    });
    this.publishActivity(session, `思考级别：${session.thinkingLevel}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleThinkingLevel(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    const level = await this.runSessionEntryMutation(session, "change the thinking level", () => Promise.resolve(session.cycleThinkingLevel()));
    if (level === undefined) throw new Error("当前模型不支持思考");
    this.publishActivity(session, `思考级别：${level}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async commands(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(ref, managementContext);
    const commands: ClientCommand[] = [...BUILTIN_COMMANDS];
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: command.invocationName, ...(command.description === undefined ? {} : { description: command.description }), source: "extension" });
    }
    for (const template of session.promptTemplates) {
      commands.push({ name: template.name, ...(template.description === undefined ? {} : { description: template.description }), source: "prompt" });
    }
    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${skill.name}`, ...(skill.description === undefined ? {} : { description: skill.description }), source: "skill" });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async prompt(ref: PiSessionLookup, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: { echoUserMessage?: boolean; managementContext?: ManagementEmbedContext | undefined }): Promise<void> {
    const promptText = requirePromptText(text);
    // Command-forwarded prompts (e.g. /skill:*) are expanded by the agent, which
    // streams the canonical message back. The client doesn't render the raw
    // command text, so the server must not echo it either, or it would show up
    // as a transient line that vanishes on reload.
    const echoUserMessage = options?.echoUserMessage !== false;
    const requestedBehavior = parsePromptStreamingBehavior(streamingBehavior);
    const parsedAttachments = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false });
    const images = (await attachmentsToInlineImages(parsedAttachments)).map((entry) => entry.image);
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, options?.managementContext);
    this.assertTreeNavigationInactive(session, "send a prompt");
    this.maybeGenerateSessionName(session, promptText);
    const isQueued = session.isStreaming || session.isCompacting;
    const behavior = isQueued ? requestedBehavior ?? "followUp" : undefined;
    if (isQueued && images.length === 0 && this.hasQueuedMessageText(session, promptText)) {
      this.publishActivity(session, "已忽略重复的排队消息", "active");
      this.publishStatus(session);
      return;
    }
    // A chat message answers the session's open ask in the user's own words, so
    // the form is void: keeping it open would invite answers to questions the
    // conversation has already moved past. Ignored duplicates skip this on
    // purpose: they must not void an ask posted after the queued original.
    await this.voidOpenAskForUserMessage(session);
    if (session.isCompacting) {
      this.enqueuePromptDuringCompaction(session, promptText, behavior ?? "followUp", images, echoUserMessage);
      return;
    }
    void this.submitPrompt(session, promptText, behavior, images, echoUserMessage);
  }

  private submitPrompt(session: PiAgentSession, text: string, behavior: QueuedPromptKind | undefined, images: ImageContent[] = [], echoUserMessage = true): Promise<void> {
    this.publishActivity(session, behavior === "steer" ? "插队消息已排队" : behavior === "followUp" ? "消息已排队" : "消息已接收", "active");
    const eventScope = this.eventScopeForSession(session);
    if (behavior === undefined && echoUserMessage) this.events.publish(session.sessionId, { type: "message.append", message: userMessage(text, images) }, eventScope);
    const promptOptions = buildPromptOptions(behavior, images);
    const promptPromise = this.runSessionEntryMutation(session, "send a prompt", () => session.prompt(text, promptOptions)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(session, "发生错误", "error", message);
      this.events.publish(session.sessionId, { type: "session.error", message }, eventScope);
    });
    void promptPromise;
    return promptPromise;
  }

  private enqueuePromptDuringCompaction(session: PiAgentSession, text: string, kind: QueuedPromptKind, images: ImageContent[] = [], echoUserMessage = true): void {
    const queue = this.compactionPromptQueues.get(session.sessionId) ?? [];
    queue.push({ kind, text, ...(images.length > 0 ? { images } : {}), ...(echoUserMessage ? {} : { echoUserMessage: false }) });
    this.compactionPromptQueues.set(session.sessionId, queue);
    this.publishActivity(session, "压缩期间消息已排队", "active");
    this.publishStatus(session);
  }

  async saveAttachments(ref: PiSessionLookup, attachments: unknown, folder?: string, managementContext?: ManagementEmbedContext): Promise<SavedPromptAttachment[]> {
    const parsed = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false, allowFileAttachments: true });
    if (parsed.length === 0) return [];
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    return saveAttachmentsToWorkspace(active.runtime.cwd, parsed, folder === undefined ? {} : { folder });
  }

  async shell(ref: PiSessionLookup, text: string, managementContext?: ManagementEmbedContext): Promise<void> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    const { session } = active.runtime;
    this.assertTreeNavigationInactive(session, "run a shell command");
    const isExcluded = text.startsWith("!!");
    const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
    if (!command) throw new Error("用法：!<shell command>");
    if (session.isBashRunning) throw new Error("已有 bash 命令正在运行");

    const eventScope = active.eventScope;
    this.publishActivity(session, "正在运行命令", "active", command);
    this.events.publish(session.sessionId, { type: "shell.start", command, excludeFromContext: isExcluded }, eventScope);
    void this.runSessionEntryMutation(session, "run a shell command", () => session.executeBash(command, (chunk) => {
      this.events.publish(session.sessionId, { type: "shell.chunk", chunk }, eventScope);
      this.publishActivity(session, "正在运行命令", "active", command);
      this.publishStatus(session);
    }, { excludeFromContext: isExcluded })).then((result) => {
      this.events.publish(session.sessionId, {
        type: "shell.end",
        output: result.output,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        cancelled: result.cancelled,
        truncated: result.truncated,
        ...(result.fullOutputPath === undefined ? {} : { fullOutputPath: result.fullOutputPath }),
      }, eventScope);
      this.publishActivity(session, "命令执行完成", result.exitCode === 0 ? "idle" : "error", command);
      this.publishStatus(session);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.events.publish(session.sessionId, { type: "shell.end", output: message, isError: true }, eventScope);
      this.events.publish(session.sessionId, { type: "session.error", message }, eventScope);
      this.publishActivity(session, "命令执行失败", "error", message);
      this.publishStatus(session);
    });
  }

  async runCommand(ref: PiSessionLookup, text: string, managementContext?: ManagementEmbedContext): Promise<ClientCommandResult> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    return this.commandService.run(active.runtime.session.sessionId, text, active.eventScope);
  }

  async respondToCommand(ref: PiSessionLookup, requestId: string, value: string, managementContext?: ManagementEmbedContext): Promise<ClientCommandResult> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    return this.commandService.respond(active.runtime.session.sessionId, requestId, value, active.eventScope);
  }

  async navigateTree(ref: PiSessionLookup, request: ClientSessionTreeNavigateRequest, managementContext?: ManagementEmbedContext): Promise<ClientSessionTreeNavigateResult> {
    if (request.targetId.trim() === "") throw new Error("Session tree target is required");
    if (this.isTreeExclusiveSessionIdentityActive(sessionIdFromLookup(ref))) {
      throw new Error("Stop current session activity before navigating the session tree");
    }
    await this.assertWritable(ref);
    const options = sessionTreeNavigationOptions(request);
    const session = await this.getOrOpen(ref, managementContext);
    if (typeof session.navigateTree !== "function") throw new Error("Session tree navigation is not supported by this Pi runtime");
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before navigating the session tree");

    // Acquire synchronously after the active-work check. No leaf-producing work
    // may enter this runtime until Pi's potentially asynchronous summary settles.
    this.treeNavigations.add(session);
    try {
      if (session.sessionManager.getLeafId() !== request.expectedLeafId) {
        throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
      }

      this.publishActivity(session, options.summarize ? "正在汇总分支" : "正在切换会话树", "active");
      this.publishStatus(session);
      const result = await session.navigateTree(request.targetId, options);
      if (result.cancelled) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, result.aborted === true ? "分支汇总已终止" : "会话树切换已取消", "idle");
        }
        return { cancelled: true, ...(result.aborted === undefined ? {} : { aborted: result.aborted }) };
      }

      if (this.isCurrentActiveSession(session)) this.publishActivity(session, "已切换会话树", "idle");
      return { cancelled: false, ...(result.editorText === undefined ? {} : { editorText: result.editorText }) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(session, "重新加载失败", "error", message);
      this.events.publish(session.sessionId, { type: "session.error", message }, this.eventScopeForSession(session));
      this.publishStatus(session);
      throw error;
    } finally {
      this.treeNavigations.delete(session);
      if (this.isCurrentActiveSession(session)) {
        this.flushDeferredTreeNavigationWork(session);
        this.publishStatus(session);
      } else {
        this.deferredGeneratedSessionNames.delete(session);
        this.deferredSubsessionNotifications.delete(session);
      }
    }
  }

  async archive(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const active = await this.getActive(ref, managementContext);
    const session = active.runtime.session;
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session, runtime: active.runtime }],
      "归档前请先停止当前会话活动",
      async () => {
        const archiveInput = await this.archiveInputForSession(session);
        await this.closeActiveSession(active);
        await this.archiveStore.archive(archiveInput);
        await this.forgetUnreadSessions([archiveInput]);
      },
    );
  }

  async archiveMany(refs: readonly SessionBulkMutationRef[], managementContext?: ManagementEmbedContext): Promise<SessionBulkArchiveResponse> {
    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const [archivedRecords, sessionContext] = await Promise.all([
      this.archiveStore.list(),
      this.bulkSessionLookupContext(uniqueRefs),
    ]);
    const failures: SessionBulkFailure[] = [];
    const alreadyArchivedSessionIds: string[] = [];
    const unreadArchivedIdentities: { sessionId: string; cwd: string }[] = [];
    const planItems: BulkArchivePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const archived = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (archived !== undefined) {
        this.publishNotificationMutations(this.notificationStore.clearSession(archived.sessionId, "archive"));
        alreadyArchivedSessionIds.push(archived.sessionId);
        unreadArchivedIdentities.push(archived);
        continue;
      }

      const active = this.activeForLookup(bulkRefToLookup(ref), managementContext);
      const listed = findListedSessionForBulkRef(sessionContext, ref);
      const resolvedSessionId = active?.runtime.session.sessionId ?? listed?.id ?? ref.id;
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: resolvedSessionId, error: "Stop current session activity before archiving" });
        continue;
      }

      try {
        if (listed !== undefined) {
          planItems.push({ input: archiveInputFromListEntry(listed), ...(active === undefined ? {} : { active }) });
        } else if (active !== undefined) {
          planItems.push({ input: archiveInputFromActiveSession(active.runtime.session), active });
        } else {
          failures.push({ sessionId: ref.id, error: "Session not found" });
        }
      } catch (error: unknown) {
        failures.push({ sessionId: resolvedSessionId, error: errorMessage(error) });
      }
    }

    const readyPlanItems: { input: ArchiveSessionInput; active?: ManagedActiveSession }[] = [];
    for (const item of planItems) {
      const active = item.active ?? this.activeForLookup(bulkRefToLookup({ id: item.input.sessionId, cwd: item.input.cwd }), managementContext);
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: item.input.sessionId, error: "Stop current session activity before archiving" });
        continue;
      }
      readyPlanItems.push(active === undefined ? item : { ...item, active });
    }

    const readyInputs: ArchiveSessionInput[] = [];
    const archivedSessionIds = [...alreadyArchivedSessionIds];
    await this.runTreeExclusiveOperation(
      readyPlanItems.map(({ input, active }) => ({
        sessionId: input.sessionId,
        ...(active === undefined ? {} : { session: active.runtime.session, runtime: active.runtime }),
      })),
      "Stop current session activity before archiving",
      async () => {
        for (const item of readyPlanItems) {
          try {
            if (item.active !== undefined) await this.closeActiveSession(item.active);
            else await this.closeActiveInScope(item.input.sessionId, eventScopeFromManagementContext(managementContext));
            readyInputs.push(item.input);
          } catch (error: unknown) {
            failures.push({ sessionId: item.input.sessionId, error: errorMessage(error) });
          }
        }

        try {
          const archived = await this.archiveStoreArchiveMany(readyInputs);
          archivedSessionIds.push(...archived.map((record) => record.sessionId));
          unreadArchivedIdentities.push(...archived);
        } catch (error: unknown) {
          for (const input of readyInputs) failures.push({ sessionId: input.sessionId, error: errorMessage(error) });
        }
      },
    );
    await this.forgetUnreadSessions(unreadArchivedIdentities);

    return {
      archived: true,
      archivedSessionIds: uniqueStrings(archivedSessionIds),
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async archiveTree(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientArchiveSessionsResponse> {
    const session = await this.getOrOpen(ref, managementContext);
    const catalog = await this.workspaceArchiveCandidates(session.sessionManager.getCwd());
    const root = findArchiveCandidateByIdOrPrefix(catalog, session.sessionId) ?? archiveCandidateFromActiveSession(session, false);
    const plan = planSessionArchiveTree(root, catalog);
    const busy = plan.targets.map((target) => target.activeSession).find((target) => target !== undefined && this.hasActiveWork(target));
    if (busy !== undefined) throw new Error(`归档 ${sessionDisplayName(busy)} 前请先停止当前会话活动`);

    const archiveInputs = plan.unarchivedTargets.map((target) => archiveInputFromCandidate(target));
    await this.runTreeExclusiveOperation(
      plan.unarchivedTargets.map((target) => ({
        sessionId: target.id,
        ...(target.activeSession === undefined ? {} : { session: target.activeSession }),
      })),
      `归档 ${sessionDisplayName(session)} 前请先停止当前会话活动`,
      async () => {
        for (const target of plan.targets) {
          if (target.archived) this.publishNotificationMutations(this.notificationStore.clearSession(target.id, "archive"));
        }
        for (const input of archiveInputs) await this.closeActiveInScope(input.sessionId, eventScopeFromManagementContext(managementContext));
        await this.archiveStoreArchiveMany(archiveInputs);
      },
    );
    await this.forgetUnreadSessions(plan.targets.map((target) => ({ sessionId: target.id, cwd: target.cwd })));

    return {
      archived: true,
      sessionIds: archiveInputs.map((input) => input.sessionId),
      archivedCount: archiveInputs.length,
      skippedAlreadyArchivedCount: plan.skippedAlreadyArchivedCount,
    };
  }

  async restore(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const archived = await this.getArchived(ref);
    if (archived === undefined) throw new Error("未找到会话");
    await this.closeActiveInScope(archived.sessionId, eventScopeFromManagementContext(managementContext));
    await this.archiveStore.restore(archived.sessionId);
    await this.forgetUnreadSessions([archived]);
  }

  async deleteArchived(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const record = await this.getArchived(ref);
    if (record === undefined) throw new Error("未找到已归档会话");
    if (this.archiveStore.deleteArchived === undefined) throw new Error("归档存储不支持删除");

    await this.closeActiveInScope(record.sessionId, eventScopeFromManagementContext(managementContext));
    if (record.archivePath === undefined) await this.ensureArchivedRecordMoved(record);
    await this.archiveStore.deleteArchived(record.sessionId);
    await this.forgetUnreadSessions([record]);
  }

  async deleteArchivedMany(refs: readonly SessionBulkMutationRef[], managementContext?: ManagementEmbedContext): Promise<SessionBulkDeleteArchivedResponse> {
    if (this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const archivedRecords = await this.archiveStore.list();
    const failures: SessionBulkFailure[] = [];
    const planItems: BulkDeletePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const record = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (record === undefined) {
        failures.push({ sessionId: ref.id, error: "Archived session not found" });
        continue;
      }

      const active = this.activeForLookup({ id: record.sessionId, cwd: record.cwd }, managementContext);
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: record.sessionId, error: "Stop current session activity before deleting archived session" });
        continue;
      }
      planItems.push({ record });
    }

    const readyRecords: ArchivedSessionRecord[] = [];
    for (const item of planItems) {
      try {
        await this.closeActiveInScope(item.record.sessionId, eventScopeFromManagementContext(managementContext));
        readyRecords.push(item.record);
      } catch (error: unknown) {
        failures.push({ sessionId: item.record.sessionId, error: errorMessage(error) });
      }
    }

    const moveFailures = await this.moveLegacyArchivedRecordsForDelete(readyRecords);
    failures.push(...moveFailures);
    const moveFailureIds = new Set(moveFailures.map((failure) => failure.sessionId));
    const deleteIds = readyRecords
      .map((record) => record.sessionId)
      .filter((sessionId) => !moveFailureIds.has(sessionId));

    let deletedSessionIds: string[] = [];
    try {
      deletedSessionIds = await this.archiveStoreDeleteArchivedMany(deleteIds);
    } catch (error: unknown) {
      for (const sessionId of deleteIds) failures.push({ sessionId, error: errorMessage(error) });
    }
    const deletedIdSet = new Set(deletedSessionIds);
    await this.forgetUnreadSessions(readyRecords.filter((record) => deletedIdSet.has(record.sessionId)));

    return {
      deleted: true,
      deletedSessionIds,
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async reload(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    const session = active.runtime.session;
    if (this.hasActiveWork(session)) throw new Error("重新加载前请先停止当前会话活动");
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("会话尚未持久化");
    const reopenedSession = await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session, runtime: active.runtime }],
      "重新加载前请先停止当前会话活动",
      async () => {
        const priorGeneration = this.notificationGenerationBySession.get(session);
        const { sessionId, cwd } = notificationIdentityForSession(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.closeActiveSession(
            active,
            priorGeneration === undefined ? CLEAR_RUNTIME_NOTIFICATIONS : DEFER_RUNTIME_NOTIFICATIONS,
          );
          candidateGeneration = priorGeneration === undefined
            ? undefined
            : this.notificationStore.beginReplacement(priorGeneration, { sessionId, cwd });
          const reopened = await this.openExistingSession(
            sessionId,
            cwd,
            () => this.sessionManager.open(sessionFile),
            {
              ...(managementContext === undefined ? {} : { managementContext }),
              ...(candidateGeneration === undefined ? {} : { notificationGeneration: candidateGeneration }),
            },
          );
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          return reopened.runtime.session;
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration));
          }
          throw error;
        }
      },
    );
    this.publishStatus(reopenedSession);
  }

  async detachParent(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const session = await this.getOrOpen(ref, managementContext);
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("会话尚未持久化");
    await clearParentSession(sessionFile);
    clearParentSessionHeader(session.sessionManager);
    this.unregisterSubsession(session.sessionId);
    await this.forgetUnreadSessions([{ sessionId: session.sessionId, cwd: session.sessionManager.getCwd() }]);
  }

  async abort(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const active = this.activeForLookup(ref, managementContext);
    if (active === undefined) return;
    const sessionId = active.runtime.session.sessionId;
    this.clearCompactionPromptQueue(sessionId);
    clearSessionQueue(active.runtime.session);
    this.abortRunScopedExtensionDialogs(active.runtime.session);
    try {
      await this.abortSessionOperations(active.runtime.session);
      this.publishActivity(active.runtime.session, "已停止", "idle");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(active.runtime.session, "停止失败", "error", message);
      throw error;
    } finally {
      this.publishStatus(active.runtime.session);
    }
  }

  async clearQueue(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.clearCompactionPromptQueue(session.sessionId);
    clearSessionQueue(session);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async stop(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    let active = this.activeForLookup(ref, managementContext);
    if (active === undefined) {
      const startup = this.startupSessionForLookup(ref, managementContext);
      if (startup !== undefined) {
        this.endSessionExtensionDialogs(startup);
        const pendingOpens = this.pendingSessionOpenPromises(startup.sessionId);
        if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
        active = this.activeForLookup(ref, managementContext);
      }
    }
    if (active !== undefined) {
      await this.closeActiveSession(active);
      return;
    }
    if (isPiSessionRef(ref)) {
      this.publishNotificationMutations(this.notificationStore.clearSessionIdentity(ref.id, canonicalizeStoredCwd(ref.cwd), "runtime-close"));
    }
  }

  private async bulkSessionLookupContext(refs: readonly SessionBulkMutationRef[]): Promise<BulkSessionLookupContext> {
    const cwdSet = new Set<string>();
    let needsAllSessions = false;
    for (const ref of refs) {
      if (ref.cwd === undefined) needsAllSessions = true;
      else cwdSet.add(ref.cwd);
    }

    const [sessionsByCwd, allSessions] = await Promise.all([
      this.listSessionsByCwd([...cwdSet]),
      needsAllSessions ? this.sessionManager.listAll?.() ?? Promise.resolve([]) : Promise.resolve(undefined),
    ]);
    return allSessions === undefined ? { sessionsByCwd } : { sessionsByCwd, allSessions };
  }

  private async listSessionsByCwd(cwds: readonly string[]): Promise<Map<string, PiSessionListEntry[]>> {
    const uniqueCwds = uniqueStrings(cwds);
    const entries = await Promise.all(uniqueCwds.map(async (cwd) => [cwd, await this.sessionManager.list(cwd)] as const));
    return new Map(entries);
  }

  private async archiveStoreArchiveMany(inputs: readonly ArchiveSessionInput[]): Promise<ArchivedSessionRecord[]> {
    if (inputs.length === 0) return [];
    if (this.archiveStore.archiveMany !== undefined) return this.archiveStore.archiveMany(inputs);
    const records: ArchivedSessionRecord[] = [];
    for (const input of inputs) records.push(await this.archiveStore.archive(input));
    return records;
  }

  private async archiveStoreDeleteArchivedMany(sessionIds: readonly string[]): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    if (this.archiveStore.deleteArchivedMany !== undefined) return this.archiveStore.deleteArchivedMany(sessionIds);
    if (this.archiveStore.deleteArchived === undefined) throw new Error("Archive store does not support deletion");
    for (const sessionId of sessionIds) await this.archiveStore.deleteArchived(sessionId);
    return [...sessionIds];
  }

  private async moveLegacyArchivedRecordsForDelete(records: readonly ArchivedSessionRecord[]): Promise<SessionBulkFailure[]> {
    const legacyRecords = records.filter((record) => record.archivePath === undefined);
    if (legacyRecords.length === 0) return [];

    let sessionsByCwd: Map<string, PiSessionListEntry[]>;
    try {
      sessionsByCwd = await this.listSessionsByCwd(legacyRecords.map((record) => record.cwd));
    } catch (error: unknown) {
      return legacyRecords.map((record) => ({ sessionId: record.sessionId, error: errorMessage(error) }));
    }

    const moveInputs = legacyRecords
      .map((record) => findSessionByIdOrPrefix(sessionsByCwd.get(record.cwd) ?? [], record.sessionId))
      .filter(isDefined)
      .map(archiveInputFromListEntry);
    if (moveInputs.length === 0) return [];

    try {
      await this.archiveStoreArchiveMany(moveInputs);
      return [];
    } catch (error: unknown) {
      const failedIds = new Set(moveInputs.map((input) => input.sessionId));
      return legacyRecords
        .filter((record) => failedIds.has(record.sessionId))
        .map((record) => ({ sessionId: record.sessionId, error: errorMessage(error) }));
    }
  }

  private async cleanupPlan(request: NormalizedSessionCleanupRequest) {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.listAll?.() ?? [], this.archiveStore.list()]);
    return planSessionCleanup({
      sessions,
      archivedRecords,
      activeSessions: this.cleanupActiveSessionStatuses(),
      thresholds: request.thresholds,
      ...(request.projectCwds === undefined ? {} : { projectCwds: request.projectCwds }),
      now: this.now(),
    });
  }

  private cleanupActiveSessionStatuses(): { sessionId: string; hasActiveWork: boolean }[] {
    return [...new Set(this.active.values())].map((active) => ({
      sessionId: active.runtime.session.sessionId,
      hasActiveWork: this.hasActiveWork(active.runtime.session),
    }));
  }

  private activeSessionHasWork(sessionId: string): boolean {
    return this.activeSessionsForId(sessionId).some((active) => this.hasActiveWork(active.runtime.session));
  }

  private reconcilableSessionIds(cwd: string, listedSessionIds: string[], archivedById: Map<string, ArchivedSessionRecord>): string[] {
    const sessionIds = new Set(listedSessionIds);
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd && !archivedById.has(session.sessionId)) sessionIds.add(session.sessionId);
    }
    return [...sessionIds];
  }

  private async ensureArchivedSessionMoved(record: ArchivedSessionRecord, session: PiSessionListEntry | undefined): Promise<ArchivedSessionRecord> {
    if (session === undefined || this.activeSessionsForId(record.sessionId).length > 0) return record;
    try {
      return await this.archiveStore.archive(archiveInputFromListEntry(session));
    } catch {
      return record;
    }
  }

  private async ensureArchivedRecordMoved(record: ArchivedSessionRecord): Promise<ArchivedSessionRecord> {
    const session = (await this.sessionManager.list(record.cwd)).find((candidate) => candidate.id === record.sessionId);
    if (session === undefined) return record;
    const [moved] = await this.archiveStoreArchiveMany([archiveInputFromListEntry(session)]);
    return moved ?? record;
  }

  private async ensureArchivedRecordsMoved(records: readonly ArchivedSessionRecord[]): Promise<void> {
    const legacyRecords = records.filter((record) => record.archivePath === undefined);
    if (legacyRecords.length === 0) return;

    const sessionsByCwd = await this.listSessionsByCwd(legacyRecords.map((record) => record.cwd));
    const moveInputs = legacyRecords
      .map((record) => sessionsByCwd.get(record.cwd)?.find((candidate) => candidate.id === record.sessionId))
      .filter(isDefined)
      .map(archiveInputFromListEntry);
    await this.archiveStoreArchiveMany(moveInputs);
  }

  private async archiveInputForSession(session: PiAgentSession): Promise<ArchiveSessionInput> {
    const cwd = session.sessionManager.getCwd();
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("会话尚未持久化");
    const listed = (await this.sessionManager.list(cwd)).find((candidate) => candidate.id === session.sessionId);
    if (listed !== undefined) return archiveInputFromListEntry(listed);
    return archiveInputFromActiveSession(session);
  }

  private async workspaceArchiveCandidates(cwd: string): Promise<WorkspaceArchiveCandidate[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const candidates = new Map<string, WorkspaceArchiveCandidate>();
    const archivedById = new Map<string, ArchivedSessionRecord>();

    for (const record of archivedRecords) {
      if (record.cwd === cwd) archivedById.set(record.sessionId, record);
    }

    for (const session of sessions) {
      const archived = archivedById.get(session.id);
      if (archived === undefined) candidates.set(session.id, archiveCandidateFromListEntry(session));
      else {
        const candidate = archiveCandidateFromArchivedRecord(archived, session);
        if (candidate !== undefined) candidates.set(candidate.id, candidate);
      }
    }

    for (const record of archivedById.values()) {
      if (candidates.has(record.sessionId)) continue;
      const candidate = archiveCandidateFromArchivedRecord(record, undefined);
      if (candidate !== undefined) candidates.set(candidate.id, candidate);
    }

    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() !== cwd || archivedById.has(session.sessionId)) continue;
      const existing = candidates.get(session.sessionId);
      candidates.set(session.sessionId, { ...(existing ?? archiveCandidateFromActiveSession(session, false)), activeSession: session });
    }

    return [...candidates.values()];
  }

  private async listSessionNames(cwd: string): Promise<string[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const names = new Set<string>();
    for (const session of sessions) addSessionName(names, session.name);
    for (const record of archivedRecords) {
      if (record.cwd === cwd) addSessionName(names, record.name);
    }
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd) addSessionName(names, session.sessionName);
    }
    return [...names];
  }

  private async closeActive(sessionId: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    for (const startup of this.startupSessions.values()) {
      if (startup.session.sessionId === sessionId) this.endSessionExtensionDialogs(startup.session);
    }
    const pendingOpens = this.pendingSessionOpenPromises(sessionId);
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const activeSessions = this.activeSessionsForId(sessionId);
    if (activeSessions.length === 0 && notificationPolicy.kind === "clear") {
      this.publishNotificationMutations(this.notificationStore.clearSession(sessionId, notificationPolicy.reason));
      return;
    }
    await Promise.all(activeSessions.map((active) => this.closeActiveSession(active, notificationPolicy)));
  }

  private async closeActiveInScope(sessionId: string, eventScope: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    const active = this.activeForSessionIdAndScope(sessionId, eventScope);
    if (active !== undefined) {
      await this.closeActiveSession(active, notificationPolicy);
    } else if (notificationPolicy.kind === "clear") {
      this.publishNotificationMutations(this.notificationStore.clearSession(sessionId, notificationPolicy.reason));
    }
  }

  private async closeActiveSession(active: ManagedActiveSession, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    const sessionId = active.runtime.session.sessionId;
    if (notificationPolicy.kind === "clear") {
      const generation = this.notificationGenerationBySession.get(active.runtime.session);
      const mutations = generation === undefined
        ? this.notificationStore.clearSession(sessionId, notificationPolicy.reason)
        : this.notificationStore.clearGeneration(generation, notificationPolicy.reason);
      this.publishNotificationMutations(mutations);
    }
    this.forgetUnreadActivity(active.runtime.session);
    this.pendingAskStore.forgetSession(sessionId);
    this.endSessionExtensionDialogs(active.runtime.session);
    this.active.delete(activeSessionKey(sessionId, active.eventScope));
    this.activities.delete(activeSessionKey(sessionId, active.eventScope));
    this.workspaceActivity?.removeSession(sessionId, active.runtime.session.sessionManager.getCwd(), active.eventScope);
    this.clearAuthLossWarningsForSession(sessionId);
    this.clearCompactionPromptQueue(sessionId);
    // Disarm subsession notification before teardown so the abort below cannot
    // emit a "stopped working" event that notifies the parent (e.g. on archive).
    // The parent/children link is kept so the parent can still see the child.
    if (this.subsessionLinkForActiveChild(active.runtime.session) !== undefined) this.subsessionNotifyArmed.delete(sessionId);
    clearSessionQueue(active.runtime.session);
    active.unsubscribe();
    active.runtime.setRebindSession(undefined);
    try {
      await this.abortSessionOperations(active.runtime.session);
    } finally {
      await active.runtime.dispose();
    }
  }

  private async abortSessionOperations(session: PiAgentSession): Promise<void> {
    let branchSummaryAbortFailed = false;
    let branchSummaryAbortError: unknown;
    try {
      session.abortBranchSummary?.();
    } catch (error: unknown) {
      branchSummaryAbortFailed = true;
      branchSummaryAbortError = error;
    }

    try {
      await session.abort();
    } catch (abortError: unknown) {
      if (branchSummaryAbortFailed) {
        throw new AggregateError([branchSummaryAbortError, abortError], "Failed to abort session operations", { cause: abortError });
      }
      throw abortError;
    }
    if (branchSummaryAbortFailed) throw branchSummaryAbortError;
  }

  private async assertWritable(ref: PiSessionLookup): Promise<void> {
    if (await this.getArchived(ref) !== undefined) throw new Error("已归档会话为只读。请恢复会话后继续。");
  }

  private async getOrOpen(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<PiAgentSession> {
    return (await this.getActive(ref, managementContext)).runtime.session;
  }

  private startupSessionForLookup(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): PiAgentSession | undefined {
    const contextKey = managementContextKey(managementContext);
    const eventScope = eventScopeFromManagementContext(managementContext);
    const sessionId = sessionIdFromLookup(ref);
    const exact = this.startupSessions.get(activeSessionKey(sessionId, eventScope));
    if (exact !== undefined && exact.managementContextKey === contextKey && lookupMatchesStartupSession(ref, exact.session)) return exact.session;
    for (const startup of this.startupSessions.values()) {
      if (startup.managementContextKey !== contextKey || !startup.session.sessionId.startsWith(sessionId)) continue;
      if (lookupMatchesStartupSession(ref, startup.session)) return startup.session;
    }
    return undefined;
  }

  /** Resolve status and dialog-close calls even while extension startup is waiting for the browser. */
  private async sessionForStatusOrDialogClose(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<PiAgentSession> {
    const reachable = this.activeForLookup(ref, managementContext)?.runtime.session ?? this.startupSessionForLookup(ref, managementContext);
    return reachable ?? this.getOrOpen(ref, managementContext);
  }

  private async getActive(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ManagedActiveSession> {
    const active = this.activeForLookup(ref, managementContext);
    if (active !== undefined) return active;

    const archived = await this.getArchived(ref);
    if (archived?.archivePath !== undefined) {
      const archivePath = archived.archivePath;
      return this.openPending(
        archived.sessionId,
        archived.cwd,
        managementContext,
        () => this.sessionManager.open(archivePath),
        { notifications: "disabled" },
      );
    }

    const match = isPiSessionRef(ref)
      ? (await this.sessionManager.list(ref.cwd)).find((s) => s.id === ref.id || s.id.startsWith(ref.id))
      : (await this.sessionManager.listAll?.() ?? []).find((s) => s.id === ref || s.id.startsWith(ref));
    if (!match) throw new Error("未找到会话");
    return this.openPending(match.id, match.cwd, managementContext, () => this.sessionManager.open(match.path));
  }

  private openPending(
    sessionId: string,
    cwd: string,
    managementContext: ManagementEmbedContext | undefined,
    openSessionManager: () => PiSessionManager,
    options: Pick<CreateSessionRuntimeOptions, "notifications"> = {},
  ): Promise<ManagedActiveSession> {
    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionId, managementContextKey(managementContext)]);
    const existing = this.pendingSessionOpens.get(key);
    if (existing !== undefined) return existing.promise;

    const pending: PendingSessionOpen = {
      sessionId,
      promise: this.create(openSessionManager(), cwd, {
        ...options,
        ...(managementContext === undefined ? {} : { managementContext }),
      }),
    };
    pending.promise = pending.promise.finally(() => {
      if (this.pendingSessionOpens.get(key) === pending) this.pendingSessionOpens.delete(key);
    });
    this.pendingSessionOpens.set(key, pending);
    return pending.promise;
  }

  private pendingSessionOpenPromises(sessionId?: string): Promise<ManagedActiveSession>[] {
    return [...this.pendingSessionOpens.values()]
      .filter((pending) => sessionId === undefined || pending.sessionId === sessionId)
      .map((pending) => pending.promise);
  }

  private async getArchived(ref: PiSessionLookup): Promise<ArchivedSessionRecord | undefined> {
    const archived = await this.archiveStore.get(sessionIdFromLookup(ref));
    if (archived === undefined) return undefined;
    if (isPiSessionRef(ref) && archived.cwd !== ref.cwd) return undefined;
    return archived;
  }

  private activeForLookup(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): ManagedActiveSession | undefined {
    const key = managementContextKey(managementContext);
    const eventScope = eventScopeFromManagementContext(managementContext);
    const sessionId = sessionIdFromLookup(ref);
    const exact = this.active.get(activeSessionKey(sessionId, eventScope));
    if (exact !== undefined && lookupMatchesActiveSession(ref, exact) && exact.managementContextKey === key) return exact;
    for (const active of this.active.values()) {
      const candidateId = active.runtime.session.sessionId;
      if (candidateId.startsWith(sessionId) && lookupMatchesActiveSession(ref, active) && active.managementContextKey === key) return active;
    }
    return undefined;
  }

  private activeForLookupAny(ref: PiSessionLookup): ManagedActiveSession | undefined {
    const sessionId = sessionIdFromLookup(ref);
    const exact = this.activeForSessionId(sessionId);
    if (exact !== undefined && lookupMatchesActiveSession(ref, exact)) return exact;
    for (const active of this.active.values()) {
      const candidateId = active.runtime.session.sessionId;
      if (candidateId.startsWith(sessionId) && lookupMatchesActiveSession(ref, active)) return active;
    }
    return undefined;
  }

  private getActiveForCommand(sessionId: string, eventScope: string | undefined): Promise<ManagedActiveSession> {
    const active = eventScope === undefined ? this.activeForSessionId(sessionId) : this.activeForSessionIdAndScope(sessionId, eventScope);
    if (active === undefined) throw new Error(`Session not active: ${sessionId}`);
    return Promise.resolve(active);
  }

  private submitCommandPrompt(sessionId: string, text: string, eventScope: string | undefined): Promise<void> {
    const active = this.activeForSessionIdAndScope(sessionId, eventScope);
    if (active === undefined) throw new Error(`Session not active: ${sessionId}`);
    return this.submitPrompt(active.runtime.session, text, undefined, [], false);
  }

  private activeForSessionId(sessionId: string): ManagedActiveSession | undefined {
    return this.activeSessionsForId(sessionId)[0];
  }

  private activeForSessionIdAndScope(sessionId: string, eventScope: string | undefined): ManagedActiveSession | undefined {
    if (eventScope === undefined) return undefined;
    return this.active.get(activeSessionKey(sessionId, eventScope));
  }

  private activeSessionsForId(sessionId: string): ManagedActiveSession[] {
    return [...new Set(this.active.values())].filter((active) => active.runtime.session.sessionId === sessionId);
  }

  private async create(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions = {},
  ): Promise<ManagedActiveSession> {
    const startup = this.startupProgress(
      sessionManager,
      options.startupIntent ?? "open",
      options.startupToken,
      eventScopeFromManagementContext(options.managementContext),
    );
    try {
      return await this.createSessionRuntime(sessionManager, cwd, options, startup);
    } finally {
      startup.end();
    }
  }

  private async bindSessionExtensions(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
    owner: Pick<ManagedActiveSession, "eventScope" | "managementContextKey">,
  ): Promise<void> {
    const uiContext = this.sessionUiContext(session, generation);
    const key = activeSessionKey(session.sessionId, owner.eventScope);
    this.startupSessions.set(key, { session, ...owner });
    try {
      await session.bindExtensions({
        uiContext,
        mode: "rpc",
        onError: (error) => {
          const message = `${error.extensionPath}: ${error.error}`;
          this.publishActivity(session, "扩展错误", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message }, owner.eventScope);
        },
      });
    } finally {
      if (this.startupSessions.get(key)?.session === session) this.startupSessions.delete(key);
    }
  }

  private bindRuntime(active: ManagedActiveSession, session: PiAgentSession = active.runtime.session): void {
    this.runtimeBySession.set(session, active.runtime);
    active.unsubscribe();
    for (const [sessionId, candidate] of this.active.entries()) {
      if (candidate === active) {
        this.active.delete(sessionId);
        if (!sessionId.endsWith(`\0${session.sessionId}`)) this.clearCompactionPromptQueue(candidate.runtime.session.sessionId);
      }
    }
    active.unsubscribe = session.subscribe((event) => {
      this.events.publish(session.sessionId, toClientEvent(event), active.eventScope);
      this.publishActivityForEvent(session, event);
      const eventType = getString(event, "type");
      if (eventType === "agent_end") this.abortRunScopedExtensionDialogs(session);
      if (eventType === "compaction_end") this.scheduleCompactionQueueDrain(session.sessionId);
      if (eventType === "agent_start" || eventType === "agent_end") this.scheduleCompactionQueueDrain(session.sessionId);
      this.publishStatus(session);
      this.updateSubsessionTracking(session);
    });
    this.active.set(activeSessionKey(session.sessionId, active.eventScope), active);
  }

  private scheduleCompactionQueueDrain(sessionId: string, delayMs = 0): void {
    if (!this.compactionPromptQueues.has(sessionId) || this.compactionDrainTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.compactionDrainTimers.delete(sessionId);
      this.drainCompactionPromptQueue(sessionId);
    }, delayMs);
    this.compactionDrainTimers.set(sessionId, timer);
  }

  private drainCompactionPromptQueue(sessionId: string): void {
    const active = this.activeForSessionId(sessionId);
    if (active === undefined) return;
    const { session } = active.runtime;
    if (session.isCompacting) {
      this.scheduleCompactionQueueDrain(sessionId, 100);
      return;
    }

    if (session.isStreaming) {
      const queued = this.takeCompactionPromptQueue(sessionId);
      if (queued.length === 0) return;
      this.publishStatus(session);
      for (const prompt of queued) void this.submitPrompt(session, prompt.text, prompt.kind, prompt.images, prompt.echoUserMessage ?? true);
      return;
    }

    const prompt = this.shiftCompactionPrompt(sessionId);
    if (prompt === undefined) return;
    this.publishStatus(session);
    const submitted = this.submitPrompt(session, prompt.text, undefined, prompt.images, prompt.echoUserMessage ?? true);
    void submitted.finally(() => { this.scheduleCompactionQueueDrain(sessionId); });
  }

  private takeCompactionPromptQueue(sessionId: string): QueuedPrompt[] {
    const queued = this.compactionPromptQueues.get(sessionId) ?? [];
    this.compactionPromptQueues.delete(sessionId);
    return queued;
  }

  private shiftCompactionPrompt(sessionId: string): QueuedPrompt | undefined {
    const queue = this.compactionPromptQueues.get(sessionId);
    const prompt = queue?.shift();
    if (queue === undefined || queue.length === 0) this.compactionPromptQueues.delete(sessionId);
    return prompt;
  }

  private clearCompactionPromptQueue(sessionId: string): void {
    this.compactionPromptQueues.delete(sessionId);
    const timer = this.compactionDrainTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.compactionDrainTimers.delete(sessionId);
    }
  }

  private clearCompactionDrainTimers(): void {
    for (const timer of this.compactionDrainTimers.values()) clearTimeout(timer);
    this.compactionDrainTimers.clear();
  }

  private maybeGenerateSessionName(session: PiAgentSession, firstMessage: string): void {
    if (session.sessionName !== undefined || session.messages.length !== 0 || session.isStreaming || session.isCompacting) return;

    const deterministicName = deterministicSessionName(firstMessage);
    if (deterministicName !== undefined) {
      this.applyGeneratedSessionName(session, deterministicName);
      return;
    }

    const model = session.model;
    if (model === undefined) return;

    void generateShortSessionName(session.agent.streamFunction, model, firstMessage).then((name) => {
      this.applyGeneratedSessionName(session, name ?? fallbackSessionName(firstMessage));
    }).catch(() => {
      this.applyGeneratedSessionName(session, fallbackSessionName(firstMessage));
    });
  }

  private applyGeneratedSessionName(session: PiAgentSession, name: string | undefined): void {
    if (name === undefined || session.sessionName !== undefined) return;
    if (this.treeNavigations.has(session)) {
      this.deferredGeneratedSessionNames.set(session, name);
      return;
    }
    session.setSessionName(name);
    this.publishSessionName(session);
  }

  applyAuthChange(change: AuthChange): void {
    const changedRuntime = change.modelRuntime;
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      if (session.modelRuntime !== changedRuntime) continue;
      this.syncCurrentModelAuthWarning(session, active.eventScope, change.removedProviderId);
      this.publishStatus(session);
    }
  }

  private syncCurrentModelAuthWarning(session: PiAgentSession, eventScope: string, removedProviderId: string | undefined): void {
    const model = session.model;
    if (model === undefined) return;
    if (model.provider === "unknown" && model.id === "unknown") return;
    const warningKey = authLossWarningKey(session.sessionId, eventScope, model.provider, model.id);
    const registered = session.modelRuntime.getModel(model.provider, model.id);
    if (registered === undefined) return;
    if (session.modelRuntime.hasConfiguredAuth(registered.provider)) {
      this.authLossWarnings.delete(warningKey);
      return;
    }
    if (removedProviderId === undefined || model.provider !== removedProviderId || this.authLossWarnings.has(warningKey)) return;
    this.authLossWarnings.add(warningKey);
    this.events.publish(session.sessionId, {
      type: "command.output",
      level: "error",
      message: `Authentication for ${model.provider}/${model.id} was removed. Use /model to select another model.`,
    }, eventScope);
  }

  private clearAuthLossWarningsForSession(sessionId: string): void {
    for (const key of this.authLossWarnings) {
      if (key.includes(`:${sessionId}:`)) this.authLossWarnings.delete(key);
    }
  }

  private publishSessionName(session: PiAgentSession): void {
    const event = session.sessionName === undefined
      ? { type: "session.name", sessionId: session.sessionId } as const
      : { type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const;
    const eventScope = this.eventScopeForSession(session);
    this.events.publish(session.sessionId, event, eventScope);
    this.events.publishGlobal(event, eventScope);
  }

  private publishHeartbeats(): void {
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      // Re-evaluate subsession completion here too: agent_end can arrive while
      // the session still reports active work transiently, so the event-driven
      // latch may not fire. The heartbeat re-checks once the session settles.
      this.updateSubsessionTracking(session);
      const activity = this.activities.get(activeSessionKey(session.sessionId, active.eventScope));
      if (!this.hasActiveWork(session)) {
        if (activity?.phase === "active") this.publishStatus(session);
        continue;
      }
      this.publishStatus(session);
      if (activity?.phase === "active") this.publishActivity(session, activity.label, "active", activity.detail);
      else this.publishActivity(session, this.activityLabelFromStatus(session), "active");
    }
  }

  private activityLabelFromStatus(session: PiAgentSession): string {
    if (this.treeNavigations.has(session)) return "正在切换会话树";
    if (this.isSessionEntryMutationActive(session)) return "正在更新会话";
    if (session.isCompacting) return "正在压缩上下文";
    if (session.isBashRunning) return "正在运行命令";
    if (session.isStreaming) return "代理正在运行";
    if (this.pendingMessageCount(session) > 0) return "正在排队";
    return "正在处理";
  }

  private hasActiveWork(session: PiAgentSession): boolean {
    return this.treeNavigations.has(session)
      || this.isSessionEntryMutationActive(session)
      || this.isTreeExclusiveOperationActive(session)
      || sessionHasActiveWork(session, this.compactionQueuedMessages(session.sessionId).length);
  }

  private async runTreeExclusiveOperation<T>(
    targets: readonly TreeExclusiveOperationTarget[],
    activeError: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const sessionIds = new Set<string>();
    const runtimes = new Set<PiSessionRuntime>();
    const sessions = new Set<PiAgentSession>();
    for (const target of targets) {
      const runtime = target.runtime ?? (target.session === undefined ? undefined : this.activeRuntimeForSession(target.session));
      const session = target.session ?? runtime?.session;
      if (session !== undefined && this.hasActiveWork(session)) throw new Error(activeError);
      sessionIds.add(target.sessionId);
      if (runtime !== undefined) runtimes.add(runtime);
      if (session !== undefined) sessions.add(session);
    }

    for (const sessionId of sessionIds) {
      this.treeExclusiveSessionOperationCounts.set(sessionId, (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) + 1);
    }
    for (const runtime of runtimes) {
      this.treeExclusiveRuntimeOperationCounts.set(runtime, (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) + 1);
    }
    for (const session of sessions) this.observeUnreadActivityState(session);

    try {
      return await operation();
    } finally {
      for (const runtime of runtimes) decrementWeakCount(this.treeExclusiveRuntimeOperationCounts, runtime);
      for (const sessionId of sessionIds) decrementMapCount(this.treeExclusiveSessionOperationCounts, sessionId);
      for (const session of sessions) {
        if (this.isCurrentActiveSession(session)) this.observeUnreadActivityState(session);
      }
    }
  }

  private isTreeExclusiveSessionIdentityActive(sessionId: string): boolean {
    return (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) > 0;
  }

  private isTreeExclusiveOperationActive(session: PiAgentSession): boolean {
    if (this.isTreeExclusiveSessionIdentityActive(session.sessionId)) return true;
    const runtime = this.activeRuntimeForSession(session);
    return runtime !== undefined && (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) > 0;
  }

  private activeRuntimeForSession(session: PiAgentSession): PiSessionRuntime | undefined {
    const tracked = this.runtimeBySession.get(session);
    if (tracked !== undefined) return tracked;
    for (const active of new Set(this.active.values())) {
      if (active.runtime.session === session) return active.runtime;
    }
    return undefined;
  }

  private assertTreeNavigationInactive(session: PiAgentSession, action: string): void {
    if (this.treeNavigations.has(session)) throw new Error(`Cannot ${action} while session tree navigation is active`);
  }

  private async runSessionEntryMutation<T>(session: PiAgentSession, action: string, operation: () => Promise<T>): Promise<T> {
    this.beginSessionEntryMutation(session, action);
    try {
      return await operation();
    } finally {
      this.endSessionEntryMutation(session);
    }
  }

  private beginSessionEntryMutation(session: PiAgentSession, action: string): void {
    this.assertTreeNavigationInactive(session, action);
    this.sessionEntryMutationCounts.set(session, (this.sessionEntryMutationCounts.get(session) ?? 0) + 1);
    this.observeUnreadActivityState(session);
  }

  private endSessionEntryMutation(session: PiAgentSession): void {
    const remaining = (this.sessionEntryMutationCounts.get(session) ?? 1) - 1;
    if (remaining <= 0) this.sessionEntryMutationCounts.delete(session);
    else this.sessionEntryMutationCounts.set(session, remaining);
    this.observeUnreadActivityState(session);
  }

  private isSessionEntryMutationActive(session: PiAgentSession): boolean {
    return (this.sessionEntryMutationCounts.get(session) ?? 0) > 0;
  }

  private publishActivityForEvent(session: PiAgentSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType === undefined) return;
    if (eventType === "agent_start") { this.publishActivity(session, "代理正在运行", "active"); return; }
    if (eventType === "agent_end") {
      this.publishActivity(session, "空闲", "idle");
      const eventScope = this.eventScopeForSession(session);
      const sessionKey = activeSessionKey(session.sessionId, eventScope);
      this.activities.scheduleSettledRefresh(sessionKey, () => {
        if (this.active.get(sessionKey)?.runtime.session !== session) return;
        this.publishActivity(session, "空闲", "idle");
        this.publishStatus(session);
      }, 250);
      return;
    }
    if (eventType === "turn_end") { this.publishActivity(session, "本轮已完成", "idle"); return; }
    if (eventType === "message_start") { this.publishActivity(session, "消息开始处理", "active"); return; }
    if (eventType === "message_end") { this.publishActivity(session, "消息处理完成", "idle"); return; }
    if (eventType === "message_update") { this.publishActivity(session, "正在接收回复", "active"); return; }
    if (eventType === "tool_execution_start") { this.publishActivity(session, "正在运行工具", "active", getString(event, "toolName")); return; }
    if (eventType === "tool_execution_end") {
      const isError = getBoolean(event, "isError") === true;
      this.publishActivity(session, isError ? "工具执行失败" : "工具执行完成", isError ? "error" : "idle", getString(event, "toolName"));
      return;
    }
    if (eventType === "bash_execution_start") { this.publishActivity(session, "正在运行命令", "active"); return; }
    if (eventType === "bash_execution_end") { this.publishActivity(session, "命令执行完成", "idle"); return; }
    if (this.hasActiveWork(session)) this.publishActivity(session, "正在处理", "active");
  }

  /**
   * Build the reporter for one session construction.
   *
   * The session id is known before any await — a `SessionManager` has its id
   * from construction — so the daemon can name what it is starting even though
   * the `PiAgentSession` that {@link publishActivity} needs does not exist yet.
   * Without an id there is nothing to report against, so the reporter stays
   * silent and the browser keeps its own generic wording.
   */
  private startupProgress(
    sessionManager: PiSessionManager,
    intent: "create" | "open",
    startupToken: string | undefined,
    eventScope: string,
  ): SessionStartupProgressReporter {
    const sessionId = sessionManager.getSessionId();
    if (sessionId === "") return { report: noop, end: noop };
    const label = intent === "create" ? "正在创建会话" : "正在打开会话";
    return {
      report: (phase) => { this.publishStartupProgress(sessionId, startupToken, label, "active", this.startupDetail(phase), eventScope); },
      end: () => {
        // A real activity published during the window (an extension error, say)
        // is the truth about this session and must survive the clear.
        if (this.activities.get(activeSessionKey(sessionId, eventScope)) !== undefined) return;
        this.publishStartupProgress(sessionId, startupToken, "空闲", "idle", undefined, eventScope);
      },
    };
  }

  private startupDetail(phase: string): string {
    return this.catalogRefreshStatus?.isRefreshInFlight() === true
      ? `${phase} · ${STARTUP_CONCURRENT_CATALOG_REFRESH}`
      : phase;
  }

  /**
   * Report startup progress on the global channel only, echoing the caller's
   * correlation token so a waiting browser row recognises its own construction.
   *
   * Unlike {@link publishActivity} this deliberately records nothing: no
   * `activities` entry, no workspace activity, no unread observation. There is
   * no session to own that state, and a failed creation would leave it stranded.
   *
   * Every report is marked `startup`, which is what keeps a session that is
   * merely opening from counting as one doing work. This is the only publisher
   * that sets the marker, and because it writes no `activities` entry no later
   * heartbeat re-publication can carry it.
   */
  private publishStartupProgress(
    sessionId: string,
    startupToken: string | undefined,
    label: string,
    phase: "active" | "idle",
    detail: string | undefined,
    eventScope: string,
  ): void {
    const at = new Date().toISOString();
    const activity = detail === undefined ? { sessionId, phase, label, at, startup: true } : { sessionId, phase, label, detail, at, startup: true };
    this.events.publishGlobal(
      startupToken === undefined ? { type: "session.startup", activity } : { type: "session.startup", startupToken, activity },
      eventScope,
    );
  }

  private publishActivity(session: PiAgentSession, label: string, phase: "active" | "idle" | "error", detail?: string): void {
    const at = new Date().toISOString();
    const stored = detail === undefined ? { phase, label, at } : { phase, label, detail, at };
    const eventScope = this.eventScopeForSession(session);
    this.activities.set(activeSessionKey(session.sessionId, eventScope), stored);
    const activity = detail === undefined ? { sessionId: session.sessionId, phase, label, at } : { sessionId: session.sessionId, phase, label, detail, at };
    this.workspaceActivity?.applySessionActivity(session.sessionManager.getCwd(), activity, eventScope);
    this.events.publish(session.sessionId, { type: "activity.update", activity }, eventScope);
    this.events.publishGlobal({ type: "activity.update", activity }, eventScope);
    this.observeUnreadActivityState(session);
  }

  private publishStatus(session: PiAgentSession): void {
    const status = this.statusFromSession(session);
    this.clearStaleActiveActivity(session);
    const eventScope = this.eventScopeForSession(session);
    this.workspaceActivity?.applySessionStatus(session.sessionManager.getCwd(), status, eventScope);
    this.events.publish(session.sessionId, { type: "status.update", status }, eventScope);
    this.events.publishGlobal({ type: "status.update", status }, eventScope);
    this.observeUnreadActivityState(session);
  }

  private clearStaleActiveActivity(session: PiAgentSession): void {
    const eventScope = this.eventScopeForSession(session);
    const current = this.activities.get(activeSessionKey(session.sessionId, eventScope));
    if (current?.phase !== "active" || this.hasActiveWork(session)) return;
    const at = new Date().toISOString();
    const stored = { phase: "idle" as const, label: "空闲", at };
    this.activities.set(activeSessionKey(session.sessionId, eventScope), stored);
    const activity = { sessionId: session.sessionId, ...stored };
    this.events.publish(session.sessionId, { type: "activity.update", activity }, eventScope);
    this.events.publishGlobal({ type: "activity.update", activity }, eventScope);
  }

  private activityForSession(session: PiAgentSession): { phase: "active" | "idle" | "error"; label: string; detail?: string; at: string } | undefined {
    return this.activities.get(activeSessionKey(session.sessionId, this.eventScopeForSession(session)));
  }

  private eventScopeForSession(session: PiAgentSession): string {
    for (const active of this.active.values()) {
      if (active.runtime.session === session) return active.eventScope;
    }
    for (const startup of this.startupSessions.values()) {
      if (startup.session === session) return startup.eventScope;
    }
    return NORMAL_SESSION_EVENT_SCOPE;
  }

  private dialogSessionKey(session: PiAgentSession): string {
    const eventScope = this.eventScopeForSession(session);
    return eventScope === NORMAL_SESSION_EVENT_SCOPE ? session.sessionId : activeSessionKey(session.sessionId, eventScope);
  }

  private publishStatusForSessionId(sessionId: string): void {
    const sessions = new Set<PiAgentSession>();
    for (const active of this.activeSessionsForId(sessionId)) sessions.add(active.runtime.session);
    for (const startup of this.startupSessions.values()) {
      if (startup.session.sessionId === sessionId) sessions.add(startup.session);
    }
    for (const session of sessions) this.publishStatus(session);
  }

  private statusFromSession(session: PiAgentSession): ClientSessionStatus {
    const stats = session.getSessionStats();
    const model = session.model === undefined ? undefined : modelToClientModel(session.model);
    const contextUsage = session.getContextUsage();
    const warnings = this.warningsForSession(session);
    const pendingAsk = this.pendingAskStore.pendingAsk(session.sessionId);
    const pendingDialogs = this.pendingExtensionDialogStore.pendingDialogs(this.dialogSessionKey(session));
    return {
      sessionId: session.sessionId,
      persisted: sessionFileExists(session.sessionFile),
      ...(model === undefined ? {} : { model }),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      pendingMessageCount: this.pendingMessageCount(session),
      queuedMessages: queuedMessagesFromSession(session, this.compactionQueuedMessages(session.sessionId)),
      messageCount: session.messages.length,
      tokens: stats.tokens,
      cost: stats.cost,
      ...(contextUsage === undefined ? {} : { contextUsage }),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(pendingAsk === undefined ? {} : { pendingAsk }),
      ...(pendingDialogs.length === 0 ? {} : { pendingDialogs }),
    };
  }

  /**
   * Compute the live warning set for a session: runtime/resource diagnostics from
   * the active runtime (if any) plus the Anthropic subscription-auth notice. Read
   * fresh on each status publish so a rebuilt runtime or an auth/model change is
   * reflected without caching a stale snapshot.
   */
  private warningsForSession(session: PiAgentSession): SessionWarning[] {
    const runtime = [...this.active.values()].find((active) => active.runtime.session === session)?.runtime;
    const warnings = runtime === undefined ? [] : collectRuntimeWarnings(runtime);
    const anthropic = anthropicSubscriptionWarning(session, join(this.agentDir, "auth.json"));
    if (anthropic !== undefined) warnings.push(anthropic);
    return warnings;
  }

  private pendingMessageCount(session: PiAgentSession): number {
    return session.pendingMessageCount + this.compactionQueuedMessages(session.sessionId).length;
  }

  private compactionQueuedMessages(sessionId: string): readonly QueuedPrompt[] {
    return this.compactionPromptQueues.get(sessionId) ?? [];
  }

  private hasQueuedMessageText(session: PiAgentSession, text: string): boolean {
    return queuedMessagesFromSession(session, this.compactionQueuedMessages(session.sessionId)).some((message) => message.text === text);
  }

notificationCatalog(): SessionNotificationCatalogSnapshot {
    return this.notificationStore.catalogSnapshot();
  }

async unreadCatalog(): Promise<SessionUnreadCatalogSnapshot> {
    await this.publishUnreadMutations([]);
    return this.unreadStore.durableCatalogSnapshot();
  }

async acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest): Promise<SessionUnreadCatalogSnapshot> {
    const result = this.unreadStore.acknowledge(sessionId, {
      ...request,
      cwd: canonicalizeStoredCwd(request.cwd),
    });
    await this.publishUnreadMutations(result.mutations);
    return this.unreadStore.durableCatalogSnapshot();
  }

notificationInbox(ref: PiSessionRef): SessionNotificationInboxSnapshot {
    return this.notificationStore.inboxSnapshot(ref.id, canonicalizeStoredCwd(ref.cwd));
  }

dismissNotification(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissRequest, "cwd">,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationStore.dismissNotification(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.notificationId,
    );
    this.publishNotificationMutations(result.mutations);
    return result.snapshot;
  }

dismissAllNotifications(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissAllRequest, "cwd">,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationStore.dismissAll(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.throughOrder,
      request.throughOverflowWatermark,
    );
    this.publishNotificationMutations(result.mutations);
    return result.snapshot;
  }

private async deliverSubsessionNotification(session: PiAgentSession, notification: DeferredSubsessionNotification): Promise<void> {
    await this.runSessionEntryMutation(session, "deliver a subsession notification", () => session.sendCustomMessage(
      { customType: SUBSESSION_NOTIFICATION_CUSTOM_TYPE, content: notification.text, display: true, details: { sessionId: notification.childId } },
      { triggerTurn: true, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
  }

private logSubsessionNotificationFailure(parentId: string, childId: string, error: unknown): void {
    this.logger.info(
      { parentSessionId: parentId, sessionId: childId, error: error instanceof Error ? error.message : String(error) },
      "failed to notify parent of subsession completion",
    );
  }

private async reloadSessionRuntime(session: PiAgentSession): Promise<void> {
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before reloading");
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before reloading",
      async () => {
        this.publishActivity(session, "正在重新加载资源", "active");
        const priorGeneration = this.notificationGenerationBySession.get(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await session.reload(priorGeneration === undefined ? undefined : {
            beforeSessionStart: () => {
              candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
              this.notificationGenerationBySession.set(session, candidateGeneration);
              this.replaceSessionNotificationContext(session, candidateGeneration);
            },
          });
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          this.publishActivity(session, "资源已重新加载", "idle");
          this.publishStatus(session);
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          const message = error instanceof Error ? error.message : String(error);
          this.publishActivity(session, "重新加载失败", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message });
          this.publishStatus(session);
          throw error;
        }
      },
    );
  }

async dismissWarning(ref: PiSessionLookup, dismissId: string): Promise<ClientSessionStatus> {
    const session = await this.getOrOpen(ref);
    dismissSessionWarning(session, dismissId);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

private openExistingSession(
    sessionId: string,
    cwd: string,
    openSessionManager: () => PiSessionManager,
    options: Pick<CreateSessionRuntimeOptions, "managementContext" | "notificationGeneration" | "notifications"> = {},
  ): Promise<ManagedActiveSession> {
    const active = this.activeForLookup({ id: sessionId, cwd }, options.managementContext);
    if (active !== undefined) return Promise.resolve(active);

    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionId]);
    const existing = this.pendingSessionOpens.get(key);
    if (existing !== undefined) return existing.promise;

    const pending: PendingSessionOpen = {
      sessionId,
      promise: this.create(openSessionManager(), cwd, options),
    };
    pending.promise = pending.promise.finally(() => {
      if (this.pendingSessionOpens.get(key) === pending) this.pendingSessionOpens.delete(key);
    });
    this.pendingSessionOpens.set(key, pending);
    return pending.promise;
  }

private isCurrentActiveSession(session: PiAgentSession): boolean {
    return [...this.active.values()].some((active) => active.runtime.session === session);
  }

private async createSessionRuntime(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions,
    startup: SessionStartupProgressReporter,
  ): Promise<ManagedActiveSession> {
    startup.report(STARTUP_PHASE_RUNTIME);
    const delegationToolsEnabled = options.creationProvenance !== "tracked-subsession"
      && await sessionAllowsDelegationTools(sessionManager, this.sessionManager);
    const runtime = await this.createAgentRuntime(this.createRuntime, {
      cwd,
      agentDir: this.agentDir,
      sessionManager,
      delegationToolsEnabled,
      ...(options.managementContext === undefined ? {} : { managementContext: options.managementContext }),
      ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
      ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
    });
    const active: ManagedActiveSession = {
      runtime,
      unsubscribe: noop,
      managementContextKey: managementContextKey(options.managementContext),
      eventScope: eventScopeFromManagementContext(options.managementContext),
    };
    let boundSession = runtime.session;
    let notificationGeneration = options.notificationGeneration;
    let notificationOwnership: "disabled" | "external" | "registered" | "replacement" = options.notifications === "disabled"
      ? "disabled"
      : notificationGeneration === undefined
        ? "registered"
        : "external";

    if (notificationOwnership === "registered") {
      const notificationIdentity = notificationIdentityForSession(runtime.session);
      const existingCandidate = this.notificationStore.beginReplacementForSession(
        notificationIdentity.sessionId,
        notificationIdentity.cwd,
      );
      if (existingCandidate !== undefined) {
        notificationGeneration = existingCandidate;
        notificationOwnership = "replacement";
      } else {
        const registration = this.notificationStore.registerSession(
          notificationIdentity.sessionId,
          notificationIdentity.cwd,
        );
        notificationGeneration = registration.generation;
        this.publishNotificationMutations(registration.mutations);
      }
    }
    if (notificationGeneration !== undefined) this.notificationGenerationBySession.set(runtime.session, notificationGeneration);

    try {
      if (options.creationProvenance === "tracked-subsession") {
        await this.publishUnreadMutations(this.unreadStore.excludeSession(
          runtime.session.sessionId,
          canonicalizeStoredCwd(runtime.session.sessionManager.getCwd()),
        ));
      } else {
        await this.recoverSubsessionTrackingForOpenedSession(runtime.session);
      }
      startup.report(STARTUP_PHASE_EXTENSIONS);
      await this.bindSessionExtensions(runtime.session, notificationGeneration, active);
      this.bindRuntime(active);
      runtime.setRebindSession(async (session) => {
        const priorGeneration = notificationGeneration;
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.prepareUnreadRuntimeRebind(boundSession, session);
          await this.recoverSubsessionTrackingForOpenedSession(session);
          if (priorGeneration !== undefined) {
            candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          this.bindRuntime(active, session);
          // The runtime being replaced parked every dialog the store still
          // holds for this session; settle those waits before the new
          // runtime's extensions can open fresh dialogs under the same id.
          this.endSessionExtensionDialogs(boundSession);
          boundSession = session;
          await this.bindSessionExtensions(session, candidateGeneration, active);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
            notificationGeneration = candidateGeneration;
          }
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            notificationGeneration = candidateGeneration;
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          throw error;
        }
      });
      this.active.set(activeSessionKey(runtime.session.sessionId, active.eventScope), active);
      if (notificationOwnership === "replacement" && notificationGeneration !== undefined) {
        this.publishNotificationMutations(this.notificationStore.commitReplacement(notificationGeneration));
        notificationOwnership = "external";
      }
      this.publishStatus(runtime.session);
      return active;
    } catch (error: unknown) {
      if (notificationGeneration !== undefined) {
        if (notificationOwnership === "registered") {
          this.publishNotificationMutations(this.notificationStore.clearSession(runtime.session.sessionId, "initialization-failed"));
        } else if (notificationOwnership === "replacement") {
          this.publishNotificationMutations(this.notificationStore.abortReplacement(notificationGeneration));
        }
      }
      active.unsubscribe();
      this.forgetUnreadActivity(boundSession);
      this.endSessionExtensionDialogs(boundSession);
      let removedActive = false;
      for (const [sessionKey, candidate] of this.active.entries()) {
        if (candidate !== active) continue;
        this.active.delete(sessionKey);
        this.activities.delete(sessionKey);
        this.clearAuthLossWarningsForSession(runtime.session.sessionId);
        this.clearCompactionPromptQueue(runtime.session.sessionId);
        removedActive = true;
      }
      if (removedActive) {
        this.workspaceActivity?.removeSession(runtime.session.sessionId, runtime.session.sessionManager.getCwd(), active.eventScope);
      }
      try {
        await runtime.session.abort();
      } finally {
        await runtime.dispose();
      }
      throw error;
    }
  }

private replaceSessionNotificationContext(session: PiAgentSession, generation: SessionNotificationGeneration): void {
    session.extensionRunner.setUIContext(this.sessionUiContext(session, generation), "rpc");
  }

private sessionUiContext(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
  ): ExtensionUIContext {
    const baseUiContext = session.extensionRunner.getUIContext();
    const notify: ExtensionUIContext["notify"] = (message, type) => {
      if (generation === undefined) {
        this.events.publish(session.sessionId, {
          type: "command.output",
          level: type === "error" ? "error" : "info",
          message,
        });
        return;
      }
      const added = this.notificationStore.addNotification(generation, message, type);
      this.publishNotificationMutations(added.mutations);
      if (added.notification === undefined) return;
      this.events.publish(session.sessionId, {
        type: "command.output",
        level: type === "error" ? "error" : "info",
        message,
        notificationId: added.notification.id,
      });
    };
    // PI WEB owns the browser-facing dialog, notification, and text-formatting
    // boundaries: the three dialog primitives park daemon-held Promises that
    // the browser answers, while every other UI method delegates to Pi's
    // headless defaults so unsupported surfaces cancel safely instead of
    // hanging.
    return new Proxy(baseUiContext, {
      get: (target, property, receiver): unknown => {
        if (property === "notify") return notify;
        if (property === "theme") return plainTextTheme;
        if (property === "confirm") {
          return (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "confirm", title, message }, opts);
        }
        if (property === "select") {
          return (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "select", title, options }, opts);
        }
        if (property === "input") {
          return (title: string, placeholder: string | undefined, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "input", title, placeholder }, opts);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
  }

private publishNotificationMutations(mutations: readonly SessionNotificationMutation[]): void {
    for (const mutation of mutations) {
      const scopes = new Set(this.activeSessionsForId(mutation.sessionId).map((active) => active.eventScope));
      if (scopes.size === 0) scopes.add(NORMAL_SESSION_EVENT_SCOPE);
      for (const scope of scopes) {
        this.events.publish(mutation.sessionId, mutation.inboxEvent, scope);
        this.events.publishGlobal(mutation.summaryEvent, scope);
      }
    }
  }

private async prepareUnreadRuntimeRebind(previous: PiAgentSession, next: PiAgentSession): Promise<void> {
    const previousCwd = canonicalizeStoredCwd(previous.sessionManager.getCwd());
    this.unreadStore.forgetActivity(previous.sessionId, previousCwd);
    const nextCwd = canonicalizeStoredCwd(next.sessionManager.getCwd());
    if (previous.sessionId === next.sessionId && cwdPathsEqual(previousCwd, nextCwd)) return;
    await this.publishUnreadMutations(this.unreadStore.forgetSession(previous.sessionId, previousCwd));
  }

private forgetUnreadActivity(session: PiAgentSession): void {
    this.unreadStore.forgetActivity(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
    );
  }

private async forgetUnreadSessions(identities: readonly { sessionId: string; cwd: string }[]): Promise<void> {
    const mutations: SessionUnreadMutation[] = [];
    for (const identity of identities) {
      mutations.push(...this.unreadStore.forgetSession(
        identity.sessionId,
        canonicalizeStoredCwd(identity.cwd),
      ));
    }
    await this.publishUnreadMutations(mutations);
  }

private observeUnreadActivityState(session: PiAgentSession): void {
    const mutations = this.unreadStore.observeActivityState(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
      this.hasActiveWork(session),
    );
    if (mutations.length === 0) return;
    void this.publishUnreadMutations(mutations).catch(() => undefined);
  }

private publishUnreadMutations(mutations: readonly SessionUnreadMutation[]): Promise<void> {
    this.enqueueUnreadMutations(mutations);
    this.unreadPublicationFlushRequested = true;
    if (this.unreadPublication === undefined && this.unreadPublicationRetryTimer !== undefined) {
      const failure = this.unreadPublicationFailure;
      return Promise.reject(failure instanceof Error
        ? failure
        : new Error("Session unread publication is awaiting retry", { cause: failure }));
    }
    return this.ensureUnreadPublication();
  }

private ensureUnreadPublication(): Promise<void> {
    const existing = this.unreadPublication;
    if (existing !== undefined) return existing;

    const publication = this.drainUnreadPublication();
    this.unreadPublication = publication;
    void publication.then(
      () => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
      },
      (error: unknown) => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
        this.unreadPublicationFailure = error;
        this.logger.info(
          { error: error instanceof Error ? error.message : String(error) },
          "failed to publish durable session unread mutations",
        );
        this.scheduleUnreadPublicationRetry();
      },
    );
    return publication;
  }

private async drainUnreadPublication(): Promise<void> {
    while (this.unreadPublicationFlushRequested || this.pendingUnreadMutations.length > 0) {
      this.unreadPublicationFlushRequested = false;
      const batch = this.pendingUnreadMutations.splice(0);
      let publishedCount = 0;
      try {
        await this.unreadStore.flush();
        for (const mutation of batch) {
          this.events.publishGlobal(mutation.event);
          publishedCount += 1;
        }
      } catch (error: unknown) {
        this.prependUnreadMutations(batch.slice(publishedCount));
        this.unreadPublicationFlushRequested = true;
        throw error;
      }
      this.unreadPublicationFailure = undefined;
      this.clearUnreadPublicationRetry();
    }
  }

private enqueueUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.push(...mutations);
    this.trimPendingUnreadMutations();
  }

private prependUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.unshift(...mutations);
    this.trimPendingUnreadMutations();
  }

private trimPendingUnreadMutations(): void {
    const excess = this.pendingUnreadMutations.length - MAX_PENDING_UNREAD_MUTATIONS;
    if (excess > 0) this.pendingUnreadMutations.splice(0, excess);
  }

private scheduleUnreadPublicationRetry(): void {
    if (this.unreadPublicationStopped || this.unreadPublicationRetryTimer !== undefined) return;
    const delay = this.unreadPublicationRetryDelayMs;
    this.unreadPublicationRetryDelayMs = Math.min(
      Math.max(delay * 2, this.unreadPublicationRetryInitialMs),
      Math.max(MAX_UNREAD_PUBLICATION_RETRY_MS, this.unreadPublicationRetryInitialMs),
    );
    this.unreadPublicationRetryTimer = setTimeout(() => {
      this.unreadPublicationRetryTimer = undefined;
      void this.ensureUnreadPublication().catch(() => undefined);
    }, delay);
    this.unreadPublicationRetryTimer.unref();
  }

private clearUnreadPublicationRetry(): void {
    if (this.unreadPublicationRetryTimer !== undefined) clearTimeout(this.unreadPublicationRetryTimer);
    this.unreadPublicationRetryTimer = undefined;
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
  }

private flushDeferredTreeNavigationWork(session: PiAgentSession): void {
    const generatedName = this.deferredGeneratedSessionNames.get(session);
    this.deferredGeneratedSessionNames.delete(session);
    if (generatedName !== undefined) {
      try {
        this.applyGeneratedSessionName(session, generatedName);
      } catch (error: unknown) {
        this.logger.info(
          { sessionId: session.sessionId, error: error instanceof Error ? error.message : String(error) },
          "failed to apply deferred session name",
        );
      }
    }

    const notifications = this.deferredSubsessionNotifications.get(session) ?? [];
    this.deferredSubsessionNotifications.delete(session);
    for (const notification of notifications) {
      void this.deliverSubsessionNotification(session, notification).catch((error: unknown) => {
        this.logSubsessionNotificationFailure(notification.parentId, notification.childId, error);
      });
    }
  }
}

function previewResponseFromPlan(plan: SessionCleanupPlan): ClientSessionCleanupPreviewResponse {
  return {
    generatedAt: plan.generatedAt,
    thresholds: plan.thresholds,
    projects: plan.projects,
    totals: plan.totals,
    ...(plan.skippedBusySessionIds.length === 0 ? {} : { skippedBusySessionIds: plan.skippedBusySessionIds }),
  };
}

function uniqueBulkSessionRefs(refs: readonly SessionBulkMutationRef[]): SessionBulkMutationRef[] {
  const seen = new Set<string>();
  const unique: SessionBulkMutationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.cwd ?? ""}\0${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function bulkRefToLookup(ref: SessionBulkMutationRef): PiSessionLookup {
  return ref.cwd === undefined ? ref.id : { id: ref.id, cwd: ref.cwd };
}

function findArchivedRecordForBulkRef(records: readonly ArchivedSessionRecord[], ref: SessionBulkMutationRef): ArchivedSessionRecord | undefined {
  return records.find((record) => (ref.cwd === undefined || record.cwd === ref.cwd) && (record.sessionId === ref.id || record.sessionId.startsWith(ref.id)));
}

function findListedSessionForBulkRef(context: BulkSessionLookupContext, ref: SessionBulkMutationRef): PiSessionListEntry | undefined {
  if (ref.cwd !== undefined) return findSessionByIdOrPrefix(context.sessionsByCwd.get(ref.cwd) ?? [], ref.id);
  return context.allSessions === undefined ? undefined : findSessionByIdOrPrefix(context.allSessions, ref.id);
}

function findSessionByIdOrPrefix(sessions: readonly PiSessionListEntry[], sessionId: string): PiSessionListEntry | undefined {
  return sessions.find((session) => session.id === sessionId) ?? sessions.find((session) => session.id.startsWith(sessionId));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelToClientModel(model: PiAgentSession["model"]): ClientSessionModel {
  if (model === undefined) return {};
  const name = getString(model, "name");
  const reasoning = getProperty(model, "reasoning");
  return {
    provider: model.provider,
    id: model.id,
    ...(name === undefined ? {} : { name }),
    contextWindow: model.contextWindow,
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function notificationIdentityForSession(session: PiAgentSession): { sessionId: string; cwd: string } {
  return {
    sessionId: session.sessionId,
    cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
  };
}

function clientSessionFromListEntry(session: PiSessionListEntry): ClientSession {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    persisted: true,
    ...(session.name === undefined ? {} : { name: session.name }),
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function sessionHasActiveWork(session: PiAgentSession, extraQueuedMessageCount = 0): boolean {
  return session.isStreaming || session.isCompacting || session.isBashRunning || session.pendingMessageCount + extraQueuedMessageCount > 0;
}

function sessionDisplayName(session: PiAgentSession): string {
  return session.sessionName ?? session.sessionId;
}

function addSessionName(names: Set<string>, name: string | undefined): void {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  if (trimmed !== undefined && trimmed !== "") names.add(trimmed);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

interface TrackedSubsessionSessionIdentity {
  sessionId: string;
  sessionFile: string | undefined;
  sessionManager: PiSessionManager;
  cwd: string;
}

/**
 * Resolve the delegation capability from server-owned, persisted session
 * provenance. A copied marker is not enough: the child header and reciprocal
 * parent link must identify the exact same session files.
 */
export async function sessionAllowsDelegationTools(
  sessionManager: PiSessionManager,
  managers: Pick<PiSessionManagerGateway, "open">,
): Promise<boolean> {
  const trackedLink = await verifiedTrackedSubsessionLink(managers, {
    sessionId: sessionManager.getSessionId(),
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    cwd: sessionManager.getCwd(),
  });
  return trackedLink === undefined;
}

async function verifiedTrackedSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  session: TrackedSubsessionSessionIdentity,
): Promise<TrackedSubsessionLink | undefined> {
  // Child markers are only hints; the current child header and reciprocal
  // parent custom link must agree on the exact ids and files before relinking.
  const entries = session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
  let marker: PersistedChildSubsessionLink | undefined;
  for (const entry of entries) {
    const parsed = parsePersistedChildSubsessionLink(entry);
    if (parsed?.spawnedSessionId === session.sessionId) marker = parsed;
  }
  if (marker === undefined) return undefined;

  const childSessionFile = nonEmptyString(session.sessionFile);
  if (childSessionFile === undefined) return undefined;
  const childHeader = await readSessionHeaderSummary(childSessionFile);
  if (childHeader?.id !== session.sessionId) return undefined;
  const parentSessionFile = nonEmptyString(childHeader.parentSession);
  if (parentSessionFile === undefined) return undefined;
  const parentHeader = await readSessionHeaderSummary(parentSessionFile);
  if (parentHeader?.id !== marker.spawnedBySessionId) return undefined;

  const parentLink = findReciprocalParentSubsessionLink(
    managers,
    parentSessionFile,
    marker.spawnedBySessionId,
    session.sessionId,
    childSessionFile,
  );
  if (parentLink === undefined) return undefined;
  return {
    parentSessionId: marker.spawnedBySessionId,
    childSessionId: session.sessionId,
    childSessionFile,
    parentSessionFile,
    cwd: parentLink.cwd ?? session.cwd,
  };
}

function findReciprocalParentSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  parentSessionFile: string,
  parentSessionId: string,
  childSessionId: string,
  childSessionFile: string,
): PersistedParentSubsessionLink | undefined {
  let parentManager: PiSessionManager;
  try {
    parentManager = managers.open(parentSessionFile);
  } catch {
    return undefined;
  }
  const entries = parentManager.getEntries?.() ?? parentManager.getBranch();
  for (const entry of entries) {
    const link = parsePersistedParentSubsessionLink(entry);
    if (link === undefined) continue;
    if (link.spawnedBySessionId !== parentSessionId || link.spawnedSessionId !== childSessionId) continue;
    if (link.spawnedSessionFile === undefined || !sessionPathsEqual(link.spawnedSessionFile, childSessionFile)) continue;
    return link;
  }
  return undefined;
}

function trackedSubsessionLinkFromParentLink(parentSessionId: string, link: PersistedParentSubsessionLink, parentSessionFile: string): TrackedSubsessionLink {
  return {
    parentSessionId,
    childSessionId: link.spawnedSessionId,
    ...(link.spawnedSessionFile === undefined ? {} : { childSessionFile: link.spawnedSessionFile }),
    parentSessionFile,
    ...(link.cwd === undefined ? {} : { cwd: link.cwd }),
  };
}

function persistedParentSubsessionLinkData(link: TrackedSubsessionLink): Record<string, unknown> {
  return {
    version: 1,
    spawnedBySessionId: link.parentSessionId,
    spawnedSessionId: link.childSessionId,
    ...(link.childSessionFile === undefined ? {} : { spawnedSessionFile: link.childSessionFile }),
    ...(link.cwd === undefined ? {} : { cwd: link.cwd }),
  };
}

function persistedChildSubsessionLinkData(parentSessionId: string, childSessionId: string): Record<string, unknown> {
  return {
    version: 1,
    spawnedBySessionId: parentSessionId,
    spawnedSessionId: childSessionId,
  };
}

function parsePersistedParentSubsessionLink(entry: unknown): PersistedParentSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  const spawnedSessionFile = getString(data, "spawnedSessionFile");
  const cwd = getString(data, "cwd");
  return {
    spawnedBySessionId,
    spawnedSessionId,
    ...(spawnedSessionFile === undefined || spawnedSessionFile === "" ? {} : { spawnedSessionFile }),
    ...(cwd === undefined || cwd === "" ? {} : { cwd }),
  };
}

function parsePersistedChildSubsessionLink(entry: unknown): PersistedChildSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_CHILD_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  return { spawnedBySessionId, spawnedSessionId };
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function subsessionHydratedParentKey(parentSessionId: string, parentSessionFile: string | undefined): string {
  return `${parentSessionId}\0${parentSessionFile ?? ""}`;
}

function sessionPathsEqual(a: string, b: string): boolean {
  return cwdPathsEqual(a, b);
}

function sessionFileExists(sessionFile: string | undefined): sessionFile is string {
  if (sessionFile === undefined || sessionFile === "") return false;
  try {
    return statSync(sessionFile).isFile();
  } catch {
    return false;
  }
}

function sessionPinScope(cwd: string, managementContext: ManagementEmbedContext | undefined): SessionPinScope {
  return managementContext === undefined
    ? { mode: "normal", cwd }
    : { mode: "management", rootUserId: managementContext.user.rootUserId, userId: managementContext.user.id, cwd };
}

async function readArchivedSessionText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function sessionFileMatches(session: PiAgentSession, expectedSessionFile: string | undefined): boolean {
  const sessionFile = nonEmptyString(session.sessionFile);
  return sessionFile !== undefined && expectedSessionFile !== undefined && sessionPathsEqual(sessionFile, expectedSessionFile);
}

function activeSessionFileMatches(active: ActiveSession<PiSessionRuntime>, expectedSessionFile: string | undefined): boolean {
  return sessionFileMatches(active.runtime.session, expectedSessionFile);
}

function trackedLinkParentFileMatches(link: TrackedSubsessionLink, parentSessionFile: string): boolean {
  return link.parentSessionFile !== undefined && sessionPathsEqual(link.parentSessionFile, parentSessionFile);
}

async function sessionFileHeaderMatches(sessionFile: string, expected: { sessionId: string; parentSessionFile?: string | undefined }): Promise<boolean> {
  const header = await readSessionHeaderSummary(sessionFile);
  if (header?.id !== expected.sessionId) return false;
  if (expected.parentSessionFile === undefined) return true;
  return header.parentSession !== undefined && sessionPathsEqual(header.parentSession, expected.parentSessionFile);
}

async function clearParentSession(sessionFile: string): Promise<void> {
  const content = await readFile(sessionFile, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);
  const header: unknown = JSON.parse(firstLine);
  if (!isRecord(header) || header["type"] !== "session") throw new Error("Invalid session file header");
  if (header["parentSession"] === undefined) return;
  delete header["parentSession"];
  await writeFile(sessionFile, `${JSON.stringify(header)}${rest}`, "utf8");
}

function clearParentSessionHeader(sessionManager: PiSessionManager): void {
  const header = sessionManager.getHeader?.();
  if (header !== undefined && header !== null) delete header.parentSession;
}

function clearSessionQueue(session: PiAgentSession): void {
  session.clearQueue();
}

function queuedMessagesFromSession(session: PiAgentSession, extraQueuedMessages: readonly QueuedPrompt[] = []): { kind: "steer" | "followUp"; text: string }[] {
  return [
    ...session.getSteeringMessages().map((text) => ({ kind: "steer" as const, text })),
    ...session.getFollowUpMessages().map((text) => ({ kind: "followUp" as const, text })),
    ...extraQueuedMessages,
  ];
}

function userTextMessage(text: string): { role: "user"; content: string } {
  return { role: "user", content: text };
}

/**
 * Build the optimistic user message echoed to clients. When images are present
 * we mirror pi's content-array shape (`[{type:"text"}, {type:"image"}, ...]`) so
 * the local echo matches what pi persists in the session branch.
 */
function userMessage(text: string, images: ImageContent[]): { role: "user"; content: string | (ImageContent | { type: "text"; text: string })[] } {
  if (images.length === 0) return userTextMessage(text);
  const content: (ImageContent | { type: "text"; text: string })[] = [];
  if (text !== "") content.push({ type: "text", text });
  content.push(...images);
  return { role: "user", content };
}

function buildPromptOptions(behavior: QueuedPromptKind | undefined, images: ImageContent[]): { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] } | undefined {
  const options: { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] } = {};
  if (behavior !== undefined) options.streamingBehavior = behavior;
  if (images.length > 0) options.images = images;
  return Object.keys(options).length > 0 ? options : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function historyMessages(session: PiAgentSession): unknown[] {
  return historyMessagesFromManager(session.sessionManager);
}

function historyMessagesFromManager(sessionManager: PiSessionManager): unknown[] {
  const messages: unknown[] = [];
  for (const entry of sessionManager.getBranch()) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "message") messages.push(entry["message"]);
    else if (entry["type"] === "custom_message" && entry["display"] === true) messages.push({ role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (entry["type"] === "compaction") messages.push({ role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") messages.push({ role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return messages;
}

/** custom entry type used to persist parent -> child subsession links outside LLM context. */
const SUBSESSION_LINK_CUSTOM_TYPE = "pi-web.subsession.link";

/** custom entry type used to mark a child as created by spawn_subsession. */
const SUBSESSION_CHILD_LINK_CUSTOM_TYPE = "pi-web.subsession.spawned";

/** customType marking a parent-facing subsession-completion notice. */
const SUBSESSION_NOTIFICATION_CUSTOM_TYPE = "subsession.completion";

const SUBSESSION_NOTIFICATION_MAX_OUTPUT_CHARS = 2000;

/** Avoid duplicating a partial result in context when deliberate inspection can return the full output. */
function formatSubsessionNotificationOutput(childSessionId: string, text: string): string {
  if (text.length > SUBSESSION_NOTIFICATION_MAX_OUTPUT_CHARS) {
    return `Output from subsession ${childSessionId} was too long for this completion notice and was omitted. Call check_subsession with sessionId "${childSessionId}" to retrieve the final output.`;
  }
  return `--- SUBSESSION OUTPUT: ${childSessionId} ---\n${text === "" ? "(no output)" : text}`;
}

/** Most recent assistant text from a history message list, or "" if none. */
function finalAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message) || message["role"] !== "assistant") continue;
    const content = message["content"];
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"]);
    }
    if (texts.length > 0) return texts.join("\n").trim();
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
