import { describe, expect, it } from "vitest";
import { ServerNoticeStore } from "./serverNoticeStore.js";
import { SERVER_PLUGIN_NOTICE_GLOBAL_LIMIT, SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT } from "../../shared/serverNoticeContract.js";

describe("ServerNoticeStore", () => {
  it("evicts oldest plugin notices per source without evicting core notices", () => {
    let nextId = 0;
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => String(++nextId) });
    const core = store.record({ severity: "warning", message: "core", source: "workspace.delete" }).notice;
    for (let index = 0; index <= SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT; index += 1) {
      store.record({ severity: "info", message: String(index), source: "plugin:alpha" });
    }
    const snapshot = store.snapshot();
    expect(snapshot.revision).toBe(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT + 2);
    expect(snapshot.notices).toHaveLength(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT + 1);
    expect(snapshot.notices).toContainEqual(core);
    expect(snapshot.notices.some((notice) => notice.message === "0")).toBe(false);
    expect(snapshot.notices[0]?.message).toBe(String(SERVER_PLUGIN_NOTICE_PER_SOURCE_LIMIT));
  });

  it("bounds all plugin-authored sources globally while preserving core and exact dismissal", () => {
    let nextId = 0;
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => String(++nextId) });
    const core = store.record({ severity: "warning", message: "core", source: "workspace.delete" }).notice;
    let firstId = "";
    for (let index = 0; index <= SERVER_PLUGIN_NOTICE_GLOBAL_LIMIT; index += 1) {
      const notice = store.record({ severity: "info", message: String(index), source: `plugin:source-${String(index % 5)}` }).notice;
      if (index === 0) firstId = notice.id;
    }
    expect(store.snapshot().notices).toHaveLength(SERVER_PLUGIN_NOTICE_GLOBAL_LIMIT + 1);
    expect(store.snapshot().notices).toContainEqual(core);
    expect(store.dismiss("daemon-a", firstId).dismissed).toBe(false);
    expect(store.dismiss("daemon-a", core.id).dismissed).toBe(true);
  });

  it("leaves revision and overflow candidates intact on invalid occurrence or duplicate id", () => {
    const store = new ServerNoticeStore({ daemonInstanceId: "daemon-a", createNoticeId: () => "same" });
    store.record({ severity: "info", message: "first", source: "plugin:alpha" });
    const before = store.snapshot();
    expect(() => store.record({ severity: "info", message: "duplicate", source: "plugin:alpha" })).toThrow("already exists");
    expect(() => store.record({ severity: "info", message: "invalid", source: " " })).toThrow("source");
    expect(store.snapshot()).toEqual(before);
  });
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
