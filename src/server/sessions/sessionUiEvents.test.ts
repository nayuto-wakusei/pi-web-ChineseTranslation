import { describe, expect, it } from "vitest";
import { toClientEvent } from "./sessionUiEvents.js";

describe("toClientEvent", () => {
  it("keeps top-level array tool args compatible with the legacy summary behavior", () => {
    const args = ["alpha", 2, true];
    const event = toClientEvent({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "call-1",
      args,
    });

    if (event.type !== "tool.start") throw new Error("expected tool.start");
    expect(event.args).toEqual(args);
    expect(event.summary).toContain("0: alpha");
    expect(event.summary).toContain("1: 2");
    expect(event.summary).toContain("2: true");
  });

  it("keeps top-level array tool results rendered as joined text and raw content", () => {
    const result = [
      { type: "text", text: "first" },
      "second",
      { output: "third" },
    ];
    const event = toClientEvent({
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-2",
      result,
      isError: false,
    });

    if (event.type !== "tool.end") throw new Error("expected tool.end");
    expect(event.text).toBe("first\nsecond\nthird");
    expect(event.content).toEqual(result);
    expect(event.details).toBeUndefined();
  });
});
