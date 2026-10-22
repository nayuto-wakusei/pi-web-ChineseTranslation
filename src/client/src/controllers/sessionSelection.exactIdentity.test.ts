import { expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { selectPreferredSession } from "./sessionSelection";

function testSession(id: string): SessionInfo { return { id, path: "/repo/"+id, cwd: "/repo", created: "now", modified: "now", messageCount: 0, firstMessage: "" }; }

  it.each([false, true])("rejects partial target IDs without falling back to a remembered session (archived: %s)", (archived) => {
    const session = { ...testSession("abcdef"), archived };

    for (const targetSessionId of ["abc", "abcde", "abcdefg", "ABCDEF"]) {
      expect(selectPreferredSession([session], { targetSessionId, latestSessionId: session.id })).toBeUndefined();
    }
  });

  it("selects an exact ID even when an earlier session shares that prefix", () => {
    const exact = testSession("abc");

    expect(selectPreferredSession([testSession("abcdef"), exact], { targetSessionId: "abc" })).toBe(exact);
  });
