import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../api";
import { initialAppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import { loadDraft } from "../promptDraftStorage";
import { createSessionControllerTestFixture, deferred, emptyPage, MemoryStorage, oldSession, replacementSession, sessionKey, sessionLookupId, status, workspace } from "./sessionController.testSupport";

afterEach(() => { vi.unstubAllGlobals(); });

describe("SessionController command responses", () => {
  it.each(["unchanged", "session", "machine"] as const)("applies a fork response only to its originating selection (%s)", async (selection) => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const response = deferred<CommandResult>();
    const remote = { id: "remote", name: "Remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
    const respondToCommand = vi.fn(() => response.promise);
    const fixture = createSessionControllerTestFixture({
      initialState: {
        ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession],
        commandDialog: { type: "select", requestId: "r1", title: "Fork", options: [{ value: "m1", label: "Prompt" }] },
      },
      api: {
        respondToCommand,
        messages: () => Promise.resolve(emptyPage),
        status: (session) => Promise.resolve(status(sessionLookupId(session))),
        streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
    });

    const pending = fixture.controller.respondToCommand("r1", "m1");
    expect(fixture.state.commandDialog).toBeUndefined();
    if (selection === "session") fixture.replaceState({ ...fixture.state, selectedSession: { ...oldSession, id: "other-session" } });
    if (selection === "machine") fixture.replaceState({ ...fixture.state, selectedMachine: remote });
    const selectedState = fixture.state;
    response.resolve({ type: "done", message: "Session forked", session: replacementSession, promptDraft: "fork prompt" });
    await pending;

    expect(respondToCommand).toHaveBeenCalledWith(oldSession, "r1", "m1", "local");
    if (selection === "unchanged") {
      await vi.waitFor(() => { expect(fixture.state.selectedSession?.id).toBe(replacementSession.id); });
      expect(fixture.state.sessions[0]).toEqual(replacementSession);
      expect(loadDraft(sessionKey(replacementSession.id))).toBe("fork prompt");
    } else {
      expect(fixture.state).toBe(selectedState);
      expect(loadDraft(sessionKey(replacementSession.id))).toBe("");
      expect(loadDraft(machineSessionKey(remote.id, replacementSession.id))).toBe("");
    }
  });
});
