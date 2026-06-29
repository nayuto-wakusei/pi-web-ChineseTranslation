import type { SessionCleanupPreviewResponse, SessionCleanupRequest } from "./api";

export interface SessionCleanupDraft {
  archiveIdleEnabled: boolean;
  archiveIdleDays: string;
  deleteArchivedEnabled: boolean;
  deleteArchivedDays: string;
}

export type SessionCleanupDraftValidation =
  | { ok: true; request: SessionCleanupRequest }
  | { ok: false; error: string };

export const DEFAULT_SESSION_CLEANUP_DRAFT: SessionCleanupDraft = {
  archiveIdleEnabled: true,
  archiveIdleDays: "30",
  deleteArchivedEnabled: false,
  deleteArchivedDays: "90",
};

export function validateSessionCleanupDraft(draft: SessionCleanupDraft): SessionCleanupDraftValidation {
  if (!draft.archiveIdleEnabled && !draft.deleteArchivedEnabled) return { ok: false, error: "请至少启用一项清理操作。" };

  const request: SessionCleanupRequest = {
    archiveIdleDays: null,
    deleteArchivedDays: null,
  };

  if (draft.archiveIdleEnabled) {
    const archiveIdleDays = parseDayThreshold(draft.archiveIdleDays, "归档空闲会话天数");
    if (typeof archiveIdleDays === "string") return { ok: false, error: archiveIdleDays };
    request.archiveIdleDays = archiveIdleDays;
  }

  if (draft.deleteArchivedEnabled) {
    const deleteArchivedDays = parseDayThreshold(draft.deleteArchivedDays, "删除已归档会话天数");
    if (typeof deleteArchivedDays === "string") return { ok: false, error: deleteArchivedDays };
    request.deleteArchivedDays = deleteArchivedDays;
  }

  return { ok: true, request };
}

export function sessionCleanupRequestKey(request: SessionCleanupRequest | undefined): string {
  // The preview freshness key is threshold-only: project selection is applied
  // to the already-previewed project list and sent separately when running.
  return JSON.stringify({
    archiveIdleDays: request?.archiveIdleDays ?? null,
    deleteArchivedDays: request?.deleteArchivedDays ?? null,
  });
}

export function canRunSessionCleanup(input: {
  canCleanup: boolean;
  draft: SessionCleanupDraft;
  preview: SessionCleanupPreviewResponse | undefined;
  previewRequest: SessionCleanupRequest | undefined;
  loading?: boolean;
  running?: boolean;
}): boolean {
  if (!input.canCleanup || input.loading === true || input.running === true || input.preview === undefined) return false;
  const validation = validateSessionCleanupDraft(input.draft);
  if (!validation.ok) return false;
  if (sessionCleanupRequestKey(validation.request) !== sessionCleanupRequestKey(input.previewRequest)) return false;
  return sessionCleanupPreviewHasTargets(input.preview);
}

export function sessionCleanupPreviewHasTargets(preview: Pick<SessionCleanupPreviewResponse, "totals">): boolean {
  return preview.totals.archiveCount > 0 || preview.totals.deleteCount > 0;
}

export function selectedSessionCleanupProjectCwds(preview: Pick<SessionCleanupPreviewResponse, "projects">, selectedProjectCwds: readonly string[] | undefined): string[] {
  const previewCwds = preview.projects.map((project) => project.cwd);
  if (selectedProjectCwds === undefined) return previewCwds;
  const selected = new Set(selectedProjectCwds);
  return previewCwds.filter((cwd) => selected.has(cwd));
}

export function sessionCleanupPreviewForSelectedProjects(preview: SessionCleanupPreviewResponse, selectedProjectCwds: readonly string[] | undefined): SessionCleanupPreviewResponse {
  const selected = new Set(selectedSessionCleanupProjectCwds(preview, selectedProjectCwds));
  const projects = preview.projects.filter((project) => selected.has(project.cwd));
  return {
    ...preview,
    projects,
    totals: projects.reduce((totals, project) => ({
      archiveCount: totals.archiveCount + project.archiveCount,
      deleteCount: totals.deleteCount + project.deleteCount,
    }), { archiveCount: 0, deleteCount: 0 }),
  };
}

export function confirmSessionCleanup(preview: Pick<SessionCleanupPreviewResponse, "totals">, confirmCleanup: (message: string) => boolean): boolean {
  return confirmCleanup(sessionCleanupConfirmationMessage(preview));
}

export function sessionCleanupConfirmationMessage(preview: Pick<SessionCleanupPreviewResponse, "totals">): string {
  const archiveCount = preview.totals.archiveCount;
  const deleteCount = preview.totals.deleteCount;
  const parts: string[] = [];
  if (archiveCount > 0) parts.push(`归档 ${String(archiveCount)} 个空闲会话`);
  if (deleteCount > 0) parts.push(`永久删除 ${String(deleteCount)} 个已归档会话`);
  const action = parts.length === 0 ? "执行清理" : parts.join("并");
  return `运行清理并${action}？\n\n永久删除只适用于已归档会话，且无法撤销。`;
}

export function sessionCleanupUnavailableMessage(machineName: string | undefined): string {
  return `请更新并重启 ${machineName ?? "此机器"} 上的 Pi-Web 后再清理会话。`;
}

function parseDayThreshold(value: string, label: string): number | string {
  const trimmed = value.trim();
  if (trimmed === "") return `${label}必须设置。`;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return `${label}必须是非负整数天数。`;
  return parsed;
}
