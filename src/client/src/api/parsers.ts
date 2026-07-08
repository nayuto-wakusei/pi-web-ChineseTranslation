import type { ArchiveSessionsResponse, AuthProviderOption, AuthProviderStatus, AuthProvidersResponse, AuthStatusSource, AuthType, CommandOption, CommandResult, DeleteWorkspaceFileResponse, FileContentResponse, FileSuggestion, FileTreeEntry, FileTreeResponse, GitDiffResponse, GitFileState, GitStatusFile, GitStatusResponse, MessagePage, ModelSelectionResponse, MoveWorkspaceFileResponse, NormalAuthStatusResponse, OAuthFlowState, Project, QueuedSessionMessage, SavedPromptAttachment, SessionBulkArchiveResponse, SessionBulkDeleteArchivedResponse, SessionBulkFailure, SessionCleanupExecuteResponse, SessionCleanupPreviewResponse, SessionCleanupProjectSummary, SessionCleanupThresholds, SessionCleanupTotals, SessionInfo, SessionModel, SessionStatus, SlashCommand, TerminalCommandRun, TerminalCommandRunStatus, TerminalInfo, ThinkingLevelsResponse, WriteWorkspaceFileResponse, Workspace, WorkspaceActivity, WorkspaceActivityResponse, WorkspaceDeleteResponse, WorkspacePathOperationResponse, WorkspaceUploadResponse } from "../../../shared/apiTypes";
import { arrayOf, isRecord, optionalField, optionalNumber, optionalString, requireBoolean, requireNumber, requireRecord, requireString, requireTrueField } from "./parsers/core";

export { arrayOf } from "./parsers/core";
export { parseMachine, parseMachineHealth, parseMachineRuntime, parseMachinesResponse } from "./parsers/machines";
export { parsePiWebConfigResponse, parsePiWebPluginsResponse, parsePiWebRuntimeResponse, parsePiWebStatusResponse } from "./parsers/piWeb";

export function parseNormalAuthStatusResponse(value: unknown): NormalAuthStatusResponse {
  const record = requireRecord(value);
  return { configured: requireBoolean(record, "configured"), authenticated: requireBoolean(record, "authenticated") };
}

function parseUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array response");
  return value;
}

function arrayOfString(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Expected string array field: ${key}`);
  return value;
}

export function parseMessagePage(value: unknown): MessagePage {
  if (Array.isArray(value)) return { messages: value, start: 0, total: value.length };
  const record = requireRecord(value);
  return { messages: parseUnknownArray(record["messages"]), start: requireNumber(record, "start"), total: requireNumber(record, "total") };
}

export function parseProject(value: unknown): Project {
  const record = requireRecord(value);
  return { id: requireString(record, "id"), name: requireString(record, "name"), path: requireString(record, "path"), createdAt: requireString(record, "createdAt") };
}

export function parseWorkspace(value: unknown): Workspace {
  const record = requireRecord(value);
  const branch = optionalString(record, "branch");
  return {
    id: requireString(record, "id"),
    projectId: requireString(record, "projectId"),
    path: requireString(record, "path"),
    label: requireString(record, "label"),
    ...(branch === undefined ? {} : { branch }),
    isMain: requireBoolean(record, "isMain"),
    isGitRepo: requireBoolean(record, "isGitRepo"),
    isGitWorktree: requireBoolean(record, "isGitWorktree"),
    ...optionalField("effectiveConfig", optionalWorkspaceEffectiveConfig(record["effectiveConfig"])),
  };
}

function optionalWorkspaceEffectiveConfig(value: unknown): Workspace["effectiveConfig"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid workspace effectiveConfig field");
  return {
    ...optionalField("uploads", optionalUploads(value["uploads"])),
  };
}

export function parseWorkspaceUploadResponse(value: unknown): WorkspaceUploadResponse {
  const record = requireRecord(value);
  return { path: requireString(record, "path"), size: requireNumber(record, "size"), modifiedAt: requireString(record, "modifiedAt") };
}

export function parseWorkspacePathOperationResponse(value: unknown): WorkspacePathOperationResponse {
  const record = requireRecord(value);
  return { path: requireString(record, "path") };
}

export function parseWorkspaceDeleteResponse(value: unknown): WorkspaceDeleteResponse {
  const record = requireRecord(value);
  if (record["deleted"] !== true) throw new Error("Expected deleted response");
  return { deleted: true, path: requireString(record, "path") };
}

export function parseSessionInfo(value: unknown): SessionInfo {
  const record = requireRecord(value);
  const name = optionalString(record, "name");
  const parentSessionPath = optionalString(record, "parentSessionPath");
  const archivedAt = optionalString(record, "archivedAt");
  return {
    id: requireString(record, "id"),
    path: requireString(record, "path"),
    cwd: requireString(record, "cwd"),
    ...(name === undefined ? {} : { name }),
    created: requireString(record, "created"),
    modified: requireString(record, "modified"),
    messageCount: requireNumber(record, "messageCount"),
    firstMessage: requireString(record, "firstMessage"),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    ...(record["archived"] === true ? { archived: true } : {}),
    ...(archivedAt === undefined ? {} : { archivedAt }),
  };
}

export function parseSessionStatus(value: unknown): SessionStatus {
  const record = requireRecord(value);
  return {
    sessionId: requireString(record, "sessionId"),
    isStreaming: requireBoolean(record, "isStreaming"),
    isCompacting: requireBoolean(record, "isCompacting"),
    isBashRunning: requireBoolean(record, "isBashRunning"),
    pendingMessageCount: requireNumber(record, "pendingMessageCount"),
    queuedMessages: record["queuedMessages"] === undefined ? [] : arrayOf(parseQueuedSessionMessage)(record["queuedMessages"]),
    ...optionalField("messageCount", optionalNumber(record, "messageCount")),
    tokens: parseTokens(record["tokens"]),
    cost: requireNumber(record, "cost"),
    ...optionalModel(record["model"]),
    ...optionalContextUsage(record["contextUsage"]),
    ...optionalField("thinkingLevel", optionalString(record, "thinkingLevel")),
  };
}

export function parseSessionCleanupPreviewResponse(value: unknown): SessionCleanupPreviewResponse {
  const record = requireRecord(value);
  const skippedBusySessionIds = record["skippedBusySessionIds"] === undefined ? undefined : arrayOfString(record["skippedBusySessionIds"], "skippedBusySessionIds");
  return {
    generatedAt: requireString(record, "generatedAt"),
    thresholds: parseSessionCleanupThresholds(record["thresholds"]),
    projects: arrayOf(parseSessionCleanupProjectSummary)(record["projects"]),
    totals: parseSessionCleanupTotals(record["totals"]),
    ...(skippedBusySessionIds === undefined ? {} : { skippedBusySessionIds }),
  };
}

export function parseSessionCleanupExecuteResponse(value: unknown): SessionCleanupExecuteResponse {
  const record = requireRecord(value);
  return {
    ...parseSessionCleanupPreviewResponse(record),
    archivedSessionIds: arrayOfString(record["archivedSessionIds"], "archivedSessionIds"),
    deletedSessionIds: arrayOfString(record["deletedSessionIds"], "deletedSessionIds"),
  };
}

export function parseSessionBulkArchiveResponse(value: unknown): SessionBulkArchiveResponse {
  const record = requireRecord(value);
  if (record["archived"] !== true) throw new Error("Expected bulk archived response");
  return {
    archived: true,
    archivedSessionIds: arrayOfString(record["archivedSessionIds"], "archivedSessionIds"),
    failures: arrayOf(parseSessionBulkFailure)(record["failures"]),
    generatedAt: requireString(record, "generatedAt"),
  };
}

export function parseSessionBulkDeleteArchivedResponse(value: unknown): SessionBulkDeleteArchivedResponse {
  const record = requireRecord(value);
  if (record["deleted"] !== true) throw new Error("Expected bulk deleted response");
  return {
    deleted: true,
    deletedSessionIds: arrayOfString(record["deletedSessionIds"], "deletedSessionIds"),
    failures: arrayOf(parseSessionBulkFailure)(record["failures"]),
    generatedAt: requireString(record, "generatedAt"),
  };
}

function parseSessionBulkFailure(value: unknown): SessionBulkFailure {
  const record = requireRecord(value);
  return { sessionId: requireString(record, "sessionId"), error: requireString(record, "error") };
}

function parseSessionCleanupThresholds(value: unknown): SessionCleanupThresholds {
  const record = requireRecord(value);
  return {
    ...optionalField("archiveIdleDays", optionalNumber(record, "archiveIdleDays")),
    ...optionalField("deleteArchivedDays", optionalNumber(record, "deleteArchivedDays")),
  };
}

function parseSessionCleanupProjectSummary(value: unknown): SessionCleanupProjectSummary {
  const record = requireRecord(value);
  return {
    cwd: requireString(record, "cwd"),
    archiveCount: requireNumber(record, "archiveCount"),
    deleteCount: requireNumber(record, "deleteCount"),
  };
}

function parseSessionCleanupTotals(value: unknown): SessionCleanupTotals {
  const record = requireRecord(value);
  return {
    archiveCount: requireNumber(record, "archiveCount"),
    deleteCount: requireNumber(record, "deleteCount"),
  };
}

function parseQueuedSessionMessage(value: unknown): QueuedSessionMessage {
  const record = requireRecord(value);
  const kind = requireString(record, "kind");
  if (kind !== "steer" && kind !== "followUp") throw new Error("Invalid queued message kind");
  return { kind, text: requireString(record, "text"), ...optionalField("imageCount", optionalNumber(record, "imageCount")) };
}

function parseTokens(value: unknown): SessionStatus["tokens"] {
  const record = requireRecord(value);
  return {
    input: requireNumber(record, "input"),
    output: requireNumber(record, "output"),
    cacheRead: requireNumber(record, "cacheRead"),
    cacheWrite: requireNumber(record, "cacheWrite"),
    total: requireNumber(record, "total"),
  };
}

function parseSessionModel(value: unknown): SessionModel {
  const record = requireRecord(value);
  return { ...optionalField("provider", optionalString(record, "provider")), ...optionalField("id", optionalString(record, "id")), ...optionalField("name", optionalString(record, "name")), ...optionalField("contextWindow", optionalNumber(record, "contextWindow")), ...optionalField("reasoning", record["reasoning"]), ...optionalField("input", optionalModelInput(record["input"])) };
}

function optionalModelInput(value: unknown): ("text" | "image")[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid model input");
  return value.map(parseModelInputKind);
}

function parseModelInputKind(value: unknown): "text" | "image" {
  if (value === "text" || value === "image") return value;
  throw new Error("Invalid model input");
}

function optionalModel(value: unknown): Pick<SessionStatus, "model"> | object {
  if (value === undefined) return {};
  return { model: parseSessionModel(value) };
}

export function parseModelSelectionResponse(value: unknown): ModelSelectionResponse {
  const record = requireRecord(value);
  return { models: arrayOf(parseSessionModel)(record["models"]) };
}

function parseThinkingLevel(value: unknown): string {
  // pi owns the level set; accept any string so a newer pi runtime reporting an
  // unknown level degrades gracefully instead of failing the whole response.
  if (typeof value !== "string") throw new Error("Invalid thinking level");
  return value;
}

export function parseThinkingLevelsResponse(value: unknown): ThinkingLevelsResponse {
  const record = requireRecord(value);
  return { levels: arrayOf(parseThinkingLevel)(record["levels"]) };
}

function parseAuthType(value: unknown): AuthType {
  if (value !== "oauth" && value !== "api_key") throw new Error("Invalid auth type");
  return value;
}

function parseAuthStatusSource(value: unknown): AuthStatusSource {
  if (value !== "stored" && value !== "runtime" && value !== "environment" && value !== "fallback" && value !== "models_json_key" && value !== "models_json_command") throw new Error("Invalid auth status source");
  return value;
}

function parseAuthProviderStatus(value: unknown): AuthProviderStatus {
  const record = requireRecord(value);
  const source = record["source"] === undefined ? undefined : parseAuthStatusSource(record["source"]);
  return { configured: requireBoolean(record, "configured"), ...optionalField("source", source), ...optionalField("label", optionalString(record, "label")) };
}

function parseAuthProviderOption(value: unknown): AuthProviderOption {
  const record = requireRecord(value);
  return { id: requireString(record, "id"), name: requireString(record, "name"), authType: parseAuthType(record["authType"]), status: parseAuthProviderStatus(record["status"]) };
}

export function parseAuthProvidersResponse(value: unknown): AuthProvidersResponse {
  const record = requireRecord(value);
  return { providers: arrayOf(parseAuthProviderOption)(record["providers"]) };
}

export function parseOAuthFlowState(value: unknown): OAuthFlowState {
  const record = requireRecord(value);
  const flow = {
    flowId: requireString(record, "flowId"),
    providerId: requireString(record, "providerId"),
    providerName: requireString(record, "providerName"),
    status: parseOAuthFlowStatus(record["status"]),
    progress: arrayOf((item) => {
      if (typeof item !== "string") throw new Error("Expected progress item string");
      return item;
    })(record["progress"]),
    ...optionalField("error", optionalString(record, "error")),
    ...optionalField("auth", optionalOAuthAuth(record["auth"])),
    ...optionalField("prompt", optionalOAuthPrompt(record["prompt"])),
    ...optionalField("select", optionalOAuthSelect(record["select"])),
  };
  return flow;
}

function parseOAuthFlowStatus(value: unknown): OAuthFlowState["status"] {
  if (value !== "running" && value !== "complete" && value !== "error" && value !== "cancelled") throw new Error("Invalid OAuth flow status");
  return value;
}

function optionalOAuthAuth(value: unknown): OAuthFlowState["auth"] | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value);
  return { url: requireString(record, "url"), ...optionalField("instructions", optionalString(record, "instructions")) };
}

function optionalOAuthPrompt(value: unknown): OAuthFlowState["prompt"] | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value);
  const kind = requireString(record, "kind");
  if (kind !== "prompt" && kind !== "manual") throw new Error("Invalid OAuth prompt kind");
  return { requestId: requireString(record, "requestId"), message: requireString(record, "message"), kind, ...optionalField("placeholder", optionalString(record, "placeholder")), ...(record["allowEmpty"] === true ? { allowEmpty: true } : {}) };
}

function optionalOAuthSelect(value: unknown): OAuthFlowState["select"] | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value);
  return { requestId: requireString(record, "requestId"), message: requireString(record, "message"), options: arrayOf(parseCommandOption)(record["options"]) };
}

function optionalContextUsage(value: unknown): Pick<SessionStatus, "contextUsage"> | object {
  if (value === undefined) return {};
  const record = requireRecord(value);
  return { contextUsage: { tokens: numberOrNull(record, "tokens"), contextWindow: requireNumber(record, "contextWindow"), percent: numberOrNull(record, "percent") } };
}

export function parseSlashCommand(value: unknown): SlashCommand {
  const record = requireRecord(value);
  const source = requireString(record, "source");
  if (source !== "extension" && source !== "prompt" && source !== "skill" && source !== "builtin") throw new Error("Invalid command source");
  return { name: requireString(record, "name"), source, ...optionalField("description", optionalString(record, "description")) };
}

export function parseFileSuggestion(value: unknown): FileSuggestion {
  const record = requireRecord(value);
  const kind = requireString(record, "kind");
  if (kind !== "tracked" && kind !== "untracked" && kind !== "other") throw new Error("Invalid file kind");
  return { path: requireString(record, "path"), kind };
}

export function parseFileTreeResponse(value: unknown): FileTreeResponse {
  const record = requireRecord(value);
  return { path: requireString(record, "path"), entries: arrayOf(parseFileTreeEntry)(record["entries"]), scannedAt: requireString(record, "scannedAt"), truncated: requireBoolean(record, "truncated") };
}

function parseFileTreeEntry(value: unknown): FileTreeEntry {
  const record = requireRecord(value);
  const type = requireString(record, "type");
  if (type !== "file" && type !== "directory" && type !== "symlink") throw new Error("Invalid file tree entry type");
  return { name: requireString(record, "name"), path: requireString(record, "path"), type, ...optionalField("size", optionalNumber(record, "size")), ...optionalField("modifiedAt", optionalString(record, "modifiedAt")) };
}

export function parseFileContentResponse(value: unknown): FileContentResponse {
  const record = requireRecord(value);
  const encoding = requireString(record, "encoding");
  if (encoding !== "utf8") throw new Error("Invalid file encoding");
  return { path: requireString(record, "path"), ...optionalField("language", optionalString(record, "language")), ...optionalField("mediaType", optionalFileMediaType(record["mediaType"])), ...optionalField("mimeType", optionalString(record, "mimeType")), encoding, size: requireNumber(record, "size"), modifiedAt: requireString(record, "modifiedAt"), content: requireString(record, "content"), truncated: requireBoolean(record, "truncated"), binary: requireBoolean(record, "binary") };
}

export function parseWriteWorkspaceFileResponse(value: unknown): WriteWorkspaceFileResponse {
  const record = requireRecord(value);
  return {
    path: requireString(record, "path"),
    size: requireNumber(record, "size"),
    modifiedAt: requireString(record, "modifiedAt"),
    created: requireBoolean(record, "created"),
  };
}

export function parseDeleteWorkspaceFileResponse(value: unknown): DeleteWorkspaceFileResponse {
  const record = requireRecord(value);
  return {
    path: requireString(record, "path"),
    existed: requireBoolean(record, "existed"),
  };
}

export function parseMoveWorkspaceFileResponse(value: unknown): MoveWorkspaceFileResponse {
  const record = requireRecord(value);
  return {
    fromPath: requireString(record, "fromPath"),
    toPath: requireString(record, "toPath"),
    size: requireNumber(record, "size"),
    modifiedAt: requireString(record, "modifiedAt"),
  };
}

function optionalFileMediaType(value: unknown): FileContentResponse["mediaType"] | undefined {
  if (value === undefined) return undefined;
  if (value !== "image") throw new Error("Invalid file media type");
  return value;
}

export function parseGitStatusResponse(value: unknown): GitStatusResponse {
  const record = requireRecord(value);
  return { isGitRepo: requireBoolean(record, "isGitRepo"), hash: requireString(record, "hash"), ...optionalField("branch", optionalString(record, "branch")), ...optionalField("upstream", optionalString(record, "upstream")), ...optionalField("ahead", optionalNumber(record, "ahead")), ...optionalField("behind", optionalNumber(record, "behind")), files: arrayOf(parseGitStatusFile)(record["files"]) };
}

function parseGitStatusFile(value: unknown): GitStatusFile {
  const record = requireRecord(value);
  return { path: requireString(record, "path"), ...optionalField("oldPath", optionalString(record, "oldPath")), index: parseGitFileState(record["index"]), workingTree: parseGitFileState(record["workingTree"]) };
}

function parseGitFileState(value: unknown): GitFileState {
  switch (value) {
    case "unmodified":
    case "modified":
    case "added":
    case "deleted":
    case "renamed":
    case "copied":
    case "untracked":
    case "ignored":
    case "conflicted":
      return value;
    default:
      throw new Error("Invalid git file state");
  }
}

export function parseGitDiffResponse(value: unknown): GitDiffResponse {
  const record = requireRecord(value);
  return { ...optionalField("path", optionalString(record, "path")), staged: requireBoolean(record, "staged"), hash: requireString(record, "hash"), diff: requireString(record, "diff"), truncated: requireBoolean(record, "truncated") };
}

export function parseTerminalInfo(value: unknown): TerminalInfo {
  const record = requireRecord(value);
  return { id: requireString(record, "id"), cwd: requireString(record, "cwd"), name: requireString(record, "name"), createdAt: requireString(record, "createdAt"), exited: requireBoolean(record, "exited"), ...optionalField("exitCode", optionalNumber(record, "exitCode")), ...optionalField("commandRunId", optionalString(record, "commandRunId")) };
}

export function parseTerminalCommandRun(value: unknown): TerminalCommandRun {
  const record = requireRecord(value);
  return {
    id: requireString(record, "id"),
    origin: requireString(record, "origin"),
    projectId: requireString(record, "projectId"),
    workspaceId: requireString(record, "workspaceId"),
    terminalId: requireString(record, "terminalId"),
    title: requireString(record, "title"),
    command: requireString(record, "command"),
    status: parseTerminalCommandRunStatus(record["status"]),
    ...optionalField("exitCode", optionalNumber(record, "exitCode")),
    createdAt: requireString(record, "createdAt"),
    ...optionalField("startedAt", optionalString(record, "startedAt")),
    ...optionalField("completedAt", optionalString(record, "completedAt")),
    metadata: parseStringRecord(record["metadata"], "metadata"),
  };
}

function parseTerminalCommandRunStatus(value: unknown): TerminalCommandRunStatus {
  if (value !== "queued" && value !== "running" && value !== "succeeded" && value !== "failed") throw new Error("Invalid terminal command run status");
  return value;
}

function parseStringRecord(value: unknown, key: string): Record<string, string> {
  const record = requireRecord(value);
  return Object.fromEntries(Object.entries(record).map(([field, fieldValue]) => {
    if (typeof fieldValue !== "string") throw new Error(`Expected string record field: ${key}.${field}`);
    return [field, fieldValue];
  }));
}

export function parseWorkspaceActivity(value: unknown): WorkspaceActivity {
  const record = requireRecord(value);
  return {
    cwd: requireString(record, "cwd"),
    hasSessionActivity: requireBoolean(record, "hasSessionActivity"),
    hasTerminalActivity: requireBoolean(record, "hasTerminalActivity"),
    updatedAt: requireString(record, "updatedAt"),
  };
}

export function parseWorkspaceActivityResponse(value: unknown): WorkspaceActivityResponse {
  const record = requireRecord(value);
  return { workspaces: arrayOf(parseWorkspaceActivity)(record["workspaces"]), generatedAt: requireString(record, "generatedAt") };
}

function optionalUploads(value: unknown): NonNullable<Workspace["effectiveConfig"]>["uploads"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error("Invalid uploads field");
  return {
    ...optionalField("defaultFolder", optionalString(value, "defaultFolder")),
  };
}

export function parseCommandResult(value: unknown): CommandResult {
  const record = requireRecord(value);
  const type = requireString(record, "type");
  if (type === "unsupported") return { type, message: requireString(record, "message") };
  if (type === "select") return { type, requestId: requireString(record, "requestId"), title: requireString(record, "title"), options: arrayOf(parseCommandOption)(record["options"]) };
  if (type === "done") return { type, ...optionalField("message", optionalString(record, "message")), ...optionalSession(record["session"]), ...optionalField("promptDraft", optionalString(record, "promptDraft")) };
  throw new Error("Invalid command result type");
}

function parseCommandOption(value: unknown): CommandOption {
  const record = requireRecord(value);
  return { value: requireString(record, "value"), label: requireString(record, "label"), ...optionalField("description", optionalString(record, "description")) };
}

function optionalSession(value: unknown): Pick<Extract<CommandResult, { type: "done" }>, "session"> | object {
  return value === undefined ? {} : { session: parseSessionInfo(value) };
}

export function parseAccepted(value: unknown): { accepted: true } {
  return { accepted: requireTrueField(value, "accepted") };
}

export function parseSavedAttachments(value: unknown): SavedPromptAttachment[] {
  const record = requireRecord(value);
  return arrayOf(parseSavedAttachment)(record["attachments"]);
}

function parseSavedAttachment(value: unknown): SavedPromptAttachment {
  const record = requireRecord(value);
  return { path: requireString(record, "path"), mimeType: requireString(record, "mimeType"), size: requireNumber(record, "size") };
}

export function parseClosed(value: unknown): { closed: true } {
  return { closed: requireTrueField(value, "closed") };
}

export function parseAborted(value: unknown): { aborted: true } {
  return { aborted: requireTrueField(value, "aborted") };
}

export function parseStopped(value: unknown): { stopped: true } {
  return { stopped: requireTrueField(value, "stopped") };
}

export function parseArchived(value: unknown): ArchiveSessionsResponse {
  const record = requireRecord(value);
  if (record["archived"] !== true) throw new Error("Expected archived response");
  const sessionIds = record["sessionIds"] === undefined ? undefined : arrayOfString(record["sessionIds"], "sessionIds");
  const archivedCount = optionalNumber(record, "archivedCount");
  const skippedAlreadyArchivedCount = optionalNumber(record, "skippedAlreadyArchivedCount");
  return {
    archived: true,
    ...(sessionIds === undefined ? {} : { sessionIds }),
    ...(archivedCount === undefined ? {} : { archivedCount }),
    ...(skippedAlreadyArchivedCount === undefined ? {} : { skippedAlreadyArchivedCount }),
  };
}

export function parseRestored(value: unknown): { restored: true } {
  return { restored: requireTrueField(value, "restored") };
}

export function parseDeleted(value: unknown): { deleted: true } {
  return { deleted: requireTrueField(value, "deleted") };
}

export function parseDetached(value: unknown): { detached: true } {
  return { detached: requireTrueField(value, "detached") };
}

export function parseReloaded(value: unknown): { reloaded: true } {
  return { reloaded: requireTrueField(value, "reloaded") };
}

function numberOrNull(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number") throw new Error(`Expected number|null field: ${key}`);
  return value;
}
