// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMessages } from "../chatMessages";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ChatView durable message actions", () => {
  it("blocks disabled and concurrent actions and reports asynchronous failures", async () => {
    vi.stubGlobal("confirm", () => true);
    let rejectAction: ((error: Error) => void) | undefined;
    const onMessageAction = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectAction = reject; }));
    const view = new ChatView();
    view.sessionId = "session";
    view.onMessageAction = onMessageAction;
    view.messages = [{ role: "user", entryId: "entry", parts: [{ type: "text", text: "question" }] }];
    view.messageActionsDisabled = true;
    document.body.append(view);
    await view.updateComplete;
    const fork = () => view.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="分叉"]');
    fork()?.click();
    expect(onMessageAction).not.toHaveBeenCalled();
    view.messageActionsDisabled = false;
    await view.updateComplete;
    fork()?.click();
    fork()?.click();
    expect(onMessageAction).toHaveBeenCalledOnce();
    rejectAction?.(new Error("fork rejected"));
    await view.updateComplete;
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector('[role="alert"]')?.textContent).toBe("fork rejected");
    expect(fork()?.disabled).toBe(false);
  });

  it("scopes render intent by machine, durable entry and part ordinal", async () => {
    const view = new ChatView();
    view.sessionId = "session";
    view.machineId = "remote";
    view.messages = [{ role: "user", entryId: "entry", parts: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }];
    document.body.append(view);
    await view.updateComplete;
    const identities = [...view.shadowRoot?.querySelectorAll<HTMLElement & { intentKey?: string }>("formatted-text") ?? []].map((element) => element.intentKey);
    expect(identities).toEqual([JSON.stringify(["remote", "session", "entry", 0]), JSON.stringify(["remote", "session", "entry", 1])]);
  });
  it("renders grouped history actions and forwards the durable ID after confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onMessageAction = vi.fn();
    const view = new ChatView();
    view.sessionId = "session-1";
    view.onMessageAction = onMessageAction;
    view.messages = normalizeMessages([
      { role: "user", entryId: "user-entry", content: "question" },
      { role: "assistant", entryId: "assistant-entry", content: [{ type: "thinking", thinking: "plan" }, { type: "text", text: "answer" }] },
    ]);
    document.body.append(view);
    await view.updateComplete;
    const actions = view.shadowRoot?.querySelectorAll<HTMLButtonElement>('.msg button[aria-label="分叉"]');
    expect(actions?.length).toBe(2);
    actions?.[0]?.click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(onMessageAction).toHaveBeenCalledWith("user-entry", "fork");
    await view.updateComplete;
    await view.updateComplete;

    const back = view.shadowRoot?.querySelectorAll<HTMLButtonElement>('.msg button[aria-label="回退"]');
    back?.[1]?.click();
    expect(onMessageAction).toHaveBeenCalledWith("assistant-entry", "back");
    await view.updateComplete;
    await view.updateComplete;
    confirm.mockReturnValue(false);
    actions?.[0]?.click();
    expect(onMessageAction).toHaveBeenCalledTimes(2);
  });
});
