import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { markCachedNewSessionInfo, rememberCachedNewSession } from "../cachedNewSessions";
import { machineSessionKey } from "../machineKeys";
import { clearStagedAttachments, loadStagedAttachments, saveStagedAttachments, type PendingAttachment } from "../promptAttachmentStaging";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, FakeSocket, MemoryStorage, oldSession, replacementSession, sessionLookupId, status, workspace, type AppState, type SessionInfo } from "./sessionController.testSupport";

const stagedKeys = new Set<string>();
const remote = { id: "remote", name: "Remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
const attachment: PendingAttachment = { id: "staged", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "YWJj", size: 3 };
const key = (machineId: string, sessionId: string) => { const value = machineSessionKey(machineId, sessionId); stagedKeys.add(value); return value; };

beforeEach(() => { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() }); });
afterEach(() => { for (const value of stagedKeys) clearStagedAttachments(value); stagedKeys.clear(); });

describe("queued attachments and captured-machine migration", () => {
  it("projects attachment counts and migrates a temporary draft only on the originating machine", async () => {
    const started = deferred<SessionInfo>();
    const prompt = vi.fn<typeof defaultApi.prompt>(() => Promise.resolve({ accepted: true }));
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: { ...defaultApi, startSession: () => started.promise, prompt }, socket: new FakeSocket(),
    });
    const creation = controller.startSession();
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected pending session");
    const localTemporary = key("local", temporaryId);
    const localReal = key("local", replacementSession.id);
    const remoteTemporary = key(remote.id, temporaryId);
    saveDraft(localTemporary, "local remaining draft");
    saveDraft(remoteTemporary, "remote draft");
    saveStagedAttachments(localTemporary, [attachment]);
    saveStagedAttachments(remoteTemporary, [{ ...attachment, id: "remote-only" }]);
    const image = { kind: "image" as const, mimeType: "image/png", data: "YWJj", name: "shot.png" };
    await controller.send("", undefined, [image]);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([expect.objectContaining({ kind: "followUp", hasAttachments: true, attachmentCount: 1 })]);
    state = { ...state, selectedMachine: remote, selectedSession: oldSession };
    started.resolve(replacementSession);
    await creation;
    expect(loadDraft(localTemporary)).toBe("");
    expect(loadDraft(localReal)).toBe("local remaining draft");
    expect(loadDraft(remoteTemporary)).toBe("remote draft");
    expect(loadStagedAttachments(localReal)).toEqual([attachment]);
    expect(loadStagedAttachments(localTemporary)).toEqual([]);
    expect(loadStagedAttachments(remoteTemporary)).toEqual([{ ...attachment, id: "remote-only" }]);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ id: replacementSession.id }), "", undefined, "local", [image]);
    expect(state.selectedSession).toBe(oldSession);
  });

  it("recreates a remote cached session without moving identically named local drafts or attachments", async () => {
    rememberCachedNewSession(oldSession, remote.id);
    const cached = markCachedNewSessionInfo(oldSession, remote.id);
    let state: AppState = { ...initialAppState(), selectedMachine: remote, selectedWorkspace: workspace, sessions: [cached] };
    const remoteOld = key(remote.id, oldSession.id);
    const remoteNew = key(remote.id, replacementSession.id);
    const localOld = key("local", oldSession.id);
    saveDraft(remoteOld, "remote draft");
    saveDraft(localOld, "local draft");
    saveStagedAttachments(remoteOld, [attachment]);
    saveStagedAttachments(localOld, [{ ...attachment, id: "local-only" }]);
    const startSession = vi.fn<typeof defaultApi.startSession>(() => Promise.resolve(replacementSession));
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: { ...defaultApi, startSession,
        transcriptSnapshot: (session) => sessionLookupId(session) === oldSession.id ? Promise.reject(new Error("Session not found"))
          : Promise.resolve({ page: { messages: [], start: 0, total: 0 }, status: status(sessionLookupId(session)), seq: 0, partial: null }),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      }, socket: new FakeSocket(),
    });
    await controller.selectSession(cached, { updateUrl: false });
    expect(startSession).toHaveBeenCalledWith(oldSession.cwd, remote.id);
    expect(loadDraft(remoteOld)).toBe("");
    expect(loadDraft(remoteNew)).toBe("remote draft");
    expect(loadDraft(localOld)).toBe("local draft");
    expect(loadStagedAttachments(remoteNew)).toEqual([attachment]);
    expect(loadStagedAttachments(remoteOld)).toEqual([]);
    expect(loadStagedAttachments(localOld)).toEqual([{ ...attachment, id: "local-only" }]);
  });
});
