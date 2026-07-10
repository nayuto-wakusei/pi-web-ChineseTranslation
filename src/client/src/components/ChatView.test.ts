import { describe, expect, it } from "vitest";
import { chatQueuedMessageSections } from "./ChatView";

describe("chatQueuedMessageSections", () => {
  it("labels client-side pending-start sends separately from server queued messages", () => {
    const sections = chatQueuedMessageSections(
      [{ kind: "followUp", text: "queued before start" }],
      [{ kind: "steer", text: "server queued" }],
    );

    expect(sections).toEqual([
      {
        heading: "等待会话启动",
        detail: "后端会话准备好后将自动发送",
        messages: [{ kind: "followUp", text: "queued before start" }],
      },
      {
        heading: "排队消息",
        detail: "1 条待处理 · 停止会清空队列",
        messages: [{ kind: "steer", text: "server queued" }],
      },
    ]);
  });
});
