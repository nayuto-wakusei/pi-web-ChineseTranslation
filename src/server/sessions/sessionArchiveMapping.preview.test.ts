import { expect, it } from "vitest";
import { archiveInputFromListEntry, clientSessionFromArchivedRecord } from "./sessionArchiveMapping.js";

it("bounds archived client previews without truncating the persisted archive input", () => {
  const firstMessage = "x".repeat(2_000);
  const entry = {
    id: "s", path: "/sessions/s.jsonl", cwd: "/workspace",
    created: new Date("2026-01-01T00:00:00Z"), modified: new Date("2026-01-01T00:00:00Z"),
    messageCount: 1, firstMessage, allMessagesText: firstMessage,
  };
  const input = archiveInputFromListEntry(entry);
  expect(input.firstMessage).toBe(firstMessage);
  const projected = clientSessionFromArchivedRecord({
    ...input, archivedAt: "2026-01-02T00:00:00Z", archivePath: "/archive/s.jsonl",
  }, entry);
  expect(projected?.firstMessage).toBe(`${"x".repeat(509)}...`);
});
