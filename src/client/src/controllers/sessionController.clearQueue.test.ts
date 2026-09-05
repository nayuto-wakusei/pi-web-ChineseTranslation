import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { createSessionControllerTestFixture, defaultApi, deferred, FakeSocket, oldSession, replacementSession, sessionLookupId, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

function machine(id: string): NonNullable<AppState["selectedMachine"]> {
  return { id, name: id, kind: "remote", createdAt: "now", updatedAt: "now" };
}

describe("SessionController server queue clearing", () => {
  it("applies the returned status to the selected session without changing client-side queued sends", async () => {
    const queuedStatus: SessionStatus = {
      ...status(oldSession.id),
      isStreaming: true,
      pendingMessageCount: 2,
      queuedMessages: [
        { kind: "steer", text: "adjust course" },
        { kind: "followUp", text: "then summarize" },
      ],
    };
    const clearedStatus: SessionStatus = { ...queuedStatus, pendingMessageCount: 0, queuedMessages: [] };
    const clientQueuedSends = [{ kind: "followUp" as const, text: "waiting for session creation" }];
    const clearCalls: { sessionId: string; machineId: string }[] = [];
    const state: AppState = {
      ...initialAppState(),
      selectedMachine: machine("remote-a"),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: queuedStatus,
      sessionStatuses: { [oldSession.id]: queuedStatus },
      clientQueuedSessionMessages: { [oldSession.id]: clientQueuedSends },
    };
    const api = {
      clearQueue: (session, machineId) => {
        clearCalls.push({ sessionId: sessionLookupId(session), machineId: machineId ?? "local" });
        return Promise.resolve(clearedStatus);
      },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    await controller.clearServerQueue();

    expect(clearCalls).toEqual([{ sessionId: oldSession.id, machineId: "remote-a" }]);
    expect(fixture.state.status).toEqual(clearedStatus);
    expect(fixture.state.sessionStatuses[oldSession.id]).toEqual(clearedStatus);
    expect(fixture.state.clientQueuedSessionMessages[oldSession.id]).toBe(clientQueuedSends);
  });

  it("does not apply a response after another session is selected", async () => {
    const request = deferred<SessionStatus>();
    const oldStatus: SessionStatus = { ...status(oldSession.id), pendingMessageCount: 1, queuedMessages: [{ kind: "followUp", text: "old queue" }] };
    const replacementStatus: SessionStatus = { ...status(replacementSession.id), pendingMessageCount: 3, queuedMessages: [{ kind: "steer", text: "new queue" }] };
    const state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession, replacementSession],
      status: oldStatus,
      sessionStatuses: { [oldSession.id]: oldStatus, [replacementSession.id]: replacementStatus },
    };
    const api = { clearQueue: () => request.promise } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller, replaceState } = fixture;

    const clearing = controller.clearServerQueue();
    replaceState({ ...fixture.state, selectedSession: replacementSession, status: replacementStatus });
    request.resolve({ ...oldStatus, pendingMessageCount: 0, queuedMessages: [] });
    await clearing;

    expect(fixture.state.status).toBe(replacementStatus);
    expect(fixture.state.sessionStatuses[oldSession.id]).toBe(oldStatus);
    expect(fixture.state.sessionStatuses[replacementSession.id]).toBe(replacementStatus);
  });

  it("does not apply a response after the selected machine changes", async () => {
    const request = deferred<SessionStatus>();
    const machineBStatus: SessionStatus = { ...status(oldSession.id), pendingMessageCount: 4, queuedMessages: [{ kind: "followUp", text: "machine B queue" }] };
    const state: AppState = {
      ...initialAppState(),
      selectedMachine: machine("remote-a"),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: status(oldSession.id),
      sessionStatuses: { [oldSession.id]: status(oldSession.id) },
    };
    const api = { clearQueue: () => request.promise } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller, replaceState } = fixture;

    const clearing = controller.clearServerQueue();
    replaceState({
      ...fixture.state,
      selectedMachine: machine("remote-b"),
      status: machineBStatus,
      sessionStatuses: { [oldSession.id]: machineBStatus },
    });
    request.resolve(status(oldSession.id));
    await clearing;

    expect(fixture.state.status).toBe(machineBStatus);
    expect(fixture.state.sessionStatuses[oldSession.id]).toBe(machineBStatus);
  });

  it("reports queue-clear failures through the application error state", async () => {
    const queuedStatus: SessionStatus = { ...status(oldSession.id), pendingMessageCount: 1, queuedMessages: [{ kind: "steer", text: "keep me" }] };
    const state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: queuedStatus,
      sessionStatuses: { [oldSession.id]: queuedStatus },
    };
    const api = { clearQueue: () => Promise.reject(new Error("queue clear failed")) } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    await controller.clearServerQueue();

    expect(Object.values(fixture.state.browserErrors).map((error) => error.message)).toContain("Error: queue clear failed");
    expect(fixture.state.status).toBe(queuedStatus);
  });

  it("does not send a server clear for a client-pending session or discard its queued sends", async () => {
    const pendingSession = { ...oldSession, id: "pending-session", clientPendingStart: true as const, machineId: "local" };
    const clientQueuedSends = [{ kind: "followUp" as const, text: "send after creation" }];
    let clearCalls = 0;
    const state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: pendingSession,
      sessions: [pendingSession],
      clientQueuedSessionMessages: { [pendingSession.id]: clientQueuedSends },
    };
    const api = {
      clearQueue: () => {
        clearCalls += 1;
        return Promise.resolve(status(pendingSession.id));
      },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    await controller.clearServerQueue();

    expect(clearCalls).toBe(0);
    expect(fixture.state.clientQueuedSessionMessages[pendingSession.id]).toBe(clientQueuedSends);
  });
});
