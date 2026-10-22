import { describe, expect, it } from "vitest";
import { groupChatMessages, groupConsecutiveImageOutputs } from "./chatGroups";
import type { ChatLine } from "./chatTypes";

describe("presentation projections retain transcript identity", () => {
  it("preserves stream and raw entry positions on readable and technical slices", () => {
    const groups = groupChatMessages([{
      role: "assistant", streamId: "stream", entryId: "entry", transcriptIndex: 41,
      parts: [{ type: "thinking", text: "reason" }, { type: "text", text: "reply" }],
    }], 8);
    expect(groups).toHaveLength(2);
    const lines = groups.flatMap((group) => group.kind === "group" ? group.messages.map(({ message }) => message) : [group.message]);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatchObject({ streamId: "stream", entryId: "entry", transcriptIndex: 41 });
  });

  it("combines adjoining tool images but not across conversation boundaries", () => {
    const image = (entryId: string): ChatLine => ({ role: "tool", entryId, parts: [{ type: "image", mimeType: "image/png", data: "AQ==" }] });
    const groups = groupConsecutiveImageOutputs(groupChatMessages([
      image("one"), image("two"), { role: "user", parts: [{ type: "text", text: "inspect" }] }, image("three"),
    ]));
    expect(groups.map((group) => group.kind)).toEqual(["tool-images", "message", "tool-images"]);
    const first = groups[0];
    if (first?.kind !== "tool-images") throw new Error("Missing tool image group");
    expect(first.outputs.map((output) => output.message.entryId)).toEqual(["one", "two"]);
  });
});
