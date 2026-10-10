import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { markCachedNewSessionInfo } from "../cachedNewSessions";
import { SessionController } from "./sessionController";
import { createSessionControllerTestFixture, defaultApi, deferred, emptyPage, FakeSocket, oldSession, replacementSession, status, workspace, type AppState, type MessagePage } from "./sessionController.testSupport";
import type { NavigationFreshness, NavigationSelection } from "./types";

const project = { id: workspace.projectId, name: "repo", path: workspace.path, createdAt: "now" };
const selectedState = () => ({ ...initialAppState(), selectedProject: project, selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] });
const expected: NavigationSelection = { machineId: "local", projectId: project.id, workspaceId: workspace.id, sessionId: oldSession.id, view: "chat" };
const fresh = (isCurrent: () => boolean): NavigationFreshness => ({ generation: 1, scope: ["machine", "project", "workspace", "session"], isCurrent });

describe("SessionController navigation ownership", () => {
  it("does not begin a retired selection", async () => {
    const messages = vi.fn();
    const fixture = createSessionControllerTestFixture({ api: { messages } });
    await fixture.controller.selectSession(oldSession, { navigation: fresh(() => false) });
    expect(fixture.state.selectedSession).toBeUndefined();
    expect(messages).not.toHaveBeenCalled();
    fixture.controller.dispose();
  });

  it("retires a pending join before a newer route has reached the controller", async () => {
    let current = true;
    const page = deferred<MessagePage>();
    const socket = new FakeSocket();
    const close = vi.spyOn(socket, "close");
    const setHandler = vi.spyOn(socket, "setHandler");
    const onSelectedSessionReady = vi.fn();
    const fixture = createSessionControllerTestFixture({
      initialState: selectedState(), socket,
      api: { messages: () => page.promise, status: () => Promise.resolve(status(oldSession.id)), streamSnapshot: () => Promise.resolve({ seq: 1, partial: null }) },
      dependencies: { onSelectedSessionReady },
    });
    const selecting = fixture.controller.selectSession(oldSession, { navigation: fresh(() => current) });
    await Promise.resolve();
    current = false;
    page.resolve({ messages: [{ role: "user", content: "retired transcript" }], start: 0, total: 1 });
    await selecting;
    expect(fixture.state.messages).toEqual([]);
    expect(onSelectedSessionReady).not.toHaveBeenCalled();
    expect(setHandler).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(2);
    fixture.controller.dispose();
  });

  it("does not close the replacement selection's socket when an older join retires", async () => {
    let current = true;
    const first = deferred<MessagePage>();
    const socket = new FakeSocket();
    const close = vi.spyOn(socket, "close");
    const fixture = createSessionControllerTestFixture({
      initialState: selectedState(), socket,
      api: { messages: (session) => session.id === oldSession.id ? first.promise : Promise.resolve(emptyPage), status: (session) => Promise.resolve(status(session.id)), streamSnapshot: () => Promise.resolve({ seq: 1, partial: null }) },
    });
    const selecting = fixture.controller.selectSession(oldSession, { navigation: fresh(() => current) });
    await Promise.resolve();
    current = false;
    await fixture.controller.selectSession(replacementSession);
    first.resolve(emptyPage);
    await selecting;
    expect(fixture.state.selectedSession?.id).toBe(replacementSession.id);
    expect(close).toHaveBeenCalledTimes(2);
    fixture.controller.dispose();
  });

  it("does not apply an archived transcript after selection ownership is retired", async () => {
    let current = true;
    const page = deferred<MessagePage>();
    const fixture = createSessionControllerTestFixture({ initialState: selectedState(), api: { messages: () => page.promise } });
    const selecting = fixture.controller.selectSession({ ...oldSession, archived: true }, { navigation: fresh(() => current) });
    current = false;
    page.resolve({ messages: [{ role: "user", content: "old archive" }], start: 0, total: 1 });
    await selecting;
    expect(fixture.state.messages).toEqual([]);
    fixture.controller.dispose();
  });

  it("routes archive fallback through the navigator without directly selecting it", async () => {
    const next = { ...replacementSession, persisted: true };
    const navigateToSession = vi.fn().mockResolvedValue(false);
    const fixture = createSessionControllerTestFixture({
      initialState: { ...selectedState(), sessions: [{ ...oldSession, persisted: true }, next] },
      api: { archive: vi.fn().mockResolvedValue({ archived: true }) },
      dependencies: { navigateToSession, captureNavigation: () => expected },
    });
    await fixture.controller.archiveSession();
    expect(navigateToSession).toHaveBeenCalledWith(next, { expected });
    expect(fixture.state.selectedSession?.id).toBe(oldSession.id);
    expect(fixture.state.sessions[0]?.archived).toBe(true);
    fixture.controller.dispose();
  });

  it("settles a created session but clears a rejected temporary selection", async () => {
    const creation = deferred<typeof replacementSession>();
    const navigateToSession = vi.fn().mockResolvedValue(false);
    const fixture = createSessionControllerTestFixture({
      initialState: selectedState(), api: { startSession: () => creation.promise },
      dependencies: { navigateToSession, captureNavigation: () => expected, beginNavigationOperation: () => fresh(() => false) },
    });
    const starting = fixture.controller.startSession();
    const tempId = fixture.state.selectedSession?.id;
    creation.resolve(replacementSession);
    await starting;
    expect(navigateToSession).toHaveBeenCalledWith(expect.objectContaining({ id: replacementSession.id }), { replace: true, creationHandoff: true, expected: { machineId: "local", projectId: project.id, workspaceId: workspace.id, sessionId: tempId } });
    expect(fixture.state.sessions.some((session) => session.id === replacementSession.id)).toBe(true);
    expect(fixture.state.selectedSession).toBeUndefined();
    fixture.controller.dispose();
  });

  it("does not apply a restore completion to a newer navigation selection", async () => {
    let current = true;
    const restored = deferred<{ restored: true }>();
    const archived = { ...oldSession, archived: true };
    const fixture = createSessionControllerTestFixture({
      initialState: { ...selectedState(), selectedSession: archived, sessions: [archived] },
      api: { restore: () => restored.promise },
      dependencies: { beginNavigationOperation: () => fresh(() => current) },
    });
    const restoring = fixture.controller.restoreSession();
    current = false;
    restored.resolve({ restored: true });
    await restoring;
    expect(fixture.state.selectedSession?.archived).toBe(true);
    fixture.controller.dispose();
  });

  it("retires an unpublished start without a navigator when the hierarchy changed", async () => {
    let current = true;
    const creation = deferred<typeof replacementSession>();
    const fixture = createSessionControllerTestFixture({
      initialState: selectedState(), api: { startSession: () => creation.promise },
      dependencies: { captureNavigation: () => expected, beginNavigationOperation: () => fresh(() => current) },
    });
    const starting = fixture.controller.startSession({ updateUrl: false });
    current = false;
    creation.resolve(replacementSession);
    await starting;
    expect(fixture.state.selectedSession).toBeUndefined();
    expect(fixture.state.sessions.some((session) => session.id === replacementSession.id)).toBe(true);
    fixture.controller.dispose();
  });

  it("retains a selection-owned restore through a surface-only change without rewriting URL", async () => {
    const archived = { ...oldSession, archived: true };
    let state: AppState = { ...selectedState(), selectedSession: archived, sessions: [archived] };
    const updateUrl = vi.fn();
    const restore = deferred<{ restored: true }>();
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, updateUrl, undefined, {
      api: { ...defaultApi, restore: () => restore.promise, messages: () => Promise.resolve(emptyPage), status: () => Promise.resolve(status(oldSession.id)), streamSnapshot: () => Promise.resolve({ seq: 1, partial: null }) },
      socket: new FakeSocket(), beginNavigationOperation: () => fresh(() => true),
    });
    const restoring = controller.restoreSession();
    restore.resolve({ restored: true });
    await restoring;
    expect(state.selectedSession?.archived).toBeUndefined();
    expect(updateUrl).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("retains a durable cached replacement but does not overwrite a newer route", async () => {
    const cached = markCachedNewSessionInfo(oldSession);
    const navigateToSession = vi.fn().mockResolvedValue(false);
    const fixture = createSessionControllerTestFixture({
      initialState: { ...selectedState(), selectedSession: cached, sessions: [cached] },
      api: { messages: vi.fn().mockRejectedValue(new Error("Session not found")), status: () => Promise.resolve(status(oldSession.id)), streamSnapshot: () => Promise.resolve({ seq: 1, partial: null }), startSession: () => Promise.resolve(replacementSession) },
      dependencies: { navigateToSession, captureNavigation: () => expected },
    });
    await fixture.controller.selectSession(cached);
    expect(navigateToSession).toHaveBeenCalledWith(expect.objectContaining({ id: replacementSession.id }), { expected });
    expect(fixture.state.sessions.some((session) => session.id === replacementSession.id)).toBe(true);
    expect(fixture.state.selectedSession).toBeUndefined();
    fixture.controller.dispose();
  });
});
