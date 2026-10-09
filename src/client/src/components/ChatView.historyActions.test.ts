// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMessages } from "../chatMessages";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ChatView durable message actions", () => {
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

    const back = view.shadowRoot?.querySelectorAll<HTMLButtonElement>('.msg button[aria-label="回退"]');
    back?.[1]?.click();
    expect(onMessageAction).toHaveBeenCalledWith("assistant-entry", "back");
    confirm.mockReturnValue(false);
    actions?.[0]?.click();
    expect(onMessageAction).toHaveBeenCalledTimes(2);
  });
});
