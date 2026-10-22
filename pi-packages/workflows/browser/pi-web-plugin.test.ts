import type { PluginActivationContext, PluginRuntimeContext, PluginRuntimeState } from "@chainingintention/pi-web-cn/plugin-api";
import { describe, expect, it, vi } from "vitest";
import plugin from "./pi-web-plugin.js";

// This action contributes only translated text; rendering helpers are unused.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const activation = { translate: (_key: string, fallback: string) => fallback } as PluginActivationContext;
const action = plugin.activate(activation).contributions.actions[0];
if (action === undefined) throw new Error("Worktree action missing");

function context(state: Partial<PluginRuntimeState> = {}, text = "") {
  const runtimeState: PluginRuntimeState = {
    mainView: "chat",
    selectedWorkspace: { id: "tree", projectId: "project", path: "/repo/tree", label: "Feature", isMain: false },
    selectedSession: { id: "session", cwd: "/repo/tree", archived: false, pending: false },
    ...state,
  };
  return {
    state: runtimeState,
    prompt: { getText: () => text, getSelection: () => null, insertText: vi.fn() },
    focusPrompt: vi.fn(),
  } satisfies Pick<PluginRuntimeContext, "state" | "prompt" | "focusPrompt">;
}

describe("Workflows worktree shortcut", () => {
  it("prepares an editable /worktree request in the selected conversation without submitting it", () => {
    const target = context();
    expect(action.enabled(target)).toBe(true);

    action.run(target);

    expect(target.focusPrompt).toHaveBeenCalledOnce();
    expect(target.prompt.insertText).toHaveBeenCalledExactlyOnceWith("/worktree ");
  });

  it.each(["selectedWorkspace", "selectedSession"] as const)("requires %s before editing the prompt", (field) => {
    const target = context();
    if (field === "selectedWorkspace") delete target.state.selectedWorkspace;
    else delete target.state.selectedSession;
    expect(action.enabled(target)).toBe(false);

    action.run(target);

    expect(target.focusPrompt).not.toHaveBeenCalled();
    expect(target.prompt.insertText).not.toHaveBeenCalled();
  });

  it.each([
    { mainView: "workspace" },
    { selectedSession: { id: "archived", cwd: "/repo/tree", archived: true, pending: false } },
    { selectedSession: { id: "pending", cwd: "/repo/tree", archived: false, pending: true } },
  ] satisfies Partial<PluginRuntimeState>[])("does not edit the prompt when the conversation is unavailable: %j", (state) => {
    const target = context(state);
    expect(action.enabled(target)).toBe(false);

    action.run(target);

    expect(target.focusPrompt).not.toHaveBeenCalled();
    expect(target.prompt.insertText).not.toHaveBeenCalled();
  });

  it.each(["existing draft", "/relay implement search", " "])("preserves existing prompt text: %j", (text) => {
    const target = context({}, text);
    expect(action.enabled(target)).toBe(false);

    action.run(target);

    expect(target.prompt.insertText).not.toHaveBeenCalled();
  });
});
