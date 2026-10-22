import { beforeEach, describe, expect, it } from "vitest";
import { setClientTranslations } from "./i18n";
import { queuedMessageAttachmentLabel, queuedMessageRecallConfirmation } from "./queuedMessageActions";

beforeEach(() => { setClientTranslations("en", {}); });

describe("queued message action copy", () => {
  const messages = [{ kind: "steer" as const, text: "first" }, { kind: "steer" as const, text: "second" }, { kind: "followUp" as const, text: "last" }];

  it("confirms clearing later messages without an attachment warning for text-only recall", () => {
    expect(queuedMessageRecallConfirmation(messages, 0)).toBe("Recall this message?\n\nThis will also remove 1 later steer and 1 queued follow-up.");
    expect(queuedMessageRecallConfirmation(messages, 1)).toBe("Recall this message?\n\nThis will also remove 1 queued follow-up.");
    expect(queuedMessageRecallConfirmation(messages, 2)).toBeUndefined();
  });

  it("warns about attachment loss only on the recalled message", () => {
    const attached = messages.map((message, index) => ({ ...message, hasAttachments: index === 2 }));
    expect(queuedMessageRecallConfirmation(attached, 0)).not.toContain("attachments");
    expect(queuedMessageRecallConfirmation(attached, 2)).toBe("Recall this message? Only its text will return to the composer. Its attachments will be lost.");
    expect(queuedMessageRecallConfirmation([{ kind: "steer", text: "attached", hasAttachments: true }, { kind: "followUp", text: "later" }], 0)).toBe("Recall this message? Only its text will return to the composer. Its attachments will be lost.\n\nThis will also remove 1 queued follow-up.");
  });

  it("labels counted and legacy attachments without adding user text", () => {
    expect(queuedMessageAttachmentLabel({ kind: "steer", text: "user text" })).toBeUndefined();
    expect(queuedMessageAttachmentLabel({ kind: "steer", text: "", attachmentCount: 1 })).toBe("1 attachment");
    expect(queuedMessageAttachmentLabel({ kind: "steer", text: "", attachmentCount: 2 })).toBe("2 attachments");
    expect(queuedMessageAttachmentLabel({ kind: "steer", text: "", hasAttachments: true })).toBe("Attachments");
  });
});
