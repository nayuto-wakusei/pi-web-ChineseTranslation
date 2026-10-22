import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { browserErrorScopeKey, sessionBrowserErrorScope, workspaceBrowserErrorScope } from "../browserErrors";
import { createSessionControllerTestFixture, deferred, oldSession, replacementSession, workspace, type SessionInfo, type SessionTranscriptSnapshot } from "./sessionController.testSupport";

afterEach(() => { vi.restoreAllMocks(); });

describe("ordinary read errors retain their captured owner", () => {
  it.each(["recovery", "explicit-retire", "dispose"] as const)("still discards late failure after %s", async (mode) => {
    const snapshot = deferred<SessionTranscriptSnapshot>();
    const started = deferred<undefined>();
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] },
      api: { transcriptSnapshot: () => { started.resolve(undefined); return snapshot.promise; } },
    });
    try {
      const pending = fixture.controller.refreshSelectedSession(undefined, { recoverNetwork: mode === "recovery" });
      await started.promise;
      fixture.replaceState({ ...fixture.state, selectedSession: replacementSession });
      if (mode === "dispose") fixture.controller.dispose();
      else if (mode === "explicit-retire") fixture.controller.retireReadRecoveries(["session"]);
      snapshot.reject(new Error("discard this late failure"));
      await pending;
      expect(fixture.state.browserErrors).toEqual({});
    } finally {
      fixture.controller.dispose();
    }
  });

  it.each(["session", "machine", "workspace", "navigation"] as const)("keeps a late ordinary failure after %s becomes stale", async (change) => {
    const snapshot = deferred<SessionTranscriptSnapshot>();
    const list = deferred<SessionInfo[]>();
    const started = deferred<undefined>();
    let navigationCurrent = true;
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession, replacementSession] },
      api: {
        transcriptSnapshot: () => { started.resolve(undefined); return snapshot.promise; },
        sessions: () => { started.resolve(undefined); return list.promise; },
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
    });
    try {
      const pending = change === "workspace" ? fixture.controller.refreshCurrentWorkspaceSessions()
        : change === "navigation" ? fixture.controller.selectSession(oldSession, { updateUrl: false, navigation: { generation: 0, scope: ["session"], isCurrent: () => navigationCurrent } })
          : fixture.controller.refreshSelectedSession();
      await started.promise;
      navigationCurrent = false;
      fixture.replaceState({
        ...fixture.state,
        selectedSession: replacementSession,
        ...(change === "machine" ? { selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" } as const } : {}),
        ...(change === "workspace" ? { selectedWorkspace: { ...workspace, id: "other", projectId: "other-project", path: "/other" } } : {}),
      });
      const failure = new Error("origin ordinary read unavailable");
      if (change === "workspace") list.reject(failure);
      else snapshot.reject(failure);
      await pending;
      const scope = change === "workspace" ? workspaceBrowserErrorScope("local", workspace.projectId, workspace.id)
        : sessionBrowserErrorScope("local", oldSession.id, { cwd: oldSession.cwd, projectId: workspace.projectId, workspaceId: workspace.id });
      expect(fixture.state.browserErrors[browserErrorScopeKey(scope)]?.message).toBe(failure.message);
      expect(fixture.state.selectedSession).toBe(replacementSession);
    } finally {
      fixture.controller.dispose();
    }
  });
});
