import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readSessionUiMetadata, requireSessionUiMetadata } from "./sessionMetadata.js";
import { UserFacingError, createTranslator, userFacingErrorMessage } from "../../shared/i18n.js";
import { realpathSync, statSync } from "node:fs";
import { clientSessionFirstMessagePreview } from "./clientSessionPreview.js";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEventBus,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  getAgentDir,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  loadSkills,
  ModelRuntime,
  ProjectTrustStore,
  hasTrustRequiringProjectResources,
  readStoredCredential,
  SessionManager,
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type EditToolDetails,
  type EditToolOptions,
  type ExtensionCommandContextActions,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ResourceDiagnostic,
  type Skill,
  type ToolDefinition,
  type ToolsOptions,
} from "../../piSdk.js";
import type { ClientArchiveSessionsResponse, ClientCommand, ClientCommandResult, ClientMessagePage, ClientSession, ClientSessionCleanupExecuteResponse, ClientSessionCleanupPreviewResponse, ClientSessionContentSearchResponse, ClientSessionModel, ClientSessionModelCatalogEntry, ClientSessionStatus, ClientSessionTreeForkRequest, ClientSessionTreeForkResult, ClientSessionTreeNavigateRequest, ClientSessionTreeNavigateResult, ClientThinkingLevel, SessionPinResponse, SessionPinnedIdsResponse, SessionStreamSnapshot, SessionTranscriptSnapshot } from "../types.js";
import { projectBrowserMessage } from "../browserMessageProjection.js";
import { messageHistoryTargetId } from "./messageHistoryTarget.js";
import { isSessionMediaId } from "../../shared/sessionMedia.js";
import type { SessionMedia } from "./sessionMediaIndex.js";
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";
import { getBuiltinExtensionFactories } from "./builtinExtensionFactories.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { eventScopeFromManagementContext, managementContextKey, NORMAL_SESSION_EVENT_SCOPE } from "../realtime/sessionEventScope.js";
import { builtinCommands } from "./builtinCommands.js";
import { loadNodeTranslator } from "../../localization.js";
import type { Translator } from "../../shared/i18n.js";
import { SessionCommandService } from "./sessionCommandService.js";
import { SessionActivityMarker } from "./sessionActivityMarker.js";
import { projectSessionTree, type ProjectableSessionTreeNode } from "./sessionTreeProjection.js";
import { SessionArchiveStore, type ArchivedSessionRecord, type ArchiveSessionInput } from "./sessionArchiveStore.js";
import { findArchiveCandidateByExactId, planSessionArchiveTree } from "./sessionArchiveTree.js";
import type { ActiveSession } from "./sessionRuntimeStore.js";
import { deterministicSessionName, fallbackSessionName, generateShortSessionName } from "./sessionNameGenerator.js";
import type { PluginSessionSnapshot } from "../../shared/pluginCatalogTypes.js";
import { computeEditPreview, type EditPreviewResult } from "./editPreview.js";
import { attachmentsToInlineImages, saveAttachmentsToWorkspace } from "./attachmentService.js";
import { loadEffectiveProjectAttachmentsConfig } from "../workspaces/projectPiWebConfig.js";
import type { PiWebConfigService } from "../configRoutes.js";
import { parsePromptAttachments } from "../../shared/promptAttachments.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, SESSION_UNREAD_LIMIT, type PiWebAttachmentsConfig } from "../../shared/apiTypes.js";
import type { AskUserCloseResponse, AskUserOutcome, AskUserSubmission, ExtensionDialogAnswer, ExtensionDialogCloseResponse, ExtensionDialogKind, ExtensionDialogOutcome, SavedPromptAttachment, SessionBulkArchiveResponse, SessionBulkDeleteArchivedResponse, SessionBulkFailure, SessionBulkMutationRef, SessionDefaults, SessionDefaultsUpdate, SessionModelScopeMode, SessionNotificationCatalogSnapshot, SessionNotificationClearReason, SessionNotificationDismissAllRequest, SessionNotificationDismissRequest, SessionNotificationInboxSnapshot, SessionUnreadAcknowledgeRequest, SessionUnreadCatalogSnapshot, SessionWarning } from "../../shared/apiTypes.js";
import type { PiWebHostPiSessionConnection } from "../../server-plugin-api.js";
import { PiSessionEventConnections } from "./piSessionEventConnections.js";
import { resolveWebProjectTrusted } from "./projectTrust.js";
import type { SessionRouteRef } from "./sessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { SessionPinStore, type SessionPinScope } from "./sessionPinStore.js";
import { SessionActivityCoordinator } from "./sessionActivityCoordinator.js";
import { searchSessionContent } from "./sessionContentSearch.js";

import { createLocalOnlyModelRuntime, modelRuntimeAuthPath, type AuthChange } from "./authService.js";
import { canonicalizeStoredCwd, cwdPathsEqual } from "../workingDirectory.js";
import { clearSessionFileParent, readSessionHeaderSummary } from "./sessionFileHeader.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { isManagedAgentsFile, workbenchAccessHandle, type ManagementEmbedContext } from "../managementEmbed.js";
import { managementPrivilegeRequested, managementPrivileges, managementUsesNormalPermissions } from "../managementPrivileges.js";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS, piWebDataDir } from "../../config.js";
import { createScopedSettingsManager, resolveSettingsScopeDirectory, type SessionSettingsMode } from "./projectSettingsScope.js";
import { parseSessionDefaults, parseSessionDefaultsUpdate } from "../../shared/sessionDefaults.js";
import { createAskUserToolDefinition, type AskUserInvocation, type AskUserToolDeps } from "./askUserTool.js";
import { PendingAskStore, renderAskUserAnswersText, type PendingAskCloseResult, type PendingAskOpenResult } from "./pendingAskStore.js";
import { PendingExtensionDialogStore, type ExtensionDialogCancelReason } from "./pendingExtensionDialogStore.js";
import { ExtensionDialogWaiters, effectiveExtensionDialogTimeoutMs, extensionDialogCancelValue } from "./extensionDialogWaiters.js";
import { createSpawnSessionToolDefinition, type SpawnSessionInvocation, type SpawnSessionResult } from "./spawnSessionTool.js";
import { createSubsessionToolDefinitions, type SpawnSubsessionInvocation, type SpawnSubsessionResult, type SubsessionCheckResult, type SubsessionReadQuery, type SubsessionReadResult, type SubsessionStatus, type SubsessionSummary, type SubsessionToolDeps } from "./spawnSubsessionTool.js";
import { buildTranscriptView } from "./subsessionTranscript.js";
import { planSessionCleanup, summarizeSessionCleanupExecution, type NormalizedSessionCleanupRequest, type SessionCleanupPlan } from "./sessionCleanup.js";
import type { SpawnTargetDecision, SpawnTargetResolver } from "./spawnTargetResolver.js";
import { createManagedAgentToolOptions, createManagedBashToolDefinition, createManagedPythonToolDefinition } from "./managementAgentTools.js";
import { PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR, managementAgentToolNames, privilegedManagementToolNames, withRuntimeCreationEnvironment, writeManagementPermissionSystemPolicy } from "./managementPermissionSystem.js";
import { SessionNotificationStore, type SessionNotificationGeneration, type SessionNotificationMutation } from "./sessionNotificationStore.js";
import { plainTextTheme } from "./plainTextTheme.js";
import { deduplicateBundledRelaySkills, ensureManagedRelaySkills, MANAGED_RELAY_SKILL_NAMES, removeUnmodifiedManagedRelaySkills } from "./relaySkill.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "./sessionUnreadStore.js";
import {
  archiveCandidateFromActiveSession,
  archiveCandidateFromArchivedRecord,
  archiveCandidateFromListEntry,
  archiveInputFromActiveSession,
  archiveInputFromCandidate,
  archiveInputFromListEntry,
  clientSessionFromArchivedRecord,
  type WorkspaceArchiveCandidate,
} from "./sessionArchiveMapping.js";
import { annotateAssistantStreamId, getBoolean, getProperty, getString, toClientEvent } from "./sessionUiEvents.js";
import { annotateAssistantThinkingLevel, historyMessagesFromEntries } from "./transcriptMessages.js";
import { WorkbenchAccessStateStore } from "../workbench/accessStateStore.js";
import { WorkbenchClient } from "../workbench/workbenchClient.js";
import { WorkbenchMcpClient } from "../workbench/mcpClient.js";
import { WorkbenchSkillSynchronizer } from "../workbench/skillSync.js";
import { createWorkbenchToolDefinitions } from "../workbench/workbenchTools.js";
import type { WorkbenchSkillReceiptFile } from "../workbench/types.js";
import type { NormalToolAuditEvent, NormalToolAuditStore } from "../audit/normalToolAuditStore.js";
import type { ManagementAuditIdentity, ManagementAuditRecorder } from "../audit/managementAuditStore.js";
import { applyEnabledModelToggle, catalogWithEnabledFirst, modelScopeId, persistedEnabledModelPatterns, resolveEnabledModelIds, resolveSessionModelOptions, scopedModelsFromEnabledIds, type EnabledModelCatalogEntry } from "./sessionModelScope.js";

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
/**
 * Appended to whichever phase is running when a background provider catalog
 * refresh happens to be in flight. It is stated as a concurrent fact, never as
 * the cause: PI WEB can verify that a refresh is running, but not that this
 * particular startup is waiting on it.
 */
const MAX_UNREAD_PUBLICATION_RETRY_MS = 30_000;
const MAX_PENDING_UNREAD_MUTATIONS = SESSION_UNREAD_LIMIT + 1;
const IDLE_SESSION_FILE_RESOLUTION_THROTTLE_MS = 30_000;

function auditVisibleAssistantMessage(message: unknown): unknown {
  if (!isRecord(message) || Array.isArray(message)) return message;
  const content = message["content"];
  if (!Array.isArray(content)) return message;
  return {
    ...message,
    content: content.filter(part => !isRecord(part) || Array.isArray(part) || part["type"] !== "thinking"),
  };
}

function noop(): void {
  // Intentionally empty default unsubscribe callback.
}

function spawnTargetError(decision: Extract<SpawnTargetDecision, { allowed: false }>, t: Translator): Error {
  if (decision.reason === "not-registered") return new Error(t("session.spawnUnregistered", "Spawned session is outside registered projects"));
  return new Error(t("session.spawnWorkspace", "cwd must be a workspace of this project. Allowed paths: {paths}", { paths: decision.allowedCwds.join(", ") }));
}

function subsessionCwdError(spawningCwd: string, requestedCwd: string, t: Translator = loadNodeTranslator("server")): Error {
  return new Error(t("server.main.3122d89b6904", "A tracked subsession runs in this session's working directory ({arg0}); {arg1} was requested. Instruct the child to work elsewhere from this workspace, or use spawn_session for an independent session in another workspace.", { arg0: spawningCwd, arg1: requestedCwd }));
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
function unknownSpawnModelError(modelSpec: string, t: Translator): Error {
  return new Error(t("model.spawnUnknown", 'Model "{model}" not found. Supply an exact "provider/model-id".', { model: modelSpec }));
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

type ManagedActiveSession = ActiveSession<PiSessionRuntime> & {
  managementContextKey: string | undefined;
  eventScope: string;
  managementAuditIdentity?: ManagementAuditIdentity;
};

interface ManagedStartupSession {
  session: PiAgentSession;
  managementContextKey: string | undefined;
  eventScope: string;
}

interface PendingSessionOpen {
  sessionId: string;
  eventScope: string;
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

type PiTreeNavigationOptions = NonNullable<Parameters<ExtensionCommandContextActions["navigateTree"]>[1]>;
type PiForkOptions = Parameters<ExtensionCommandContextActions["fork"]>[1];
interface ExtensionCommandSubmission { session: PiAgentSession; active: boolean }
interface ExtensionCommandExecution { submission?: ExtensionCommandSubmission; sessionControl?: boolean }

function sessionTreeNavigationOptions(request: ClientSessionTreeNavigateRequest, t: Translator = loadNodeTranslator("server")): PiTreeNavigationOptions {
  switch (request.summary.mode) {
    case "none":
      return { summarize: false };
    case "default":
      return { summarize: true };
    case "custom": {
      const customInstructions = request.summary.instructions.trim();
      if (customInstructions === "") throw new Error(t("server.main.416db415bedb", "Custom branch-summary instructions are required"));
      if (customInstructions.length > SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
        throw new Error(t("server.main.8e5676bb8f61", "Custom branch-summary instructions must be at most {arg0} characters", { arg0: String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) }));
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

interface ScopedTrackedSubsessionLink extends TrackedSubsessionLink {
  eventScope: string;
  // Keep the authenticated context in memory; persisted links cannot grant it.
  managementContext?: ManagementEmbedContext;
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

type SessionCreationProvenance = "tracked-subsession" | "host-one-shot";

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

function requirePromptText(value: unknown, t: Translator): string {
  if (typeof value !== "string") throw new Error(t("session.promptRequired", "Prompt text is required"));
  return value;
}

function parsePromptStreamingBehavior(value: unknown): QueuedPromptKind | undefined {
  if (value === undefined) return undefined;
  if (value === "steer" || value === "followUp") return value;
  throw new UserFacingError("routing.streamingBehaviorInvalid", "Prompt streamingBehavior must be \"steer\" or \"followUp\"");
}

type SessionArchiveRepository = Pick<SessionArchiveStore, "list" | "get" | "archive" | "restore" | "isArchived"> & {
  archiveMany?: (sessions: readonly ArchiveSessionInput[]) => Promise<ArchivedSessionRecord[]>;
  deleteArchived?: (sessionId: string) => Promise<void>;
  deleteArchivedMany?: (sessionIds: readonly string[]) => Promise<string[]>;
};

export type PiSessionRef = SessionRouteRef;
type PiSessionLookup = string | PiSessionRef;

export interface PiSessionListEntry {
  metadata?: import("../../shared/pluginApiTypes.js").SessionUiMetadata;
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

export interface ResolvedSessionFile {
  id: string;
  cwd: string;
  path: string;
}


interface BulkSessionLookupContext {
  sessionsByCwd: Map<string, PiSessionListEntry[]>;
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

interface ModelScopeContext {
  key: string;
  editable: boolean;
}

interface ModelScopeSnapshot {
  enabledIds: readonly string[] | null;
  revision: number;
}

interface SessionModelScopeCache {
  scopeKey: string;
  revision: number;
  catalogKey: string;
}

export interface PiSessionManager {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getBranch(): unknown[];
  getEntries?(): readonly unknown[];
  getTree?(): readonly ProjectableSessionTreeNode[];
  getLeafId(): string | null;
  branch(branchFromId: string): void;
  resetLeaf(): void;
  getHeader?(): { parentSession?: string; timestamp?: string } | null | undefined;
  appendCustomEntry?(customType: string, data?: unknown): string;
}

export interface PiSessionManagerGateway {
  list(cwd: string): Promise<PiSessionListEntry[]>;
  /** Resolve one cwd-scoped session without building the full workspace listing. */
  resolveSessionFile(cwd: string, sessionId: string): Promise<ResolvedSessionFile | undefined>;
  /** Invalidate a memoized summary after an in-place session-file rewrite. */
  invalidateSessionFile(sessionFile: string): void;
  /** Read the active transcript branch without creating a runtime or writing the file. */
  readBranch?(path: string): Promise<unknown[] | undefined>;
  /** Read all branches from the same immutable disk snapshot as readBranch. */
  readEntries?(path: string): Promise<readonly unknown[] | undefined>;
  create(cwd: string, options?: { parentSession?: string }): PiSessionManager;
  /**
   * Legacy id-only lookup surface for older clients. This intentionally searches
   * only Pi's default session store, because custom session directories require
   * a cwd-scoped lookup.
   */
  listAll(): Promise<PiSessionListEntry[]>;
  open(path: string): PiSessionManager;
}

interface PiExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

interface PiExtensionBindings {
  commandContextActions?: ExtensionCommandContextActions;
  uiContext?: ExtensionUIContext;
  mode?: "rpc";
  onError?: (error: PiExtensionError) => void;
}

export interface PiAgentSession {
  modelRuntime: PiSessionModelRuntime;
  settingsManager: {
    getWarnings(): { anthropicExtraUsage?: boolean };
    setWarnings(warnings: { anthropicExtraUsage?: boolean }): void;
    getGlobalSettings?(): { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: ClientThinkingLevel };
    setDefaultModelAndProvider?(provider: string, modelId: string): void;
    setDefaultThinkingLevel?(level: ClientThinkingLevel): void;
    flush?(): Promise<void>;
    drainErrors?(): { error: { message: string } }[];
    getEnabledModels(): string[] | undefined;
    getProjectSettings?(): object;
    isProjectTrusted?(): boolean;
    setEnabledModels(patterns: string[] | undefined): void;
    readonly piWebScopeKey?: string;
    readonly piWebModelScopeEditable?: boolean;
  };
  sessionManager: PiSessionManager;
  scopedModels: readonly { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[];
  setScopedModels(models: { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[]): void;
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
  promptTemplates: readonly { name: string; description?: string; argumentHint?: string }[];
  resourceLoader: { getSkills(): { skills: readonly { name: string; description?: string }[] } };
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: PiExtensionBindings): Promise<void>;
  compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }>;
  getUserMessagesForForking(): readonly { entryId: string; text: string }[];
  getSessionStats(): { sessionId: string; totalMessages: number; userMessages: number; assistantMessages: number; toolCalls: number; tokens: ClientSessionStatus["tokens"]; cost: number };
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  waitForIdle(): Promise<void>;
  getContextUsage(): ClientSessionStatus["contextUsage"] | undefined;
  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] }): Promise<void>;
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }): Promise<{ output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
  navigateTree?(targetId: string, options?: PiTreeNavigationOptions): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: unknown }>;
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
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
  getAvailable(): Promise<readonly AgentModel[]>;
  getAvailableSnapshot(): readonly AgentModel[];
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
  fork(entryId: string, options?: PiForkOptions): Promise<{ cancelled: boolean; selectedText?: string }>;
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

interface SkillCollectionResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

const GLOBAL_AGENT_CONTEXT_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);

export function filterPrivilegedManagementContextFiles(cwd: string, context: ManagementEmbedContext, base: AgentContextFilesResult): AgentContextFilesResult {
  const injectedInstructions = context.projects.flatMap((project) => [
    ...(project.agentsInstructions === undefined ? [] : [project.agentsInstructions]),
    ...(project.agentsInstructionsReplaceIfMatches ?? []),
  ]).map((content) => content.trim());
  return {
    agentsFiles: base.agentsFiles.filter((file) => !isManagedAgentsFile(file.content)
      && !(basename(file.path) === "AGENTS.md" && pathInsideOrEqual(dirname(file.path), cwd) && injectedInstructions.includes(file.content.trim()))),
  };
}

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

export function filterManagedProjectSkills(cwd: string, base: SkillCollectionResult, agentDir = getAgentDir()): SkillCollectionResult {
  const projectRoot = realpathSync(cwd);
  const pathAllowed = (path: string) => pathInsideRealDirectory(projectRoot, path);
  return filterManagedSkills(cwd, agentDir, base, pathAllowed);
}

export function filterManagedWorkbenchSkills(cwd: string, base: SkillCollectionResult, receipt: WorkbenchSkillReceiptFile, agentDir = getAgentDir()): SkillCollectionResult {
  const projectRoot = realpathSync(cwd);
  const allowedDirectories = new Set([
    ...MANAGED_RELAY_SKILL_NAMES.map((name) => resolve(projectRoot, ".pi", "skills", name)),
    ...receipt.skills.map((skill) => resolve(projectRoot, ".pi", "skills", skill.directory)),
  ]);
  const pathAllowed = (path: string) => [...allowedDirectories].some((directory) => pathInsideRealDirectory(directory, path));
  return filterManagedSkills(cwd, agentDir, base, pathAllowed);
}

function filterManagedSkills(cwd: string, agentDir: string, base: SkillCollectionResult, pathAllowed: (path: string) => boolean): SkillCollectionResult {
  const skills = base.skills.filter((skill) => pathAllowed(skill.filePath));
  const shadowedPaths = new Set<string>();
  const diagnostics = base.diagnostics.filter((diagnostic) => {
    const collision = diagnostic.collision;
    if (diagnostic.type === "collision" && collision?.resourceType === "skill") {
      const winnerAllowed = pathAllowed(collision.winnerPath);
      const loserAllowed = pathAllowed(collision.loserPath);
      if (!winnerAllowed && loserAllowed) shadowedPaths.add(collision.loserPath);
      return winnerAllowed && loserAllowed;
    }
    return diagnostic.path === undefined || pathAllowed(diagnostic.path);
  });

  // The SDK deduplicates names before this override. Restore permitted losers
  // instead of letting a discarded global/package winner hide them entirely.
  if (shadowedPaths.size > 0) {
    const recovered = loadSkills({ cwd, agentDir, skillPaths: [...shadowedPaths], includeDefaults: false });
    skills.push(...recovered.skills.filter((skill) => pathAllowed(skill.filePath)));
    for (const diagnostic of recovered.diagnostics) {
      if (!diagnostics.some((existing) => existing.type === diagnostic.type && existing.path === diagnostic.path && existing.message === diagnostic.message)) {
        diagnostics.push(diagnostic);
      }
    }
  }
  return { ...base, skills, diagnostics };
}

function pathInsideRealDirectory(directory: string, path: string): boolean {
  try {
    return pathInsideOrEqual(directory, realpathSync(path));
  } catch {
    return false;
  }
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
   * Cancels only unpublished startup. Hosted publication transfers lifetime
   * ownership, so a later abort must not stop the conversation.
   */
  startupSignal?: AbortSignal;
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
    throw new UserFacingError("routing.warningDismissInvalid", "Unknown session warning dismiss id: {arg0}", { arg0: dismissId });
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
  if (!(options.sessionManager instanceof SessionManager)) throw new UserFacingError("routing.runtimeManagerRequired", "Default runtime creation requires an SDK SessionManager");
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
interface ScopedSubsessionToolDeps {
  spawn(input: ScopedSpawnSubsessionInvocation): Promise<SpawnSubsessionResult>;
  list(parentSessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionSummary[]>;
  check(parentSessionId: string, sessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionCheckResult>;
  read(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionReadResult>;
}

type ResolveSettingsScopeDirectory = (cwd: string, mode: SessionSettingsMode) => Promise<string>;

export interface WorkbenchRuntimeDependencies {
  translator?: Translator;
  accessStates: WorkbenchAccessStateStore;
  client: WorkbenchClient;
  mcp: WorkbenchMcpClient;
  skills: WorkbenchSkillSynchronizer;
}

/** Append PI WEB-owned prompt sections after the operator's Pi prompt files. */
export function piWebResourceLoaderOptions(
  appendSystemPromptSections: readonly string[],
): CreateAgentSessionServicesOptions["resourceLoaderOptions"] | undefined {
  if (appendSystemPromptSections.length === 0) return undefined;
  return { appendSystemPromptOverride: (base) => [...base, ...appendSystemPromptSections] };
}

async function createNormalPermissionSessionServices(options: Required<Pick<CreateAgentSessionServicesOptions, "cwd" | "agentDir" | "modelRuntime" | "settingsManager">> & {
  projectTrustRequiring: boolean;
  appendSystemPromptSections: readonly string[];
  eventBus: ReturnType<typeof createEventBus>;
  agentsFilesOverride?: (base: AgentContextFilesResult) => AgentContextFilesResult;
}) {
  const { cwd, agentDir, settingsManager, projectTrustRequiring } = options;
  const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime: options.modelRuntime,
    settingsManager,
    resourceLoaderOptions: {
      ...piWebResourceLoaderOptions(options.appendSystemPromptSections),
      eventBus: options.eventBus,
      extensionFactories: await getBuiltinExtensionFactories(),
      ...(options.agentsFilesOverride === undefined ? {} : { agentsFilesOverride: options.agentsFilesOverride }),
      skillsOverride: (base: SkillCollectionResult) => deduplicateBundledRelaySkills(cwd, base),
    },
    ...(projectTrustRequiring ? {
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async ({ extensionsResult }) => resolveWebProjectTrusted({
          cwd,
          trustStore: new ProjectTrustStore(agentDir),
          settingsManager,
          extensionsResult,
          onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
        }),
      },
    } : {}),
  });
  return { services, projectTrustDiagnostics };
}

function createDefaultRuntimeFactory(
  sessionEvents: PiSessionEventConnections,
  normalModelRuntimeForCwd: (cwd: string) => Promise<ModelRuntime>,
  managementModelRuntime: () => Promise<ModelRuntime>,
  resolveSettingsScope: ResolveSettingsScopeDirectory,
  sessionManagers: Pick<PiSessionManagerGateway, "open">,
  spawn?: SpawnSessionFn,
  subsessions?: ScopedSubsessionToolDeps,
  askUser?: AskUserToolDeps,
  workbench?: WorkbenchRuntimeDependencies,
  logger: PiSessionLogger = noopLogger,
  managementAudit?: ManagementAuditRecorder,
  managementProjectIdForCwd?: (cwd: string, context: ManagementEmbedContext) => Promise<string>,
  appendSystemPromptSections: readonly string[] = [],
  managementAllowPrivileged = false,
): PiCreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, managementContext, initialModel, initialThinkingLevel, delegationToolsEnabled }) => {
    const scopedModelRuntime = managementContext === undefined ? await normalModelRuntimeForCwd(cwd) : await managementModelRuntime();
    if (managementContext !== undefined) {
      return createManagementRuntimeFactory(scopedModelRuntime, resolveSettingsScope, sessionManagers, spawn, subsessions, askUser, managementContext, workbench, logger, managementAudit, managementProjectIdForCwd, managementAllowPrivileged, appendSystemPromptSections)({
        cwd,
        agentDir,
        sessionManager,
        ...(delegationToolsEnabled === undefined ? {} : { delegationToolsEnabled }),
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        ...(initialModel === undefined ? {} : { initialModel }),
        ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
      });
    }

    // Resource loaders may read process.env; wait for managed overrides to be restored.
    return withRuntimeCreationEnvironment({}, async () => {
      const projectTrustRequiring = hasTrustRequiringProjectResources(cwd);
      const settingsManager = await createScopedSettingsManager({
        cwd,
        scopeDirectory: await resolveSettingsScope(cwd, "normal"),
        globalAgentDir: agentDir,
        mode: "normal",
        projectTrusted: !projectTrustRequiring,
      });
      // Only normal runtimes register a host connection; privileged management
      // packages keep their own event bus without exposing a normal-mode session.
      const eventBus = createEventBus();
      const { services, projectTrustDiagnostics } = await createNormalPermissionSessionServices({
        cwd,
        agentDir,
        modelRuntime: scopedModelRuntime,
        settingsManager,
        projectTrustRequiring,
        appendSystemPromptSections,
        eventBus,
      });
      const modelOptions = await resolveSessionModelOptions({
        services,
        hasExistingSession: sessionManager.buildSessionContext().messages.length > 0,
        ...(initialModel === undefined ? {} : { initialModel }),
        ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
      });
      services.diagnostics.push(...modelOptions.diagnostics);
      const resolvedDelegationToolsEnabled = delegationToolsEnabled
        ?? await sessionAllowsDelegationTools(sessionManager, sessionManagers);
      const customTools = createPiWebCustomToolDefinitions(cwd, resolvedDelegationToolsEnabled, spawn, subsessions, askUser);
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        customTools,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        ...(modelOptions.model === undefined ? {} : { model: modelOptions.model }),
        ...(modelOptions.thinkingLevel === undefined ? {} : { thinkingLevel: modelOptions.thinkingLevel }),
        ...(modelOptions.scopedModels.length === 0 ? {} : { scopedModels: modelOptions.scopedModels }),
      });
      sessionEvents.register(result.session, eventBus);
      const reload = result.session.reload.bind(result.session);
      result.session.reload = (options) => withRuntimeCreationEnvironment({}, () => reload(options));
      return { ...result, services, diagnostics: [...projectTrustDiagnostics, ...services.diagnostics] };
    });
  };
}

function createManagementRuntimeFactory(
  modelRuntime: ModelRuntime,
  resolveSettingsScope: ResolveSettingsScopeDirectory,
  sessionManagers: Pick<PiSessionManagerGateway, "open">,
  spawn: SpawnSessionFn | undefined,
  subsessions: ScopedSubsessionToolDeps | undefined,
  askUser: AskUserToolDeps | undefined,
  managementContext: ManagementEmbedContext,
  workbench: WorkbenchRuntimeDependencies | undefined,
  logger: PiSessionLogger,
  managementAudit: ManagementAuditRecorder | undefined,
  managementProjectIdForCwd: ((cwd: string, context: ManagementEmbedContext) => Promise<string>) | undefined,
  managementAllowPrivileged = false,
  appendSystemPromptSections: readonly string[] = [],
): PiCreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, initialModel, initialThinkingLevel, delegationToolsEnabled }) => {
    const normalPermissions = managementUsesNormalPermissions(managementContext, { allowPrivileged: managementAllowPrivileged });
    const privileges = managementPrivileges(managementContext, { allowPrivileged: managementAllowPrivileged });
    const resolvedDelegationToolsEnabled = delegationToolsEnabled
      ?? await sessionAllowsDelegationTools(sessionManager, sessionManagers);
    if (normalPermissions) await removeUnmodifiedManagedRelaySkills(cwd);
    else await ensureManagedRelaySkills(cwd);
    const auditIdentity = await resolveManagementAuditIdentity(cwd, managementContext, managementProjectIdForCwd, logger);
    const accessHandle = workbenchAccessHandle(managementContext);
    const state = normalPermissions || workbench === undefined ? undefined : await workbench.accessStates.prepare(accessHandle, workbench.client);
    const receipt = state === undefined ? undefined : await workbench?.skills.synchronize(cwd, state, {
      ...(managementAudit === undefined ? {} : { recorder: managementAudit }),
      ...auditIdentity,
      sessionId: sessionManager.getSessionId(),
      cwd,
    });
    const workbenchTools = state === undefined || workbench === undefined ? [] : createWorkbenchToolDefinitions({
      getState: () => workbench.accessStates.prepare(accessHandle, workbench.client),
      workbench: workbench.client,
      mcp: workbench.mcp,
      invalidate: () => { if (accessHandle !== undefined) workbench.accessStates.delete(accessHandle); },
      logger,
      ...(managementAudit === undefined ? {} : { audit: managementAudit }),
      auditContext: {
        ...auditIdentity,
        sessionId: sessionManager.getSessionId(),
        cwd,
      },
    });
    const scopedSpawn = spawn === undefined
      ? undefined
      : (input: SpawnSessionInvocation) => spawn({ ...input, managementContext });
    const scopedSubsessions = subsessions === undefined
      ? undefined
      : {
          spawn: (input: SpawnSubsessionInvocation) => subsessions.spawn({ ...input, managementContext }),
          list: (parentSessionId: string, parentSessionFile?: string) => subsessions.list(parentSessionId, parentSessionFile, managementContext),
          check: (parentSessionId: string, sessionId: string, parentSessionFile?: string) => subsessions.check(parentSessionId, sessionId, parentSessionFile, managementContext),
          read: (parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string) => subsessions.read(parentSessionId, sessionId, query, parentSessionFile, managementContext),
        };
    const scopedAskUser = askUser === undefined ? undefined : {
      open: (input: Parameters<AskUserToolDeps["open"]>[0]) => askUser.open({ ...input, managementContext }),
    };
    const controlledManagementTools = [
      ...(resolvedDelegationToolsEnabled && scopedSpawn !== undefined ? [defineTool(createSpawnSessionToolDefinition(cwd, { spawn: scopedSpawn }))] : []),
      ...(resolvedDelegationToolsEnabled && scopedSubsessions !== undefined ? createSubsessionToolDefinitions(cwd, scopedSubsessions).map((tool) => defineTool(tool)) : []),
      ...(scopedAskUser === undefined ? [] : [createAskUserToolDefinition(scopedAskUser)]),
      ...workbenchTools,
    ];
    const controlledManagementToolNames = controlledManagementTools.map((tool) => tool.name);
    if (!managementAllowPrivileged && managementPrivilegeRequested(managementContext)) {
      logger.info({
        userId: managementContext.user.id,
        requestedBash: managementContext.privileged?.bash === true,
        requestedNetwork: managementContext.privileged?.network === true,
      }, "management privileged grant ignored because managementEmbed.allowPrivileged is disabled");
    }
    const extraToolNames = [...controlledManagementToolNames, ...privilegedManagementToolNames(privileges)];
    const policyAgentDir = normalPermissions ? undefined : await writeManagementPermissionSystemPolicy(agentDir, cwd, managementContext, extraToolNames, privileges);
    const resourceEnvironment = normalPermissions ? {} : { [PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR]: policyAgentDir };
    return withRuntimeCreationEnvironment(resourceEnvironment, async () => {
      const settingsManager = await createScopedSettingsManager({
        cwd,
        scopeDirectory: await resolveSettingsScope(cwd, "management"),
        globalAgentDir: agentDir,
        mode: "management",
        // Signed management entry authorizes the project without changing ordinary trust decisions.
        projectTrusted: true,
      });
      const { services, projectTrustDiagnostics } = normalPermissions ? await createNormalPermissionSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        projectTrustRequiring: false,
        appendSystemPromptSections,
        eventBus: createEventBus(),
        agentsFilesOverride: (base) => filterPrivilegedManagementContextFiles(cwd, managementContext, base),
      }) : { services: await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          agentsFilesOverride: (base) => filterManagedGlobalContextFiles(cwd, agentDir, base),
          skillsOverride: (base) => receipt === undefined ? filterManagedProjectSkills(cwd, base, agentDir) : filterManagedWorkbenchSkills(cwd, base, receipt, agentDir),
        },
      }), projectTrustDiagnostics: [] };
      const modelOptions = await resolveSessionModelOptions({
        services,
        hasExistingSession: sessionManager.buildSessionContext().messages.length > 0,
        ...(initialModel === undefined ? {} : { initialModel }),
        ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
      });
      services.diagnostics.push(...modelOptions.diagnostics);
      const customTools = normalPermissions ? createPiWebCustomToolDefinitions(
        cwd, resolvedDelegationToolsEnabled, scopedSpawn, scopedSubsessions, scopedAskUser,
      ) : [
        ...managedAgentToolDefinitions(cwd, createManagedAgentToolOptions(cwd)),
        createManagedPythonToolDefinition(cwd, managementContext, { network: privileges.network }),
        createManagedBashToolDefinition(cwd, managementContext, { network: privileges.network, hostFilesystem: privileges.bash }),
        ...controlledManagementTools,
      ];
      const options = {
        services,
        sessionManager,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
        customTools,
        ...(normalPermissions ? {} : { tools: managementAgentToolNames(managementContext, extraToolNames, privileges) }),
        ...(modelOptions.model === undefined ? {} : { model: modelOptions.model }),
        ...(modelOptions.thinkingLevel === undefined ? {} : { thinkingLevel: modelOptions.thinkingLevel }),
        ...(modelOptions.scopedModels.length === 0 ? {} : { scopedModels: modelOptions.scopedModels }),
      };
      const result = await createAgentSessionFromServices(options);
      // SDK reload re-executes extensions, so it needs the same scoped environment as startup.
      const reload = result.session.reload.bind(result.session);
      result.session.reload = (options) => withRuntimeCreationEnvironment(resourceEnvironment, async () => {
        if (normalPermissions) await removeUnmodifiedManagedRelaySkills(cwd);
        else await ensureManagedRelaySkills(cwd);
        return reload(options);
      });
      return { ...result, services, diagnostics: [...projectTrustDiagnostics, ...services.diagnostics] };
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
  translator?: Translator;
  sessionEvents?: PiSessionEventConnections;
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
   * When true (and `spawnTargets` is provided), the tracked-subsession
   * tools are available to sessions whose creation provenance permits
   * delegation. On by default; the operator opts out via config or environment.
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
  /** Optional durable metadata-only recorder for ordinary-mode tool calls. */
  normalToolAudit?: Pick<NormalToolAuditStore, "record">;
  /** Optional Elasticsearch recorder for user-scoped management-mode audit events. */
  managementAudit?: ManagementAuditRecorder;
  /** Resolve the authorized management project owning a session cwd. */
  managementProjectIdForCwd?: (cwd: string, context: ManagementEmbedContext) => Promise<string>;
  /**
   * When true, signed management-embed `privileged` grants may enable the
   * constrained bash tool and sandbox network. Default false.
   */
  managementAllowPrivileged?: boolean;
  /** Clock seam for cleanup planning tests. */
  now?: () => Date;
  /** Daemon-lifetime notification state, injected by sessiond in production. */
  notificationStore?: SessionNotificationStore;
  /** Durable daemon-owned unread state; defaults to an in-memory store in tests. */
  unreadStore?: SessionUnreadStore;
  /** Initial retry delay for durable unread publication failures. */
  unreadPublicationRetryDelayMs?: number;
  /** Notify the machine status projection when unread state changes. */
  onUnreadChanged?: (scope: string, hasNewCompletion: boolean) => void;
  /**
   * Lets session startup report that provider model lists are refreshing while
   * a session is being constructed. Omit to report the startup phase alone.
   */
  catalogRefreshStatus?: CatalogRefreshStatus;
  /** Live config reader for request-time workspace defaults. */
  config?: Pick<PiWebConfigService, "read">;
  workbench?: WorkbenchRuntimeDependencies;
  /** PI WEB session nesting facts appended only to ordinary-mode sessions. */
  appendSystemPromptSections?: readonly string[];
}

export class PiSessionService {
  private readonly t: Translator;
  private readonly active = new Map<string, ManagedActiveSession>();
  private readonly runtimeBySession = new WeakMap<PiAgentSession, PiSessionRuntime>();
  /** Media cold reads must not reopen files observed under a management identity. */
  private readonly managementMediaFiles = new Set<string>();
  private readonly pendingSessionOpens = new Map<string, PendingSessionOpen>();
  /** Sessions whose extension binding is parked on a `session_start` dialog. */
  private readonly startupSessions = new Map<string, ManagedStartupSession>();
  private readonly activities = new SessionActivityCoordinator();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly activityMarker: SessionActivityMarker;
  private readonly commandService: SessionCommandService<PiAgentSession>;
  /** Runtime-identity gate held while Pi may await abandoned-branch summarization. */
  private readonly treeNavigations = new WeakSet<PiAgentSession>();
  private readonly unpersistedTreeBranchLeaves = new WeakMap<PiAgentSession, string | null>();
  /** Counts async operations that may append an entry before they settle. */
  private readonly sessionEntryMutationCounts = new WeakMap<PiAgentSession, number>();
  private readonly manualCompactionEnded = new WeakSet<PiAgentSession>();
  private readonly extensionCommandExecution = new AsyncLocalStorage<ExtensionCommandExecution>();
  private readonly runtimeMessageCounts = new WeakMap<PiAgentSession, number>();
  private readonly snapshotMessageCounts = new WeakMap<readonly unknown[], number>();
  private readonly pendingPromptEchoes = new WeakMap<PiAgentSession, { userIndex: number; message: ReturnType<typeof userMessage> }[]>();
  private readonly publishedAssistantPartials = new WeakMap<PiAgentSession, unknown>();
  private readonly assistantStreamIds = new WeakMap<PiAgentSession, string>();
  private readonly suggestedInputs = new Map<string, string>();
  /** Serializes enabled-model read/modify/write operations. */
  private modelScopeMutationQueue: Promise<void> = Promise.resolve();
  /** Effective enabled-model state keyed by the project-scoped settings store. */
  private readonly modelScopeStates = new Map<string, ModelScopeSnapshot>();
  private readonly modelScopeInitializations = new Map<string, Promise<ModelScopeSnapshot>>();
  private modelScopeRevision = 0;
  private readonly modelScopeCache = new WeakMap<PiAgentSession, SessionModelScopeCache>();
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
  private readonly subsessionLinks = new Map<string, ScopedTrackedSubsessionLink>();
  /** Parent id/file identities whose persisted links have already been loaded. */
  private readonly subsessionHydratedParents = new Set<string>();
  /** Session file path -> its parsed header. Headers are written once, so successful reads are cached. */
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
  private readonly sessionEvents: PiSessionEventConnections;
  private readonly normalModelRuntimeForCwd: (cwd: string) => Promise<ModelRuntime>;
  private readonly managementModelRuntime: () => Promise<ModelRuntime>;
  private readonly workspaceActivity: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity"> | undefined;
  private readonly spawnTargets: SpawnTargetResolver | undefined;
  private readonly logger: PiSessionLogger;
  private readonly normalToolAudit: Pick<NormalToolAuditStore, "record"> | undefined;
  private readonly managementAudit: ManagementAuditRecorder | undefined;
  private readonly managementProjectIdForCwd: ((cwd: string, context: ManagementEmbedContext) => Promise<string>) | undefined;
  private readonly now: () => Date;
  private readonly notificationStore: SessionNotificationStore;
  private readonly scopedNotificationStores = new Map<string, SessionNotificationStore>();
  private readonly scopedUnreadStores = new Map<string, SessionUnreadStore>();
  private readonly sessionEventScopes = new WeakMap<PiAgentSession, string>();
  private readonly sessionManagementContexts = new WeakMap<PiAgentSession, ManagementEmbedContext>();
  private readonly notificationGenerationBySession = new WeakMap<PiAgentSession, SessionNotificationGeneration>();
  private readonly idleSessionFileResolutions = new WeakMap<PiAgentSession, { at: number; path: string | undefined }>();
  private readonly unreadStore: SessionUnreadStore;
  private readonly pendingAskStore: PendingAskStore;
  private readonly pendingExtensionDialogStore: PendingExtensionDialogStore;
  private readonly extensionDialogsTimeoutMs: number;
  /** The parked extension Promise resolvers behind the store's open dialogs. */
  private readonly dialogWaiters = new ExtensionDialogWaiters();
  private readonly catalogRefreshStatus: CatalogRefreshStatus | undefined;
  private readonly config: Pick<PiWebConfigService, "read"> | undefined;
  private readonly unreadPublicationRetryInitialMs: number;
  private readonly onUnreadChanged: ((scope: string, hasNewCompletion: boolean) => void) | undefined;
  private readonly pendingUnreadMutations: SessionUnreadMutation[] = [];
  private unreadPublication: Promise<void> | undefined;
  private unreadPublicationFailure: unknown;
  private unreadPublicationFlushRequested = false;
  private unreadPublicationRetryTimer: NodeJS.Timeout | undefined;
  private unreadPublicationRetryDelayMs: number;
  private unreadPublicationStopped = false;

  constructor(private readonly events: SessionEventHub, deps: PiSessionServiceDependencies) {
    this.t = deps.translator ?? loadNodeTranslator("server");
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
      defaultModelRuntime ??= deps.modelRuntime === undefined ? createLocalOnlyModelRuntime() : Promise.resolve(deps.modelRuntime);
      return defaultModelRuntime;
    };
    this.normalModelRuntimeForCwd = deps.normalModelRuntimeForCwd ?? resolveDefaultModelRuntime;
    const managementModelRuntime = deps.managementModelRuntime;
    this.managementModelRuntime = managementModelRuntime === undefined
      ? resolveDefaultModelRuntime
      : () => Promise.resolve(managementModelRuntime);
    this.spawnTargets = deps.spawnTargets;
    this.logger = deps.logger ?? noopLogger;
    this.normalToolAudit = deps.normalToolAudit;
    this.managementAudit = deps.managementAudit;
    this.managementProjectIdForCwd = deps.managementProjectIdForCwd;
    this.now = deps.now ?? (() => new Date());
    this.activityMarker = new SessionActivityMarker({
      now: () => this.now().getTime(),
      onError: (error) => { this.logger.info({ err: error }, "Could not update advisory session activity marker"); },
    });
    this.notificationStore = deps.notificationStore ?? new SessionNotificationStore();
    this.unreadStore = deps.unreadStore ?? new SessionUnreadStore();
    this.onUnreadChanged = deps.onUnreadChanged;
    this.pendingAskStore = deps.pendingAskStore ?? new PendingAskStore();
    this.pendingExtensionDialogStore = deps.pendingExtensionDialogStore ?? new PendingExtensionDialogStore();
    this.extensionDialogsTimeoutMs = deps.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS;
    this.catalogRefreshStatus = deps.catalogRefreshStatus;
    this.config = deps.config;
    this.unreadPublicationRetryInitialMs = Math.max(
      0,
      deps.unreadPublicationRetryDelayMs ?? DEFAULT_UNREAD_PUBLICATION_RETRY_MS,
    );
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
    // Subsessions are gated behind their own flag, and they
    // also require the spawn capability (they share its project-scope resolver).
    const subsessionsActive = this.spawnTargets !== undefined && deps.subsessionsEnabled === true;
    this.sessionEvents = deps.sessionEvents ?? new PiSessionEventConnections();
    this.createRuntime = deps.createRuntime ?? createDefaultRuntimeFactory(
      this.sessionEvents,
      this.normalModelRuntimeForCwd,
      this.managementModelRuntime,
      (cwd, mode) => this.resolveSettingsScopeDirectory(cwd, mode),
      this.sessionManager,
      this.spawnTargets === undefined ? undefined : (input) => this.spawnSession(input),
      !subsessionsActive ? undefined : {
        spawn: (input) => this.spawnSubsession(input),
        list: (parentSessionId, parentSessionFile, managementContext) => this.listSubsessions(parentSessionId, parentSessionFile, managementContext),
        check: (parentSessionId, sessionId, parentSessionFile, managementContext) => this.checkSubsession(parentSessionId, sessionId, parentSessionFile, managementContext),
        read: (parentSessionId, sessionId, query, parentSessionFile, managementContext) => this.readSubsession(parentSessionId, sessionId, query, parentSessionFile, managementContext),
      },
      deps.askUserEnabled === true ? { open: (input) => this.openAsk(input, input.managementContext) } : undefined,
      deps.workbench,
      this.logger,
      this.managementAudit,
      this.managementProjectIdForCwd,
      deps.appendSystemPromptSections ?? [],
      deps.managementAllowPrivileged === true,
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
          this.beginSessionEntryMutation(session, this.t("session.action.compact", "compact the session"));
          this.manualCompactionEnded.delete(session);
          this.publishActivity(session, this.t("activity.compacting", "Compacting context"), "active");
          this.publishStatus(session);
        },
        onCompactionEnd: (session, result, detail) => {
          this.endSessionEntryMutation(session);
          if (!this.manualCompactionEnded.delete(session) && result === "error") {
            this.publishCompactionOutcome(session, { reason: "manual", errorMessage: this.t("command.compactionFailed", "Compaction failed: {value0}", { value0: detail ?? "Unknown error" }) });
          }
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
            this.t("session.stopBeforeReplace", "Stop current session activity before replacing the session"),
            operation,
          );
        },
      },
      { listSessionNames: (cwd) => this.listSessionNames(cwd) },
      this.t,
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

  async cleanup(request: NormalizedSessionCleanupRequest, context?: ManagementEmbedContext): Promise<ClientSessionCleanupExecuteResponse> {
    const scope = eventScopeFromManagementContext(context);
    const plan = await this.cleanupPlan(request);
    if (plan.deleteRecords.length > 0 && this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error(this.t("session.archiveDeleteUnsupported", "The archive store does not support deletion"));

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
      await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" }, scope);
      readyArchiveInputs.push(input);
    }
    await this.archiveStoreArchiveMany(readyArchiveInputs);
    archiveInputs.push(...readyArchiveInputs);
    await this.forgetUnreadSessions(readyArchiveInputs, scope);

    for (const record of plan.deleteRecords) {
      if (this.activeSessionHasWork(record.sessionId)) {
        skippedBusySessionIds.add(record.sessionId);
        continue;
      }
      await this.closeActive(record.sessionId, { kind: "clear", reason: "delete" }, scope);
      readyDeleteRecords.push(record);
    }
    const deletedSessionIds = new Set(await this.archiveStoreDeleteArchivedMany(readyDeleteRecords.map((record) => record.sessionId)));
    deleteRecords.push(...readyDeleteRecords.filter((record) => deletedSessionIds.has(record.sessionId)));
    await this.forgetUnreadSessions(deleteRecords, scope);

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
      this.pendingAskStore.forgetSession(this.dialogSessionKey(active.runtime.session));
      this.endSessionExtensionDialogs(active.runtime.session);
    }
    this.active.clear();
    this.pendingSessionOpens.clear();
    this.startupSessions.clear();
    this.suggestedInputs.clear();
    this.activities.clear();
    this.compactionPromptQueues.clear();
    this.authLossWarnings.clear();
    this.subsessionParents.clear();
    this.subsessionChildren.clear();
    this.subsessionLinks.clear();
    this.subsessionHydratedParents.clear();
    this.subsessionNotifyArmed.clear();
    this.notificationStore.clearAll("service-dispose");
    for (const store of this.scopedNotificationStores.values()) store.clearAll("service-dispose");
    await Promise.all(activeSessions.map(async (active) => {
      active.unsubscribe();
      active.runtime.setRebindSession(undefined);
      this.workspaceActivity?.removeSession(active.runtime.session.sessionId, active.runtime.session.sessionManager.getCwd(), active.eventScope);
      try {
        await this.abortSessionOperations(active.runtime.session);
      } finally {
        await active.runtime.dispose();
      }
    })).finally(async () => {
      this.extensionCommandExecution.disable();
      this.events.mediaIndex.clear();
      await this.activityMarker.dispose();
    });
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

  async setPinned(ref: SessionRouteRef, pinned: boolean, managementContext?: ManagementEmbedContext): Promise<SessionPinResponse> {
    if (ref.cwd === "") throw new Error(this.t("session.pinWorkspaceRequired", "A workspace is required to pin a session"));
    const sessions = await this.list(ref.cwd, managementContext);
    const session = sessions.find((candidate) => candidate.id === ref.id);
    if (session === undefined) throw new Error(this.t("session.notFound", "Session not found"));
    if (session.archived !== true && session.persisted === false) throw new Error(this.t("session.pinPersistedOnly", "Only persisted sessions can be pinned"));
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
      this.publishNotificationMutations(this.notificationsForScope(eventScopeFromManagementContext(managementContext)).clearSession(record.sessionId, "archive-reconcile"));
    }
    const unarchivedById = new Map(sessions.filter((session) => !archivedById.has(session.id)).map((session) => [session.id, clientSessionFromListEntry(session)]));
    const eventScope = eventScopeFromManagementContext(managementContext);
    for (const active of new Set(this.active.values())) {
      if (active.eventScope !== eventScope) continue;
      const session = active.runtime.session;
      if (!cwdPathsEqual(session.sessionManager.getCwd(), cwd) || archivedById.has(session.sessionId) || unarchivedById.has(session.sessionId)) continue;
      unarchivedById.set(session.sessionId, clientSessionFromActiveSession(session));
    }
    const unarchivedSessions = [...unarchivedById.values()].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
    const reconcilableSessionIds = this.reconcilableSessionIds(cwd, unarchivedSessions.map((session) => session.id), archivedById);
    this.workspaceActivity?.reconcileSessionActivity(cwd, reconcilableSessionIds, eventScopeFromManagementContext(managementContext));
    if (managementContext === undefined) {
      await this.publishUnreadMutations(this.unreadForScope(eventScopeFromManagementContext(managementContext)).reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds));
    }
    const archivedSessions = archivedForCwd
      .map((record) => clientSessionFromArchivedRecord(record, sessionsById.get(record.sessionId)))
      .filter(isDefined)
      .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
    return {
      sessions: [...unarchivedSessions, ...archivedSessions],
      entriesById: new Map(sessions.map((session) => [session.id, session])),
      archivedById,
    };
  }

  /** Read-only plugin catalog: do not open runtimes or reconcile unread/activity state. */
  async listCatalogSessions(cwd: string, signal?: AbortSignal): Promise<readonly PluginSessionSnapshot[]> {
    signal?.throwIfAborted();
    const [entries, archives] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    signal?.throwIfAborted();
    const managementFiles = [...new Set(this.active.values())]
      .filter((active) => active.eventScope !== NORMAL_SESSION_EVENT_SCOPE)
      .map((active) => active.runtime.session.sessionFile)
      .filter((path) => path !== undefined);
    const archived = archives.filter((record) => cwdPathsEqual(record.cwd, cwd));
    const archivedIds = new Set(archived.map((record) => record.sessionId));
    const rows = new Map(entries.filter((entry) => !archivedIds.has(entry.id)
      && !managementFiles.some((path) => sessionPathsEqual(path, entry.path))).map((entry) => [entry.id, clientSessionFromListEntry(entry)]));
    const runtimes = new Map<string, PiAgentSession>();
    for (const active of new Set(this.active.values())) {
      if (active.eventScope !== NORMAL_SESSION_EVENT_SCOPE) continue;
      const session = active.runtime.session;
      if (!cwdPathsEqual(session.sessionManager.getCwd(), cwd) || archivedIds.has(session.sessionId)) continue;
      const row = rows.get(session.sessionId);
      // A disk clone with the same id must not inherit another file's runtime.
      if (row !== undefined && (session.sessionFile === undefined || !sessionPathsEqual(row.path, session.sessionFile))) continue;
      runtimes.set(session.sessionId, session);
      rows.set(session.sessionId, clientSessionFromActiveSession(session));
    }
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const record of archived) {
      const row = clientSessionFromArchivedRecord(record, entriesById.get(record.sessionId));
      if (row !== undefined) rows.set(row.id, row);
    }
    return [...rows.values()].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).map((row) => {
      const runtime = runtimes.get(row.id);
      return Object.freeze({
        id: row.id,
        cwd: row.cwd,
        ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.metadata === undefined ? {} : { metadata: structuredClone(row.metadata) }),
        archived: row.archived === true,
        runtime: runtime === undefined ? "not-hosted" : this.hasActiveWork(runtime) ? "busy" : "idle",
      } satisfies PluginSessionSnapshot);
    });
  }

  async start(cwd: string, options: StartSessionOptions = {}): Promise<ClientSession> {
    if (options.managementContext === undefined) await this.normalModelRuntimeForCwd(cwd);
    return this.startSession(cwd, options);
  }

  /** Publish a host-owned normal-mode conversation without submitting an initial prompt. */
  async createHostedSession(cwd: string, signal: AbortSignal): Promise<{ readonly id: string }> {
    const created = await this.startManagedSession(cwd, signal);
    return Object.freeze({ id: created.id });
  }

  /** Atomically start and prompt one visible normal-mode, non-delegating session. */
  async startOneShotRun(
    cwd: string,
    text: unknown,
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly completion: Promise<void> }> {
    const promptText = requirePromptText(text, this.t);
    return this.startManagedSession(cwd, signal, promptText);
  }

  private async startManagedSession(
    cwd: string,
    signal: AbortSignal,
    promptText?: string,
  ): Promise<{ readonly id: string; readonly completion: Promise<void> }> {
    signal.throwIfAborted();
    await this.normalModelRuntimeForCwd(cwd);
    const active = await this.create(
      this.sessionManager.create(cwd),
      cwd,
      { startupIntent: "create", creationProvenance: "host-one-shot", startupSignal: signal },
    );
    const { session } = active.runtime;
    try {
      signal.throwIfAborted();
      if (promptText !== undefined) this.maybeGenerateSessionName(session, promptText);
      const created = this.announceCreatedSession(active, cwd);
      // Publication transfers lifetime ownership to normal hosting. Plugin
      // cancellation after this point must not abort this or later user work.
      const completion = promptText === undefined ? Promise.resolve() : this.submitInitialRunPrompt(session, promptText);
      return Object.freeze({ id: created.id, completion });
    } catch (error) {
      try {
        await this.closeActive(session.sessionId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          this.t("server.main.dbc19a47e7b3", "Failed to clean up managed session {arg0} after startup failed", { arg0: session.sessionId }),
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }

  private announceCreatedSession(
    active: ManagedActiveSession,
    cwd: string,
    parentSession?: string,
  ): ClientSession {
    const { session } = active.runtime;
    const created: ClientSession = {
      ...clientSessionFromActiveSession(session),
      cwd,
      ...(parentSession === undefined ? {} : { parentSessionPath: parentSession }),
    };
    this.events.publishGlobal({ type: "session.created", session: created }, active.eventScope);
    return created;
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
    return this.announceCreatedSession(active, cwd, options.parentSession);
  }

  /**
   * Start a new session on behalf of a LLM and deliver an initial prompt to it.
   * The target cwd is constrained to a workspace of the same registered project
   * as the spawning session so the new session is visible in the web UI.
   */
  async spawnSession(input: ScopedSpawnSessionInvocation): Promise<SpawnSessionResult> {
    if (this.spawnTargets === undefined) throw new Error(this.t("session.spawningDisabled", "Session spawning is disabled"));
    const decision = await this.spawnTargets.resolveSpawnTarget(
      input.spawningCwd,
      input.cwd,
      eventScopeFromManagementContext(input.managementContext),
    );
    if (!decision.allowed) throw spawnTargetError(decision, this.t);
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

  /** Start a tracked child in the parent's workspace so it remains visible in the same session tree. */
  async spawnSubsession(input: ScopedSpawnSubsessionInvocation): Promise<SpawnSubsessionResult> {
    if (this.spawnTargets === undefined) throw new Error(this.t("session.spawningDisabled", "Session spawning is disabled"));
    if (input.cwd !== undefined && input.cwd !== "" && !cwdPathsEqual(input.cwd, input.spawningCwd)) {
      throw subsessionCwdError(input.spawningCwd, input.cwd, this.t);
    }
    const decision = await this.spawnTargets.resolveSpawnTarget(
      input.spawningCwd,
      undefined,
      eventScopeFromManagementContext(input.managementContext),
    );
    if (!decision.allowed) throw spawnTargetError(decision, this.t);
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
    const scopedLink = await this.registerVerifiedSubsession(link, input.managementContext);
    this.persistSubsessionLink(scopedLink);
    this.persistSubsessionChildMarker(scopedLink);
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

  private modelScopeContext(session: PiAgentSession): ModelScopeContext {
    const settingsKey = session.settingsManager.piWebScopeKey ?? "global";
    const projectSettings = session.settingsManager.getProjectSettings?.() ?? {};
    if (Object.hasOwn(projectSettings, "enabledModels")) {
      const workspace = canonicalizeStoredCwd(session.sessionManager.getCwd());
      return { key: `${settingsKey}:workspace:${workspace}`, editable: false };
    }
    return { key: settingsKey, editable: session.settingsManager.piWebModelScopeEditable !== false };
  }

  private async modelScopeSnapshot(session: PiAgentSession, context = this.modelScopeContext(session)): Promise<ModelScopeSnapshot> {
    const existing = this.modelScopeStates.get(context.key);
    if (existing !== undefined) return existing;
    const pending = this.modelScopeInitializations.get(context.key);
    if (pending !== undefined) return pending;
    const initialization = (async () => {
      const enabledIds = await resolveEnabledModelIds({
        settingsManager: session.settingsManager,
        // Runtime-backed sessions always hold the SDK ModelRuntime; PiAgentSession keeps a narrow public seam for tests.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        modelRuntime: session.modelRuntime as ModelRuntime,
        scopedModels: session.scopedModels,
      });
      const snapshot: ModelScopeSnapshot = { enabledIds: enabledIds === null ? null : [...enabledIds], revision: 0 };
      this.modelScopeStates.set(context.key, snapshot);
      return snapshot;
    })();
    this.modelScopeInitializations.set(context.key, initialization);
    try {
      return await initialization;
    } finally {
      if (this.modelScopeInitializations.get(context.key) === initialization) this.modelScopeInitializations.delete(context.key);
    }
  }

  private async synchronizeSessionModelScope(session: PiAgentSession, available: readonly AgentModel[]): Promise<void> {
    const context = this.modelScopeContext(session);
    const snapshot = await this.modelScopeSnapshot(session, context);
    const catalogKey = available.map(modelScopeId).join("\0");
    const cached = this.modelScopeCache.get(session);
    if (cached?.scopeKey === context.key && cached.revision === snapshot.revision && cached.catalogKey === catalogKey) return;
    session.setScopedModels(scopedModelsFromEnabledIds(available, snapshot.enabledIds, session.scopedModels));
    this.modelScopeCache.set(session, { scopeKey: context.key, revision: snapshot.revision, catalogKey });
  }

  private async sessionModelCandidates(session: PiAgentSession): Promise<readonly AgentModel[]> {
    await session.modelRuntime.refresh({ allowNetwork: false });
    const available = session.modelRuntime.getAvailableSnapshot();
    await this.synchronizeSessionModelScope(session, available);
    return session.scopedModels.length > 0 ? session.scopedModels.map((scoped) => scoped.model) : available;
  }

  private async enabledModelCatalog(session: PiAgentSession): Promise<EnabledModelCatalogEntry<AgentModel>[]> {
    await session.modelRuntime.refresh({ allowNetwork: false });
    const available = session.modelRuntime.getAvailableSnapshot();
    await this.synchronizeSessionModelScope(session, available);
    const context = this.modelScopeContext(session);
    return catalogWithEnabledFirst(available, (await this.modelScopeSnapshot(session, context)).enabledIds);
  }

  private runModelScopeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.modelScopeMutationQueue.then(operation);
    this.modelScopeMutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private reloadModelScope(session: PiAgentSession): Promise<void> {
    return this.runModelScopeMutation(async () => {
      const context = this.modelScopeContext(session);
      await this.modelScopeInitializations.get(context.key);
      const enabledIds = await resolveEnabledModelIds({
        settingsManager: session.settingsManager,
        // Runtime-backed sessions hold the SDK ModelRuntime behind the narrow test seam.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        modelRuntime: session.modelRuntime as ModelRuntime,
        scopedModels: [],
      });
      const revision = ++this.modelScopeRevision;
      this.modelScopeStates.set(context.key, { enabledIds, revision });
      await this.synchronizeSessionModelScope(session, session.modelRuntime.getAvailableSnapshot());
      this.events.publishGlobal({ type: "models.changed", revision }, this.eventScopeForSession(session));
    });
  }

  private applyEnabledModelScope(
    session: PiAgentSession,
    available: readonly AgentModel[],
    enabledIds: readonly string[] | null,
  ): void {
    const context = this.modelScopeContext(session);
    const availableIds = available.map(modelScopeId);
    const persisted = persistedEnabledModelPatterns(enabledIds, availableIds);
    const nextState: ModelScopeSnapshot = {
      enabledIds: persisted === undefined ? null : enabledIds === null ? [] : [...enabledIds],
      revision: ++this.modelScopeRevision,
    };
    session.settingsManager.setEnabledModels(persisted);
    this.modelScopeStates.set(context.key, nextState);
    session.setScopedModels(scopedModelsFromEnabledIds(available, nextState.enabledIds, session.scopedModels));
    this.modelScopeCache.set(session, { scopeKey: context.key, revision: nextState.revision, catalogKey: available.map(modelScopeId).join("\0") });
    this.events.publishGlobal({ type: "models.changed", revision: nextState.revision });
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
    if (model === undefined) throw unknownSpawnModelError(modelSpec, this.t);
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
  async openAsk(input: AskUserInvocation, managementContext?: ManagementEmbedContext): Promise<PendingAskOpenResult> {
    const scope = eventScopeFromManagementContext(managementContext);
    const sessionKey = scope === NORMAL_SESSION_EVENT_SCOPE ? input.sessionId : activeSessionKey(input.sessionId, scope);
    const result = this.pendingAskStore.open({ ...input, sessionId: sessionKey });
    // A supersede closes the earlier ask, so the browsers watching it must hear
    // that before they hear about its replacement.
    if (result.superseded !== undefined) this.publishAskClosed(input.sessionId, result.superseded, scope);
    this.events.publish(input.sessionId, { type: "ask.opened", ask: result.ask }, scope);
    this.publishStatusForSessionId(input.sessionId, scope);
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
  async submitAsk(ref: PiSessionLookup, askId: string, submission: AskUserSubmission, managementContext?: ManagementEmbedContext): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    // Checked before the store closes the ask so a refused delivery cannot
    // discard answers the user already submitted.
    this.assertTreeNavigationInactive(session, this.t("session.action.answer", "answer questions"));
    return this.closeAsk(session, this.pendingAskStore.submit(this.dialogSessionKey(session), askId, submission));
  }

  /**
   * Close the open ask without answers. The model is still told, naming every
   * question as unanswered: it was promised a follow-up message and would
   * otherwise wait for one that never comes.
   */
  async cancelAsk(ref: PiSessionLookup, askId: string, managementContext?: ManagementEmbedContext): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.assertTreeNavigationInactive(session, this.t("session.action.dismiss", "dismiss questions"));
    return this.closeAsk(session, this.pendingAskStore.cancel(this.dialogSessionKey(session), askId));
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
    this.publishAskClosed(session.sessionId, outcome, this.eventScopeForSession(session));
    await this.runSessionEntryMutation(session, this.t("server.main.07f784061918", "deliver answers to your questions"), () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      { triggerTurn: true, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  private publishAskClosed(sessionId: string, outcome: AskUserOutcome, scope: string): void {
    this.events.publish(sessionId, { type: "ask.closed", askId: outcome.askId, reason: outcome.reason }, scope);
  }

  /**
   * Void the session's open ask because the user sent a chat message instead of
   * answering it. Every browser closes the card as cancelled, and the model is
   * told — without being woken — so the notice rides into the turn the message
   * itself triggers rather than becoming a turn of its own.
   */
  private async voidOpenAskForUserMessage(session: PiAgentSession): Promise<void> {
    const outcome = this.pendingAskStore.cancelOpen(this.dialogSessionKey(session));
    if (outcome === undefined) return;
    this.publishAskClosed(session.sessionId, outcome, this.eventScopeForSession(session));
    await this.runSessionEntryMutation(session, this.t("server.main.90b5a8ac7c7d", "void the open questions"), () => session.sendCustomMessage(
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
    startupSignal?: AbortSignal,
  ): Promise<boolean | string | undefined> {
    const signal = opts?.signal === undefined
      ? startupSignal
      : startupSignal === undefined
        ? opts.signal
        : AbortSignal.any([opts.signal, startupSignal]);
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
  async listSubsessions(parentSessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionSummary[]> {
    const parentFile = nonEmptyString(parentSessionFile);
    const scope = eventScopeFromManagementContext(managementContext);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile, managementContext);
    const childIds = this.subsessionChildren.get(activeSessionKey(parentSessionId, scope));
    if (childIds === undefined) return [];
    const authorizedChildIds = [...childIds].filter((childId) => this.subsessionLinkBelongsToParent(parentSessionId, parentFile, childId, scope));
    return Promise.all(authorizedChildIds.map(async (childId) => ({ sessionId: childId, ...(await this.subsessionSummaryFields(childId, scope)) })));
  }

  /** Status and final result of a subsession, scoped to the caller's children. */
  async checkSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionCheckResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile, managementContext);
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
  async readSubsession(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<SubsessionReadResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile, managementContext);
    const view = buildTranscriptView(historyMessages(session), query);
    return {
      sessionId,
      cwd: session.sessionManager.getCwd(),
      status: this.subsessionStatus(session),
      ...view,
    };
  }

  /** Open a session after verifying it is one of the caller's tracked children. */
  private async openSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<PiAgentSession> {
    const parentFile = nonEmptyString(parentSessionFile);
    const scope = eventScopeFromManagementContext(managementContext);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile, managementContext);
    if (this.subsessionParents.get(activeSessionKey(sessionId, scope)) !== parentSessionId || !this.subsessionLinkBelongsToParent(parentSessionId, parentFile, sessionId, scope)) {
      throw new Error(`Session ${sessionId} is not one of your subsessions`);
    }
    return this.getOrOpenTrackedSubsession(sessionId, scope);
  }

  private subsessionLinkBelongsToParent(parentSessionId: string, parentSessionFile: string | undefined, childSessionId: string, scope: string): boolean {
    const link = this.subsessionLinks.get(activeSessionKey(childSessionId, scope));
    if (link?.parentSessionId !== parentSessionId) return false;
    return parentSessionFile === undefined || trackedLinkParentFileMatches(link, parentSessionFile);
  }

  private activeChildForSubsessionLink(link: ScopedTrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    const active = this.activeForSessionIdAndScope(link.childSessionId, link.eventScope);
    return active !== undefined && activeSessionFileMatches(active, link.childSessionFile) ? active : undefined;
  }

  private activeParentForSubsessionLink(link: ScopedTrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    const active = this.activeForSessionIdAndScope(link.parentSessionId, link.eventScope);
    return active !== undefined && activeSessionFileMatches(active, link.parentSessionFile) ? active : undefined;
  }

  private subsessionLinkForActiveChild(session: PiAgentSession): ScopedTrackedSubsessionLink | undefined {
    const childKey = activeSessionKey(session.sessionId, this.eventScopeForSession(session));
    const parentId = this.subsessionParents.get(childKey);
    const link = this.subsessionLinks.get(childKey);
    if (parentId === undefined || link?.parentSessionId !== parentId) return undefined;
    return sessionFileMatches(session, link.childSessionFile) ? link : undefined;
  }

  private async registerVerifiedSubsession(link: TrackedSubsessionLink, managementContext?: ManagementEmbedContext): Promise<ScopedTrackedSubsessionLink> {
    const { childSessionId, parentSessionId } = link;
    const scope = eventScopeFromManagementContext(managementContext);
    const childKey = activeSessionKey(childSessionId, scope);
    const parentKey = activeSessionKey(parentSessionId, scope);
    const scopedLink: ScopedTrackedSubsessionLink = { ...link, eventScope: scope, ...(managementContext === undefined ? {} : { managementContext }) };
    const previousParentId = this.subsessionParents.get(childKey);
    if (previousParentId !== undefined && previousParentId !== parentSessionId) {
      const previousParentKey = activeSessionKey(previousParentId, scope);
      const previousChildren = this.subsessionChildren.get(previousParentKey);
      previousChildren?.delete(childSessionId);
      if (previousChildren?.size === 0) this.subsessionChildren.delete(previousParentKey);
    }

    this.subsessionParents.set(childKey, parentSessionId);
    const children = this.subsessionChildren.get(parentKey) ?? new Set<string>();
    children.add(childSessionId);
    this.subsessionChildren.set(parentKey, children);

    this.subsessionLinks.set(childKey, scopedLink);
    if (!this.subsessionNotifyArmed.has(childKey)) this.subsessionNotifyArmed.set(childKey, false);

    const cwd = this.cwdForVerifiedSubsession(scopedLink);
    await this.publishUnreadMutations(this.unreadForScope(scope).excludeSession(childSessionId, cwd));
    return scopedLink;
  }

  private cwdForVerifiedSubsession(link: ScopedTrackedSubsessionLink): string {
    const activeCwd = this.activeChildForSubsessionLink(link)?.runtime.session.sessionManager.getCwd();
    const linkedCwd = nonEmptyString(activeCwd) ?? nonEmptyString(link.cwd);
    if (linkedCwd !== undefined) return canonicalizeStoredCwd(linkedCwd);

    const childSessionFile = link.childSessionFile;
    if (childSessionFile !== undefined) {
      try {
        return canonicalizeStoredCwd(this.sessionManager.open(childSessionFile).getCwd());
      } catch (error: unknown) {
        throw new Error(this.t("session.subsessionCwdMissing", "Could not resolve cwd for verified tracked sub-session"), { cause: error });
      }
    }
    throw new Error(this.t("session.subsessionCwdMissing", "Could not resolve cwd for verified tracked sub-session"));
  }

  private unregisterSubsession(childSessionId: string, scope: string): void {
    const childKey = activeSessionKey(childSessionId, scope);
    const parentSessionId = this.subsessionParents.get(childKey);
    this.subsessionParents.delete(childKey);
    this.subsessionLinks.delete(childKey);
    this.subsessionNotifyArmed.delete(childKey);
    if (parentSessionId === undefined) return;
    const parentKey = activeSessionKey(parentSessionId, scope);
    const children = this.subsessionChildren.get(parentKey);
    children?.delete(childSessionId);
    if (children?.size === 0) this.subsessionChildren.delete(parentKey);
  }

  private persistSubsessionLink(link: ScopedTrackedSubsessionLink): void {
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

  private persistSubsessionChildMarker(link: ScopedTrackedSubsessionLink): void {
    const { parentSessionId, childSessionId } = link;
    const child = this.activeChildForSubsessionLink(link)?.runtime.session;
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

  private async hydrateSubsessionsForParent(parentSessionId: string, parentSessionFile?: string, managementContext?: ManagementEmbedContext): Promise<void> {
    const scope = eventScopeFromManagementContext(managementContext);
    const hydrationKey = subsessionHydratedParentKey(activeSessionKey(parentSessionId, scope), parentSessionFile);
    if (this.subsessionHydratedParents.has(hydrationKey)) return;

    const activeParent = this.activeForSessionIdAndScope(parentSessionId, scope);
    if (activeParent !== undefined && (parentSessionFile === undefined || activeSessionFileMatches(activeParent, parentSessionFile))) {
      const activeParentFile = nonEmptyString(activeParent.runtime.session.sessionFile);
      const complete = await this.registerPersistedSubsessionLinks(
        parentSessionId,
        activeParent.runtime.session.sessionManager,
        activeParentFile,
        managementContext,
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
    const complete = await this.registerPersistedSubsessionLinks(parentSessionId, parentManager, parentSessionFile, managementContext);
    if (complete) this.subsessionHydratedParents.add(hydrationKey);
  }

  private async registerPersistedSubsessionLinks(parentSessionId: string, parentManager: PiSessionManager, parentSessionFile: string | undefined, managementContext?: ManagementEmbedContext): Promise<boolean> {
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
      await this.registerVerifiedSubsession(verified, managementContext);
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
    await this.registerVerifiedSubsession(link, this.sessionManagementContexts.get(session));
  }

  private verifiedSubsessionLinkFromOpenedChild(session: PiAgentSession): Promise<TrackedSubsessionLink | undefined> {
    return verifiedTrackedSubsessionLink(this.sessionManager, {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionManager: session.sessionManager,
      cwd: session.sessionManager.getCwd(),
    });
  }

  private async getOrOpenTrackedSubsession(sessionId: string, scope: string): Promise<PiAgentSession> {
    const link = this.subsessionLinks.get(activeSessionKey(sessionId, scope));
    if (link === undefined) throw new Error("Session not found");

    const active = this.activeChildForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    if (link.childSessionFile !== undefined) {
      if (!(await sessionFileHeaderMatches(link.childSessionFile, { sessionId, parentSessionFile: link.parentSessionFile }))) throw new Error(this.t("session.notFound", "Session not found"));
      const sessionManager = this.sessionManager.open(link.childSessionFile);
      return (await this.create(sessionManager, link.cwd ?? sessionManager.getCwd(), {
        ...(link.managementContext === undefined ? {} : { managementContext: link.managementContext }),
      })).runtime.session;
    }

    throw new Error(this.t("session.notFound", "Session not found"));
  }

  private async subsessionSummaryFields(childSessionId: string, scope: string): Promise<{ cwd: string; status: SubsessionStatus }> {
    const link = this.subsessionLinks.get(activeSessionKey(childSessionId, scope));
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

  private workingSubsessionIds(parentSessionId: string, scope: string): string[] {
    const childIds = this.subsessionChildren.get(activeSessionKey(parentSessionId, scope));
    if (childIds === undefined) return [];
    return [...childIds].filter((childId) => {
      const link = this.subsessionLinks.get(activeSessionKey(childId, scope));
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
    const childKey = activeSessionKey(childId, link.eventScope);
    if (this.hasActiveWork(session)) {
      this.subsessionNotifyArmed.set(childKey, true);
      return;
    }
    if (this.subsessionNotifyArmed.get(childKey) !== true) return;
    this.subsessionNotifyArmed.set(childKey, false);
    const status: SubsessionStatus = this.activityForSession(session)?.phase === "error" ? "error" : "idle";
    const finalText = finalAssistantText(historyMessages(session));
    const outputSection = formatSubsessionNotificationOutput(childId, finalText);
    const workingIds = this.workingSubsessionIds(link.parentSessionId, link.eventScope);
    const next = workingIds.length === 0
      ? "No other tracked subsessions are working."
      : `Still working: ${workingIds.join(", ")}. Continue working, or call yield_to_subsessions alone and last at the next join point. Further completion notices arrive automatically; do not poll.`;
    const text = `Subsession ${childId} stopped working (${status}).\n${next}\n\n${outputSection}`;
    void this.notifyParentOfSubsession(link, text);
  }

  private async getOrOpenParentForSubsession(link: ScopedTrackedSubsessionLink): Promise<PiAgentSession> {
    const { parentSessionId } = link;

    const active = this.activeParentForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    const parentSessionFile = link.parentSessionFile;
    if (parentSessionFile === undefined) throw new Error(this.t("session.parentUnavailable", "Parent session {parentSessionId} is not available for subsession notification", { parentSessionId }));
    if ((await readSessionHeaderSummary(parentSessionFile))?.id !== parentSessionId) {
      throw new Error(this.t("session.parentUnavailable", "Parent session {parentSessionId} is not available for subsession notification", { parentSessionId }));
    }
    const sessionManager = this.sessionManager.open(parentSessionFile);
    return (await this.create(sessionManager, sessionManager.getCwd(), {
      ...(link.managementContext === undefined ? {} : { managementContext: link.managementContext }),
    })).runtime.session;
  }

  /**
   * Deliver a subsession-completion notice to the parent as a system-authored
   * custom message rather than a user message, so it is not attributed to the
   * human in the transcript. It still wakes an idle parent (`triggerTurn`) and
   * queues behind in-flight work (`deliverAs: "followUp"`), preserving the
   * established "queue if busy, send and act if idle" behavior.
   */
  private async notifyParentOfSubsession(link: ScopedTrackedSubsessionLink, text: string): Promise<void> {
    const { parentSessionId: parentId, childSessionId: childId } = link;
    try {
      const session = await this.getOrOpenParentForSubsession(link);
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

  async transcriptSnapshot(ref: PiSessionLookup, page?: { limit?: number }, managementContext?: ManagementEmbedContext): Promise<SessionTranscriptSnapshot> {
    const session = await this.getOrOpen(ref, managementContext);
    const seqBeforeRead = this.events.currentSeq(session.sessionId, this.eventScopeForSession(session));
    const activeAtCapture = this.hasActiveWork(session);
    const diskBranch = activeAtCapture ? undefined : await this.readableSessionBranch(session);
    // Disk reads yield, even if a whole turn starts AND ends while they run.
    // From the final runtime read through the watermark capture nothing may yield.
    const branch = diskBranch === undefined || this.hasActiveWork(session) || this.events.currentSeq(session.sessionId, this.eventScopeForSession(session)) !== seqBeforeRead
      ? session.sessionManager.getBranch()
      : diskBranch;
    const messages = historyMessagesFromEntries(branch);
    const userCount = messages.filter((message) => isRecord(message) && message["role"] === "user").length;
    const echoes = (this.pendingPromptEchoes.get(session) ?? []).filter((echo) => echo.userIndex >= userCount);
    messages.push(...echoes.map((echo) => echo.message));
    return {
      page: { ...pageMessagesAtSafeBoundary(messages, page), leafId: session.sessionManager.getLeafId() },
      status: this.statusFromSession(session, transcriptMessageCount(branch) + echoes.length),
      seq: this.events.currentSeq(session.sessionId, this.eventScopeForSession(session)),
      partial: this.publishedAssistantPartials.get(session) ?? null,
    };
  }

  async messages(ref: PiSessionLookup, page?: { before?: number; limit?: number }, managementContext?: ManagementEmbedContext): Promise<ClientMessagePage> {
    const session = await this.getOrOpen(ref, managementContext);
    const branch = await this.readableSessionBranch(session);
    return { ...pageMessagesAtSafeBoundary(historyMessagesFromEntries(branch), page), leafId: session.sessionManager.getLeafId() };
  }

  async media(ref: PiSessionRef, mediaId: string, managementContext?: ManagementEmbedContext): Promise<SessionMedia | undefined> {
    if (!isSessionMediaId(mediaId)) throw new Error(this.t("session.media.invalidId", "Invalid media id"));
    const index = this.events.mediaIndex;
    const session = this.activeForLookup(ref, managementContext)?.runtime.session ?? this.startupSessionForLookup(ref, managementContext);
    const eventScope = eventScopeFromManagementContext(managementContext);
    const unavailable = () => new Error(this.t("routing.sessionNotFound", "Session not found"));
    // No durable management ownership marker exists. Management binary reads
    // require an already-hosted owner rather than inferring identity from disk.
    if (managementContext !== undefined && session === undefined) throw unavailable();
    const assertVisible = (path?: string): void => {
      if (eventScope !== NORMAL_SESSION_EVENT_SCOPE) return;
      if (session === undefined && (
        [...this.active.values()].some((active) => active.eventScope !== eventScope && active.runtime.session.sessionId === ref.id && lookupMatchesActiveSession(ref, active))
        || [...this.startupSessions.values()].some((startup) => startup.eventScope !== eventScope && startup.session.sessionId === ref.id && lookupMatchesStartupSession(ref, startup.session))
      )) throw unavailable();
      if (path !== undefined && [...this.managementMediaFiles].some((managed) => sessionPathsEqual(managed, path))) throw unavailable();
    };
    assertVisible(session?.sessionFile ?? session?.sessionManager.getSessionFile());
    // Verify session/cwd ownership before consulting the session-scoped cache.
    // Cold binary reads do not construct an SDK runtime (which can migrate files).
    const archived = session === undefined ? await this.getArchived(ref) : undefined;
    const resolved = session === undefined && archived?.archivePath === undefined
      ? await this.sessionManager.resolveSessionFile(ref.cwd, ref.id)
      : undefined;
    const sessionId = session?.sessionId ?? archived?.sessionId ?? resolved?.id;
    if (sessionId === undefined || (resolved !== undefined && !cwdPathsEqual(resolved.cwd, ref.cwd))) throw new Error(this.t("routing.sessionNotFound", "Session not found"));
    assertVisible(archived?.originalPath);
    assertVisible(session?.sessionFile ?? session?.sessionManager.getSessionFile() ?? archived?.archivePath ?? resolved?.path);
    const scope = { id: sessionId, eventScope, cwd: canonicalizeStoredCwd(session?.sessionManager.getCwd() ?? archived?.cwd ?? resolved?.cwd ?? ref.cwd) };
    const cached = index.get(scope, mediaId);
    if (cached !== undefined) return cached;
    if (session !== undefined) {
      const live = index.find(scope, mediaId, [
        session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch(),
        session.messages,
        session.state.streamingMessage,
        this.publishedAssistantPartials.get(session),
        ...(this.pendingPromptEchoes.get(session) ?? []).map((echo) => echo.message),
      ]);
      if (live !== undefined) return live;
    }
    // Read disk on misses even for a cached idle runtime: other processes can
    // append images on any branch without emitting events through this daemon.
    const path = session?.sessionFile ?? session?.sessionManager.getSessionFile() ?? archived?.archivePath ?? resolved?.path
      ?? (session === undefined ? undefined : (await this.sessionManager.resolveSessionFile(ref.cwd, sessionId))?.path);
    if (path === undefined) return undefined;
    assertVisible(path);
    const entries = await this.sessionManager.readEntries?.(path);
    assertVisible(path);
    return entries === undefined ? undefined : index.find(scope, mediaId, entries);
  }

  async status(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    const session = await this.sessionForStatusOrDialogClose(ref, managementContext);
    if (this.eventScopeForSession(session) === NORMAL_SESSION_EVENT_SCOPE) {
      await this.activityMarker.refresh(session.sessionFile, this.hasActiveWork(session));
    }
    if (this.hasActiveWork(session)) return this.statusFromSession(session);
    const branch = await this.readableSessionBranch(session);
    return this.statusFromSession(session, this.snapshotMessageCount(branch));
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
      : annotateAssistantStreamId(annotateAssistantThinkingLevel(projectBrowserMessage(streamingMessage), session.thinkingLevel), this.assistantStreamIds.get(session));
    return { seq, partial };
  }

  async getSessionDefaults(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<SessionDefaults> {
    const session = await this.getOrOpen(ref, managementContext);
    const settings = await this.freshSessionDefaultsSettings(session);
    return parseSessionDefaults(settings.getGlobalSettings());
  }

  async setSessionDefaults(ref: PiSessionLookup, defaults: SessionDefaultsUpdate, managementContext?: ManagementEmbedContext): Promise<SessionDefaults> {
    const update = parseSessionDefaultsUpdate({ ...defaults });
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    return this.runModelScopeMutation(async () => {
      const settings = await this.freshSessionDefaultsSettings(session);
      if (update.provider !== undefined && update.modelId !== undefined) {
        await session.modelRuntime.refresh({ allowNetwork: false });
        const target = `${update.provider}/${update.modelId}`;
        const available = session.modelRuntime.getAvailableSnapshot();
        if (!available.some((model) => modelScopeId(model) === target)) throw new Error(this.t("server.main.583c6c767d31", "Model not found: {arg0}", { arg0: target }));
        const enabledIds = await resolveEnabledModelIds({
          settingsManager: settings,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          modelRuntime: session.modelRuntime as ModelRuntime,
          scopedModels: [],
        });
        if (enabledIds !== null && !enabledIds.includes(target)) throw new Error(this.t("server.main.c24071bdc942", "Model is not enabled: {arg0}", { arg0: target }));
        settings.setDefaultModelAndProvider(update.provider, update.modelId);
      } else if (update.thinkingLevel !== undefined) {
        settings.setDefaultThinkingLevel(update.thinkingLevel);
      }
      await settings.flush();
      this.assertDefaultsSettingsHealthy(settings);
      return parseSessionDefaults(settings.getGlobalSettings());
    });
  }

  private async freshSessionDefaultsSettings(session: PiAgentSession) {
    const cwd = session.sessionManager.getCwd();
    const mode = this.eventScopeForSession(session) === NORMAL_SESSION_EVENT_SCOPE ? "normal" : "management";
    const settings = await createScopedSettingsManager({
      cwd,
      scopeDirectory: await this.resolveSettingsScopeDirectory(cwd, mode),
      globalAgentDir: this.agentDir,
      mode,
      projectTrusted: session.settingsManager.isProjectTrusted?.() ?? true,
    });
    await settings.reload();
    this.assertDefaultsSettingsHealthy(settings);
    return settings;
  }

  private assertDefaultsSettingsHealthy(settings: { drainErrors(): { error: { message: string } }[] }): void {
    const errors = settings.drainErrors();
    if (errors.length > 0) throw new Error(this.t("server.main.d04dfe5abc11", "Session defaults settings failed: {arg0}", { arg0: errors.map(({ error }) => error.message).join("; ") }));
  }

  async availableModels(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionModel[]> {
    const session = await this.getOrOpen(ref, managementContext);
    const models = await this.sessionModelCandidates(session);
    return models.map(modelToClientModel);
  }

  async modelCatalog(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionModelCatalogEntry[]> {
    const session = await this.getOrOpen(ref, managementContext);
    const scope = this.modelScopeContext(session);
    return (await this.enabledModelCatalog(session)).map((entry) => catalogEntryToClientModel(entry, scope.editable));
  }

  async setModelEnabled(ref: PiSessionLookup, provider: string, modelId: string, enabled: boolean, managementContext?: ManagementEmbedContext): Promise<ClientSessionModelCatalogEntry[]> {
    if (managementContext !== undefined) throw new Error(this.t("server.main.2a7cb0e35521", "Enabled model scope cannot be changed in management embed mode"));
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    return this.runModelScopeMutation(async () => {
      const scope = this.modelScopeContext(session);
      if (!scope.editable) throw new Error(this.t("server.main.c43b4e3cefe1", "Model availability is controlled by this workspace's .pi/settings.json"));
      this.assertTreeNavigationInactive(session, this.t("server.main.fd81137332d5", "change enabled models"));
      await session.modelRuntime.refresh({ allowNetwork: false });
      const currentIds = (await this.modelScopeSnapshot(session, scope)).enabledIds;
      const available = session.modelRuntime.getAvailableSnapshot();
      const availableIds = available.map(modelScopeId);
      const targetId = `${provider}/${modelId}`;
      if (!availableIds.includes(targetId)) throw new Error(this.t("server.main.583c6c767d31", "Model not found: {arg0}", { arg0: targetId }));
      if (!enabled && session.model !== undefined && modelScopeId(session.model) === targetId) throw new Error(this.t("server.main.fe143303e69e", "Current model cannot be disabled"));
      const nextIds = applyEnabledModelToggle(currentIds, availableIds, targetId, enabled);
      this.assertTreeNavigationInactive(session, this.t("server.main.fd81137332d5", "change enabled models"));
      if (nextIds !== currentIds) this.applyEnabledModelScope(session, available, nextIds);
      return (await this.enabledModelCatalog(session)).map((entry) => catalogEntryToClientModel(entry));
    });
  }

  async setModelScope(ref: PiSessionLookup, mode: SessionModelScopeMode, managementContext?: ManagementEmbedContext): Promise<ClientSessionModelCatalogEntry[]> {
    if (managementContext !== undefined) throw new Error(this.t("server.main.2a7cb0e35521", "Enabled model scope cannot be changed in management embed mode"));
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    return this.runModelScopeMutation(async () => {
      const scope = this.modelScopeContext(session);
      if (!scope.editable) throw new Error(this.t("server.main.c43b4e3cefe1", "Model availability is controlled by this workspace's .pi/settings.json"));
      this.assertTreeNavigationInactive(session, this.t("server.main.fd81137332d5", "change enabled models"));
      await session.modelRuntime.refresh({ allowNetwork: false });
      const available = session.modelRuntime.getAvailableSnapshot();
      const availableIds = available.map(modelScopeId);
      let nextIds: readonly string[] | null = null;
      if (mode === "current") {
        const current = session.model;
        if (current === undefined || !availableIds.includes(modelScopeId(current))) throw new Error(this.t("server.main.46b71cd9c032", "The current model is unavailable"));
        nextIds = [modelScopeId(current)];
      }
      this.assertTreeNavigationInactive(session, this.t("server.main.fd81137332d5", "change enabled models"));
      this.applyEnabledModelScope(session, available, nextIds);
      return (await this.enabledModelCatalog(session)).map((entry) => catalogEntryToClientModel(entry));
    });
  }

  async setModel(ref: PiSessionLookup, provider: string, modelId: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.assertTreeNavigationInactive(session, this.t("server.main.130226a572df", "change models"));
    const candidates = await this.sessionModelCandidates(session);
    this.assertTreeNavigationInactive(session, this.t("server.main.130226a572df", "change models"));
    const model = candidates.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      ?? session.modelRuntime.getModel(provider, modelId);
    if (model === undefined) throw new Error(this.t("model.notFound", "Model not found: {value0}/{value1}", { value0: provider, value1: modelId }));
    await this.runSessionEntryMutation(session, this.t("server.main.130226a572df", "change models"), () => session.setModel(model));
    this.publishActivity(session, this.t("activity.model", "Model: {value0}", { value0: model.id }), "idle", model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleModel(ref: PiSessionLookup, direction: "forward" | "backward", managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    const result = await this.runModelScopeMutation(async () => {
      await session.modelRuntime.refresh({ allowNetwork: false });
      await this.synchronizeSessionModelScope(session, session.modelRuntime.getAvailableSnapshot());
      return this.runSessionEntryMutation(session, this.t("server.main.130226a572df", "change models"), () => session.cycleModel(direction));
    });
    if (result === undefined) throw new Error(session.scopedModels.length > 0 ? this.t("model.oneScoped", "Only one scoped model is available") : this.t("model.oneAvailable", "Only one model is available"));
    this.publishActivity(session, this.t("activity.model", "Model: {value0}", { value0: result.model.id }), "idle", result.model.provider);
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
    this.assertTreeNavigationInactive(session, this.t("session.action.changeThinking", "change the thinking level"));
    // pi owns the valid set; validate against the session's live levels rather
    // than a hardcoded union so this stays correct if pi changes the set.
    const available = session.getAvailableThinkingLevels();
    const match = available.find((candidate) => candidate === level);
    if (match === undefined) throw new Error(this.t("model.invalidThinking", "Invalid thinking level: {value0}", { value0: level }));
    await this.runSessionEntryMutation(session, this.t("session.action.changeThinking", "change the thinking level"), () => {
      session.setThinkingLevel(match);
      return Promise.resolve();
    });
    this.publishActivity(session, this.t("activity.thinking", "Thinking level: {value0}", { value0: session.thinkingLevel }), "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleThinkingLevel(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    const level = await this.runSessionEntryMutation(session, this.t("session.action.changeThinking", "change the thinking level"), () => Promise.resolve(session.cycleThinkingLevel()));
    if (level === undefined) throw new Error(this.t("model.thinkingUnsupported", "The current model does not support thinking"));
    this.publishActivity(session, this.t("ui.promptEditor.thinkingLevel", "Thinking level: {thinkingLevel}", { thinkingLevel: level }), "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async commands(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(ref, managementContext);
    const commands: ClientCommand[] = builtinCommands(this.t);
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: command.invocationName, ...(command.description === undefined ? {} : { description: command.description }), source: "extension" });
    }
    for (const template of session.promptTemplates) {
      commands.push({
        name: template.name,
        ...(template.description === undefined ? {} : { description: template.description }),
        ...(template.argumentHint === undefined ? {} : { argumentHint: template.argumentHint }),
        source: "prompt",
      });
    }
    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${skill.name}`, ...(skill.description === undefined ? {} : { description: skill.description }), source: "skill" });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async prompt(ref: PiSessionLookup, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: { echoUserMessage?: boolean; managementContext?: ManagementEmbedContext | undefined }): Promise<void> {
    const promptText = requirePromptText(text, this.t);
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
    this.assertTreeNavigationInactive(session, this.t("server.main.94306b2fc35c", "send a prompt"));
    this.maybeGenerateSessionName(session, promptText);
    const isQueued = session.isStreaming || session.isCompacting;
    const behavior = isQueued ? requestedBehavior ?? "followUp" : undefined;
    if (isQueued && images.length === 0 && this.hasQueuedMessageText(session, promptText)) {
      this.publishActivity(session, this.t("activity.duplicateIgnored", "Duplicate queued message ignored"), "active");
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
    const promptPromise = this.beginPromptSubmission(session, text, behavior, images, echoUserMessage).catch(() => undefined);
    void promptPromise;
    return promptPromise;
  }

  private beginPromptSubmission(session: PiAgentSession, text: string, behavior: QueuedPromptKind | undefined, images: ImageContent[] = [], echoUserMessage = true): Promise<void> {
    this.auditUserPrompt(session, text);
    this.publishActivity(session, behavior === "steer" ? this.t("activity.steerQueued", "Steering message queued") : behavior === "followUp" ? this.t("activity.messageQueued", "Message queued") : this.t("activity.messageReceived", "Message received"), "active");
    const eventScope = this.eventScopeForSession(session);
    const echoes = this.pendingPromptEchoes.get(session) ?? [];
    const userCount = historyMessagesFromEntries(session.sessionManager.getBranch()).filter((message) => isRecord(message) && message["role"] === "user").length;
    const echo = behavior === undefined && echoUserMessage
      ? { userIndex: Math.max(userCount, ...echoes.map((pending) => pending.userIndex + 1)), message: userMessage(text, images) }
      : undefined;
    if (echo !== undefined) {
      // SDK input hooks may await before appending the user message. Keep the
      // already-published echo visible in snapshots until that append occurs.
      this.pendingPromptEchoes.set(session, [...echoes, echo]);
      this.events.publish(session.sessionId, { type: "message.append", message: echo.message }, eventScope, { id: session.sessionId, cwd: session.sessionManager.getCwd(), eventScope });
    }
    const promptOptions = buildPromptOptions(behavior, images);
    const submission: ExtensionCommandSubmission = { session, active: true };
    const commandName = text.trim().split(/\s+/)[0]?.replace(/^\//, "");
    const isExtensionCommand = text.trim().startsWith("/") && session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === commandName);
    const promptPromise = this.runSessionEntryMutation(session, this.t("server.main.94306b2fc35c", "send a prompt"), () => isExtensionCommand
      ? this.extensionCommandExecution.run({ submission }, () => session.prompt(text, promptOptions))
      : session.prompt(text, promptOptions)).finally(() => {
      submission.active = false;
      if (echo !== undefined) {
        const remaining = (this.pendingPromptEchoes.get(session) ?? []).filter((pending) => pending !== echo);
        if (remaining.length === 0) this.pendingPromptEchoes.delete(session);
        else this.pendingPromptEchoes.set(session, remaining);
      }
    });
    void promptPromise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(session, this.t("activity.error", "An error occurred"), "error", message);
      this.events.publish(session.sessionId, { type: "session.error", message }, eventScope);
    });
    return promptPromise;
  }

  private async submitInitialRunPrompt(session: PiAgentSession, text: string): Promise<void> {
    let failure: Error | undefined;
    let settled = false;
    let sawInitialUserMessage = false;
    const unsubscribe = session.subscribe((event) => {
      if (settled || !isRecord(event)) return;
      if (event["type"] === "agent_settled") {
        // Freeze the initial outcome before a later user submission can change it.
        settled = true;
        return;
      }
      if (event["type"] === "auto_retry_end" && event["success"] === false && event["finalError"] === "Retry cancelled") {
        // Native Pi cancels retry sleep without an aborted assistant message.
        failure = new DOMException(this.t("server.main.ed6dfd6b55ab", "Initial PI session run was aborted"), "AbortError");
        return;
      }
      const message = event["message"];
      if (!isRecord(message)) return;
      if (event["type"] === "message_start" && message["role"] === "user") {
        // Pi can drain a queued user follow-up inside the same prompt promise.
        // Its outcome belongs to that later submission, not this launcher.
        if (sawInitialUserMessage) settled = true;
        sawInitialUserMessage = true;
        return;
      }
      if (event["type"] !== "message_end" || message["role"] !== "assistant") return;
      // A successful retry supersedes a transient provider failure. Pi's
      // prompt promise can fulfill even when the final assistant is an error.
      const reason = message["stopReason"];
      failure = reason === "aborted"
        ? new DOMException(this.t("server.main.ed6dfd6b55ab", "Initial PI session run was aborted"), "AbortError")
        : reason === "error"
          ? new Error(typeof message["errorMessage"] === "string" ? message["errorMessage"] : this.t("server.main.e08c1380a71f", "Initial PI session run failed"))
          : undefined;
    });
    try {
      await this.beginPromptSubmission(session, text, undefined);
      if (failure !== undefined) throw failure;
    } finally {
      unsubscribe();
    }
  }

  private enqueuePromptDuringCompaction(session: PiAgentSession, text: string, kind: QueuedPromptKind, images: ImageContent[] = [], echoUserMessage = true): void {
    const sessionKey = activeSessionKey(session.sessionId, this.eventScopeForSession(session));
    const queue = this.compactionPromptQueues.get(sessionKey) ?? [];
    queue.push({ kind, text, ...(images.length > 0 ? { images } : {}), ...(echoUserMessage ? {} : { echoUserMessage: false }) });
    this.compactionPromptQueues.set(sessionKey, queue);
    this.publishActivity(session, this.t("activity.compactionQueued", "Message queued during compaction"), "active");
    this.publishStatus(session);
  }

  async saveAttachments(ref: PiSessionLookup, attachments: unknown, folder?: string, managementContext?: ManagementEmbedContext): Promise<SavedPromptAttachment[]> {
    const parsed = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false, allowFileAttachments: true });
    if (parsed.length === 0) return [];
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    const cwd = active.runtime.cwd;
    const effectiveFolder = folder ?? (await this.workspaceAttachmentsConfig(cwd)).defaultFolder;
    return saveAttachmentsToWorkspace(cwd, parsed, effectiveFolder === undefined ? {} : { folder: effectiveFolder });
  }

  private async workspaceAttachmentsConfig(cwd: string): Promise<PiWebAttachmentsConfig> {
    const globalConfig = this.config === undefined ? {} : (await this.config.read()).effectiveConfig;
    return loadEffectiveProjectAttachmentsConfig(cwd, globalConfig);
  }

  async shell(ref: PiSessionLookup, text: string, managementContext?: ManagementEmbedContext): Promise<void> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref, managementContext);
    const { session } = active.runtime;
    this.assertTreeNavigationInactive(session, this.t("session.action.shell", "run a shell command"));
    const isExcluded = text.startsWith("!!");
    const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
    if (!command) throw new Error(this.t("shell.usage", "Usage: !<shell command>"));
    if (session.isBashRunning) throw new Error(this.t("shell.alreadyRunning", "A bash command is already running"));

    const eventScope = active.eventScope;
    this.publishActivity(session, this.t("activity.commandRunning", "Running command"), "active", command);
    this.events.publish(session.sessionId, { type: "shell.start", command, excludeFromContext: isExcluded }, eventScope);
    void this.runSessionEntryMutation(session, this.t("session.action.shell", "run a shell command"), () => session.executeBash(command, (chunk) => {
      this.events.publish(session.sessionId, { type: "shell.chunk", chunk }, eventScope);
      this.publishActivity(session, this.t("activity.commandRunning", "Running command"), "active", command);
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
      this.publishActivity(session, this.t("activity.commandCompleted", "Command completed"), result.exitCode === 0 ? "idle" : "error", command);
      this.publishStatus(session);
    }).catch((error: unknown) => {
      const message = userFacingErrorMessage(error, this.t);
      this.events.publish(session.sessionId, { type: "shell.end", output: message, isError: true }, eventScope);
      this.events.publish(session.sessionId, { type: "session.error", message }, eventScope);
      this.publishActivity(session, this.t("activity.commandFailed", "Command failed"), "error", message);
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
    return this.navigateSessionTree(ref, request.targetId, request.expectedLeafId, sessionTreeNavigationOptions(request, this.t), managementContext, undefined, request.retainCheckpoint);
  }

  private async navigateSessionTree(ref: PiSessionLookup, targetId: string, expectedLeafId: string | null, options: PiTreeNavigationOptions, managementContext?: ManagementEmbedContext, expectedSession?: PiAgentSession, retainCheckpoint = false): Promise<ClientSessionTreeNavigateResult> {
    if (targetId.trim() === "") throw new Error(this.t("server.main.f39f37acdac1", "Session tree target is required"));
    if (this.isTreeExclusiveSessionIdentityActive(sessionIdFromLookup(ref))) {
      throw new Error(this.t("server.main.e39e6b98e072", "Stop current session activity before navigating the session tree"));
    }
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    if (expectedSession !== undefined && session !== expectedSession) throw new Error(this.t("session.extensionUnavailable", "This extension command belongs to an unavailable session runtime"));
    const navigateTree = session.navigateTree?.bind(session);
    if (navigateTree === undefined) throw new Error(this.t("session.treeUnsupported", "Session tree navigation is not supported by this Pi runtime"));
    if (this.hasActiveWork(session)) throw new Error(this.t("server.main.e39e6b98e072", "Stop current session activity before navigating the session tree"));

    // Acquire synchronously after the active-work check. No leaf-producing work
    // may enter this runtime until Pi's potentially asynchronous summary settles.
    this.treeNavigations.add(session);
    try {
      const oldLeafId = session.sessionManager.getLeafId();
      if (oldLeafId !== expectedLeafId) {
        throw new Error(this.t("session.treeStale", "The session changed since /tree was opened. Reopen /tree and try again."));
      }

      if (retainCheckpoint) targetId = messageHistoryTargetId(session.sessionManager.getBranch(), targetId);
      const checkpointTail = retainCheckpoint ? session.sessionManager.getBranch().find((entry) => isRecord(entry) && entry["id"] === targetId) : undefined;
      const retainCustomMessage = isRecord(checkpointTail) && checkpointTail["type"] === "custom_message";
      if (retainCustomMessage && options.summarize === true) throw new Error(this.t("session.checkpointSummary", "Retaining a custom-message checkpoint requires navigation without a branch summary"));
      const activeEditableTargetParentId = retainCustomMessage ? undefined : activeEditableTreeTargetParentId(session.sessionManager, targetId, oldLeafId);
      this.publishActivity(session, options.summarize === true ? this.t("activity.summarizing", "Summarizing branch") : this.t("activity.navigating", "Navigating session tree"), "active");
      this.publishStatus(session);
      let result = retainCustomMessage
        ? await navigateTreeRetainingCustomMessage(session.sessionManager, targetId, checkpointTail["parentId"], () => navigateTree(targetId, options))
        : await navigateTree(targetId, options);
      if (activeEditableTargetParentId !== undefined && !result.cancelled
        && result.editorText === undefined && result.summaryEntry === undefined
        && session.sessionManager.getLeafId() === oldLeafId) {
        setSessionTreeLeaf(session.sessionManager, activeEditableTargetParentId);
        try {
          result = await navigateTree(targetId, options);
        } catch (error: unknown) {
          session.sessionManager.branch(targetId);
          throw error;
        }
        if (result.cancelled) session.sessionManager.branch(targetId);
      }
      if (result.cancelled) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, result.aborted === true ? this.t("activity.summaryAborted", "Branch summary aborted") : this.t("activity.navigationCancelled", "Session tree navigation cancelled"), "idle");
        }
        return { cancelled: true, ...(result.aborted === undefined ? {} : { aborted: result.aborted }) };
      }

      if (session.sessionManager.getLeafId() !== oldLeafId) {
        // Questions belong to the branch we left. Close them without appending a
        // cancellation message or waking the rewound session.
        const outcome = this.pendingAskStore.cancelOpen(this.dialogSessionKey(session));
        if (outcome !== undefined) this.publishAskClosed(session.sessionId, outcome, this.eventScopeForSession(session));
      }

      if (result.summaryEntry !== undefined) {
        this.unpersistedTreeBranchLeaves.delete(session);
      } else {
        const selectedLeafId = session.sessionManager.getLeafId();
        if (selectedLeafId !== oldLeafId) this.unpersistedTreeBranchLeaves.set(session, selectedLeafId);
      }
      this.setSuggestedInput(session, result.editorText);
      this.events.publish(session.sessionId, { type: "session.tree.changed" }, this.eventScopeForSession(session));
      if (this.isCurrentActiveSession(session)) this.publishActivity(session, this.t("activity.navigated", "Session tree changed"), "idle");
      return { cancelled: false, ...(result.editorText === undefined ? {} : { editorText: result.editorText }) };
    } catch (error: unknown) {
      const message = userFacingErrorMessage(error, this.t);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, this.t("server.main.8cae209986b4", "tree navigation failed"), "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message }, this.eventScopeForSession(session));
      }
      throw error;
    } finally {
      this.treeNavigations.delete(session);
      if (this.isCurrentActiveSession(session)) {
        this.flushDeferredTreeNavigationWork(session);
        this.reconcileRuntimeMessageCount(session);
        this.publishStatus(session);
      } else {
        this.deferredGeneratedSessionNames.delete(session);
        this.deferredSubsessionNotifications.delete(session);
      }
    }
  }

  async forkFromTree(ref: PiSessionLookup, request: ClientSessionTreeForkRequest, managementContext?: ManagementEmbedContext): Promise<ClientSessionTreeForkResult> {
    return this.forkSessionTree(ref, request, managementContext);
  }

  private async forkSessionTree(ref: PiSessionLookup, request: ClientSessionTreeForkRequest, managementContext?: ManagementEmbedContext, options?: PiForkOptions, expectedSession?: PiAgentSession): Promise<ClientSessionTreeForkResult> {
    if (request.entryId.trim() === "") throw new Error(this.t("server.main.f10a242f597a", "Session tree entry is required"));
    const requestedSessionId = sessionIdFromLookup(ref);
    if (this.isTreeExclusiveSessionIdentityActive(requestedSessionId)) {
      throw new Error(this.t("server.main.3f5b7f08e91c", "Stop current session activity before forking the session tree"));
    }
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    if (expectedSession !== undefined && session !== expectedSession) throw new Error(this.t("session.extensionUnavailable", "This extension command belongs to an unavailable session runtime"));
    if (this.hasActiveWork(session)) throw new Error(this.t("server.main.3f5b7f08e91c", "Stop current session activity before forking the session tree"));
    if (session.sessionManager.getLeafId() !== request.expectedLeafId) {
      throw new Error(this.t("session.treeStale", "The session changed since /tree was opened. Reopen /tree and try again."));
    }
    const sourceSessionId = session.sessionId;
    const sourceEventScope = this.eventScopeForSession(session);
    const sourceCwd = session.sessionManager.getCwd();

    this.publishActivity(session, this.t("server.main.4de911d3b72a", "forking session from entry"), "active");
    this.publishStatus(session);
    try {
      const entryId = request.retainCheckpoint === true ? messageHistoryTargetId(session.sessionManager.getBranch(), request.entryId) : request.entryId;
      const result = await this.commandService.forkEntry(session.sessionId, entryId, sourceEventScope, {
        ...options, expectedLeafId: request.expectedLeafId, expectedSession: session,
      });
      if (result.type === "unsupported") throw new Error(result.message);
      if (result.type !== "done") throw new Error(this.t("server.main.0246b6af6843", "Session fork is unavailable"));
      if (result.session === undefined) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, this.t("server.main.1cceead5f414", "fork cancelled"), "idle");
          this.publishStatus(session);
        }
        return { cancelled: true };
      }

      const forked = this.activeForLookup({ id: result.session.id, cwd: result.session.cwd }, managementContext)?.runtime.session;
      if (forked !== undefined) this.setSuggestedInput(forked, result.promptDraft);
      this.events.publish(sourceSessionId, { type: "session.tree.changed" }, sourceEventScope);
      if (forked !== undefined && this.isCurrentActiveSession(forked)) {
        this.publishActivity(forked, this.t("command.forked", "Session forked"), "idle");
        this.publishStatus(forked);
      }
      if (result.session.id !== sourceSessionId) this.clearSupersededSessionActivity(sourceSessionId, sourceCwd, sourceEventScope);
      return {
        cancelled: false,
        session: result.session,
        ...(result.promptDraft === undefined ? {} : { promptDraft: result.promptDraft }),
      };
    } catch (error: unknown) {
      const message = userFacingErrorMessage(error, this.t);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, this.t("server.main.08e8f3ea9eaa", "fork failed"), "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message }, sourceEventScope);
        this.publishStatus(session);
      }
      throw error;
    }
  }

  private clearSupersededSessionActivity(sessionId: string, cwd: string, eventScope: string): void {
    const sessionKey = activeSessionKey(sessionId, eventScope);
    if (this.activities.get(sessionKey)?.phase === "active") {
      const at = new Date().toISOString();
      const stored = { phase: "idle" as const, label: this.t("activity.idle", "Idle"), at };
      this.activities.set(sessionKey, stored);
      const activity = { sessionId, ...stored };
      this.events.publish(sessionId, { type: "activity.update", activity }, eventScope);
      this.events.publishGlobal({ type: "activity.update", activity }, eventScope);
    }
    this.workspaceActivity?.removeSession(sessionId, cwd, eventScope);
    this.activities.delete(sessionKey);
  }

  async archive(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const active = await this.getActive(ref, managementContext);
    const session = active.runtime.session;
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session, runtime: active.runtime }],
      this.t("session.stopBeforeArchive", "Stop current session activity before archiving"),
      async () => {
        const archiveInput = await this.archiveInputForSession(session);
        await this.closeActiveSession(active);
        await this.archiveStore.archive(archiveInput);
        await this.forgetUnreadSessions([archiveInput], active.eventScope);
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
        this.publishNotificationMutations(this.notificationsForScope(eventScopeFromManagementContext(managementContext)).clearSession(archived.sessionId, "archive"));
        alreadyArchivedSessionIds.push(archived.sessionId);
        unreadArchivedIdentities.push(archived);
        continue;
      }

      const active = this.activeForLookup(bulkRefToLookup(ref), managementContext);
      const listed = findListedSessionForBulkRef(sessionContext, ref);
      const resolvedSessionId = active?.runtime.session.sessionId ?? listed?.id ?? ref.id;
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: resolvedSessionId, error: this.t("session.stopBeforeArchive", "Stop current session activity before archiving") });
        continue;
      }

      try {
        if (listed !== undefined) {
          planItems.push({ input: archiveInputFromListEntry(listed), ...(active === undefined ? {} : { active }) });
        } else if (active !== undefined) {
          planItems.push({ input: archiveInputFromActiveSession(active.runtime.session, this.t), active });
        } else {
          failures.push({ sessionId: ref.id, error: this.t("session.notFound", "Session not found") });
        }
      } catch (error: unknown) {
        failures.push({ sessionId: resolvedSessionId, error: errorMessage(error, this.t) });
      }
    }

    const readyPlanItems: { input: ArchiveSessionInput; active?: ManagedActiveSession }[] = [];
    for (const item of planItems) {
      const active = item.active ?? this.activeForLookup(bulkRefToLookup({ id: item.input.sessionId, cwd: item.input.cwd }), managementContext);
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: item.input.sessionId, error: this.t("session.stopBeforeArchive", "Stop current session activity before archiving") });
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
      this.t("session.stopBeforeArchive", "Stop current session activity before archiving"),
      async () => {
        for (const item of readyPlanItems) {
          try {
            if (item.active !== undefined) await this.closeActiveSession(item.active);
            else await this.closeActiveInScope(item.input.sessionId, eventScopeFromManagementContext(managementContext));
            readyInputs.push(item.input);
          } catch (error: unknown) {
            failures.push({ sessionId: item.input.sessionId, error: errorMessage(error, this.t) });
          }
        }

        try {
          const archived = await this.archiveStoreArchiveMany(readyInputs);
          archivedSessionIds.push(...archived.map((record) => record.sessionId));
          unreadArchivedIdentities.push(...archived);
        } catch (error: unknown) {
          for (const input of readyInputs) failures.push({ sessionId: input.sessionId, error: errorMessage(error, this.t) });
        }
      },
    );
    await this.forgetUnreadSessions(unreadArchivedIdentities, eventScopeFromManagementContext(managementContext));

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
    const root = findArchiveCandidateByExactId(catalog, session.sessionId) ?? archiveCandidateFromActiveSession(session, false, this.t);
    const plan = planSessionArchiveTree(root, catalog);
    const busy = plan.targets.map((target) => target.activeSession).find((target) => target !== undefined && this.hasActiveWork(target));
    if (busy !== undefined) throw new Error(this.t("session.stopBeforeNamedArchive", "Stop current session activity before archiving {value0}", { value0: sessionDisplayName(busy) }));

    const archiveInputs = plan.unarchivedTargets.map((target) => archiveInputFromCandidate(target, this.t));
    await this.runTreeExclusiveOperation(
      plan.unarchivedTargets.map((target) => ({
        sessionId: target.id,
        ...(target.activeSession === undefined ? {} : { session: target.activeSession }),
      })),
      this.t("session.stopBeforeNamedArchive", "Stop current session activity before archiving {value0}", { value0: sessionDisplayName(session) }),
      async () => {
        for (const target of plan.targets) {
          if (target.archived) this.publishNotificationMutations(this.notificationsForScope(eventScopeFromManagementContext(managementContext)).clearSession(target.id, "archive"));
        }
        for (const input of archiveInputs) await this.closeActiveInScope(input.sessionId, eventScopeFromManagementContext(managementContext));
        await this.archiveStoreArchiveMany(archiveInputs);
      },
    );
    await this.forgetUnreadSessions(plan.targets.map((target) => ({ sessionId: target.id, cwd: target.cwd })), eventScopeFromManagementContext(managementContext));

    return {
      archived: true,
      sessionIds: archiveInputs.map((input) => input.sessionId),
      archivedCount: archiveInputs.length,
      skippedAlreadyArchivedCount: plan.skippedAlreadyArchivedCount,
    };
  }

  async restore(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const archived = await this.getArchived(ref);
    if (archived === undefined) throw new Error(this.t("session.notFound", "Session not found"));
    await this.closeActiveInScope(archived.sessionId, eventScopeFromManagementContext(managementContext));
    await this.archiveStore.restore(archived.sessionId);
    await this.forgetUnreadSessions([archived], eventScopeFromManagementContext(managementContext));
  }

  async deleteArchived(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const record = await this.getArchived(ref);
    if (record === undefined) throw new Error(this.t("session.archiveNotFound", "Archived session not found"));
    if (this.archiveStore.deleteArchived === undefined) throw new Error(this.t("session.archiveDeleteUnsupported", "The archive store does not support deletion"));

    await this.closeActiveInScope(record.sessionId, eventScopeFromManagementContext(managementContext));
    await this.archiveStore.deleteArchived(record.sessionId);
    await this.forgetUnreadSessions([record], eventScopeFromManagementContext(managementContext));
  }

  async deleteArchivedMany(refs: readonly SessionBulkMutationRef[], managementContext?: ManagementEmbedContext): Promise<SessionBulkDeleteArchivedResponse> {
    if (this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error(this.t("session.archiveDeleteUnsupported", "The archive store does not support deletion"));

    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const archivedRecords = await this.archiveStore.list();
    const failures: SessionBulkFailure[] = [];
    const planItems: BulkDeletePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const record = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (record === undefined) {
        failures.push({ sessionId: ref.id, error: this.t("session.archiveNotFound", "Archived session not found") });
        continue;
      }

      const active = this.activeForLookup({ id: record.sessionId, cwd: record.cwd }, managementContext);
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: record.sessionId, error: this.t("session.stopBeforeDeleteArchive", "Stop current session activity before deleting archived session") });
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
        failures.push({ sessionId: item.record.sessionId, error: errorMessage(error, this.t) });
      }
    }

    const deleteIds = readyRecords.map((record) => record.sessionId);

    let deletedSessionIds: string[] = [];
    try {
      deletedSessionIds = await this.archiveStoreDeleteArchivedMany(deleteIds);
    } catch (error: unknown) {
      for (const sessionId of deleteIds) failures.push({ sessionId, error: errorMessage(error, this.t) });
    }
    const deletedIdSet = new Set(deletedSessionIds);
    await this.forgetUnreadSessions(readyRecords.filter((record) => deletedIdSet.has(record.sessionId)), eventScopeFromManagementContext(managementContext));

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
    if (this.hasActiveWork(session)) throw new Error(this.t("session.stopBeforeReload", "Stop current session activity before reloading"));
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error(this.t("session.notPersisted", "Session has not been persisted"));
    const reopenedSession = await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session, runtime: active.runtime }],
      this.t("session.stopBeforeReload", "Stop current session activity before reloading"),
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
            : this.notificationsForSession(session).beginReplacement(priorGeneration, { sessionId, cwd });
          const reopened = await this.openExistingSession(
            sessionId,
            cwd,
            () => this.sessionManager.open(sessionFile),
            {
              ...(managementContext === undefined ? {} : { managementContext }),
              ...(candidateGeneration === undefined ? {} : { notificationGeneration: candidateGeneration }),
            },
          );
          await this.reloadModelScope(reopened.runtime.session);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationsForSession(session).commitReplacement(candidateGeneration));
          }
          return reopened.runtime.session;
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationsForSession(session).abortReplacement(candidateGeneration));
          }
          throw error;
        }
      },
    );
    this.publishStatus(reopenedSession);
  }

  async detachParent(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error(this.t("session.notPersisted", "Session has not been persisted"));
    clearSessionFileParent(sessionFile);
    this.sessionManager.invalidateSessionFile(sessionFile);
    clearParentSessionHeader(session.sessionManager);
    this.unregisterSubsession(session.sessionId, this.eventScopeForSession(session));
    await this.forgetUnreadSessions([{ sessionId: session.sessionId, cwd: session.sessionManager.getCwd() }], this.eventScopeForSession(session));
  }

  async abort(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const active = this.activeForLookup(ref, managementContext);
    if (active === undefined) return;
    this.clearCompactionPromptQueue(active.runtime.session);
    clearSessionQueue(active.runtime.session);
    this.abortRunScopedExtensionDialogs(active.runtime.session);
    try {
      await this.abortSessionOperations(active.runtime.session);
      this.publishActivity(active.runtime.session, this.t("activity.stopped", "Stopped"), "idle");
    } catch (error: unknown) {
      const message = userFacingErrorMessage(error, this.t);
      this.publishActivity(active.runtime.session, this.t("activity.stopFailed", "Stop failed"), "error", message);
      throw error;
    } finally {
      this.publishStatus(active.runtime.session);
    }
  }

  async clearQueue(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref, managementContext);
    this.clearCompactionPromptQueue(session);
    clearSessionQueue(session);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async stop(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<void> {
    const session = this.activeForLookup(ref, managementContext)?.runtime.session ?? this.startupSessionForLookup(ref, managementContext);
    if (session !== undefined) {
      await this.closeActive(session.sessionId, CLEAR_RUNTIME_NOTIFICATIONS, eventScopeFromManagementContext(managementContext));
      return;
    }
    if (isPiSessionRef(ref)) {
      this.publishNotificationMutations(this.notificationsForScope(eventScopeFromManagementContext(managementContext)).clearSessionIdentity(ref.id, canonicalizeStoredCwd(ref.cwd), "runtime-close"));
    }
  }

  private async bulkSessionLookupContext(refs: readonly SessionBulkMutationRef[]): Promise<BulkSessionLookupContext> {
    return { sessionsByCwd: await this.listSessionsByCwd(refs.map((ref) => ref.cwd)) };
  }

  private async listSessionsByCwd(cwds: readonly string[]): Promise<Map<string, PiSessionListEntry[]>> {
    const uniqueCwds = uniqueStrings(cwds);
    const entries = await Promise.all(uniqueCwds.map(async (cwd) => [cwd, await this.sessionManager.list(cwd)] as const));
    return new Map(entries);
  }

  private async archiveStoreArchiveMany(inputs: readonly ArchiveSessionInput[]): Promise<ArchivedSessionRecord[]> {
    if (inputs.length === 0) return [];
    const oldestFirst = [...inputs].sort((a, b) => Date.parse(a.modified) - Date.parse(b.modified));
    if (this.archiveStore.archiveMany !== undefined) return this.archiveStore.archiveMany(oldestFirst);
    const records: ArchivedSessionRecord[] = [];
    for (const input of oldestFirst) records.push(await this.archiveStore.archive(input));
    return records;
  }

  private async archiveStoreDeleteArchivedMany(sessionIds: readonly string[]): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    if (this.archiveStore.deleteArchivedMany !== undefined) return this.archiveStore.deleteArchivedMany(sessionIds);
    if (this.archiveStore.deleteArchived === undefined) throw new Error(this.t("session.archiveDeleteUnsupported", "The archive store does not support deletion"));
    for (const sessionId of sessionIds) await this.archiveStore.deleteArchived(sessionId);
    return [...sessionIds];
  }

  private async cleanupPlan(request: NormalizedSessionCleanupRequest) {
    const [sessions, archivedRecords, scopedSessions] = await Promise.all([
      this.sessionManager.listAll(),
      this.archiveStore.list(),
      request.thresholds.archiveIdleDays === undefined
        ? Promise.resolve(new Map<string, PiSessionListEntry[]>())
        : this.listSessionsByCwd(request.projectCwds ?? []),
    ]);
    return planSessionCleanup({
      sessions: [...sessions, ...[...scopedSessions.values()].flat()],
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

  private async archiveInputForSession(session: PiAgentSession): Promise<ArchiveSessionInput> {
    const cwd = session.sessionManager.getCwd();
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error(this.t("session.notPersisted", "Session has not been persisted"));
    const listed = (await this.sessionManager.list(cwd)).find((candidate) => candidate.id === session.sessionId);
    if (listed !== undefined) return archiveInputFromListEntry(listed);
    return archiveInputFromActiveSession(session, this.t);
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
      candidates.set(session.sessionId, { ...(existing ?? archiveCandidateFromActiveSession(session, false, this.t)), activeSession: session });
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

  private async closeActive(sessionId: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS, eventScope = NORMAL_SESSION_EVENT_SCOPE): Promise<void> {
    for (const startup of this.startupSessions.values()) {
      if (startup.session.sessionId === sessionId && startup.eventScope === eventScope) this.endSessionExtensionDialogs(startup.session);
    }
    const pendingOpens = this.pendingSessionOpenPromises(sessionId, eventScope);
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const activeSessions = this.activeSessionsForId(sessionId).filter((active) => active.eventScope === eventScope);
    if (activeSessions.length === 0 && notificationPolicy.kind === "clear") {
      this.publishNotificationMutations(this.notificationsForScope(eventScope).clearSession(sessionId, notificationPolicy.reason));
      return;
    }
    await Promise.all(activeSessions.map((active) => this.closeActiveSession(active, notificationPolicy)));
  }

  private async closeActiveInScope(sessionId: string, eventScope: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    await this.closeActive(sessionId, notificationPolicy, eventScope);
  }

  private async closeActiveSession(active: ManagedActiveSession, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    const sessionId = active.runtime.session.sessionId;
    if (notificationPolicy.kind === "clear") {
      const generation = this.notificationGenerationBySession.get(active.runtime.session);
      const store = this.notificationsForScope(active.eventScope);
      const mutations = generation === undefined
        ? store.clearSession(sessionId, notificationPolicy.reason)
        : store.clearGeneration(generation, notificationPolicy.reason);
      this.publishNotificationMutations(mutations);
    }
    this.forgetUnreadActivity(active.runtime.session);
    this.pendingAskStore.forgetSession(this.dialogSessionKey(active.runtime.session));
    this.endSessionExtensionDialogs(active.runtime.session);
    this.rememberManagementMediaFile(active.runtime.session, active.eventScope);
    this.active.delete(activeSessionKey(sessionId, active.eventScope));
    this.suggestedInputs.delete(this.dialogSessionKey(active.runtime.session));
    this.events.mediaIndex.forgetSession({ id: sessionId, cwd: active.runtime.session.sessionManager.getCwd(), eventScope: active.eventScope });
    this.activities.delete(activeSessionKey(sessionId, active.eventScope));
    this.workspaceActivity?.removeSession(sessionId, active.runtime.session.sessionManager.getCwd(), active.eventScope);
    this.clearAuthLossWarningsForSession(sessionId);
    this.clearCompactionPromptQueue(active.runtime.session);
    // Disarm subsession notification before teardown so the abort below cannot
    // emit a "stopped working" event that notifies the parent (e.g. on archive).
    // The parent/children link is kept so the parent can still see the child.
    if (this.subsessionLinkForActiveChild(active.runtime.session) !== undefined) this.subsessionNotifyArmed.delete(activeSessionKey(sessionId, active.eventScope));
    clearSessionQueue(active.runtime.session);
    active.unsubscribe();
    active.runtime.setRebindSession(undefined);
    try {
      await this.abortSessionOperations(active.runtime.session);
    } finally {
      if (active.eventScope === NORMAL_SESSION_EVENT_SCOPE) await this.activityMarker.release(active.runtime.session.sessionFile);
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
    if (await this.getArchived(ref) !== undefined) throw new Error(this.t("session.archiveReadOnly", "Archived sessions are read-only. Restore the session to continue."));
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
    return undefined;
  }

  /** Resolve status and dialog-close calls even while extension startup is waiting for the browser. */
  private async sessionForStatusOrDialogClose(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<PiAgentSession> {
    const reachable = this.activeForLookup(ref, managementContext)?.runtime.session ?? this.startupSessionForLookup(ref, managementContext);
    return reachable ?? this.getOrOpen(ref, managementContext);
  }

  private async readableSessionBranch(session: PiAgentSession): Promise<unknown[]> {
    if (this.hasActiveWork(session) || this.sessionManager.readBranch === undefined) return session.sessionManager.getBranch();
    const leafId = session.sessionManager.getLeafId();
    const latestEntry = session.sessionManager.getEntries?.().at(-1);
    // Unsummarized tree navigation changes only the SDK's in-memory leaf.
    if (!this.unpersistedTreeBranchLeaves.has(session)
      && isRecord(latestEntry) && typeof latestEntry["id"] === "string"
      && latestEntry["id"] !== leafId) return session.sessionManager.getBranch();
    const sessionFile = session.sessionFile ?? session.sessionManager.getSessionFile();
    const resolvedPath = sessionFile === undefined ? await this.idleSessionFilePath(session) : undefined;
    if (this.hasActiveWork(session)) return session.sessionManager.getBranch();
    const path = sessionFile ?? resolvedPath;
    if (path === undefined) return session.sessionManager.getBranch();
    const snapshot = await this.sessionManager.readBranch(path);
    if (snapshot === undefined) return session.sessionManager.getBranch();
    if (this.hasActiveWork(session) || session.sessionManager.getLeafId() !== leafId) return session.sessionManager.getBranch();
    const selectedLeafId = this.unpersistedTreeBranchLeaves.get(session);
    if (selectedLeafId !== undefined) {
      const runtimeLeafId = session.sessionManager.getLeafId();
      const selectedBranchIsAnchored = runtimeLeafId !== null
        && runtimeLeafId !== selectedLeafId && transcriptBranchIncludesEntry(snapshot, runtimeLeafId);
      if (!selectedBranchIsAnchored) return session.sessionManager.getBranch();
      this.unpersistedTreeBranchLeaves.delete(session);
    }
    return snapshot;
  }

  private async idleSessionFilePath(session: PiAgentSession): Promise<string | undefined> {
    const cached = this.idleSessionFileResolutions.get(session);
    const at = this.now().getTime();
    if (cached !== undefined && at - cached.at < IDLE_SESSION_FILE_RESOLUTION_THROTTLE_MS) return cached.path;
    const match = await this.sessionManager.resolveSessionFile(session.sessionManager.getCwd(), session.sessionId);
    this.idleSessionFileResolutions.set(session, { at, path: match?.path });
    return match?.path;
  }

  private async getActive(ref: PiSessionLookup, managementContext?: ManagementEmbedContext): Promise<ManagedActiveSession> {
    const active = this.activeForLookup(ref, managementContext);
    const resolvedRef = active === undefined ? isPiSessionRef(ref) ? ref : undefined
      : { id: active.runtime.session.sessionId, cwd: active.runtime.cwd };
    const pending = resolvedRef === undefined ? undefined : this.pendingSessionOpens.get(JSON.stringify([
      canonicalizeStoredCwd(resolvedRef.cwd), resolvedRef.id, managementContextKey(managementContext),
    ]));
    if (pending !== undefined) return pending.promise;
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
      ? await this.sessionManager.resolveSessionFile(ref.cwd, ref.id)
      : findSessionByExactId(await this.sessionManager.listAll(), ref);
    if (!match) throw new Error(this.t("routing.sessionNotFound", "Session not found"));
    return this.openPending(match.id, match.cwd, managementContext, () => this.sessionManager.open(match.path));
  }

  private openPending(
    sessionId: string,
    cwd: string,
    managementContext: ManagementEmbedContext | undefined,
    openSessionManager: () => PiSessionManager,
    options: Pick<CreateSessionRuntimeOptions, "notificationGeneration" | "notifications"> = {},
  ): Promise<ManagedActiveSession> {
    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionId, managementContextKey(managementContext)]);
    const existing = this.pendingSessionOpens.get(key);
    if (existing !== undefined) return existing.promise;

    const active = this.activeForLookup({ id: sessionId, cwd }, managementContext);
    if (active !== undefined) return Promise.resolve(active);
    const pending: PendingSessionOpen = {
      sessionId,
      eventScope: eventScopeFromManagementContext(managementContext),
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

  private pendingSessionOpenPromises(sessionId?: string, eventScope?: string): Promise<ManagedActiveSession>[] {
    return [...this.pendingSessionOpens.values()]
      .filter((pending) => (sessionId === undefined || pending.sessionId === sessionId) && (eventScope === undefined || pending.eventScope === eventScope))
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
    return undefined;
  }

  private activeForLookupAny(ref: PiSessionLookup): ManagedActiveSession | undefined {
    const sessionId = sessionIdFromLookup(ref);
    const exact = this.activeForSessionId(sessionId);
    if (exact !== undefined && lookupMatchesActiveSession(ref, exact)) return exact;
    return undefined;
  }

  private getActiveForCommand(sessionId: string, eventScope: string | undefined): Promise<ManagedActiveSession> {
    const active = eventScope === undefined ? this.activeForSessionId(sessionId) : this.activeForSessionIdAndScope(sessionId, eventScope);
    if (active === undefined) throw new Error(this.t("session.notActive", "Session not active: {sessionId}", { sessionId }));
    return Promise.resolve(active);
  }

  private submitCommandPrompt(sessionId: string, text: string, eventScope: string | undefined): Promise<void> {
    const active = this.activeForSessionIdAndScope(sessionId, eventScope);
    if (active === undefined) throw new Error(this.t("session.notActive", "Session not active: {sessionId}", { sessionId }));
    return this.submitPrompt(active.runtime.session, text, undefined, [], false);
  }

  /**
   * Attach to one already-hosted normal-mode session. Management scopes are
   * not searched: host session events are a normal-mode capability.
   */
  connectSessionEvents(ref: PiSessionRef, lifetime: AbortSignal): PiWebHostPiSessionConnection {
    const active = this.activeForSessionIdAndScope(ref.id, NORMAL_SESSION_EVENT_SCOPE);
    if (active?.runtime.session.sessionId !== ref.id
      || !cwdPathsEqual(active.runtime.session.sessionManager.getCwd(), ref.cwd)) {
      throw new Error("Selected session is not hosted in this workspace on this machine");
    }
    if (this.startupSessions.has(activeSessionKey(ref.id, NORMAL_SESSION_EVENT_SCOPE))) {
      throw new Error("Selected session is still initializing its extensions");
    }
    return this.sessionEvents.connect(active.runtime.session, lifetime);
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

  private create(
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
    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionManager.getSessionId(), managementContextKey(options.managementContext)]);
    const pending: PendingSessionOpen = {
      sessionId: sessionManager.getSessionId(),
      eventScope: eventScopeFromManagementContext(options.managementContext),
      promise: this.createSessionRuntime(sessionManager, cwd, options, startup),
    };
    pending.promise = pending.promise.finally(() => {
      startup.end();
      if (this.pendingSessionOpens.get(key) === pending) this.pendingSessionOpens.delete(key);
    });
    this.pendingSessionOpens.set(key, pending);
    return pending.promise;
  }

  private async bindSessionExtensions(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
    owner: Pick<ManagedActiveSession, "eventScope" | "managementContextKey">,
    startupSignal?: AbortSignal,
  ): Promise<void> {
    const startupDialogs = { signal: startupSignal };
    const uiContext = this.sessionUiContext(session, generation, startupDialogs);
    const key = activeSessionKey(session.sessionId, owner.eventScope);
    this.startupSessions.set(key, { session, ...owner });
    try {
      await session.bindExtensions({
        uiContext,
        mode: "rpc",
        commandContextActions: this.extensionCommandActions(session),
        onError: (error) => {
          const message = `${error.extensionPath}: ${error.error}`;
          this.publishActivity(session, this.t("activity.extensionError", "Extension error"), "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message }, owner.eventScope);
        },
      });
    } finally {
      // A captured startup UI context must not carry plugin cancellation into
      // later user turns after startup has finished.
      startupDialogs.signal = undefined;
      if (this.startupSessions.get(key)?.session === session) this.startupSessions.delete(key);
    }
  }

  private extensionCommandActions(session: PiAgentSession): ExtensionCommandContextActions {
    const ref = { id: session.sessionId, cwd: session.sessionManager.getCwd() };
    const managementContext = this.sessionManagementContexts.get(session);
    return {
      waitForIdle: () => {
        this.assertCurrentExtensionSession(session);
        return session.waitForIdle();
      },
      navigateTree: (targetId, options) => {
        const expectedLeafId = session.sessionManager.getLeafId();
        return this.runExtensionSessionControl(session, async () => {
          const result = await this.navigateSessionTree(ref, targetId, expectedLeafId, options ?? { summarize: false }, managementContext, session);
          return { cancelled: result.cancelled };
        });
      },
      fork: (entryId, options) => {
        const expectedLeafId = session.sessionManager.getLeafId();
        const withSession = options?.withSession;
        let completeReplacement: (() => Promise<void>) | undefined;
        const forkOptions: PiForkOptions = {
          ...options,
          position: options?.position ?? "before",
          // Capture Pi's fresh context, but run user code after the host's
          // replacement reservation is released so fresh controls can work.
          ...(withSession === undefined ? {} : { withSession: (ctx) => {
            completeReplacement = () => withSession(ctx);
            return Promise.resolve();
          } }),
        };
        return this.runExtensionSessionControl(session, async () => {
          const runtime = this.activeForLookup(ref, managementContext)?.runtime;
          const result = await this.forkSessionTree(ref, { entryId, expectedLeafId }, managementContext, forkOptions, session);
          if (!result.cancelled) {
            try {
              await completeReplacement?.();
            } catch (error: unknown) {
              // The fork is committed. Report callback failure on the current
              // runtime (which may have forked again), including its recoverable inbox.
              const current = runtime?.session;
              if (current !== undefined && this.isCurrentActiveSession(current)) {
                const message = userFacingErrorMessage(error, this.t);
                current.extensionRunner.getUIContext().notify(message, "error");
                this.publishActivity(current, "extension callback failed", "error", message);
                this.events.publish(current.sessionId, { type: "session.error", message }, this.eventScopeForSession(current));
              }
              throw error;
            }
          }
          return { cancelled: result.cancelled };
        });
      },
      reload: () => this.runExtensionSessionControl(session, () => this.reloadSessionRuntime(session)),
      // These need host-owned creation/selection policies, not SDK runtime-only
      // replacement. Fail visibly until PI WEB supplies that integration.
      newSession: () => Promise.reject(new Error(this.t("session.extensionNewUnsupported", "ctx.newSession() is not supported in PI WEB. Start a new session from the web UI."))),
      switchSession: () => Promise.reject(new Error(this.t("session.extensionSwitchUnsupported", "ctx.switchSession() is not supported in PI WEB. Select a session from the web UI."))),
    };
  }


  private assertCurrentExtensionSession(session: PiAgentSession): void {
    if (!this.isCurrentActiveSession(session) || this.startupSessions.has(activeSessionKey(session.sessionId, this.eventScopeForSession(session)))) {
      throw new Error(this.t("session.extensionUnavailable", "This extension command belongs to an unavailable session runtime"));
    }
  }


  private runExtensionSessionControl<T>(session: PiAgentSession, operation: () => Promise<T>): Promise<T> {
    return this.extensionCommandExecution.run({ ...this.extensionCommandExecution.getStore(), sessionControl: true }, async () => {
      this.assertCurrentExtensionSession(session);
      await this.assertWritable({ id: session.sessionId, cwd: session.sessionManager.getCwd() });
      this.assertCurrentExtensionSession(session);
      return operation();
    });
  }

  private setSuggestedInput(session: PiAgentSession, text: string | undefined): void {
    const key = this.dialogSessionKey(session);
    if (text === undefined || text === "") this.suggestedInputs.delete(key);
    else this.suggestedInputs.set(key, text);
  }

  private bindRuntime(active: ManagedActiveSession, session: PiAgentSession = active.runtime.session): void {
    this.sessionEventScopes.set(session, active.eventScope);
    this.runtimeBySession.set(session, active.runtime);
    this.rememberManagementMediaFile(session, active.eventScope);
    active.unsubscribe();
    for (const [sessionKey, candidate] of this.active.entries()) {
      if (candidate === active) {
        this.active.delete(sessionKey);
        if (sessionKey !== activeSessionKey(session.sessionId, active.eventScope)) this.clearCompactionPromptQueueKey(sessionKey);
      }
    }
    if (active.eventScope === NORMAL_SESSION_EVENT_SCOPE && active.runtime.session !== session) {
      this.sessionEvents.close(active.runtime.session);
    }
    this.reconcileRuntimeMessageCount(session);
    const unsubscribe = session.subscribe((event) => {
      const eventType = getString(event, "type");
      const message = getProperty(event, "message");
      const entry = getProperty(event, "entry");
      const role = getString(message, "role");
      if ((eventType === "message_end" && (role === "user" || role === "assistant" || role === "toolResult" || role === "system"))
        || (eventType === "entry_appended" && getString(entry, "type") === "message")) {
        this.runtimeMessageCounts.set(session, this.runtimeMessageCount(session) + 1);
      }
      if (eventType === "agent_settled" || eventType === "session_tree") this.reconcileRuntimeMessageCount(session);
      if (eventType === "message_start" && role === "assistant") this.assistantStreamIds.set(session, randomUUID());
      const streamId = this.assistantStreamIds.get(session);
      if ((eventType === "message_start" || eventType === "message_update") && role === "assistant") {
        this.publishedAssistantPartials.set(session, structuredClone(
          annotateAssistantStreamId(annotateAssistantThinkingLevel(projectBrowserMessage(message), session.thinkingLevel), streamId),
        ));
      } else if ((eventType === "message_end" && role === "assistant") || eventType === "agent_end") {
        this.publishedAssistantPartials.delete(session);
      }
      this.events.publish(session.sessionId, toClientEvent(event, session.thinkingLevel, streamId), active.eventScope, { id: session.sessionId, cwd: session.sessionManager.getCwd() });
      if ((eventType === "message_end" && role === "assistant") || eventType === "agent_end") this.assistantStreamIds.delete(session);
      this.auditToolExecutionEvent(active, event);
      this.auditAssistantResponseEvent(active, event);
      this.publishActivityForEvent(session, event);
      if (eventType === "message_start" && isRecord(event) && getString(event["message"], "role") === "user") {
        void this.voidOpenAskForUserMessage(session).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.publishActivity(session, this.t("activity.extensionError", "Extension error"), "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message }, active.eventScope);
        });
      }
      if (eventType === "message_start" && role === "user") this.suggestedInputs.delete(this.dialogSessionKey(session));
      if (eventType === "agent_end") this.abortRunScopedExtensionDialogs(session);
      if (eventType === "compaction_end") {
        if (getString(event, "reason") === "manual") this.manualCompactionEnded.add(session);
        this.publishCompactionOutcome(session, event);
        this.scheduleCompactionQueueDrain(session);
      }
      if (eventType === "agent_start" || eventType === "agent_end") this.scheduleCompactionQueueDrain(session);
      this.publishStatus(session);
      this.updateSubsessionTracking(session);
    });
    active.unsubscribe = () => {
      if (active.eventScope === NORMAL_SESSION_EVENT_SCOPE) this.sessionEvents.close(session);
      unsubscribe();
      this.publishedAssistantPartials.delete(session);
      this.assistantStreamIds.delete(session);
    };
    this.active.set(activeSessionKey(session.sessionId, active.eventScope), active);
  }

  private publishCompactionOutcome(session: PiAgentSession, event: unknown): void {
    const aborted = getBoolean(event, "aborted") === true;
    const errorMessage = getString(event, "errorMessage");
    const automatic = getString(event, "reason") !== "manual";
    const message = aborted
      ? (automatic ? this.t("session.compaction.autoCancelled", "Automatic compaction cancelled.") : this.t("session.compaction.cancelled", "Compaction cancelled."))
      : errorMessage === undefined ? undefined : this.t("session.compaction.failed", "Could not compact history. Try again.");
    if (!aborted && errorMessage !== undefined) {
      this.events.publish(session.sessionId, { type: "session.diagnostic", message: errorMessage }, this.eventScopeForSession(session));
    }
    this.publishActivity(session, aborted ? this.t("activity.compactionCancelled", "Compaction cancelled") : errorMessage === undefined ? this.t("activity.compacted", "Context compacted") : this.t("activity.compactionFailed", "Context compaction failed"),
      !aborted && errorMessage !== undefined ? "error" : "idle", message);
    // Successful compaction already has a canonical summary in the transcript.
    // Keep cancellation/failure feedback in the refresh-safe session inbox only.
    const generation = this.notificationGenerationBySession.get(session);
    if (message !== undefined && generation !== undefined) {
      this.publishNotificationMutations(this.notificationsForSession(session).addNotification(generation, message, aborted ? "info" : "error").mutations);
    }
  }

  private scheduleCompactionQueueDrain(session: PiAgentSession, delayMs = 0): void {
    const sessionKey = activeSessionKey(session.sessionId, this.eventScopeForSession(session));
    if (!this.isCurrentActiveSession(session)
      || !this.compactionPromptQueues.has(sessionKey) || this.compactionDrainTimers.has(sessionKey)) return;
    const timer = setTimeout(() => {
      this.compactionDrainTimers.delete(sessionKey);
      this.drainCompactionPromptQueue(session);
    }, delayMs);
    this.compactionDrainTimers.set(sessionKey, timer);
  }

  private drainCompactionPromptQueue(session: PiAgentSession): void {
    if (!this.isCurrentActiveSession(session)) return;
    const sessionKey = activeSessionKey(session.sessionId, this.eventScopeForSession(session));
    if (session.isCompacting) {
      this.scheduleCompactionQueueDrain(session, 100);
      return;
    }

    if (session.isStreaming) {
      const queued = this.takeCompactionPromptQueue(sessionKey);
      if (queued.length === 0) return;
      this.publishStatus(session);
      for (const prompt of queued) void this.submitPrompt(session, prompt.text, prompt.kind, prompt.images, prompt.echoUserMessage ?? true);
      return;
    }

    const prompt = this.shiftCompactionPrompt(sessionKey);
    if (prompt === undefined) return;
    this.publishStatus(session);
    const submitted = this.submitPrompt(session, prompt.text, undefined, prompt.images, prompt.echoUserMessage ?? true);
    void submitted.finally(() => { this.scheduleCompactionQueueDrain(session); });
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

  private clearCompactionPromptQueue(session: PiAgentSession): void {
    this.clearCompactionPromptQueueKey(activeSessionKey(session.sessionId, this.eventScopeForSession(session)));
  }

  private clearCompactionPromptQueueKey(sessionKey: string): void {
    this.compactionPromptQueues.delete(sessionKey);
    const timer = this.compactionDrainTimers.get(sessionKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.compactionDrainTimers.delete(sessionKey);
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
      message: this.t("session.authRemoved", "Authentication for {provider}/{model} was removed. Use /model to select another model.", { provider: model.provider, model: model.id }),
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
      void this.refreshActivityMarker(session);
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
    if (this.treeNavigations.has(session)) return this.t("activity.navigating", "Navigating session tree");
    if (this.isSessionEntryMutationActive(session)) return this.t("activity.updating", "Updating session");
    if (session.isCompacting) return this.t("activity.compacting", "Compacting context");
    if (session.isBashRunning) return this.t("activity.commandRunning", "Running command");
    if (session.isStreaming) return this.t("activity.agentRunning", "Agent running");
    if (this.pendingMessageCount(session) > 0) return this.t("activity.queued", "Queued");
    return this.t("activity.working", "Working");
  }

  private hasActiveWork(session: PiAgentSession): boolean {
    const execution = this.extensionCommandExecution.getStore();
    const ownCommandReceipt = execution?.sessionControl === true && execution.submission?.active === true && execution.submission.session === session ? 1 : 0;
    return this.treeNavigations.has(session)
      || this.isSessionEntryMutationActive(session, ownCommandReceipt)
      || this.isTreeExclusiveOperationActive(session)
      || sessionHasActiveWork(session, this.compactionQueuedMessages(session).length);
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
    if (this.treeNavigations.has(session)) throw new Error(this.t("server.main.0c70757b6815", "Cannot {arg0} while session tree navigation is active", { arg0: action }));
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

  private isSessionEntryMutationActive(session: PiAgentSession, ignoredReceipts = 0): boolean {
    return (this.sessionEntryMutationCounts.get(session) ?? 0) > ignoredReceipts;
  }

  private publishActivityForEvent(session: PiAgentSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType === undefined) return;
    if (eventType === "agent_start") { this.publishActivity(session, this.t("activity.agentRunning", "Agent running"), "active"); return; }
    if (eventType === "agent_end") {
      this.publishActivity(session, this.t("activity.idle", "Idle"), "idle");
      const eventScope = this.eventScopeForSession(session);
      const sessionKey = activeSessionKey(session.sessionId, eventScope);
      this.activities.scheduleSettledRefresh(sessionKey, () => {
        if (this.active.get(sessionKey)?.runtime.session !== session) return;
        this.publishActivity(session, this.t("activity.idle", "Idle"), "idle");
        this.publishStatus(session);
      }, 250);
      return;
    }
    if (eventType === "turn_end") { this.publishActivity(session, this.t("activity.turnCompleted", "Turn completed"), "idle"); return; }
    if (eventType === "message_start") { this.publishActivity(session, this.t("activity.messageStarted", "Message started"), "active"); return; }
    if (eventType === "message_end") { this.publishActivity(session, this.t("activity.messageCompleted", "Message completed"), "idle"); return; }
    if (eventType === "message_update") { this.publishActivity(session, this.t("activity.receiving", "Receiving reply"), "active"); return; }
    if (eventType === "tool_execution_start") { this.publishActivity(session, this.t("activity.toolRunning", "Running tool"), "active", getString(event, "toolName")); return; }
    if (eventType === "tool_execution_end") {
      const isError = getBoolean(event, "isError") === true;
      this.publishActivity(session, isError ? this.t("activity.toolFailed", "Tool failed") : this.t("activity.toolCompleted", "Tool completed"), isError ? "error" : "idle", getString(event, "toolName"));
      return;
    }
    if (eventType === "bash_execution_start") { this.publishActivity(session, this.t("activity.commandRunning", "Running command"), "active"); return; }
    if (eventType === "bash_execution_end") { this.publishActivity(session, this.t("activity.commandCompleted", "Command completed"), "idle"); return; }
    if (this.hasActiveWork(session)) this.publishActivity(session, this.t("activity.working", "Working"), "active");
  }

  private auditToolExecutionEvent(active: ManagedActiveSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType !== "tool_execution_start" && eventType !== "tool_execution_end") return;
    const isEnd = eventType === "tool_execution_end";
    const auditEvent: NormalToolAuditEvent = {
      sessionId: active.runtime.session.sessionId,
      cwd: active.runtime.cwd,
      toolName: getString(event, "toolName") ?? "unknown",
      toolCallId: getString(event, "toolCallId") ?? "unknown",
      status: isEnd ? (getBoolean(event, "isError") === true ? "failed" : "completed") : "started",
    };
    const managementIdentity = active.managementAuditIdentity;
    this.logger.info({
      mode: active.managementContextKey === undefined ? "normal" : "management",
      ...(managementIdentity ?? {}),
      ...auditEvent,
    }, "Pi tool execution audit");
    if (managementIdentity !== undefined) {
      try {
        this.managementAudit?.record({
          action: "tool_execution",
          ...managementIdentity,
          ...auditEvent,
          content: isEnd ? getProperty(event, "result") : getProperty(event, "args"),
        });
      } catch (error) {
        this.logger.info({ sessionId: auditEvent.sessionId, toolCallId: auditEvent.toolCallId, error: error instanceof Error ? error.message : String(error) }, "failed to enqueue management-mode tool audit");
      }
      return;
    }
    if (this.normalToolAudit === undefined) return;
    try {
      this.normalToolAudit.record(auditEvent);
    } catch (error) {
      this.logger.info({
        sessionId: auditEvent.sessionId,
        toolCallId: auditEvent.toolCallId,
        error: error instanceof Error ? error.message : String(error),
      }, "failed to persist ordinary-mode tool audit");
    }
  }

  private auditAssistantResponseEvent(active: ManagedActiveSession, event: unknown): void {
    if (getString(event, "type") !== "message_end") return;
    const message = getProperty(event, "message");
    if (getString(message, "role") !== "assistant") return;
    this.recordManagementMessageAudit(active, "assistant_response", auditVisibleAssistantMessage(message));
  }

  private auditUserPrompt(session: PiAgentSession, text: string): void {
    const active = [...new Set(this.active.values())]
      .find(candidate => candidate.runtime.session === session);
    if (active === undefined) return;
    this.recordManagementMessageAudit(active, "user_prompt", text);
  }

  private recordManagementMessageAudit(
    active: ManagedActiveSession,
    action: "user_prompt" | "assistant_response",
    content: unknown,
  ): void {
    const identity = active.managementAuditIdentity;
    if (identity === undefined || this.managementAudit === undefined) return;
    try {
      this.managementAudit.record({
        action,
        status: "completed",
        ...identity,
        sessionId: active.runtime.session.sessionId,
        cwd: active.runtime.cwd,
        content,
      });
    } catch (error) {
      this.logger.info({
        sessionId: active.runtime.session.sessionId,
        action,
        error: error instanceof Error ? error.message : String(error),
      }, "failed to enqueue management-mode message audit");
    }
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
    const label = intent === "create" ? this.t("activity.creating", "Creating session") : this.t("activity.opening", "Opening session");
    return {
      report: (phase) => { this.publishStartupProgress(sessionId, startupToken, label, "active", this.startupDetail(phase), eventScope); },
      end: () => {
        // A real activity published during the window (an extension error, say)
        // is the truth about this session and must survive the clear.
        if (this.activities.get(activeSessionKey(sessionId, eventScope)) !== undefined) return;
        this.publishStartupProgress(sessionId, startupToken, this.t("activity.idle", "Idle"), "idle", undefined, eventScope);
      },
    };
  }

  private startupDetail(phase: string): string {
    return this.catalogRefreshStatus?.isRefreshInFlight() === true
      ? `${phase} · ${this.t("startup.catalogRefresh", "Provider model catalog is refreshing")}`
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

  private async refreshActivityMarker(session: PiAgentSession): Promise<void> {
    const eventScope = this.eventScopeForSession(session);
    if (eventScope !== NORMAL_SESSION_EVENT_SCOPE
      || this.activeForSessionIdAndScope(session.sessionId, eventScope)?.runtime.session !== session) return;
    const previous = this.activityMarker.isActiveElsewhere(session.sessionFile);
    await this.activityMarker.refresh(session.sessionFile, this.hasActiveWork(session));
    if (this.activeForSessionIdAndScope(session.sessionId, eventScope)?.runtime.session === session
      && previous !== this.activityMarker.isActiveElsewhere(session.sessionFile)) {
      this.publishStatus(session);
    }
  }

  private rememberManagementMediaFile(session: PiAgentSession, eventScope: string): void {
    if (eventScope === NORMAL_SESSION_EVENT_SCOPE) return;
    const path = session.sessionFile ?? session.sessionManager.getSessionFile();
    if (path !== undefined) this.managementMediaFiles.add(path);
  }

  private publishStatus(session: PiAgentSession): void {
    this.rememberManagementMediaFile(session, this.eventScopeForSession(session));
    void this.refreshActivityMarker(session);
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
    const stored = { phase: "idle" as const, label: this.t("activity.idle", "Idle"), at };
    this.activities.set(activeSessionKey(session.sessionId, eventScope), stored);
    const activity = { sessionId: session.sessionId, ...stored };
    this.events.publish(session.sessionId, { type: "activity.update", activity }, eventScope);
    this.events.publishGlobal({ type: "activity.update", activity }, eventScope);
  }

  private activityForSession(session: PiAgentSession): { phase: "active" | "idle" | "error"; label: string; detail?: string; at: string } | undefined {
    return this.activities.get(activeSessionKey(session.sessionId, this.eventScopeForSession(session)));
  }

  private eventScopeForSession(session: PiAgentSession): string {
    const boundScope = this.sessionEventScopes.get(session);
    if (boundScope !== undefined) return boundScope;
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

  private publishStatusForSessionId(sessionId: string, scope?: string): void {
    const sessions = new Set<PiAgentSession>();
    for (const active of this.activeSessionsForId(sessionId)) sessions.add(active.runtime.session);
    for (const startup of this.startupSessions.values()) {
      if (startup.session.sessionId === sessionId) sessions.add(startup.session);
    }
    for (const session of sessions) {
      if (scope === undefined || this.eventScopeForSession(session) === scope) this.publishStatus(session);
    }
  }

  private reconcileRuntimeMessageCount(session: PiAgentSession): number {
    const count = transcriptMessageCount(session.sessionManager.getBranch());
    this.runtimeMessageCounts.set(session, count);
    return count;
  }


  private runtimeMessageCount(session: PiAgentSession): number {
    return this.runtimeMessageCounts.get(session) ?? this.reconcileRuntimeMessageCount(session);
  }


  private snapshotMessageCount(branch: readonly unknown[]): number {
    // The gateway reuses immutable disk snapshots until the file changes.
    // Keep disk counts separate: an idle runtime may lag external appends.
    const cached = this.snapshotMessageCounts.get(branch);
    if (cached !== undefined) return cached;
    const count = transcriptMessageCount(branch);
    this.snapshotMessageCounts.set(branch, count);
    return count;
  }

  private statusFromSession(session: PiAgentSession, messageCount = this.runtimeMessageCount(session)): ClientSessionStatus {
    const stats = session.getSessionStats();
    const model = session.model === undefined ? undefined : modelToClientModel(session.model);
    const contextUsage = session.getContextUsage();
    const warnings = this.warningsForSession(session);
    const pendingAsk = this.pendingAskStore.pendingAsk(this.dialogSessionKey(session));
    const pendingDialogs = this.pendingExtensionDialogStore.pendingDialogs(this.dialogSessionKey(session));
    const suggestedInput = this.suggestedInputs.get(this.dialogSessionKey(session));
    return {
      sessionId: session.sessionId,
      persisted: sessionFileExists(session.sessionFile),
      recentlyActiveElsewhere: this.eventScopeForSession(session) === NORMAL_SESSION_EVENT_SCOPE && this.activityMarker.isActiveElsewhere(session.sessionFile),
      ...(model === undefined ? {} : { model }),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      pendingMessageCount: this.pendingMessageCount(session),
      queuedMessages: queuedMessagesFromSession(session, this.compactionQueuedMessages(session)),
      messageCount,
      tokens: stats.tokens,
      cost: stats.cost,
      ...(contextUsage === undefined ? {} : { contextUsage }),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(pendingAsk === undefined ? {} : { pendingAsk }),
      ...(pendingDialogs.length === 0 ? {} : { pendingDialogs }),
      ...(suggestedInput === undefined ? {} : { suggestedInput }),
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
    const authPath = modelRuntimeAuthPath(session.modelRuntime);
    const anthropic = authPath === undefined ? undefined : anthropicSubscriptionWarning(session, authPath);
    if (anthropic !== undefined) warnings.push(anthropic);
    return warnings;
  }

  private pendingMessageCount(session: PiAgentSession): number {
    return session.pendingMessageCount + this.compactionQueuedMessages(session).length;
  }

  private compactionQueuedMessages(session: PiAgentSession): readonly QueuedPrompt[] {
    return this.compactionPromptQueues.get(activeSessionKey(session.sessionId, this.eventScopeForSession(session))) ?? [];
  }

  private hasQueuedMessageText(session: PiAgentSession, text: string): boolean {
    return queuedMessagesFromSession(session, this.compactionQueuedMessages(session)).some((message) => message.text === text);
  }

  private notificationsForScope(scope: string): SessionNotificationStore {
    if (scope === NORMAL_SESSION_EVENT_SCOPE) return this.notificationStore;
    let store = this.scopedNotificationStores.get(scope);
    if (store === undefined) {
      store = new SessionNotificationStore({ eventScope: scope, now: this.now });
      this.scopedNotificationStores.set(scope, store);
    }
    return store;
  }

  private notificationsForSession(session: PiAgentSession): SessionNotificationStore {
    return this.notificationsForScope(this.eventScopeForSession(session));
  }

  private unreadForScope(scope: string): SessionUnreadStore {
    if (scope === NORMAL_SESSION_EVENT_SCOPE) return this.unreadStore;
    let store = this.scopedUnreadStores.get(scope);
    if (store === undefined) {
      store = new SessionUnreadStore({ eventScope: scope, now: this.now });
      this.scopedUnreadStores.set(scope, store);
    }
    return store;
  }

notificationCatalog(context?: ManagementEmbedContext): SessionNotificationCatalogSnapshot {
    return this.notificationsForScope(eventScopeFromManagementContext(context)).catalogSnapshot();
  }

async unreadCatalog(context?: ManagementEmbedContext): Promise<SessionUnreadCatalogSnapshot> {
    await this.publishUnreadMutations([]);
    return this.unreadForScope(eventScopeFromManagementContext(context)).durableCatalogSnapshot();
  }

  /** The status tree and HTTP catalog must read the same scoped store. */
  async unreadCatalogForScope(eventScope: string): Promise<SessionUnreadCatalogSnapshot> {
    await this.publishUnreadMutations([]);
    return this.unreadForScope(eventScope).durableCatalogSnapshot();
  }

  async reconcileUnreadWorkspaces(cwds: Iterable<string>): Promise<void> {
    await this.publishUnreadMutations(this.unreadStore.reconcileWorkspaces(cwds));
  }

async acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest, context?: ManagementEmbedContext): Promise<SessionUnreadCatalogSnapshot> {
    const store = this.unreadForScope(eventScopeFromManagementContext(context));
    const result = store.acknowledge(sessionId, {
      ...request,
      cwd: canonicalizeStoredCwd(request.cwd),
    });
    await this.publishUnreadMutations(result.mutations);
    return store.durableCatalogSnapshot();
  }

notificationInbox(ref: PiSessionRef, context?: ManagementEmbedContext): SessionNotificationInboxSnapshot {
    return this.notificationsForScope(eventScopeFromManagementContext(context)).inboxSnapshot(ref.id, canonicalizeStoredCwd(ref.cwd));
  }

dismissNotification(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissRequest, "cwd">,
    context?: ManagementEmbedContext,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationsForScope(eventScopeFromManagementContext(context)).dismissNotification(
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
    context?: ManagementEmbedContext,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationsForScope(eventScopeFromManagementContext(context)).dismissAll(
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
    await this.runSessionEntryMutation(session, this.t("session.action.notify", "deliver a subsession notification"), () => session.sendCustomMessage(
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
    if (this.hasActiveWork(session)) throw new Error(this.t("session.stopBeforeReload", "Stop current session activity before reloading"));
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      this.t("session.stopBeforeReload", "Stop current session activity before reloading"),
      async () => {
        this.publishActivity(session, this.t("activity.reloading", "Reloading resources"), "active");
        const priorGeneration = this.notificationGenerationBySession.get(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        const reloadBoundary = { beforeSessionStart: false };
        try {
          await session.reload({
            beforeSessionStart: () => {
              this.endSessionExtensionDialogs(session);
              reloadBoundary.beforeSessionStart = true;
              if (priorGeneration === undefined) return;
              candidateGeneration = this.notificationsForSession(session).beginReplacement(priorGeneration, notificationIdentityForSession(session));
              this.notificationGenerationBySession.set(session, candidateGeneration);
              this.replaceSessionNotificationContext(session, candidateGeneration);
            },
          });
          await this.reloadModelScope(session);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationsForSession(session).commitReplacement(candidateGeneration));
          }
          this.publishActivity(session, this.t("activity.reloaded", "Resources reloaded"), "idle");
          this.publishStatus(session);
        } catch (error: unknown) {
          if (!reloadBoundary.beforeSessionStart) this.endSessionExtensionDialogs(session);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationsForSession(session).abortReplacement(candidateGeneration, "candidate"));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          const message = error instanceof Error ? error.message : String(error);
          this.publishActivity(session, this.t("activity.reloadFailed", "Reload failed"), "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message }, this.eventScopeForSession(session));
          this.publishStatus(session);
          throw error;
        }
      },
    );
  }

async dismissWarning(ref: PiSessionLookup, dismissId: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus> {
    const session = await this.getOrOpen(ref, managementContext);
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
    return this.openPending(sessionId, cwd, options.managementContext, openSessionManager, options);
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
    startup.report(this.t("startup.runtime", "Loading session runtime"));
    options.startupSignal?.throwIfAborted();
    // Ordinary local sessions (undefined provenance) keep the current rule.
    // Only an explicit host one-shot forces delegation off; do not treat every
    // defined provenance as disabled the way upstream does.
    const delegationToolsEnabled = options.creationProvenance === "host-one-shot"
      ? false
      : options.creationProvenance !== "tracked-subsession"
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
      ...(options.managementContext === undefined ? {} : {
        managementAuditIdentity: await resolveManagementAuditIdentity(cwd, options.managementContext, this.managementProjectIdForCwd, this.logger),
      }),
    };
    let boundSession = runtime.session;
    this.sessionEventScopes.set(boundSession, active.eventScope);
    if (options.managementContext !== undefined) this.sessionManagementContexts.set(boundSession, options.managementContext);
    const startupSignal = options.startupSignal;
    const cancelStartup = (): void => { this.endSessionExtensionDialogs(boundSession); };
    if (startupSignal !== undefined && !startupSignal.aborted) {
      startupSignal.addEventListener("abort", cancelStartup, { once: true });
    }
    const notificationStore = this.notificationsForScope(active.eventScope);
    let notificationGeneration = options.notificationGeneration;
    let notificationOwnership: "disabled" | "external" | "registered" | "replacement" = options.notifications === "disabled"
      ? "disabled"
      : notificationGeneration === undefined
        ? "registered"
        : "external";

    if (notificationOwnership === "registered") {
      const notificationIdentity = notificationIdentityForSession(runtime.session);
      const existingCandidate = notificationStore.beginReplacementForSession(
        notificationIdentity.sessionId,
        notificationIdentity.cwd,
      );
      if (existingCandidate !== undefined) {
        notificationGeneration = existingCandidate;
        notificationOwnership = "replacement";
      } else {
        const registration = notificationStore.registerSession(
          notificationIdentity.sessionId,
          notificationIdentity.cwd,
        );
        notificationGeneration = registration.generation;
        this.publishNotificationMutations(registration.mutations);
      }
    }
    if (notificationGeneration !== undefined) this.notificationGenerationBySession.set(runtime.session, notificationGeneration);

    try {
      startupSignal?.throwIfAborted();
      if (options.creationProvenance === "tracked-subsession") {
        await this.publishUnreadMutations(this.unreadForScope(active.eventScope).excludeSession(
          runtime.session.sessionId,
          canonicalizeStoredCwd(runtime.session.sessionManager.getCwd()),
        ));
      } else {
        await this.recoverSubsessionTrackingForOpenedSession(runtime.session);
      }
      startupSignal?.throwIfAborted();
      startup.report(this.t("startup.extensions", "Starting session extensions"));
      // Startup hooks emit through the same scoped stream as hosted turns.
      this.bindRuntime(active);
      await this.bindSessionExtensions(runtime.session, notificationGeneration, active, startupSignal);
      startupSignal?.throwIfAborted();
      runtime.setRebindSession(async (session) => {
        this.sessionEventScopes.set(session, active.eventScope);
        if (options.managementContext !== undefined) this.sessionManagementContexts.set(session, options.managementContext);
        const priorGeneration = notificationGeneration;
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.prepareUnreadRuntimeRebind(boundSession, session);
          await this.recoverSubsessionTrackingForOpenedSession(session);
          if (priorGeneration !== undefined) {
            candidateGeneration = notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          this.bindRuntime(active, session);
          // The runtime being replaced parked every dialog the store still
          // holds for this session; settle those waits before the new
          // runtime's extensions can open fresh dialogs under the same id.
          this.endSessionExtensionDialogs(boundSession);
          const changedIdentity = boundSession.sessionId !== session.sessionId;
          boundSession = session;
          this.startupSessions.set(activeSessionKey(session.sessionId, active.eventScope), { session, eventScope: active.eventScope, managementContextKey: active.managementContextKey });
          if (changedIdentity) this.announceCreatedSession(active, session.sessionManager.getCwd());
          await this.bindSessionExtensions(session, candidateGeneration, active);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(notificationStore.commitReplacement(candidateGeneration));
            notificationGeneration = candidateGeneration;
          }
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(notificationStore.abortReplacement(candidateGeneration, "candidate"));
            notificationGeneration = candidateGeneration;
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          throw error;
        }
      });
      startupSignal?.throwIfAborted();
      this.active.set(activeSessionKey(runtime.session.sessionId, active.eventScope), active);
      if (notificationOwnership === "replacement" && notificationGeneration !== undefined) {
        this.publishNotificationMutations(notificationStore.commitReplacement(notificationGeneration));
        notificationOwnership = "external";
      }
      this.publishStatus(runtime.session);
      return active;
    } catch (error: unknown) {
      if (notificationGeneration !== undefined) {
        if (notificationOwnership === "registered") {
          this.publishNotificationMutations(notificationStore.clearSession(runtime.session.sessionId, "initialization-failed"));
        } else if (notificationOwnership === "replacement") {
          this.publishNotificationMutations(notificationStore.abortReplacement(notificationGeneration));
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
        this.clearCompactionPromptQueue(runtime.session);
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
    } finally {
      startupSignal?.removeEventListener("abort", cancelStartup);
    }
  }

private replaceSessionNotificationContext(session: PiAgentSession, generation: SessionNotificationGeneration): void {
    session.extensionRunner.setUIContext(this.sessionUiContext(session, generation), "rpc");
  }

private sessionUiContext(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
    startupDialogs: { signal?: AbortSignal | undefined } = {},
  ): ExtensionUIContext {
    const baseUiContext = session.extensionRunner.getUIContext();
    const eventScope = this.eventScopeForSession(session);
    const notificationStore = this.notificationsForScope(eventScope);
    const notify: ExtensionUIContext["notify"] = (message, type) => {
      if (generation === undefined) {
        this.events.publish(session.sessionId, {
          type: "command.output",
          level: type === "error" ? "error" : "info",
          message,
        }, eventScope);
        return;
      }
      const added = notificationStore.addNotification(generation, message, type);
      this.publishNotificationMutations(added.mutations);
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
            this.openExtensionDialog(session, { kind: "confirm", title, message }, opts, startupDialogs.signal);
        }
        if (property === "select") {
          return (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "select", title, options }, opts, startupDialogs.signal);
        }
        if (property === "input") {
          return (title: string, placeholder: string | undefined, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "input", title, placeholder }, opts, startupDialogs.signal);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
  }

private publishNotificationMutations(mutations: readonly SessionNotificationMutation[]): void {
    for (const mutation of mutations) {
      const scope = mutation.eventScope ?? NORMAL_SESSION_EVENT_SCOPE;
      this.events.publish(mutation.sessionId, mutation.inboxEvent, scope);
      this.events.publishGlobal(mutation.summaryEvent, scope);
    }
  }

private async prepareUnreadRuntimeRebind(previous: PiAgentSession, next: PiAgentSession): Promise<void> {
    const previousCwd = canonicalizeStoredCwd(previous.sessionManager.getCwd());
    const store = this.unreadForScope(this.eventScopeForSession(previous));
    store.forgetActivity(previous.sessionId, previousCwd);
    const nextCwd = canonicalizeStoredCwd(next.sessionManager.getCwd());
    if (previous.sessionId === next.sessionId && cwdPathsEqual(previousCwd, nextCwd)) return;
    await this.publishUnreadMutations(store.forgetSession(previous.sessionId, previousCwd));
  }

private forgetUnreadActivity(session: PiAgentSession): void {
    this.unreadForScope(this.eventScopeForSession(session)).forgetActivity(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
    );
  }

private async forgetUnreadSessions(identities: readonly { sessionId: string; cwd: string }[], scope = NORMAL_SESSION_EVENT_SCOPE): Promise<void> {
    const mutations: SessionUnreadMutation[] = [];
    for (const identity of identities) {
      mutations.push(...this.unreadForScope(scope).forgetSession(
        identity.sessionId,
        canonicalizeStoredCwd(identity.cwd),
      ));
    }
    await this.publishUnreadMutations(mutations);
  }

private observeUnreadActivityState(session: PiAgentSession): void {
    const mutations = this.unreadForScope(this.eventScopeForSession(session)).observeActivityState(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
      this.hasActiveWork(session),
      () => ({ messageCount: historyMessages(session).length, leafId: session.sessionManager.getLeafId() }),
    );
    if (mutations.length === 0) return;
    void this.publishUnreadMutations(mutations).catch(() => undefined);
  }

private publishUnreadMutations(mutations: readonly SessionUnreadMutation[]): Promise<void> {
    if (mutations.length > 0) {
      const scopes = new Map<string, boolean>();
      for (const mutation of mutations) {
        const scope = mutation.eventScope ?? NORMAL_SESSION_EVENT_SCOPE;
        scopes.set(scope, scopes.get(scope) === true || mutation.event.unread !== null);
      }
      scopes.forEach((hasNewCompletion, scope) => this.onUnreadChanged?.(scope, hasNewCompletion));
    }
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
        for (const store of this.scopedUnreadStores.values()) await store.flush();
        for (const mutation of batch) {
          this.events.publishGlobal(mutation.event, mutation.eventScope ?? NORMAL_SESSION_EVENT_SCOPE);
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
    const key = `${ref.cwd}\0${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function bulkRefToLookup(ref: SessionBulkMutationRef): PiSessionLookup {
  return ref;
}

function findArchivedRecordForBulkRef(records: readonly ArchivedSessionRecord[], ref: SessionBulkMutationRef): ArchivedSessionRecord | undefined {
  return records.find((record) => record.cwd === ref.cwd && record.sessionId === ref.id);
}

function findListedSessionForBulkRef(context: BulkSessionLookupContext, ref: SessionBulkMutationRef): PiSessionListEntry | undefined {
  return findSessionByExactId(context.sessionsByCwd.get(ref.cwd) ?? [], ref.id);
}

function findSessionByExactId(sessions: readonly PiSessionListEntry[], sessionId: string): PiSessionListEntry | undefined {
  return sessions.find((session) => session.id === sessionId);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown, t: Translator = createTranslator("en", {})): string {
  return userFacingErrorMessage(error, t);
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

function catalogEntryToClientModel(entry: EnabledModelCatalogEntry<AgentModel>, editable = true): ClientSessionModelCatalogEntry {
  return {
    ...modelToClientModel(entry.model),
    provider: entry.model.provider,
    id: entry.model.id,
    enabled: entry.enabled,
    catalogIndex: entry.catalogIndex,
    ...(editable ? {} : { editable: false }),
  };
}

function notificationIdentityForSession(session: PiAgentSession): { sessionId: string; cwd: string } {
  return {
    sessionId: session.sessionId,
    cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
  };
}

function clientSessionFromActiveSession(session: PiAgentSession): ClientSession {
  const header = session.sessionManager.getHeader?.();
  const created = header?.timestamp ?? new Date().toISOString();
  const metadata = readSessionUiMetadata(session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch());
  return {
    id: session.sessionId, path: session.sessionFile ?? "", cwd: session.sessionManager.getCwd(),
    persisted: sessionFileExists(session.sessionFile), created, modified: created,
    messageCount: transcriptMessageCount(session.sessionManager.getBranch()), firstMessage: "",
    ...(metadata === undefined ? {} : { metadata }),
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    ...(header?.parentSession === undefined ? {} : { parentSessionPath: header.parentSession }),
  };
}

function clientSessionFromListEntry(session: PiSessionListEntry): ClientSession {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    persisted: true,
    ...(session.metadata === undefined ? {} : { metadata: requireSessionUiMetadata(session.metadata) }),
    ...(session.name === undefined ? {} : { name: session.name }),
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: clientSessionFirstMessagePreview(session.firstMessage),
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

function historyMessages(session: PiAgentSession): unknown[] {
  return historyMessagesFromManager(session.sessionManager);
}

function historyMessagesFromManager(sessionManager: PiSessionManager): unknown[] {
  return historyMessagesFromEntries(sessionManager.getBranch());
}

function transcriptMessageCount(entries: readonly unknown[]): number {
  let count = 0;
  for (const entry of entries) {
    if (isRecord(entry) && entry["type"] === "message") count += 1;
  }
  return count;
}

function activeEditableTreeTargetParentId(
  manager: PiSessionManager,
  targetId: string,
  activeLeafId: string | null,
): string | null | undefined {
  if (activeLeafId !== targetId) return undefined;
  const entry = manager.getBranch().at(-1);
  if (!isRecord(entry) || entry["id"] !== targetId) return undefined;
  const isUserMessage = entry["type"] === "message"
    && isRecord(entry["message"]) && entry["message"]["role"] === "user";
  if (!isUserMessage && entry["type"] !== "custom_message") return undefined;
  const parentId = entry["parentId"];
  if (parentId === targetId) return undefined;
  return parentId === null || typeof parentId === "string" ? parentId : undefined;
}

/**
 * Pi edits custom messages from their parent. For a retained checkpoint, remap
 * that single leaf movement instead, before Pi rebuilds context/restores tools
 * and emits session_tree. Restore the manager methods before extension handlers
 * run: their appended history must not be overwritten by a post-event repair.
 * The caller holds the tree-navigation gate and excludes branch summarization.
 */
async function navigateTreeRetainingCustomMessage(
  manager: PiSessionManager,
  targetId: string,
  parentId: unknown,
  navigate: () => ReturnType<NonNullable<PiAgentSession["navigateTree"]>>,
): ReturnType<NonNullable<PiAgentSession["navigateTree"]>> {
  if (parentId !== null && typeof parentId !== "string") throw new UserFacingError("session.checkpointParent", "This checkpoint has no valid history parent");
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore exact identities; calls below explicitly bind the manager.
  const { branch, resetLeaf } = manager;
  let pending = true;
  const restore = () => {
    if (!pending) return;
    pending = false;
    manager.branch = branch;
    manager.resetLeaf = resetLeaf;
  };
  try {
    manager.branch = (entryId) => {
      if (entryId === parentId) {
        restore();
        branch.call(manager, targetId);
      } else branch.call(manager, entryId);
    };
    manager.resetLeaf = () => {
      if (parentId === null) {
        restore();
        branch.call(manager, targetId);
      } else resetLeaf.call(manager);
    };
    const result = await navigate();
    if (result.cancelled) return result;
    // The retained notice is context, not text to restore into the editor.
    const { editorText, ...retainedResult } = result;
    void editorText;
    return retainedResult;
  } finally {
    restore();
  }
}

function setSessionTreeLeaf(manager: PiSessionManager, leafId: string | null): void {
  if (leafId === null) manager.resetLeaf();
  else manager.branch(leafId);
}

function transcriptBranchIncludesEntry(entries: readonly unknown[], entryId: string): boolean {
  return entries.some((entry) => isRecord(entry) && entry["id"] === entryId);
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

async function resolveManagementAuditIdentity(
  cwd: string,
  context: ManagementEmbedContext,
  resolveProjectId: ((cwd: string, context: ManagementEmbedContext) => Promise<string>) | undefined,
  logger: PiSessionLogger,
): Promise<ManagementAuditIdentity> {
  let projectId = context.projects[0]?.id ?? "default-project";
  if (resolveProjectId !== undefined) {
    try {
      projectId = await resolveProjectId(cwd, context);
    } catch (error) {
      logger.info({ userId: context.user.id, cwd, error: error instanceof Error ? error.message : String(error) }, "failed to resolve management audit project; using the authorized default");
    }
  }
  return {
    userId: context.user.id,
    rootUserId: context.user.rootUserId,
    ...(context.user.displayName === undefined ? {} : { userDisplayName: context.user.displayName }),
    projectId,
  };
}
