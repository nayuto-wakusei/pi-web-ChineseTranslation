// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(entryId: string | undefined = "entry-1") {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = [{ role: "user", entryId, parts: [{ type: "text", text: "Hello" }] }];
  view.onMessageAction = vi.fn(() => Promise.resolve());
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function button(view: ChatView, index: number): HTMLButtonElement {
  const result = buttons(view)[index];
  if (result === undefined) throw new Error(`Missing message action ${String(index)}`);
  return result;
}

function buttons(view: ChatView) {
  return Array.from(view.renderRoot.querySelectorAll<HTMLButtonElement>(".msg-action"));
}

describe("chat message history shortcuts", () => {
  it.each([
    [0, "fork", "从这条消息分叉出一个新会话？当前会话保持不变。"],
    [1, "back", "回退到这条消息？之后的对话会离开当前分支，未保存的输入不会保留。"],
  ] as const)("confirms shortcut %s before changing history", async (index, action, copy) => {
    const view = await mount();
    expect(buttons(view).map((button) => button.getAttribute("aria-label"))).toEqual([
      "分叉", "回退", "复制用户消息",
    ]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    button(view, index).click();
    expect(confirm).toHaveBeenCalledWith(copy);
    expect(view.onMessageAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    button(view, index).click();
    await view.updateComplete;
    expect(view.onMessageAction).toHaveBeenCalledWith("entry-1", action);
  });

  it("does not offer history shortcuts for messages without a durable entry", async () => {
    const view = await mount();
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "Streaming" }] }];
    await view.updateComplete;
    expect(buttons(view).map((button) => button.title)).toEqual(["复制消息"]);
  });

  it("disables history actions while busy and surfaces failures", async () => {
    const view = await mount();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    view.messageActionsDisabled = true;
    await view.updateComplete;
    button(view, 0).click();
    expect(confirm).not.toHaveBeenCalled();
    expect(button(view, 2).disabled).toBe(false);
    view.messageActionsDisabled = false;
    view.onMessageAction = vi.fn(() => Promise.reject(new Error("History changed")));
    await view.updateComplete;
    button(view, 1).click();
    await view.updateComplete;
    await view.updateComplete;
    expect(view.renderRoot.querySelector('[role="alert"]')?.textContent).toBe("History changed");
  });

  it.each(["machine", "workspace", "session ABA", "disconnect"] as const)("ignores a late history failure after %s changes", async (change) => {
    const view = await mount();
    view.workspaceContext = { machineId: "local", projectId: "p", workspaceId: "w", root: "/first" };
    await view.updateComplete;
    let rejectAction!: (error: Error) => void;
    view.onMessageAction = () => new Promise<void>((_resolve, reject) => { rejectAction = reject; });
    vi.stubGlobal("confirm", () => true);
    button(view, 0).click();
    await view.updateComplete;
    if (change === "machine") view.machineId = "remote";
    else if (change === "workspace") view.workspaceContext = { ...view.workspaceContext, root: "/second" };
    else if (change === "session ABA") {
      view.sessionId = "session-2";
      await view.updateComplete;
      view.sessionId = "session-1";
    } else {
      view.remove();
      document.body.append(view);
    }
    await view.updateComplete;
    rejectAction(new Error("Previous identity failed"));
    await Promise.resolve();
    await view.updateComplete;
    expect(view.renderRoot.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not let an old history completion clear a new identity's pending action", async () => {
    const view = await mount();
    let rejectOld!: (error: Error) => void;
    let finishNew!: () => void;
    const action = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishNew = resolve; }));
    view.onMessageAction = action;
    vi.stubGlobal("confirm", () => true);
    button(view, 0).click();
    await view.updateComplete;
    view.machineId = "remote";
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(false);
    button(view, 1).click();
    await view.updateComplete;
    expect(action).toHaveBeenCalledTimes(2);
    rejectOld(new Error("Old action failed"));
    await Promise.resolve();
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(true);
    expect(view.renderRoot.querySelector('[role="alert"]')).toBeNull();
    finishNew();
    await Promise.resolve();
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(false);
  });
});
