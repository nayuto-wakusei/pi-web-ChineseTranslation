import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { CommandResult, SessionTranscriptSnapshot, SessionTreeNavigateResult, SessionTreeSnapshot } from "../api";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController, type SessionControllerDependencies } from "./sessionController";
import { defaultApi, deferred, FakeSocket, MemoryStorage, oldSession, replacementSession, status, workspace, type AppState } from "./sessionController.testSupport";

beforeEach(() => { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() }); });

const tree: SessionTreeSnapshot = {
  nodes: [{ id: "root", parentId: null, kind: "user", summary: "original prompt" }, { id: "leaf", parentId: "root", kind: "assistant", summary: "answer" }],
  activeLeafId: "leaf", activePathIds: ["root", "leaf"],
};
const snapshot = (): SessionTranscriptSnapshot => ({ page: { messages: [{ role: "assistant", content: "selected entry" }], start: 0, total: 1 }, status: status(oldSession.id), seq: 0, partial: null });

function setup(options: { result?: SessionTreeNavigateResult | Promise<SessionTreeNavigateResult>; refresh?: Promise<SessionTranscriptSnapshot>; replace?: SessionControllerDependencies["replacePromptEditorText"]; command?: Promise<CommandResult> } = {}) {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession], treeDialog: tree };
  const replacePromptEditorText = vi.fn<NonNullable<SessionControllerDependencies["replacePromptEditorText"]>>(options.replace ?? (() => undefined));
  const transcriptSnapshot = vi.fn<typeof defaultApi.transcriptSnapshot>(() => options.refresh ?? Promise.resolve(snapshot()));
  const navigateTree = vi.fn<typeof defaultApi.navigateTree>(() => Promise.resolve(options.result ?? { cancelled: false }));
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
    api: { ...defaultApi, navigateTree, runCommand: () => options.command ?? Promise.resolve({ type: "tree", tree }), transcriptSnapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) },
    socket: new FakeSocket(), replacePromptEditorText,
  });
  return { controller, replacePromptEditorText, transcriptSnapshot, navigateTree, state: () => state, patch: (patch: Partial<AppState>) => { state = { ...state, ...patch }; } };
}

describe("history navigation draft protection", () => {
  it("preserves the editor draft when navigation returns no editor text", async () => {
    const key = machineSessionKey("local", oldSession.id);
    saveDraft(key, "unsent draft");
    const test = setup();
    await test.controller.navigateTree("leaf", { mode: "none" });
    expect(loadDraft(key)).toBe("unsent draft");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
    expect(test.state().messages[0]?.parts).toEqual([{ type: "text", text: "selected entry" }]);
    expect(test.state().treeDialog).toBeUndefined();
    expect(test.state().pendingTreeActions).toEqual([]);
  });

  it("accepts an explicitly empty editable prompt rather than treating it as missing", async () => {
    const key = machineSessionKey("local", oldSession.id);
    saveDraft(key, "old draft");
    const test = setup({ result: { cancelled: false, editorText: "" } });
    await test.controller.navigateTree("root", { mode: "none" });
    expect(loadDraft(key)).toBe("");
    expect(test.replacePromptEditorText.mock.calls[0]?.[0].text).toBe("");
  });

  it("keeps the busy tree mounted until authoritative history and editor replacement finish", async () => {
    const refresh = deferred<SessionTranscriptSnapshot>();
    const editor = deferred<undefined>();
    const test = setup({ result: { cancelled: false, editorText: "edit original prompt" }, refresh: refresh.promise, replace: () => editor.promise });
    const navigation = test.controller.navigateTree("root", { mode: "none" });
    await vi.waitFor(() => { expect(test.transcriptSnapshot).toHaveBeenCalledOnce(); });
    expect(test.replacePromptEditorText).toHaveBeenCalledWith(expect.objectContaining({ machineId: "local", sessionId: oldSession.id, text: "edit original prompt" }));
    expect(test.replacePromptEditorText.mock.calls[0]?.[0].isCurrent?.()).toBe(true);
    expect(test.state().pendingTreeActions).toEqual([{ machineId: "local", sessionId: oldSession.id }]);
    refresh.resolve(snapshot());
    await vi.waitFor(() => { expect(test.state().messages[0]?.parts).toEqual([{ type: "text", text: "selected entry" }]); });
    expect(test.state().treeDialog).toBe(tree);
    expect(test.state().pendingTreeActions).toHaveLength(1);
    editor.resolve(undefined);
    await navigation;
    expect(test.state().treeDialog).toBeUndefined();
    expect(test.state().pendingTreeActions).toEqual([]);
  });

  it("retains the navigator when live prompt-editor replacement fails but refresh still completes", async () => {
    const test = setup({ result: { cancelled: false, editorText: "recovered draft" }, replace: () => Promise.reject(new Error("prompt editor replacement failed")) });
    await expect(test.controller.navigateTree("root", { mode: "none" })).rejects.toThrow("prompt editor replacement failed");
    expect(test.state().messages[0]?.parts).toEqual([{ type: "text", text: "selected entry" }]);
    expect(test.state().treeDialog).toBe(tree);
    expect(test.state().pendingTreeActions).toEqual([]);
    expect(loadDraft(machineSessionKey("local", oldSession.id))).toBe("recovered draft");
  });

  it("retains the navigator and recovered text when the authoritative refresh fails", async () => {
    const test = setup({ result: { cancelled: false, editorText: "recovered draft" }, refresh: Promise.reject(new Error("refresh failed")) });
    await expect(test.controller.navigateTree("root", { mode: "none" })).rejects.toThrow("refresh failed");
    expect(test.replacePromptEditorText).toHaveBeenCalledOnce();
    expect(test.state().treeDialog).toBe(tree);
    expect(test.state().pendingTreeActions).toEqual([]);
    expect(loadDraft(machineSessionKey("local", oldSession.id))).toBe("recovered draft");
  });

  it("invalidates a delayed host editor update when its selection changes during rendering", async () => {
    const editor = deferred<undefined>();
    const writes: string[] = [];
    const test = setup({ result: { cancelled: false, editorText: "old context text" }, replace: async (replacement) => {
      await editor.promise;
      if (replacement.isCurrent?.() !== false) writes.push(replacement.text);
    } });
    const navigation = test.controller.navigateTree("root", { mode: "none" });
    await vi.waitFor(() => { expect(test.replacePromptEditorText).toHaveBeenCalledOnce(); });
    test.patch({ selectedSession: { ...oldSession, path: "/another/file.jsonl" } });
    editor.resolve(undefined);
    await navigation;
    expect(writes).toEqual([]);
    expect(test.state().treeDialog).toBe(tree);
  });

  it("does not overwrite a colliding cwd draft when navigation returns late", async () => {
    const result = deferred<SessionTreeNavigateResult>();
    const test = setup({ result: result.promise });
    const key = machineSessionKey("local", oldSession.id);
    const navigation = test.controller.navigateTree("root", { mode: "none" });
    test.patch({ selectedSession: { ...oldSession, cwd: "/another/workspace" } });
    saveDraft(key, "new context draft");
    result.resolve({ cancelled: false, editorText: "old context text" });
    await navigation;
    expect(loadDraft(key)).toBe("new context draft");
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
    expect(test.transcriptSnapshot).not.toHaveBeenCalled();
  });

  it.each(["cwd", "reselection"] as const)("does not mutate history after a stale message-action lookup (%s)", async (change) => {
    const command = deferred<CommandResult>();
    const test = setup({ command: command.promise });
    const action = test.controller.actOnMessage("root", "back");
    if (change === "cwd") test.patch({ selectedSession: { ...oldSession, cwd: "/different/context" } });
    else {
      await test.controller.selectSession(replacementSession, { deferChatLoading: true, updateUrl: false });
      await test.controller.selectSession(oldSession, { deferChatLoading: true, updateUrl: false });
    }
    command.resolve({ type: "tree", tree });
    await action;
    expect(test.navigateTree).not.toHaveBeenCalled();
    expect(test.replacePromptEditorText).not.toHaveBeenCalled();
  });
});
