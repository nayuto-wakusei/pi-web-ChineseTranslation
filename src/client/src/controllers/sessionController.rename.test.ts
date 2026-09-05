import { describe, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { createSessionControllerTestFixture, defaultApi, oldSession, workspace } from "./sessionController.testSupport";

describe("SessionController session rename", () => {
  it("renames the requested persisted session without changing the active conversation", async () => {
    const targetSession = { ...oldSession, id: "target-session", path: "/tmp/target-session.jsonl", persisted: true };
    const machine = { id: "remote-1", name: "远程机器", kind: "remote" as const, createdAt: "2026-05-15T00:00:00.000Z", updatedAt: "2026-05-15T00:00:00.000Z" };
    const state: AppState = { ...initialAppState(), selectedMachine: machine, selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession, targetSession] };
    const api = {
      runCommand: (session, text, machineId) => {
        expect(session).toBe(targetSession);
        expect(text).toBe("/name 新名称");
        expect(machineId).toBe(machine.id);
        return Promise.resolve({ type: "done", session: { ...targetSession, name: "新名称" } });
      },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api });
    const { controller } = fixture;

    await controller.renameSession(targetSession, "  新名称  ");

    expect(fixture.state.sessions.find((session) => session.id === targetSession.id)?.name).toBe("新名称");
    expect(fixture.state.selectedSession).toBe(oldSession);
    expect(fixture.state.messages).toEqual([]);
  });

  it("surfaces rename failures without adding a chat message", async () => {
    const targetSession = { ...oldSession, persisted: true };
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: targetSession, sessions: [targetSession] };
    const api = { runCommand: () => Promise.reject(new Error("rename failed")) } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api });
    const { controller } = fixture;

    await controller.renameSession(targetSession, "新名称");

    expect(Object.values(fixture.state.browserErrors).map((error) => error.message)).toContain("Error: rename failed");
    expect(fixture.state.messages).toEqual([]);
  });
});
