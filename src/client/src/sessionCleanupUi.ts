import { t } from "./i18n";
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
  if (!draft.archiveIdleEnabled && !draft.deleteArchivedEnabled) return { ok: false, error: t("client.sessionCleanupUi.enable.at.least.one.cleanup.action.d2ce50", "Enable at least one cleanup action.") };

  const request: SessionCleanupRequest = {
    archiveIdleDays: null,
    deleteArchivedDays: null,
  };

  if (draft.archiveIdleEnabled) {
    const archiveIdleDays = parseDayThreshold(draft.archiveIdleDays, t("client.sessionCleanupUi.archive.idle.sessions.after.6d41ea", "Archive idle sessions after"));
    if (typeof archiveIdleDays === "string") return { ok: false, error: archiveIdleDays };
    request.archiveIdleDays = archiveIdleDays;
  }

  if (draft.deleteArchivedEnabled) {
    const deleteArchivedDays = parseDayThreshold(draft.deleteArchivedDays, t("client.sessionCleanupUi.delete.archived.sessions.after.923bee", "Delete archived sessions after"));
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
    projectId: request?.projectId ?? null,
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
  if (archiveCount > 0) parts.push(t("client.sessionCleanupUi.archive.idle.sessions.27a4f1", "archive {value1} idle sessions", { value1: String(archiveCount) }));
  if (deleteCount > 0) parts.push(t("client.sessionCleanupUi.permanently.delete.archived.sessions.360209", "permanently delete {value1} archived sessions", { value1: String(deleteCount) }));
  const action = parts.length === 0 ? t("client.sessionCleanupUi.run.cleanup.233f8e", "run cleanup") : parts.join(t("client.sessionCleanupUi.and.2f4b60", " and "));
  return t("client.sessionCleanupUi.run.cleanup.and.permanent.deletion.only.applies.to.archived.sessions.a.9775e2", "Run cleanup and {value1}?\n\nPermanent deletion only applies to archived sessions and cannot be undone.", { value1: action });
}

export function sessionCleanupUnavailableMessage(machineName: string | undefined): string {
  return t("client.sessionCleanupUi.update.and.restart.pi.web.on.before.cleaning.up.sessions.3c493f", "Update and restart Pi-Web on {value1} before cleaning up sessions.", { value1: machineName ?? t("client.sessionCleanupUi.this.machine.74a83f", "this machine") });
}

function parseDayThreshold(value: string, label: string): number | string {
  const trimmed = value.trim();
  if (trimmed === "") return t("client.sessionCleanupUi.must.be.set.208394", "{value1} must be set.", { value1: label });
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return t("client.sessionCleanupUi.must.be.a.non.negative.integer.number.of.days.7ed7a9", "{value1} must be a non-negative integer number of days.", { value1: label });
  return parsed;
}
