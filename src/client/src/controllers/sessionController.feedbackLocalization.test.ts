import { afterEach, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { NetworkRequestError } from "../api/http";
import { localization } from "../localization/browser";
import { SessionController } from "./sessionController";
import { emptyTranscriptApi as defaultApi, FakeSocket, oldSession, workspace } from "./sessionController.testSupport";

const controllers: SessionController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

function setup(overrides: Partial<typeof defaultApi>, inWorkspace = true) {
  let state: AppState = {
    ...initialAppState(), selectedSession: oldSession, sessions: [oldSession],
    ...(inWorkspace ? { selectedWorkspace: workspace } : {}),
  };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined,
    undefined, { api: { ...defaultApi, ...overrides }, socket: new FakeSocket() });
  controllers.push(controller);
  return { controller, state: () => state };
}

for (const action of ["archive", "delete"] as const) {
  for (const partial of [false, true]) {
    it.each([false, true])(`keeps ${action} ${partial ? "partial" : "request"} failure wrappers live (workspace: %s)`, async (inWorkspace) => {
      const diagnostic = "The conversation could not be refreshed. Check your connection and retry.";
      const failures = [{ sessionId: "raw-id/日本語", error: diagnostic }, { sessionId: "other-id", error: "busy" }];
      const h = setup({
        archiveMany: () => partial
          ? Promise.resolve({ archived: true, archivedSessionIds: [], failures, generatedAt: "now" })
          : Promise.reject(new Error(diagnostic)),
        deleteArchivedMany: () => partial
          ? Promise.resolve({ deleted: true, deletedSessionIds: [], failures, generatedAt: "now" })
          : Promise.reject(new Error(diagnostic)),
      }, inWorkspace);
      if (action === "archive") await h.controller.archiveSessions([{ ...oldSession, persisted: true }]);
      else await h.controller.deleteArchivedSessions([{ ...oldSession, archived: true }]);
      const notice = Object.values(h.state().browserErrors)[0];
      if (notice === undefined) throw new Error("Expected a retained mutation failure");
      expect(notice.scope).toMatchObject({ kind: inWorkspace ? "workspace" : "session", machineId: "local" });
      const identity = notice.message;
      const title = action === "archive" ? "Archive" : "Delete";
      expect(identity).toBe(partial
        ? `${title} failed for 2 sessions: raw-id/日本語: ${diagnostic}; other-id: busy`
        : `${title} failed: ${diagnostic}`);
      for (const language of ["en-XA", "ar-XB"]) {
        await localization.setPreferences({ language, formatLocale: "en" });
        expect(notice.message).toBe(identity);
        expect(notice.displayMessage?.()).not.toBe(identity);
        expect(notice.displayMessage?.()).toContain(diagnostic);
        if (partial) expect(notice.displayMessage?.()).toContain("raw-id/日本語");
      }
    });
  }
}

it.each(["conversation", "session-list"] as const)("retains live %s refresh guidance and clears it only after recovery", async (target) => {
  const failure = new NetworkRequestError("raw network failure", { cause: new TypeError("offline") });
  let failing = true;
  const h = setup({
    transcriptSnapshot: (...args) => failing ? Promise.reject(failure) : defaultApi.transcriptSnapshot(...args),
    sessions: () => failing ? Promise.reject(failure) : Promise.resolve([oldSession]),
  });
  const refresh = () => target === "conversation" ? h.controller.refreshSelectedSession() : h.controller.refreshCurrentWorkspaceSessions();
  await refresh();
  const notice = Object.values(h.state().browserErrors)[0];
  if (notice === undefined) throw new Error("Expected retained refresh guidance");
  expect(notice.recovery).toBe(target === "conversation" ? "session-refresh" : "workspace-sessions-refresh");
  const identity = notice.message;
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(notice.message).toBe(identity);
    expect(notice.displayMessage?.()).not.toBe(identity);
  }
  failing = false;
  await refresh();
  expect(h.state().browserErrors).toEqual({});
});

it("does not translate runtime failures that happen to match browser-owned messages", async () => {
  const diagnostic = "The conversation could not be refreshed. Check your connection and retry.";
  const h = setup({ sessions: () => Promise.reject(new Error(diagnostic)) });
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await h.controller.refreshCurrentWorkspaceSessions();
  const notice = Object.values(h.state().browserErrors)[0];
  if (notice === undefined) throw new Error("Expected a runtime failure banner");
  expect(notice.message).toBe(diagnostic);
  expect(notice.displayMessage).toBeUndefined();
});
