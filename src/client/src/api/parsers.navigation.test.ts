import { expect, it } from "vitest";
import { parseRealtimeStreamEvent, parseSessionInfo } from "./parsers";

const session = {
  id: "child", path: "/sessions/child.jsonl", cwd: "/workspace",
  created: "2026-01-01", modified: "2026-01-01", messageCount: 0, firstMessage: "",
};

it("preserves verified tracked subsession classification in session rows and creation events", () => {
  expect(parseSessionInfo({ ...session, agentSubsession: true })).toMatchObject({ agentSubsession: true });
  expect(parseSessionInfo(session)).not.toHaveProperty("agentSubsession");
  expect(parseRealtimeStreamEvent({ type: "session.created", session: { ...session, agentSubsession: true } }))
    .toMatchObject({ session: { agentSubsession: true } });
  expect(() => parseSessionInfo({ ...session, agentSubsession: "true" })).toThrow();
});

it("parses project-scoped workspace topology invalidation without accepting malformed identity", () => {
  expect(parseRealtimeStreamEvent({ type: "workspaces.changed", projectId: "project-a" }))
    .toEqual({ type: "workspaces.changed", projectId: "project-a" });
  expect(() => parseRealtimeStreamEvent({ type: "workspaces.changed", projectId: 123 })).toThrow();
  expect(() => parseRealtimeStreamEvent({ type: "workspaces.changed" })).toThrow();
  expect(() => parseRealtimeStreamEvent({ type: "workspaces.changed", projectId: "" })).toThrow();
});
