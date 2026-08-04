// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionStatus } from "../../../shared/apiTypes";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView queued messages", () => {
  it("keeps a newly queued server message visible while the live transcript is pinned to the bottom", async () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    document.body.append(view);
    await view.updateComplete;

    let bottomScrolls = 0;
    if (!Reflect.set(view, "scrollToBottom", () => { bottomScrolls += 1; })) throw new Error("Could not observe ChatView.scrollToBottom");

    view.status = queuedStatus("Continue after this response");
    view.pendingMessageCount = 1;
    await view.updateComplete;

    expect(bottomScrolls).toBe(1);
    const queuedText = view.shadowRoot?.querySelector("formatted-text");
    expect(queuedText).not.toBeNull();
    expect(Reflect.get(queuedText ?? {}, "text")).toBe("Continue after this response");
  });
});

function queuedStatus(text: string): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 1,
    queuedMessages: [{ kind: "followUp", text }],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}
