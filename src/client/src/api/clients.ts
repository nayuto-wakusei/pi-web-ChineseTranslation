import type { AskUserSubmission, DeleteWorkspaceFileResponse, ExtensionDialogAnswer, FileSuggestion, MoveWorkspaceFileOptions, PiPackageInstallRequest, PiPackageRemoveRequest, PiPackageScope, PiPackageUpdateRequest, PiWebConfigValues, PromptAttachment, RunTerminalCommandInput, SessionBulkMutationRef, SessionCleanupRequest, SessionNotificationDismissThrough, SessionRef, SessionTreeForkRequest, SessionTreeNavigateRequest, SessionUnreadAcknowledgeRequest, TerminalCommandRun, TerminalCommandRunFilter, WriteWorkspaceFileOptions } from "../../../shared/apiTypes";
import { request, requestOptional } from "./http";
import {
  arrayOf,
  parseAborted,
  parseAskUserCloseResponse,
  parseAccepted,
  parseArchived,
  parseAuthProvidersResponse,
  parseClosed,
  parseCommandResult,
  parseDeleted,
  parseDeleteWorkspaceFileResponse,
  parseDetached,
  parseExtensionDialogCloseResponse,
  parseFileContentResponse,
  parseFileSuggestion,
  parseFileTreeResponse,
  parseGitDiffResponse,
  parseGitStatusResponse,
  parseMachine,
  parseMachineHealth,
  parseMachineRuntime,
  parseMachinesResponse,
  parseMessagePage,
  parseModelSelectionResponse,
  parseMoveWorkspaceFileResponse,
  parseNormalAuthStatusResponse,
  parseOAuthFlowState,
  parsePiPackageMutationResponse,
  parsePiPackagesResponse,
  parsePiWebConfigResponse,
  parsePiWebPluginsResponse,
  parsePiWebRuntimeResponse,
  parsePiWebStatusResponse,
  parseProject,
  parseReloaded,
  parseRestored,
  parseSavedAttachments,
  parseSessionBulkArchiveResponse,
  parseSessionBulkDeleteArchivedResponse,
  parseSessionCleanupExecuteResponse,
  parseSessionCleanupPreviewResponse,
  parseSessionContentSearchResponse,
  parseSessionInfo,
  parseSessionNotificationInboxSnapshot,
  parseSessionPinResponse,
  parseSessionPinnedIdsResponse,
  parseSessionStatus,
  parseSessionStreamSnapshot,
  parseSessionTreeForkResult,
  parseSessionTreeNavigateResult,
  parseSessionUnreadCatalogSnapshot,
  parseSlashCommand,
  parseStopped,
  parseTerminalCommandRun,
  parseTerminalInfo,
  parseThinkingLevelsResponse,
  parseWriteWorkspaceFileResponse,
  parseWorkspace,
  parseWorkspaceActivityResponse,
  requireMachineStatusSnapshot,
  parseWorkspaceDeleteResponse,
  parseWorkspacePathOperationResponse,
} from "./parsers";
import { machineGitDiffPath, messagePath, workspaceFileDownloadUrl } from "./urls";

const machinePrefix = (machineId = "local") => `api/machines/${encodeURIComponent(machineId)}`;

type SessionLookup = SessionRef;

export interface AuthRequestTarget {
  machineId: string;
  projectId?: string;
  projectName?: string;
}

interface AuthProvidersOptions extends AuthRequestTarget {
  mode?: "login" | "logout";
  authType?: "oauth" | "api_key";
}

function sessionBasePath(session: SessionRef, machineId = "local"): string {
  return `${machinePrefix(machineId)}/sessions/${encodeURIComponent(session.id)}`;
}

function sessionPath(session: SessionRef, endpoint: string, machineId = "local"): string {
  return `${sessionBasePath(session, machineId)}/${endpoint}`;
}

function sessionQueryPath(session: SessionRef, endpoint: string, machineId = "local"): string {
  return `${sessionPath(session, endpoint, machineId)}${sessionQuery(session)}`;
}

function sessionBaseQueryPath(session: SessionRef, machineId = "local"): string {
  return `${sessionBasePath(session, machineId)}${sessionQuery(session)}`;
}

function sessionQuery(session: SessionRef): string {
  return `?${new URLSearchParams({ cwd: session.cwd }).toString()}`;
}

function sessionBody(session: SessionRef, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ cwd: session.cwd, ...fields });
}

function sessionBulkMutationBody(sessions: readonly SessionRef[]): string {
  return JSON.stringify({ sessions: sessions satisfies readonly SessionBulkMutationRef[] });
}

function authUrl(endpoint: string, target: AuthRequestTarget): string {
  const params = new URLSearchParams();
  if (target.projectId !== undefined) params.set("projectId", target.projectId);
  const query = params.toString();
  return `${machinePrefix(target.machineId)}/auth/${endpoint}${query === "" ? "" : `?${query}`}`;
}

function piWebStatusPath(machineId: string): string {
  return machineId === "local" ? "api/pi-web/status" : `${machinePrefix(machineId)}/pi-web/status`;
}

export const piWebApi = {
  piWebStatus: (machineId = "local") => request(piWebStatusPath(machineId), parsePiWebStatusResponse),
  checkForUpdates: (machineId = "local") => request(`${piWebStatusPath(machineId)}?refresh=1`, parsePiWebStatusResponse, { cache: "no-store" }),
  piWebRuntime: () => request("api/pi-web/runtime", parsePiWebRuntimeResponse),
};

export const machinesApi = {
  machines: () => request("api/machines", parseMachinesResponse),
  addMachine: (input: { name: string; baseUrl: string; token?: string }) => request("api/machines", parseMachine, { method: "POST", body: JSON.stringify(input) }),
  deleteMachine: (machineId: string) => request(`api/machines/${encodeURIComponent(machineId)}`, (value) => value, { method: "DELETE" }),
  health: (machineId: string) => request(`api/machines/${encodeURIComponent(machineId)}/health`, parseMachineHealth),
  runtime: (machineId: string, refresh = false) => request(`api/machines/${encodeURIComponent(machineId)}/runtime${refresh ? "?refresh=1" : ""}`, parseMachineRuntime, refresh ? { cache: "no-store" } : {}),
};

function configPath(machineId?: string): string {
  return machineId === undefined ? "api/config" : `${machinePrefix(machineId)}/config`;
}

function pluginsPath(machineId?: string): string {
  return machineId === undefined ? "api/plugins" : `${machinePrefix(machineId)}/plugins`;
}

export const configApi = {
  config: (machineId?: string) => request(configPath(machineId), parsePiWebConfigResponse),
  saveConfig: (config: PiWebConfigValues, machineId?: string) => request(configPath(machineId), parsePiWebConfigResponse, { method: "PUT", body: JSON.stringify({ config }) }),
};

export const normalAuthApi = {
  status: () => request("api/normal-auth/status", parseNormalAuthStatusResponse),
  setup: (password: string) => request("api/normal-auth/setup", parseAccepted, { method: "POST", body: JSON.stringify({ password }) }),
  login: (password: string) => request("api/normal-auth/login", parseAccepted, { method: "POST", body: JSON.stringify({ password }) }),
  changePassword: (currentPassword: string, newPassword: string) => request("api/normal-auth/change-password", parseAccepted, { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
};

export const pluginsApi = {
  plugins: (machineId?: string) => request(pluginsPath(machineId), parsePiWebPluginsResponse),
};

function piPackagePath(endpoint = "", machineId?: string): string {
  const basePath = machineId === undefined ? "api/pi-packages" : `${machinePrefix(machineId)}/pi-packages`;
  return endpoint === "" ? basePath : `${basePath}/${endpoint}`;
}

export const piPackagesApi = {
  packages: (machineId?: string) => request(piPackagePath("", machineId), parsePiPackagesResponse),
  install: (source: string, machineId?: string) => {
    const body: PiPackageInstallRequest = { source };
    return request(piPackagePath("install", machineId), parsePiPackageMutationResponse, { method: "POST", body: JSON.stringify(body) });
  },
  remove: (source: string, scope?: PiPackageScope, machineId?: string) => {
    const body: PiPackageRemoveRequest = scope === undefined ? { source } : { source, scope };
    return request(piPackagePath("remove", machineId), parsePiPackageMutationResponse, { method: "POST", body: JSON.stringify(body) });
  },
  update: (source?: string, machineId?: string) => {
    const body: PiPackageUpdateRequest | undefined = source === undefined ? undefined : { source };
    return request(piPackagePath("update", machineId), parsePiPackageMutationResponse, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  },
};

export const activityApi = {
  workspaceActivity: (machineId = "local") => request(`${machinePrefix(machineId)}/activity`, parseWorkspaceActivityResponse),
};

export const machineStatusApi = {
  machineStatus: (machineId = "local") => request(`${machinePrefix(machineId)}/status`, requireMachineStatusSnapshot),
};

export const projectsApi = {
  projects: (machineId = "local") => request(`${machinePrefix(machineId)}/projects`, arrayOf(parseProject)),
  addProject: (path: string, name?: string, create?: boolean, machineId = "local") => request(`${machinePrefix(machineId)}/projects`, parseProject, { method: "POST", body: JSON.stringify({ path, name, create }) }),
  closeProject: (projectId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}`, parseClosed, { method: "DELETE" }),
  projectDirectories: (query: string, machineId = "local") => request(`${machinePrefix(machineId)}/project-directories?q=${encodeURIComponent(query)}`, arrayOf(parseFileSuggestion)),
};

function writeWorkspaceFile(projectId: string, workspaceId: string, path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions, machineId = "local") {
  const params = new URLSearchParams({ path });
  if (options?.createDirs === false) params.set("createDirs", "false");
  if (options?.overwrite === false) params.set("overwrite", "false");
  const isBinary = content instanceof Uint8Array;
  const body: BodyInit = isBinary ? new Uint8Array(content) : new TextEncoder().encode(content);
  return request(
    `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`,
    parseWriteWorkspaceFileResponse,
    { method: "PUT", body, headers: { "Content-Type": isBinary ? "application/octet-stream" : "text/plain" } },
  );
}

export const workspacesApi = {
  workspaces: (projectId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces`, arrayOf(parseWorkspace)),
  deleteWorkspace: (projectId: string, workspaceId: string, precondition: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}`, parseTerminalCommandRun, { method: "DELETE", body: JSON.stringify({ precondition }), headers: { "Content-Type": "application/json" } }),
  workspaceTree: (projectId: string, workspaceId: string, path = "", machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/tree?path=${encodeURIComponent(path)}`, parseFileTreeResponse),
  workspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}`, parseFileContentResponse),
  optionalWorkspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local") => requestOptional(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}&optional=true`, parseFileContentResponse),
  createWorkspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local") => writeWorkspaceFile(projectId, workspaceId, path, new Uint8Array(), undefined, machineId),
  writeWorkspaceFile,
  deleteWorkspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local"): Promise<DeleteWorkspaceFileResponse> => {
    const params = new URLSearchParams({ path });
    return request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`, parseDeleteWorkspaceFileResponse, { method: "DELETE" });
  },
  moveWorkspaceFile: (projectId: string, workspaceId: string, fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions, machineId = "local") => {
    const params = new URLSearchParams({ fromPath, toPath });
    if (options?.createDirs === false) params.set("createDirs", "false");
    if (options?.overwrite === true) params.set("overwrite", "true");
    return request(
      `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file/move?${params.toString()}`,
      parseMoveWorkspaceFileResponse,
      { method: "POST" },
    );
  },
  createWorkspaceDirectory: (projectId: string, workspaceId: string, path: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/directory`, parseWorkspacePathOperationResponse, { method: "POST", body: JSON.stringify({ path }) }),
  moveWorkspaceDirectory: (projectId: string, workspaceId: string, fromPath: string, toPath: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/directory`, parseWorkspacePathOperationResponse, { method: "PATCH", body: JSON.stringify({ fromPath, toPath }) }),
  deleteWorkspaceDirectory: (projectId: string, workspaceId: string, path: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/directory?path=${encodeURIComponent(path)}`, parseWorkspaceDeleteResponse, { method: "DELETE" }),
  downloadWorkspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local") => downloadWorkspaceFile(projectId, workspaceId, path, machineId),
};

export const sessionsApi = {
  sessions: (cwd: string, machineId = "local") => request(`${machinePrefix(machineId)}/sessions?cwd=${encodeURIComponent(cwd)}`, arrayOf(parseSessionInfo)),
  search: (cwd: string, query: string, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/search?${new URLSearchParams({ cwd, q: query }).toString()}`, arrayOf(parseSessionInfo)),
  searchContent: (cwd: string, query: string, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/search-content?${new URLSearchParams({ cwd, q: query }).toString()}`, parseSessionContentSearchResponse),
  pinned: (cwd: string, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/pins?cwd=${encodeURIComponent(cwd)}`, parseSessionPinnedIdsResponse),
  pin: (session: SessionRef, machineId = "local") => request(`${sessionBasePath(session, machineId)}/pin`, parseSessionPinResponse, { method: "PUT", body: sessionBody(session) }),
  unpin: (session: SessionRef, machineId = "local") => request(`${sessionBasePath(session, machineId)}/pin${sessionQuery(session)}`, parseSessionPinResponse, { method: "DELETE" }),
  unreadCatalog: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions/unread`, parseSessionUnreadCatalogSnapshot, { cache: "no-store" }),
  acknowledgeUnread: (session: SessionRef, catalogId: string, throughCompletionOrder: number, machineId = "local") => {
    const body: SessionUnreadAcknowledgeRequest = { cwd: session.cwd, catalogId, throughCompletionOrder };
    return request(sessionPath(session, "unread/acknowledge", machineId), parseSessionUnreadCatalogSnapshot, { method: "POST", body: JSON.stringify(body) });
  },
  notificationInbox: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "notifications", machineId), parseSessionNotificationInboxSnapshot),
  dismissNotification: (session: SessionLookup, daemonInstanceId: string, notificationId: string, machineId = "local") => request(sessionPath(session, "notifications/dismiss", machineId), parseSessionNotificationInboxSnapshot, { method: "POST", body: sessionBody(session, { daemonInstanceId, notificationId }) }),
  dismissAllNotifications: (session: SessionLookup, daemonInstanceId: string, through: SessionNotificationDismissThrough, machineId = "local") => request(sessionPath(session, "notifications/dismiss-all", machineId), parseSessionNotificationInboxSnapshot, { method: "POST", body: sessionBody(session, { daemonInstanceId, throughOrder: through.order, throughOverflowWatermark: through.overflowWatermark }) }),
  startSession: (cwd: string, machineId = "local", startupToken?: string) => request(`${machinePrefix(machineId)}/sessions`, parseSessionInfo, { method: "POST", body: JSON.stringify(startupToken === undefined ? { cwd } : { cwd, startupToken }) }),
  cleanupPreview: (input: SessionCleanupRequest, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/cleanup/preview`, parseSessionCleanupPreviewResponse, { method: "POST", body: JSON.stringify(input) }),
  cleanup: (input: SessionCleanupRequest, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/cleanup`, parseSessionCleanupExecuteResponse, { method: "POST", body: JSON.stringify(input) }),
  archiveMany: (sessions: readonly SessionLookup[], machineId = "local") => request(`${machinePrefix(machineId)}/sessions/bulk/archive`, parseSessionBulkArchiveResponse, { method: "POST", body: sessionBulkMutationBody(sessions) }),
  deleteArchivedMany: (sessions: readonly SessionLookup[], machineId = "local") => request(`${machinePrefix(machineId)}/sessions/bulk/delete-archived`, parseSessionBulkDeleteArchivedResponse, { method: "POST", body: sessionBulkMutationBody(sessions) }),
  messages: (session: SessionLookup, options?: { limit?: number; before?: number }, machineId = "local") => request(messagePath(session, options, machineId), parseMessagePage),
  status: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "status", machineId), parseSessionStatus),
  streamSnapshot: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "stream-snapshot", machineId), parseSessionStreamSnapshot),
  models: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "models", machineId), parseModelSelectionResponse),
  setModel: (session: SessionLookup, provider: string, modelId: string, machineId = "local") => request(sessionPath(session, "model", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { provider, modelId }) }),
  cycleModel: (session: SessionLookup, direction: "forward" | "backward", machineId = "local") => request(sessionPath(session, "model/cycle", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { direction }) }),
  thinkingLevels: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "thinking-levels", machineId), parseThinkingLevelsResponse),
  setThinkingLevel: (session: SessionLookup, level: string, machineId = "local") => request(sessionPath(session, "thinking-level", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { level }) }),
  cycleThinkingLevel: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "thinking-level/cycle", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session) }),
  commands: (session: SessionLookup, machineId = "local") => request(sessionQueryPath(session, "commands", machineId), arrayOf(parseSlashCommand)),
  prompt: (session: SessionLookup, text: string, streamingBehavior?: "steer" | "followUp", machineId = "local", attachments?: PromptAttachment[]) => request(sessionPath(session, "prompt", machineId), parseAccepted, { method: "POST", body: sessionBody(session, { text, ...(streamingBehavior === undefined ? {} : { streamingBehavior }), ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}) }) }),
  saveAttachments: (session: SessionLookup, attachments: PromptAttachment[], machineId = "local", folder?: string) => request(sessionPath(session, "attachments", machineId), parseSavedAttachments, { method: "POST", body: sessionBody(session, { attachments, ...(folder === undefined ? {} : { folder }) }) }),
  shell: (session: SessionLookup, text: string, machineId = "local") => request(sessionPath(session, "shell", machineId), parseAccepted, { method: "POST", body: sessionBody(session, { text }) }),
  runCommand: (session: SessionLookup, text: string, machineId = "local") => request(sessionPath(session, "commands/run", machineId), parseCommandResult, { method: "POST", body: sessionBody(session, { text }) }),
  respondToCommand: (session: SessionLookup, requestId: string, value: string, machineId = "local") => request(sessionPath(session, "commands/respond", machineId), parseCommandResult, { method: "POST", body: sessionBody(session, { requestId, value }) }),
  navigateTree: (session: SessionLookup, navigation: SessionTreeNavigateRequest, machineId = "local") => request(sessionPath(session, "tree/navigate", machineId), parseSessionTreeNavigateResult, {
    method: "POST",
    body: sessionBody(session, { targetId: navigation.targetId, expectedLeafId: navigation.expectedLeafId, summary: navigation.summary }),
  }),
  forkTree: (session: SessionLookup, fork: SessionTreeForkRequest, machineId = "local") => request(sessionPath(session, "tree/fork", machineId), parseSessionTreeForkResult, {
    method: "POST",
    body: sessionBody(session, { entryId: fork.entryId, expectedLeafId: fork.expectedLeafId }),
  }),
  abort: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "abort", machineId), parseAborted, { method: "POST", body: sessionBody(session) }),
  stop: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "stop", machineId), parseStopped, { method: "POST", body: sessionBody(session) }),
  archive: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "archive", machineId), parseArchived, { method: "POST", body: sessionBody(session) }),
  archiveWithDescendants: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "archive-tree", machineId), parseArchived, { method: "POST", body: sessionBody(session) }),
  restore: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "restore", machineId), parseRestored, { method: "POST", body: sessionBody(session) }),
  deleteArchived: (session: SessionLookup, machineId = "local") => request(sessionBaseQueryPath(session, machineId), parseDeleted, { method: "DELETE" }),
  detachParent: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "detach-parent", machineId), parseDetached, { method: "POST", body: sessionBody(session) }),
  reloadSession: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "reload", machineId), parseReloaded, { method: "POST", body: sessionBody(session) }),
  clearQueue: (session: SessionLookup, machineId = "local") => request(sessionPath(session, "queue/clear", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session) }),
  dismissWarning: (session: SessionLookup, dismissId: string, machineId = "local") => request(sessionPath(session, "warnings/dismiss", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { dismissId }) }),
  submitAsk: (session: SessionLookup, askId: string, submission: AskUserSubmission, machineId = "local") => request(sessionPath(session, "ask/submit", machineId), parseAskUserCloseResponse, { method: "POST", body: sessionBody(session, { askId, answers: submission.answers }) }),
  cancelAsk: (session: SessionLookup, askId: string, machineId = "local") => request(sessionPath(session, "ask/cancel", machineId), parseAskUserCloseResponse, { method: "POST", body: sessionBody(session, { askId }) }),
  answerDialog: (session: SessionLookup, dialogId: string, value: ExtensionDialogAnswer, machineId = "local") => request(sessionPath(session, "dialogs/answer", machineId), parseExtensionDialogCloseResponse, { method: "POST", body: sessionBody(session, { dialogId, value }) }),
  cancelDialog: (session: SessionLookup, dialogId: string, machineId = "local") => request(sessionPath(session, "dialogs/cancel", machineId), parseExtensionDialogCloseResponse, { method: "POST", body: sessionBody(session, { dialogId }) }),
  authProviders: (options: AuthProvidersOptions) => {
    const params = new URLSearchParams();
    if (options.mode !== undefined) params.set("mode", options.mode);
    if (options.authType !== undefined) params.set("authType", options.authType);
    if (options.projectId !== undefined) params.set("projectId", options.projectId);
    const query = params.toString();
    return request(`${machinePrefix(options.machineId)}/auth/providers${query === "" ? "" : `?${query}`}`, parseAuthProvidersResponse);
  },
  saveApiKey: (providerId: string, key: string, target: AuthRequestTarget) => request(authUrl("api-key", target), parseAccepted, { method: "POST", body: JSON.stringify({ providerId, key }) }),
  startInteractiveApiKeyLogin: (providerId: string, target: AuthRequestTarget) => request(authUrl("api-key/interactive", target), parseOAuthFlowState, { method: "POST", body: JSON.stringify({ providerId }) }),
  logoutProvider: (providerId: string, target: AuthRequestTarget) => request(authUrl("logout", target), parseAccepted, { method: "POST", body: JSON.stringify({ providerId }) }),
  startOAuthLogin: (providerId: string, target: AuthRequestTarget) => request(authUrl("oauth", target), parseOAuthFlowState, { method: "POST", body: JSON.stringify({ providerId }) }),
  oauthFlow: (flowId: string, target: AuthRequestTarget) => request(authUrl(`oauth/${encodeURIComponent(flowId)}`, target), parseOAuthFlowState),
  respondOAuthFlow: (flowId: string, requestId: string, value: string, target: AuthRequestTarget) => request(authUrl(`oauth/${encodeURIComponent(flowId)}/respond`, target), parseOAuthFlowState, { method: "POST", body: JSON.stringify({ requestId, value }) }),
  cancelOAuthFlow: (flowId: string, target: AuthRequestTarget) => request(authUrl(`oauth/${encodeURIComponent(flowId)}/cancel`, target), parseOAuthFlowState, { method: "POST" }),
};

export const terminalsApi = {
  terminals: (projectId: string, workspaceId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, arrayOf(parseTerminalInfo)),
  startTerminal: (projectId: string, workspaceId: string, options?: { name?: string; cols?: number; rows?: number }, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, parseTerminalInfo, { method: "POST", body: JSON.stringify(options ?? {}) }),
  closeWorkspaceTerminals: (projectId: string, workspaceId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, parseClosed, { method: "DELETE" }),
  closeTerminal: (projectId: string, workspaceId: string, terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}`, parseClosed, { method: "DELETE" }),
  continueTerminal: (projectId: string, workspaceId: string, terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/continue`, parseTerminalInfo, { method: "POST" }),
  runTerminalCommand: (origin: string, input: RunTerminalCommandInput, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(input.workspace.projectId)}/workspaces/${encodeURIComponent(input.workspace.id)}/terminal-command-runs`, parseTerminalCommandRun, { method: "POST", body: JSON.stringify({ origin, title: input.title, command: input.command, metadata: input.metadata ?? {} }) }),
  listCommandRuns: (filter?: TerminalCommandRunFilter, machineId = "local") => request(`${machinePrefix(machineId)}/terminal-command-runs${terminalCommandRunFilterQuery(filter)}`, arrayOf(parseTerminalCommandRun)),
  getCommandRun: (runId: string, machineId = "local") => getOptionalTerminalCommandRun(runId, machineId),
  cancelCommandRun: (runId: string, machineId = "local") => request(`${machinePrefix(machineId)}/terminal-command-runs/${encodeURIComponent(runId)}/cancel`, parseTerminalCommandRun, { method: "POST" }),
};

async function getOptionalTerminalCommandRun(runId: string, machineId: string): Promise<TerminalCommandRun | undefined> {
  return requestOptional(`${machinePrefix(machineId)}/terminal-command-runs/${encodeURIComponent(runId)}`, parseTerminalCommandRun);
}

function terminalCommandRunFilterQuery(filter: TerminalCommandRunFilter | undefined): string {
  if (filter === undefined) return "";
  const params = new URLSearchParams();
  if (filter.projectId !== undefined) params.set("projectId", filter.projectId);
  if (filter.workspaceId !== undefined) params.set("workspaceId", filter.workspaceId);
  if (filter.terminalId !== undefined) params.set("terminalId", filter.terminalId);
  if (filter.statuses !== undefined && filter.statuses.length > 0) params.set("statuses", filter.statuses.join(","));
  if (filter.metadata !== undefined && Object.keys(filter.metadata).length > 0) params.set("metadata", JSON.stringify(filter.metadata));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function apiErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const error = value["error"];
  return typeof error === "string" ? error : undefined;
}

async function downloadWorkspaceFile(projectId: string, workspaceId: string, path: string, machineId: string): Promise<void> {
  const response = await fetch(workspaceFileDownloadUrl(projectId, workspaceId, path, { machineId }));
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new Error(apiErrorMessage(body) ?? response.statusText);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const fileName = path.split("/").pop();
  anchor.download = fileName === undefined || fileName === "" ? "download" : fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface FileSuggestionQueryOptions {
  kind?: FileSuggestion["kind"] | undefined;
  mode?: "file" | "path" | undefined;
  scope?: "tracked" | "all" | undefined;
  machineId?: string | undefined;
  projectId?: string | undefined;
  workspaceId?: string | undefined;
  workspaceScoped?: boolean | undefined;
}

export const filesApi = {
  files: (cwd: string, query: string, options: FileSuggestionQueryOptions = {}) => {
    const params = new URLSearchParams({ q: query });
    if (options.kind !== undefined) params.set("kind", options.kind);
    if (options.mode !== undefined) params.set("mode", options.mode);
    if (options.scope !== undefined) params.set("scope", options.scope);
    if (options.workspaceScoped === true && options.projectId !== undefined && options.workspaceId !== undefined) {
      return request(`${machinePrefix(options.machineId)}/projects/${encodeURIComponent(options.projectId)}/workspaces/${encodeURIComponent(options.workspaceId)}/files?${params.toString()}`, arrayOf(parseFileSuggestion));
    }
    params.set("cwd", cwd);
    return request(`${machinePrefix(options.machineId)}/files?${params.toString()}`, arrayOf(parseFileSuggestion));
  },
};

export const gitApi = {
  gitStatus: (projectId: string, workspaceId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/git/status`, parseGitStatusResponse),
  gitDiff: (projectId: string, workspaceId: string, options?: { path?: string; staged?: boolean }, machineId = "local") => request(machineGitDiffPath(machineId, projectId, workspaceId, options), parseGitDiffResponse),
};

export const api = {
  ...piWebApi,
  ...machinesApi,
  ...configApi,
  ...normalAuthApi,
  ...pluginsApi,
  ...piPackagesApi,
  ...activityApi,
  ...machineStatusApi,
  ...projectsApi,
  ...workspacesApi,
  ...sessionsApi,
  ...terminalsApi,
  ...filesApi,
  ...gitApi,
};
