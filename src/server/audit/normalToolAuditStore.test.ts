import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NormalToolAuditStore, normalToolAuditStats, pruneNormalToolAudit, queryNormalToolAudit } from "./normalToolAuditStore.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("NormalToolAuditStore", () => {
  it("persists one completed row without tool arguments or results", () => {
    const { path, store, setNow } = fixture();
    store.record(event("started"));
    setNow("2026-08-06T01:00:01.250Z");
    store.record(event("completed"));

    expect(queryNormalToolAudit(path)).toEqual([{
      id: 1,
      sessionId: "session-1",
      cwd: "D:\\dev\\project",
      toolName: "read",
      toolCallId: "call-1",
      status: "completed",
      startedAt: "2026-08-06T01:00:00.000Z",
      finishedAt: "2026-08-06T01:00:01.250Z",
      durationMs: 1_250,
      createdAt: "2026-08-06T01:00:00.000Z",
    }]);
    expect(normalToolAuditStats(path)).toMatchObject({ total: 1, byStatus: { completed: 1 } });
    store.close();
  });

  it("marks unfinished calls interrupted when the store closes", () => {
    const { path, store, setNow } = fixture();
    store.record(event("started"));
    setNow("2026-08-06T01:00:02.000Z");
    store.close();

    expect(queryNormalToolAudit(path)[0]).toMatchObject({ status: "interrupted", durationMs: 2_000 });
  });

  it("prunes expired rows and enforces the maximum row count", () => {
    const { path, store, setNow } = fixture();
    for (let index = 0; index < 3; index += 1) {
      setNow(`2026-08-0${String(index + 1)}T01:00:00.000Z`);
      store.record({ ...event("completed"), toolCallId: `call-${String(index)}` });
    }
    store.close();

    expect(pruneNormalToolAudit(path, new Date("2026-08-02T00:00:00.000Z"), 1)).toBe(2);
    expect(queryNormalToolAudit(path)).toHaveLength(1);
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-web-normal-audit-"));
  roots.push(root);
  const path = join(root, "audit.sqlite");
  let now = new Date("2026-08-06T01:00:00.000Z");
  const setNow = (value: string) => { now = new Date(value); };
  return {
    path,
    setNow,
    store: new NormalToolAuditStore({ path, retentionDays: 90, maxRows: 500_000, now: () => now, maintenanceIntervalMs: 0 }),
  };
}

function event(status: "started" | "completed" | "failed") {
  return { sessionId: "session-1", cwd: "D:\\dev\\project", toolName: "read", toolCallId: "call-1", status };
}
