import type {
  AskUserCloseResponse,
  AskUserSubmission,
  ExtensionDialogAnswer,
  ExtensionDialogCloseResponse,
  SavedPromptAttachment,
  SessionBulkArchiveResponse,
  SessionBulkDeleteArchivedResponse,
  SessionBulkMutationRef,
  SessionNotificationCatalogSnapshot,
  SessionNotificationDismissAllRequest,
  SessionNotificationDismissRequest,
  SessionNotificationInboxSnapshot,
  SessionUnreadAcknowledgeRequest,
  SessionUnreadCatalogSnapshot,
} from "../../shared/apiTypes.js";
import type {
  ClientArchiveSessionsResponse,
  ClientCommand,
  ClientCommandResult,
  ClientMessagePage,
  ClientSession,
  ClientSessionContentSearchResponse,
  ClientSessionCleanupExecuteResponse,
  ClientSessionCleanupPreviewResponse,
  ClientSessionModel,
  ClientSessionRef,
  ClientSessionStatus,
  ClientSessionTreeNavigateRequest,
  ClientSessionTreeNavigateResult,
  SessionPinResponse,
  SessionPinnedIdsResponse,
  ClientThinkingLevel,
  SessionStreamSnapshot,
} from "../types.js";
import type { NormalizedSessionCleanupRequest } from "./sessionCleanup.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";

export type SessionRouteRef = ClientSessionRef;
export type SessionRouteLookup = SessionRouteRef;

/**
 * Route-facing session contract for PI WEB's HTTP/WebSocket API.
 *
 * Keep transport concerns separate from the bundled Pi SDK implementation so
 * routes remain testable. Pi-specific lifecycle hooks such as auth-change
 * handling and daemon shutdown stay on the concrete service.
 */
export interface SessionRouteService {
  list(cwd: string, managementContext?: ManagementEmbedContext): Promise<ClientSession[]>;
  search(cwd: string, query: string, managementContext?: ManagementEmbedContext): Promise<ClientSession[]>;
  searchContent(cwd: string, query: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionContentSearchResponse>;
  listPinned(cwd: string, managementContext?: ManagementEmbedContext): Promise<SessionPinnedIdsResponse>;
  setPinned(ref: SessionRouteLookup, pinned: boolean, managementContext?: ManagementEmbedContext): Promise<SessionPinResponse>;
  start(cwd: string, options?: { startupToken?: string; managementContext?: ManagementEmbedContext }): Promise<ClientSession>;
  messages(ref: SessionRouteLookup, page?: { before?: number; limit?: number }, managementContext?: ManagementEmbedContext): Promise<unknown[] | ClientMessagePage>;
  status(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  streamSnapshot(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<SessionStreamSnapshot>;
  notificationCatalog(): SessionNotificationCatalogSnapshot | Promise<SessionNotificationCatalogSnapshot>;
  unreadCatalog(): Promise<SessionUnreadCatalogSnapshot>;
  acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest): Promise<SessionUnreadCatalogSnapshot>;
  notificationInbox(ref: SessionRouteRef): SessionNotificationInboxSnapshot | Promise<SessionNotificationInboxSnapshot>;
  dismissNotification(ref: SessionRouteRef, request: Omit<SessionNotificationDismissRequest, "cwd">): SessionNotificationInboxSnapshot | Promise<SessionNotificationInboxSnapshot>;
  dismissAllNotifications(ref: SessionRouteRef, request: Omit<SessionNotificationDismissAllRequest, "cwd">): SessionNotificationInboxSnapshot | Promise<SessionNotificationInboxSnapshot>;
  clearQueue(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  submitAsk(ref: SessionRouteLookup, askId: string, submission: AskUserSubmission, managementContext?: ManagementEmbedContext): Promise<AskUserCloseResponse>;
  cancelAsk(ref: SessionRouteLookup, askId: string, managementContext?: ManagementEmbedContext): Promise<AskUserCloseResponse>;
  answerDialog(ref: SessionRouteLookup, dialogId: string, value: ExtensionDialogAnswer, managementContext?: ManagementEmbedContext): Promise<ExtensionDialogCloseResponse>;
  cancelDialog(ref: SessionRouteLookup, dialogId: string, managementContext?: ManagementEmbedContext): Promise<ExtensionDialogCloseResponse>;
  dismissWarning(ref: SessionRouteLookup, dismissId: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  availableModels(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionModel[]>;
  setModel(ref: SessionRouteLookup, provider: string, modelId: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  cycleModel(ref: SessionRouteLookup, direction: "forward" | "backward", managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  availableThinkingLevels(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientThinkingLevel[]>;
  setThinkingLevel(ref: SessionRouteLookup, level: string, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  cycleThinkingLevel(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  commands(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientCommand[]>;
  prompt(ref: SessionRouteLookup, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: { managementContext?: ManagementEmbedContext }): Promise<void>;
  saveAttachments(ref: SessionRouteLookup, attachments: unknown, folder?: string, managementContext?: ManagementEmbedContext): Promise<SavedPromptAttachment[]>;
  cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupPreviewResponse>;
  cleanup(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupExecuteResponse>;
  archiveMany(refs: readonly SessionBulkMutationRef[], managementContext?: ManagementEmbedContext): Promise<SessionBulkArchiveResponse>;
  deleteArchivedMany(refs: readonly SessionBulkMutationRef[], managementContext?: ManagementEmbedContext): Promise<SessionBulkDeleteArchivedResponse>;
  shell(ref: SessionRouteLookup, text: string, managementContext?: ManagementEmbedContext): Promise<void>;
  runCommand(ref: SessionRouteLookup, text: string, managementContext?: ManagementEmbedContext): Promise<ClientCommandResult>;
  respondToCommand(ref: SessionRouteLookup, requestId: string, value: string, managementContext?: ManagementEmbedContext): Promise<ClientCommandResult>;
  navigateTree(ref: SessionRouteLookup, request: ClientSessionTreeNavigateRequest, managementContext?: ManagementEmbedContext): Promise<ClientSessionTreeNavigateResult>;
  abort(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  stop(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): void | Promise<void>;
  archive(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  archiveTree(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientArchiveSessionsResponse>;
  restore(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  deleteArchived(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  reload(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  detachParent(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
}
