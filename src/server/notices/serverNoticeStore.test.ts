import { describe, expect, it } from "vitest";
import { ServerNoticeStore } from "./serverNoticeStore.js";

describe("ServerNoticeStore", () => {
  it("retains independent event occurrences even when their content matches", () => {
    let nextId = 0;
    const store = new ServerNoticeStore({
      daemonInstanceId: "daemon-a",
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      createNoticeId: () => String(++nextId),
    });

    const first = store.record({ severity: "error", message: "Something failed", source: "test" }).notice;
    const second = store.record({ severity: "error", message: "Something failed", source: "test" }).notice;

    expect(first.id).not.toBe(second.id);
    expect(store.snapshot()).toEqual({
      daemonInstanceId: "daemon-a",
      revision: 2,
      notices: [second, first],
    });
  });

  it("deletes only the requested id and ignores stale or repeated dismissals", () => {
    let nextId = 0;
    const store = new ServerNoticeStore({
      daemonInstanceId: "daemon-a",
      createNoticeId: () => String(++nextId),
    });
    const first = store.record({ severity: "info", message: "first" }).notice;
    const second = store.record({ severity: "warning", message: "second" }).notice;

    const stale = store.dismiss("daemon-old", first.id);
    expect(stale.dismissed).toBe(false);
    expect(stale.snapshot.revision).toBe(2);

    const dismissed = store.dismiss("daemon-a", first.id);
    expect(dismissed.dismissed).toBe(true);
    expect(dismissed.snapshot).toEqual({ daemonInstanceId: "daemon-a", revision: 3, notices: [second] });

    const repeated = store.dismiss("daemon-a", first.id);
    expect(repeated.dismissed).toBe(false);
    expect(repeated.snapshot.revision).toBe(3);
  });

  it("copies context metadata at the store boundary", () => {
    const context = { projectId: "project-1", details: { workspaceId: "workspace-1" } };
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => "1" });
    const recorded = store.record({ severity: "warning", message: "warning", context }).notice;

    context.details.workspaceId = "changed";

    expect(recorded.context).toEqual({ projectId: "project-1", details: { workspaceId: "workspace-1" } });
  });

  it("detaches readonly plugin metadata and scope throughout record and snapshots", () => {
    const nested = { workspaceId: "diagnostic-workspace" };
    const context = Object.freeze({ items: Object.freeze([nested, Object.freeze(["first"])]) });
    const scope = { projectId: "project-1", workspaceId: "workspace-1" };
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => "1" });
    const result = store.record({ severity: "error", message: "failure", source: "plugin:pi-web.terminal", scope, context });
    nested.workspaceId = "changed";
    scope.projectId = "changed";
    expect(result.notice.scope).toEqual({ projectId: "project-1", workspaceId: "workspace-1" });
    expect(result.notice.context).toEqual({ items: [{ workspaceId: "diagnostic-workspace" }, ["first"]] });
    const items = result.notice.context?.["items"];
    if (!Array.isArray(items)) throw new Error("Expected detached items");
    items.push("external mutation");
    const projected = store.snapshot().notices[0];
    if (projected?.scope === undefined) throw new Error("Expected scope");
    projected.scope.projectId = "external mutation";
    expect(store.snapshot().notices[0]).toMatchObject({
      scope: { projectId: "project-1", workspaceId: "workspace-1" },
      context: { items: [{ workspaceId: "diagnostic-workspace" }, ["first"]] },
    });
  });

  it("rejects malformed notice scope before changing current state", () => {
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a" });
    expect(() => store.record({ severity: "error", message: "failure", scope: { projectId: "" } })).toThrow("scope");
    expect(store.snapshot()).toEqual({ daemonInstanceId: "daemon-a", revision: 0, notices: [] });
  });
});
