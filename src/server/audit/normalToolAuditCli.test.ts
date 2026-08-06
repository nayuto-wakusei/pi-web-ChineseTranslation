import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNormalToolAuditCommand } from "./normalToolAuditCli.js";
import { NormalToolAuditStore } from "./normalToolAuditStore.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ordinary-mode audit CLI", () => {
  it("lists filtered rows and exports CSV", () => {
    const { path, store } = fixture();
    store.record({ sessionId: "session-1", cwd: "D:\\dev\\project", toolName: "read", toolCallId: "call-1", status: "completed" });
    store.record({ sessionId: "session-2", cwd: "D:\\dev\\other", toolName: "bash", toolCallId: "call-2", status: "failed" });
    const output: string[] = [];
    let exported = "";

    runNormalToolAuditCommand(["list", "--status", "failed"], { databasePath: path, stdout: (line) => output.push(line) });
    runNormalToolAuditCommand(["export", "--format", "csv", "--output", "audit.csv"], {
      databasePath: path,
      stdout: () => undefined,
      writeOutput: (_target, content) => { exported = content; },
    });

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({ sessionId: "session-2", status: "failed" });
    expect(exported).toContain("id,sessionId,cwd,toolName");
    expect(exported).toContain("session-1");
    store.close();
  });

  it("rejects invalid filters without opening the database", () => {
    expect(() => { runNormalToolAuditCommand(["list", "--status", "unknown"], { databasePath: "missing.sqlite" }); })
      .toThrow("--status must be");
  });

  it("reports stats and prunes through the CLI", () => {
    const { path, store } = fixture();
    store.record({ sessionId: "session-1", cwd: "D:\\dev\\project", toolName: "read", toolCallId: "call-1", status: "completed" });
    store.close();
    const output: string[] = [];

    runNormalToolAuditCommand(["stats"], { databasePath: path, stdout: (line) => { output.push(line); } });
    runNormalToolAuditCommand(["prune", "--before", "2099-01-01"], { databasePath: path, maxRows: 500_000, stdout: (line) => { output.push(line); } });
    runNormalToolAuditCommand(["vacuum"], { databasePath: path, stdout: (line) => { output.push(line); } });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({ total: 1, byStatus: { completed: 1 } });
    expect(output[1]).toBe("Deleted 1 audit rows");
    expect(output[2]).toBe("Audit database vacuum completed");
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-web-audit-cli-"));
  roots.push(root);
  const path = join(root, "audit.sqlite");
  return {
    path,
    store: new NormalToolAuditStore({ path, retentionDays: 90, maxRows: 500_000, maintenanceIntervalMs: 0 }),
  };
}
