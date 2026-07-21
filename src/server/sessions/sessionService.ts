import type {
  SavedPromptAttachment,
  SessionBulkArchiveResponse,
  SessionBulkDeleteArchivedResponse,
  SessionBulkMutationRef,
} from "../../shared/apiTypes.js";
import type {
  ClientArchiveSessionsResponse,
  ClientCommand,
  ClientCommandResult,
  ClientMessagePage,
  ClientSession,
  ClientSessionCleanupExecuteResponse,
  ClientSessionCleanupPreviewResponse,
  ClientSessionModel,
  ClientSessionRef,
  ClientSessionStatus,
  ClientThinkingLevel,
} from "../types.js";
import type { NormalizedSessionCleanupRequest } from "./sessionCleanup.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";

export type SessionRouteRef = ClientSessionRef;
export type SessionRouteLookup = string | SessionRouteRef;

/**
 * Route-facing session contract for PI WEB's HTTP/WebSocket API.
 *
 * Keep transport concerns separate from the bundled Pi SDK implementation so
 * routes remain testable. Pi-specific lifecycle hooks such as auth-change
 * handling and daemon shutdown stay on the concrete service.
 */
export interface SessionRouteService {
  list(cwd: string, managementContext?: ManagementEmbedContext): Promise<ClientSession[]>;
  start(cwd: string, options?: { managementContext?: ManagementEmbedContext }): Promise<ClientSession>;
  messages(ref: SessionRouteLookup, page?: { before?: number; limit?: number }, managementContext?: ManagementEmbedContext): Promise<unknown[] | ClientMessagePage>;
  status(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
  clearQueue(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientSessionStatus>;
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
  abort(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  stop(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): void | Promise<void>;
  archive(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  archiveTree(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<ClientArchiveSessionsResponse>;
  restore(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  deleteArchived(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  reload(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
  detachParent(ref: SessionRouteLookup, managementContext?: ManagementEmbedContext): Promise<void>;
}
