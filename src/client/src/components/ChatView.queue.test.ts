// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../../../shared/apiTypes";
import { ChatView } from "./ChatView";
import { controlledChatViewport } from "./chatScroll.testSupport";
import { installDeferredContent, settleDeferredContent } from "../formatting/deferredContent.testSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatView queued messages", () => {
  it("keeps a newly queued server message visible while the live transcript is pinned to the bottom", async () => {
    installDeferredContent();
    const view = new ChatView();
    view.sessionId = "session-1";
    document.body.append(view);
    await view.updateComplete;

    const { metrics, write } = controlledChatViewport(view);
    await settleDeferredContent(view);
    write.mockClear();
    metrics.height = 2400;

    view.status = queuedStatus("Continue after this response");
    view.pendingMessageCount = 1;
    await view.updateComplete;

    await settleDeferredContent(view);
    expect(write).toHaveBeenCalledExactlyOnceWith(2400);
    expect(metrics.top).toBe(2100);
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
