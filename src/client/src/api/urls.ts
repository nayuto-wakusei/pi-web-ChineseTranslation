import type { SessionRef } from "../../../shared/apiTypes";
import { SESSION_MEDIA_MODE } from "../../../shared/sessionMedia";
import { resolveAppUrl } from "../appUrl";
import { withManagementEmbed } from "./managementEmbed";

function referenceSessionPath(session: SessionRef, endpoint: string, options: { limit?: number; before?: number } | undefined, machineId: string): string {
  const params = new URLSearchParams({ cwd: session.cwd });
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.before !== undefined) params.set("before", String(options.before));
  params.set("media", SESSION_MEDIA_MODE);
  return `api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(session.id)}/${endpoint}?${params.toString()}`;
}

export function messagePath(session: SessionRef, options?: { limit?: number; before?: number }, machineId = "local"): string {
  return referenceSessionPath(session, "messages", options, machineId);
}

export function transcriptSnapshotPath(session: SessionRef, options?: { limit?: number }, machineId = "local"): string {
  return referenceSessionPath(session, "transcript-snapshot", options, machineId);
}

export function streamSnapshotPath(session: SessionRef, machineId = "local"): string {
  return referenceSessionPath(session, "stream-snapshot", undefined, machineId);
}

export function sessionEventsPath(session: SessionRef, machineId = "local"): string {
  return referenceSessionPath(session, "events", undefined, machineId);
}

/** Browser-ready media URL through the selected machine and management context. */
export function sessionMediaUrl(session: SessionRef, mediaId: string, machineId = "local"): string {
  const params = new URLSearchParams({ cwd: session.cwd });
  const path = `api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(session.id)}/media/${encodeURIComponent(mediaId)}?${params.toString()}`;
  const resolved = resolveAppUrl(path);
  return new URL(withManagementEmbed(resolved), resolved).href;
}

export function workspaceFileWriteUrl(projectId: string, workspaceId: string, path: string, options?: { createDirs?: boolean; overwrite?: boolean; machineId?: string }): string {
  const params = new URLSearchParams({ path });
  if (options?.createDirs === false) params.set("createDirs", "false");
  if (options?.overwrite === false) params.set("overwrite", "false");
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return resolveAppUrl(withManagementEmbed(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`));
}

export interface WorkspaceFilePreviewUrlOptions {
  modifiedAt?: string;
  machineId?: string;
  download?: boolean;
}

export function workspaceFilePreviewPath(projectId: string, workspaceId: string, path: string, options?: WorkspaceFilePreviewUrlOptions): string {
  const params = new URLSearchParams();
  params.set("path", path);
  if (options?.modifiedAt !== undefined) params.set("v", options.modifiedAt);
  if (options?.download === true) params.set("download", "1");
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return withManagementEmbed(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file/preview?${params.toString()}`);
}

export function workspaceFilePreviewUrl(projectId: string, workspaceId: string, path: string, options?: WorkspaceFilePreviewUrlOptions): string {
  return resolveAppUrl(workspaceFilePreviewPath(projectId, workspaceId, path, options));
}

/** Rolling compatibility alias for existing bundled callers. */
export function workspaceImagePreviewUrl(projectId: string, workspaceId: string, path: string, options?: WorkspaceFilePreviewUrlOptions): string {
  return workspaceFilePreviewUrl(projectId, workspaceId, path, options);
}

export function workspaceFileDownloadUrl(projectId: string, workspaceId: string, path: string, options?: { machineId?: string }): string {
  return workspaceFilePreviewUrl(projectId, workspaceId, path, { ...options, download: true });
}
