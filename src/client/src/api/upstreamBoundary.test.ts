import { describe, expect, it } from "vitest";
import { parseMessagePage, parseWorkspaceProviderResolution } from "./parsers";
import { parseRealtimeSocketEvent, parseSessionSocketEvent } from "../sessionSocket";

describe("upstream response boundaries", () => {
  it("validates durable transcript ids in paged messages and rejects legacy arrays", () => {
    const message = { role: "user", entryId: 7, content: "hello" };
    expect(() => parseMessagePage({ messages: [message], start: 0, total: 1 })).toThrow("entryId");
    expect(() => parseMessagePage([message])).toThrow("Expected array response");
    expect(() => parseMessagePage([{ ...message, entryId: "entry" }])).toThrow("Expected array response");
    expect(parseMessagePage({ messages: [{ ...message, entryId: "entry" }], start: 0, total: 1 }).messages).toHaveLength(1);
  });

  it("drops malformed stream payloads while preserving the transport watermark", () => {
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: 7, seq: 12 })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "tool.end", toolName: "read", toolCallId: "call", text: "done", isError: "false" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "message.append" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: "live", seq: 12, ignored: "field" })).toEqual({ type: "assistant.delta", text: "live", seq: 12 });
    expect(parseRealtimeSocketEvent({ type: "status.update", status: {} })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "session.name", sessionId: "session", name: 7 })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "terminal.created", terminal: {} })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "workspace.activity", activity: {} })).toBeUndefined();
  });

  it("keeps provider ownership and diagnostics and rejects cross-project workspaces", () => {
    const resolution = {
      status: "degraded", projectId: "project", workspaces: [{ id: "workspace", projectId: "project", path: "/repo", label: "repo", isMain: true, isGitRepo: false, isGitWorktree: false, effectiveConfig: {} }],
      diagnostics: [{ code: "probe-failed", tier: "primary", pluginId: "owner", message: "probe unavailable" }],
    };
    expect(parseWorkspaceProviderResolution(resolution)).toEqual(resolution);
    expect(() => parseWorkspaceProviderResolution({ ...resolution, status: "provider" })).toThrow("ownerPluginId");
    expect(() => parseWorkspaceProviderResolution({ ...resolution, workspaces: [{ ...resolution.workspaces[0], projectId: "other" }] })).toThrow("project workspaces");
  });
});
