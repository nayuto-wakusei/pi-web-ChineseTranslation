import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { setClientTranslations } from "../i18n";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { machineSessionKey } from "../machineKeys";
import { SessionController, type SessionControllerDependencies } from "./sessionController";
import { defaultApi, deferred, FakeSocket, MemoryStorage, oldSession, replacementSession, status, workspace, type AppState, type SessionInfo, type SessionStatus } from "./sessionController.testSupport";

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  setClientTranslations("en", {});
});

const queue = () => [{ kind: "followUp" as const, text: "recall text", hasAttachments: true, attachmentCount: 2 }];
const originKey = machineSessionKey("local", oldSession.id);

function setup(options: { gate?: "absent" | false; unavailable?: string; session?: SessionInfo; replace?: SessionControllerDependencies["replacePromptEditorText"] } = {}) {
  const selected = options.session ?? oldSession;
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: selected, sessions: [selected], status: {
    ...status(selected.id), ...(options.unavailable === undefined ? {} : { queueMessageActionsUnavailable: options.unavailable }),
  } };
  let allowed = options.gate !== false;
  const request = deferred<SessionStatus>();
  const mutateQueuedMessage = vi.fn<typeof defaultApi.mutateQueuedMessage>(() => request.promise);
  const replacePromptEditorText = vi.fn<NonNullable<SessionControllerDependencies["replacePromptEditorText"]>>(options.replace ?? (() => undefined));
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
    api: { ...defaultApi, mutateQueuedMessage }, socket: new FakeSocket(), replacePromptEditorText,
    ...(options.gate === "absent" ? {} : { canMutateQueueMessage: () => allowed }),
  });
  return { controller, request, mutateQueuedMessage, replacePromptEditorText, state: () => state,
    patch: (patch: Partial<AppState>) => { state = { ...state, ...patch }; }, revoke: () => { allowed = false; } };
}

describe("queue mutation scope and capability", () => {
  it.each(["absent", false] as const)("does not mutate when the capability gate is %s", async (gate) => {
    const test = setup({ gate });
    await test.controller.mutateQueuedMessage("edit", 0, queue());
    expect(test.mutateQueuedMessage).not.toHaveBeenCalled();
  });

  it.each(["", "SDK layout unsupported"])("refuses an explicitly unavailable SDK even for reason %j", async (unavailable) => {
    const test = setup({ unavailable });
    await test.controller.mutateQueuedMessage("toggle", 0, queue());
    expect(test.mutateQueuedMessage).not.toHaveBeenCalled();
  });

  it("refuses archived, pending-start, invalid-index and disposed targets", async () => {
    const archived = setup({ session: { ...oldSession, archived: true } });
    await archived.controller.mutateQueuedMessage("edit", 0, queue());
    expect(archived.mutateQueuedMessage).not.toHaveBeenCalled();
    const pending = setup({ session: { ...oldSession, ...{ clientPendingStart: true, machineId: "local" } } });
    await pending.controller.mutateQueuedMessage("edit", 0, queue());
    expect(pending.mutateQueuedMessage).not.toHaveBeenCalled();
    const invalid = setup();
    await invalid.controller.mutateQueuedMessage("edit", -1, queue());
    await invalid.controller.mutateQueuedMessage("edit", 1, queue());
    invalid.controller.dispose();
    await invalid.controller.mutateQueuedMessage("edit", 0, queue());
    expect(invalid.mutateQueuedMessage).not.toHaveBeenCalled();
  });

  it("captures the expected structure and recall text before awaiting the API", async () => {
    const test = setup();
    const input = queue();
    const pending = test.controller.mutateQueuedMessage("edit", 0, input);
    const first = input[0];
    if (first === undefined) throw new Error("Expected initial queue message");
    first.text = "changed by caller";
    input.push({ kind: "followUp", text: "later", hasAttachments: false, attachmentCount: 0 });
    expect(test.mutateQueuedMessage.mock.calls[0]?.[1]).toEqual({ action: "edit", index: 0, expectedQueue: queue() });
    test.request.resolve(status(oldSession.id));
    await pending;
    expect(loadDraft(originKey)).toBe("recall text");
    expect(test.replacePromptEditorText.mock.calls[0]?.[0].text).toBe("recall text");
    expect(test.replacePromptEditorText.mock.calls[0]?.[0].isCurrent?.()).toBe(true);
  });

  it("keeps a successful background recall under its original machine key", async () => {
    const test = setup();
    const remote = { id: "remote", name: "Remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
    const remoteKey = machineSessionKey(remote.id, oldSession.id);
    saveDraft(remoteKey, "remote draft");
    const pending = test.controller.mutateQueuedMessage("edit", 0, queue());
    test.patch({ selectedMachine: remote, status: { ...status(oldSession.id), pendingMessageCount: 9 } });
    test.request.resolve(status(oldSession.id));
    await pending;
    expect(loadDraft(originKey)).toBe("recall text");
    expect(loadDraft(remoteKey)).toBe("remote draft");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
    expect(test.state().status?.pendingMessageCount).toBe(9);
  });

  it.each(["cwd", "path"] as const)("preserves the colliding draft key when the same id changes %s", async (field) => {
    const test = setup();
    saveDraft(originKey, "current context draft");
    const pending = test.controller.mutateQueuedMessage("edit", 0, queue());
    test.patch({ selectedSession: { ...oldSession, [field]: "/another/context" }, status: { ...status(oldSession.id), pendingMessageCount: 9 } });
    test.request.resolve(status(oldSession.id));
    await pending;
    expect(loadDraft(originKey)).toBe("current context draft");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
    expect(test.state().status?.pendingMessageCount).toBe(9);
    expect(Object.values(test.state().browserErrors).map((error) => error.message).join("\n")).toContain("conversation context changed");
    expect(test.mutateQueuedMessage).toHaveBeenCalledOnce();
  });

  it("does not restore a stale composer after A to B to A reselection", async () => {
    const test = setup();
    const pending = test.controller.mutateQueuedMessage("edit", 0, queue());
    await test.controller.selectSession(replacementSession, { deferChatLoading: true, updateUrl: false });
    await test.controller.selectSession(oldSession, { deferChatLoading: true, updateUrl: false });
    test.request.resolve(status(oldSession.id));
    await pending;
    expect(loadDraft(originKey)).toBe("recall text");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
  });

  it.each(["mismatch", "revoked", "disposed", "rejected"] as const)("does not refill or retry when a request is %s", async (outcome) => {
    const test = setup();
    saveDraft(originKey, "unsent draft");
    const pending = test.controller.mutateQueuedMessage("edit", 0, queue());
    if (outcome === "revoked") test.revoke();
    if (outcome === "disposed") test.controller.dispose();
    if (outcome === "rejected") test.request.reject(new Error("Queue changed"));
    else test.request.resolve(status(outcome === "mismatch" ? replacementSession.id : oldSession.id));
    await pending;
    expect(loadDraft(originKey)).toBe("unsent draft");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
    expect(test.mutateQueuedMessage).toHaveBeenCalledOnce();
  });

  it("lets the host recheck scope after its own asynchronous render wait", async () => {
    const waiting = deferred<undefined>();
    const writes: string[] = [];
    const test = setup({ replace: async (replacement) => {
      expect(replacement.isCurrent?.()).toBe(true);
      await waiting.promise;
      if (replacement.isCurrent?.() !== false) writes.push(replacement.text);
    } });
    const pending = test.controller.mutateQueuedMessage("edit", 0, queue());
    test.request.resolve(status(oldSession.id));
    await vi.waitFor(() => { expect(test.replacePromptEditorText).toHaveBeenCalledOnce(); });
    test.patch({ selectedSession: { ...oldSession, path: "/another/file.jsonl" }, status: { ...status(oldSession.id), pendingMessageCount: 9 } });
    waiting.resolve(undefined);
    await pending;
    expect(writes).toEqual([]);
    expect(test.state().status?.pendingMessageCount).toBe(9);
  });
});
