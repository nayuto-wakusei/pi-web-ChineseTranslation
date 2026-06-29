import { describe, expect, it } from "vitest";
import type { SessionCleanupPreviewResponse } from "./api";
import { canRunSessionCleanup, confirmSessionCleanup, selectedSessionCleanupProjectCwds, sessionCleanupConfirmationMessage, sessionCleanupPreviewForSelectedProjects, sessionCleanupRequestKey, sessionCleanupUnavailableMessage, validateSessionCleanupDraft, type SessionCleanupDraft } from "./sessionCleanupUi";

const draft: SessionCleanupDraft = {
  archiveIdleEnabled: true,
  archiveIdleDays: "30",
  deleteArchivedEnabled: true,
  deleteArchivedDays: "90",
};

const preview: SessionCleanupPreviewResponse = {
  generatedAt: "2026-06-25T12:00:00.000Z",
  thresholds: { archiveIdleDays: 30, deleteArchivedDays: 90 },
  projects: [{ cwd: "/repo", archiveCount: 2, deleteCount: 1 }],
  totals: { archiveCount: 2, deleteCount: 1 },
};

describe("session cleanup UI helpers", () => {
  it("builds request thresholds from enabled runtime inputs", () => {
    expect(validateSessionCleanupDraft(draft)).toEqual({
      ok: true,
      request: { archiveIdleDays: 30, deleteArchivedDays: 90 },
    });
    expect(validateSessionCleanupDraft({ ...draft, archiveIdleEnabled: false })).toEqual({
      ok: true,
      request: { archiveIdleDays: null, deleteArchivedDays: 90 },
    });
  });

  it("validates threshold inputs before preview or execution", () => {
    expect(validateSessionCleanupDraft({ ...draft, archiveIdleDays: "1.5" })).toEqual({ ok: false, error: "归档空闲会话天数必须是非负整数天数。" });
    expect(validateSessionCleanupDraft({ ...draft, deleteArchivedDays: "-1" })).toEqual({ ok: false, error: "删除已归档会话天数必须是非负整数天数。" });
    expect(validateSessionCleanupDraft({ ...draft, archiveIdleEnabled: false, deleteArchivedEnabled: false })).toEqual({ ok: false, error: "请至少启用一项清理操作。" });
  });

  it("requires a current preview before cleanup can run", () => {
    const validation = validateSessionCleanupDraft(draft);
    if (!validation.ok) throw new Error(validation.error);

    expect(canRunSessionCleanup({ canCleanup: true, draft, preview, previewRequest: validation.request })).toBe(true);
    expect(canRunSessionCleanup({ canCleanup: true, draft: { ...draft, archiveIdleDays: "31" }, preview, previewRequest: validation.request })).toBe(false);
    expect(canRunSessionCleanup({ canCleanup: true, draft, preview: { ...preview, totals: { archiveCount: 0, deleteCount: 0 } }, previewRequest: validation.request })).toBe(false);
    expect(canRunSessionCleanup({ canCleanup: false, draft, preview, previewRequest: validation.request })).toBe(false);
  });

  it("normalizes request keys for null, omitted disabled actions, and selected projects", () => {
    expect(sessionCleanupRequestKey({ archiveIdleDays: 30 })).toBe(sessionCleanupRequestKey({ archiveIdleDays: 30, deleteArchivedDays: null, projectCwds: ["/repo"] }));
  });

  it("summarizes the preview for selected projects", () => {
    const multiProjectPreview: SessionCleanupPreviewResponse = {
      ...preview,
      projects: [
        { cwd: "/repo-a", archiveCount: 2, deleteCount: 1 },
        { cwd: "/repo-b", archiveCount: 0, deleteCount: 3 },
      ],
      totals: { archiveCount: 2, deleteCount: 4 },
    };

    expect(selectedSessionCleanupProjectCwds(multiProjectPreview, undefined)).toEqual(["/repo-a", "/repo-b"]);
    expect(selectedSessionCleanupProjectCwds(multiProjectPreview, ["/missing", "/repo-b"])).toEqual(["/repo-b"]);
    expect(sessionCleanupPreviewForSelectedProjects(multiProjectPreview, ["/repo-b"])).toMatchObject({
      projects: [{ cwd: "/repo-b", archiveCount: 0, deleteCount: 3 }],
      totals: { archiveCount: 0, deleteCount: 3 },
    });
    expect(sessionCleanupPreviewForSelectedProjects(multiProjectPreview, [])).toMatchObject({
      projects: [],
      totals: { archiveCount: 0, deleteCount: 0 },
    });
  });

  it("uses explicit permanent deletion copy in confirmation and unavailable messages", () => {
    const confirmMessages: string[] = [];
    expect(confirmSessionCleanup(preview, (message) => {
      confirmMessages.push(message);
      return true;
    })).toBe(true);
    expect(confirmMessages[0]).toContain("永久删除 1 个已归档会话");
    expect(sessionCleanupConfirmationMessage(preview)).toContain("无法撤销");
    expect(sessionCleanupUnavailableMessage("远端开发机")).toBe("请更新并重启 远端开发机 上的 Pi-Web 后再清理会话。");
  });
});
