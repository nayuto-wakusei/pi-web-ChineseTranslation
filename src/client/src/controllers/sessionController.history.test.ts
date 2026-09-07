import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { ChatTranscriptStore } from "../chatTranscriptStore";
import { machineSessionKey } from "../machineKeys";
import { createSessionControllerTestFixture, deferred, oldSession, type MessagePage } from "./sessionController.testSupport";

describe("SessionController earlier history ownership", () => {
  it("does not merge another machine's history or clear its pending load", async () => {
    const pending = deferred<MessagePage>();
    const { fixture, cacheWrite } = createHarness(() => pending.promise);
    const loading = fixture.controller.loadEarlierMessages();
    fixture.replaceState({
      ...fixture.state,
      selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" },
      isLoadingEarlierMessages: true,
    });
    pending.resolve(page("old machine"));
    await loading;

    expect(cacheWrite).not.toHaveBeenCalled();
    expect(fixture.state.messages).toEqual([]);
    expect(fixture.state.isLoadingEarlierMessages).toBe(true);
  });

  it("ignores old history after selecting the same session again", async () => {
    const pending = deferred<MessagePage>();
    const newer = deferred<MessagePage>();
    const messages = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ messages: [], start: 10, total: 10 }).mockReturnValueOnce(newer.promise);
    const { fixture, cacheWrite } = createHarness(messages, true);
    const loading = fixture.controller.loadEarlierMessages();
    await fixture.controller.selectSession({ ...oldSession, archived: true }, { updateUrl: false });
    const newerLoading = fixture.controller.loadEarlierMessages();
    cacheWrite.mockClear();
    pending.resolve(page("old selection"));
    await loading;

    expect(cacheWrite).not.toHaveBeenCalled();
    expect(fixture.state.isLoadingEarlierMessages).toBe(true);
    newer.resolve(page("new selection"));
    await newerLoading;
    expect(fixture.state.isLoadingEarlierMessages).toBe(false);
    expect(cacheWrite).toHaveBeenCalledWith(machineSessionKey("local", oldSession.id), page("new selection"));
  });

  it.each([false, true])("loads earlier history for the current session (archived=%s)", async (archived) => {
    const { fixture, cacheWrite } = createHarness(() => Promise.resolve(page("current")), archived);
    await fixture.controller.loadEarlierMessages();
    expect(cacheWrite).toHaveBeenCalledWith(machineSessionKey("local", oldSession.id), page("current"));
    expect(fixture.state.messagePageStart).toBe(0);
    expect(fixture.state.messages).toHaveLength(1);
    expect(fixture.state.isLoadingEarlierMessages).toBe(false);
  });

  it("ignores stale errors without clearing the new selection's loading flag", async () => {
    const pending = deferred<MessagePage>();
    const { fixture } = createHarness(() => pending.promise);
    const loading = fixture.controller.loadEarlierMessages();
    fixture.replaceState({ ...fixture.state, selectedSession: { ...oldSession, cwd: "/other" } });
    pending.reject(new Error("stale history error"));
    await loading;
    expect(fixture.state.browserErrors).toEqual({});
    expect(fixture.state.isLoadingEarlierMessages).toBe(true);
  });
});

function createHarness(messages: () => Promise<MessagePage>, archived = false) {
  const cacheWrite = vi.fn();
  const transcripts = new ChatTranscriptStore({ read: () => undefined, write: cacheWrite });
  const fixture = createSessionControllerTestFixture({
    initialState: { ...initialAppState(), selectedSession: { ...oldSession, archived }, messagePageStart: 10 },
    api: { messages },
    dependencies: { transcripts },
  });
  return { fixture, cacheWrite };
}

function page(text: string): MessagePage {
  return { messages: [{ role: "assistant", content: text }], start: 0, total: 10 };
}
