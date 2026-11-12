import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { SessionManager } from "../../piSdk.js";
import { createManagementPermissionSystemPolicy, managementAgentToolNames } from "../sessions/managementPermissionSystem.js";
import type { AuthorizedResource, BookstackOperationReceipt, BookstackOperationResult, BookstackReadResult, WorkbenchResourceAction } from "./types.js";
import { WorkbenchMcpClient } from "./mcpClient.js";
import { parseAuthorizedResources, WorkbenchClient, WorkbenchHttpError, WorkbenchTimeoutError } from "./workbenchClient.js";
import { createWorkbenchToolDefinitions } from "./workbenchTools.js";
import type { BookstackSessionJournal } from "./bookstackWriteIntents.js";

describe("BookStack entity transport", () => {
  it("reads an exact entity with the Agent Session bearer and preserves version and actions", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(readResult()));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    const request = { resourceName: "bookstack.gx.1", entityType: "page" as const, entityId: 42 };
    expect(await client.readBookstack("agent-secret", request)).toEqual(readResult());
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(new URL("https://workbench/api/agent-access/bookstack/read"), expect.objectContaining({
      method: "POST", headers: { authorization: "Bearer agent-secret", "content-type": "application/json" }, body: JSON.stringify(request),
    }));
  });

  it.each([
    { resourceName: "bookstack.other.2" }, { entityType: "chapter" }, { entityId: 43 },
    { entityId: -1 }, { content: [] }, { baseVersion: "" }, { actions: ["approve"] },
  ])("rejects mismatched or invalid read results %j", async (patch) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ...readResult(), ...patch }));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.readBookstack("secret", { resourceName: "bookstack.gx.1", entityType: "page", entityId: 42 })).rejects.toThrow();
  });

  it("posts an exact write once and preserves a backend unknown result", async () => {
    const response = { ...writeResult(), status: "unknown" as const, message: "Check the upstream result." };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(response));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    const request = { resourceName: "bookstack.gx.1", action: "page.update" as const, entityId: 42, html: "<p>Updated</p>", baseVersion: "revision-3", idempotencyKey: "same-operation" };
    expect(await client.writeBookstack("agent-secret", request)).toEqual(response);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(new URL("https://workbench/api/agent-access/bookstack/operations"), expect.objectContaining({
      method: "POST", headers: { authorization: "Bearer agent-secret", "content-type": "application/json" }, body: JSON.stringify(request),
    }));
  });

  it.each([
    { resourceName: "bookstack.other.2" }, { action: "book.delete" }, { entityId: 99 },
    { status: "pending" }, { operationId: "" }, { url: "javascript:alert(1)" }, { url: "https://user:secret@host/page" },
  ])("rejects mismatched or invalid write results %j", async (patch) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ...writeResult(), ...patch }));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.writeBookstack("secret", { resourceName: "bookstack.gx.1", action: "page.update", entityId: 42, baseVersion: "revision-3", idempotencyKey: "same" })).rejects.toThrow();
  });

  it("preserves optional resource actions and rejects unsupported grants", () => {
    expect(parseAuthorizedResources([resource()])[0]?.actions).toBeUndefined();
    expect(parseAuthorizedResources([resource(["read", "update", "read"])])[0]?.actions).toEqual(["read", "update"]);
    expect(() => parseAuthorizedResources([{ ...resource(), actions: ["admin"] }])).toThrow();
    expect(() => parseAuthorizedResources([{ ...resource(), actions: null }])).toThrow();
  });

  it("queries a historical receipt using the bearer and preserves the actual actor and resolution", async () => {
    const response = { ...receiptResult(), status: "unknown", resolution: { actorUserId: "admin", reason: "Verified native revision", resolvedAt: "2026-11-04T01:00:00Z", outcome: "applied", entityId: 42 } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(response));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    const request = { resourceName: "bookstack.gx.1", idempotencyKey: "original-key" };
    expect(await client.getBookstackOperation("agent-secret", request)).toEqual(response);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(new URL("https://workbench/api/agent-access/bookstack/operations/receipt"), expect.objectContaining({
      method: "POST", headers: { authorization: "Bearer agent-secret", "content-type": "application/json" }, body: JSON.stringify(request),
    }));
  });

  it.each([
    { resourceName: "other" }, { operationId: "other-operation" }, { status: "approved" }, { createdAt: "invalid" },
    { completedAt: 5 }, { actor: { id: "other" } }, { failureStatus: 200 },
    { resolution: { actorUserId: "admin", reason: "Verified", resolvedAt: "2026-11-04", outcome: "retry" } },
  ])("rejects mismatched or malformed operation receipts %j", async (patch) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ...receiptResult(), ...patch }));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.getBookstackOperation("secret", { resourceName: "bookstack.gx.1", operationId: "operation-1" })).rejects.toThrow();
  });
});

describe("BookStack entity tools", () => {
  it("reads with the user bearer and permits a book read without a physical ID", async () => {
    const h = harness();
    const signal = new AbortController().signal;
    await h.readTool.execute("call", { resource_name: "bookstack.gx.1", entity_type: "book" }, signal, undefined, context());
    expect(h.read).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: "bookstack.gx.1", entityType: "book" }, signal);
    expect(h.issueToken).not.toHaveBeenCalled();
    await expect(h.readTool.execute("call", { resource_name: "bookstack.gx.1", entity_type: "page" }, undefined, undefined, context())).rejects.toThrow("ID");
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("invalidates a rejected read authorization (%s) without replaying the request", async (status) => {
    const h = harness();
    const rejected = new WorkbenchHttpError(status, "Authorization changed");
    h.read.mockRejectedValue(rejected);
    await expect(h.readTool.execute("call", { resource_name: "bookstack.gx.1", entity_type: "book" }, undefined, undefined, context())).rejects.toBe(rejected);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.issueToken).not.toHaveBeenCalled();
  });

  it("defaults legacy grants to read and blocks writes outside the action or resource scope", async () => {
    const grants: (WorkbenchResourceAction[] | undefined)[] = [undefined, ["read"], ["read", "create"]];
    for (const actions of grants) {
      const h = harness(actions);
      await expect(h.writeTool.execute("call", updateInput(), undefined, undefined, context())).rejects.toThrow("未获授权");
      expect(h.write).not.toHaveBeenCalled();
    }
    const h = harness(["read", "update"]);
    await expect(h.writeTool.execute("call", { ...updateInput(), resource_name: "bookstack.other.2" }, undefined, undefined, context())).rejects.toThrow("未获授权");
    expect(h.write).not.toHaveBeenCalled();
    const unreadable = harness([]);
    await expect(unreadable.readTool.execute("call", { resource_name: "bookstack.gx.1", entity_type: "book" }, undefined, undefined, context())).rejects.toThrow("未获授权");
    expect(unreadable.read).not.toHaveBeenCalled();
  });

  it("requires the current base version for modifications and sends only declared fields", async () => {
    const h = harness(["read", "update"]);
    await expect(h.writeTool.execute("call", { resource_name: "bookstack.gx.1", action: "page.update", entity_id: 42 }, undefined, undefined, context())).rejects.toThrow("baseVersion");
    expect(h.write).not.toHaveBeenCalled();
    const output = await h.writeTool.execute("call", updateInput(), undefined, undefined, context());
    const idempotencyKey = h.write.mock.calls[0]?.[1].idempotencyKey;
    expect(idempotencyKey).toMatch(/^pi-[a-f0-9]{64}$/u);
    expect(h.write).toHaveBeenCalledExactlyOnceWith("agent-secret", {
      resourceName: "bookstack.gx.1", action: "page.update", entityId: 42, markdown: "Updated", baseVersion: "revision-3", idempotencyKey,
    }, undefined);
    expect(JSON.stringify(output)).toContain(idempotencyKey);
    expect(h.issueToken).not.toHaveBeenCalled();
  });

  it("creates within the authorized book without requiring a base version", async () => {
    const h = harness(["read", "create"]);
    h.write.mockResolvedValue({ ...writeResult(), action: "page.create" });
    await h.writeTool.execute("call", { resource_name: "bookstack.gx.1", action: "page.create", parent_chapter_id: 5, name: "New page", html: "<p>New</p>", idempotency_key: "create-key" }, undefined, undefined, context());
    expect(h.write).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: "bookstack.gx.1", action: "page.create", parentChapterId: 5, name: "New page", html: "<p>New</p>", idempotencyKey: "create-key" }, undefined);
  });

  it("deletes an authorized book only with its current version", async () => {
    const h = harness(["read", "delete"]);
    h.write.mockResolvedValue({ ...writeResult(), action: "book.delete", entityId: 1 });
    await expect(h.writeTool.execute("call", { resource_name: "bookstack.gx.1", action: "book.delete" }, undefined, undefined, context())).rejects.toThrow("baseVersion");
    expect(h.write).not.toHaveBeenCalled();
    await h.writeTool.execute("call", { resource_name: "bookstack.gx.1", action: "book.delete", base_version: "book-revision", idempotency_key: "delete-key" }, undefined, undefined, context());
    expect(h.write).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: "bookstack.gx.1", action: "book.delete", baseVersion: "book-revision", idempotencyKey: "delete-key" }, undefined);
  });

  it("does not dispatch a stopped write before or during authorization", async () => {
    const h = harness(["update"]);
    const controller = new AbortController();
    await expect(h.writeTool.execute("call", updateInput(), AbortSignal.abort(), undefined, context())).rejects.toMatchObject({ name: "AbortError" });
    expect(h.getState).not.toHaveBeenCalled();
    h.getState.mockImplementationOnce(async () => {
      await Promise.resolve();
      controller.abort();
      return h.state;
    });
    await expect(h.writeTool.execute("call", updateInput(), controller.signal, undefined, context())).rejects.toMatchObject({ name: "AbortError" });
    expect(h.getState).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("checks cancellation after constructing the authorized request and before POST", async () => {
    const h = harness(["update"]);
    const controller = new AbortController();
    const input = { ...updateInput(), get markdown() { controller.abort(); return "Updated"; } };
    await expect(h.writeTool.execute("call", input, controller.signal, undefined, context())).rejects.toMatchObject({ name: "AbortError" });
    expect(h.getState).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("reports the original receipt key if the connection fails after dispatch and cancellation", async () => {
    const h = harness(["update"]);
    const controller = new AbortController();
    h.write.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new TypeError("Connection closed"));
    });
    await expect(h.writeTool.execute("call", { ...updateInput(), idempotency_key: "original-key" }, controller.signal, undefined, context())).rejects.toThrow("original-key");
    await h.receiptTool.execute("lookup", { resource_name: "bookstack.gx.1", idempotency_key: "original-key" }, undefined, undefined, context());
    expect(h.receipt).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it.each([new TypeError("Network failed"), new WorkbenchTimeoutError()])("does not replay an uncertain mutation and reports the original key (%s)", async (error) => {
    const h = harness(["read", "update"]);
    h.write.mockRejectedValue(error);
    await expect(h.writeTool.execute("call", { ...updateInput(), idempotency_key: "keep-this-key" }, undefined, undefined, context())).rejects.toThrow("keep-this-key");
    expect(h.write).toHaveBeenCalledTimes(1);
    h.receipt.mockResolvedValue({ ...receiptResult(), status: "unknown" });
    const output = await h.writeTool.execute("call", { ...updateInput(), idempotency_key: "keep-this-key" }, undefined, undefined, context());
    expect(JSON.stringify(output)).toContain('\\"status\\":\\"unknown\\"');
    expect(JSON.stringify(output)).toContain("keep-this-key");
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending HTTP response and recovers a committed write under its original key across daemon restore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-bookstack-intent-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const journal = SessionManager.create(dir, dir);
    journal.appendMessage({ role: "user", content: "Original instruction", timestamp: 1 });
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { reject(new Error("aborted")); }, { once: true });
      });
    });
    const transport = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 60_000, fetch: fetchImpl });
    const first = harness(["update"], undefined, journal);
    first.write.mockImplementation(transport.writeBookstack.bind(transport));
    const pending = first.writeTool.execute("first-tool", { ...updateInput(), idempotency_key: "original" }, controller.signal, undefined, context());
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(1); });
    controller.abort();
    await expect(pending).rejects.toThrow("original");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const file = journal.getSessionFile();
    if (file === undefined) throw new Error("Session file was not persisted");
    expect(await readFile(file, "utf8")).not.toMatch(/Updated|agent-secret|revision-3/u);
    const reopened = SessionManager.open(file, dir);
    reopened.appendMessage({ role: "user", content: "Check the interrupted turn", timestamp: 2 });
    const restored = harness(["update"], undefined, reopened);
    await restored.writeTool.execute("new-tool", { ...updateInput(), idempotency_key: "replacement" }, undefined, undefined, context());
    expect(restored.receipt).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: "bookstack.gx.1", idempotencyKey: "original" }, undefined);
    await restored.writeTool.execute("third-tool", updateInput(), undefined, undefined, context());
    expect(restored.write).not.toHaveBeenCalled();
    reopened.appendMessage({ role: "user", content: "New instruction", timestamp: 3 });
    await restored.writeTool.execute("fresh-tool", updateInput(), undefined, undefined, context());
    expect(restored.write).toHaveBeenCalledTimes(1);
  });

  it.each(["applied", "not_applied"] as const)("recognizes the administrator's %s resolution and allows a later user turn", async (outcome) => {
    const entries: unknown[] = [{ type: "message", id: "one", message: { role: "user" } }];
    const h = harness(["update"], undefined, {
      getBranch: () => entries,
      appendCustomEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); return String(entries.length); },
    });
    h.write.mockResolvedValueOnce({ ...writeResult(), status: "unknown" });
    await h.writeTool.execute("first", updateInput(), undefined, undefined, context());
    h.receipt.mockResolvedValue({ ...receiptResult(), status: "unknown", resolution: {
      outcome, actorUserId: "auditor", reason: "Checked upstream", resolvedAt: "2026-11-11T00:00:00Z",
    } });
    await h.receiptTool.execute("resolve", { resource_name: "bookstack.gx.1", operation_id: "operation-1" }, undefined, undefined, context());
    await h.writeTool.execute("repeat", updateInput(), undefined, undefined, context());
    expect(h.write).toHaveBeenCalledTimes(1);
    entries.push({ type: "message", id: "two", message: { role: "user" } });
    await h.writeTool.execute("fresh", updateInput(), undefined, undefined, context());
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("reconciles a lost page creation before a reworded creation and waits for the next user instruction", async () => {
    const entries: unknown[] = [{ type: "message", id: "initial", message: { role: "user" } }];
    const journal: BookstackSessionJournal = {
      getBranch: () => entries,
      appendCustomEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); return String(entries.length); },
    };
    const create = { resource_name: "bookstack.gx.1", action: "page.create" as const, name: "page", markdown: "first text", idempotency_key: "original-create" };
    const first = harness(["create"], undefined, journal);
    first.write.mockRejectedValueOnce(new TypeError("response lost"));
    await expect(first.writeTool.execute("first", create, undefined, undefined, context())).rejects.toThrow("original-create");
    const recovered = harness(["create"], undefined, journal);
    recovered.receipt.mockResolvedValue({ ...receiptResult(), action: "page.create" });
    const changed = { ...create, name: "revised page", markdown: "first text.", idempotency_key: "replacement" };
    for (const callId of ["model-retry", "model-retry-again"]) {
      await expect(recovered.writeTool.execute(callId, changed, undefined, undefined, context())).rejects.toThrow("写入未发送");
    }
    expect(recovered.receipt).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: create.resource_name, idempotencyKey: "original-create" }, undefined);
    expect(recovered.write).not.toHaveBeenCalled();
    entries.push({ type: "message", id: "next-instruction", message: { role: "user" } });
    await recovered.writeTool.execute("fresh", changed, undefined, undefined, context());
    expect(recovered.write).toHaveBeenCalledTimes(1);
  });

  it("keeps a recovered PI tool call key stable across Agent Session replacement and separates different calls", async () => {
    const first = harness(["update"], { piSessionId: "persistent-pi-session", agentSessionId: "agent-before" });
    await first.writeTool.execute("call-1", updateInput(), undefined, undefined, context());
    const restarted = harness(["update"], { piSessionId: "persistent-pi-session", agentSessionId: "agent-after" });
    await restarted.writeTool.execute("call-1", updateInput(), undefined, undefined, context());
    await restarted.writeTool.execute("call-2", updateInput(), undefined, undefined, context());
    expect(first.write.mock.calls[0]?.[1].idempotencyKey).toBe(restarted.write.mock.calls[0]?.[1].idempotencyKey);
    expect(restarted.write.mock.calls[1]?.[1].idempotencyKey).not.toBe(restarted.write.mock.calls[0]?.[1].idempotencyKey);
    const another = harness(["update"], { piSessionId: "other-pi-session", agentSessionId: "agent-after" });
    await another.writeTool.execute("call-1", updateInput(), undefined, undefined, context());
    expect(another.write.mock.calls[0]?.[1].idempotencyKey).not.toBe(restarted.write.mock.calls[0]?.[1].idempotencyKey);
  });

  it("queries own historical receipts after resource removal without obtaining a write grant or sending a write", async () => {
    const h = harness();
    h.state.resources = [];
    const result = await h.receiptTool.execute("query-call", { resource_name: "bookstack.gx.1", idempotency_key: "original-key" }, undefined, undefined, context());
    expect(h.receipt).toHaveBeenCalledExactlyOnceWith("agent-secret", { resourceName: "bookstack.gx.1", idempotencyKey: "original-key" }, undefined);
    expect(JSON.stringify(result)).toContain("Actual User");
    expect(h.write).not.toHaveBeenCalled();
    expect(h.issueToken).not.toHaveBeenCalled();
    for (const selector of [{}, { operation_id: "operation-1", idempotency_key: "original-key" }]) {
      await expect(h.receiptTool.execute("query-call", { resource_name: "bookstack.gx.1", ...selector }, undefined, undefined, context())).rejects.toThrow("必须且只能");
    }
    expect(h.receipt).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("invalidates rejected receipt authentication (%s) without retrying", async (status) => {
    const h = harness();
    const rejected = new WorkbenchHttpError(status, "Session rejected");
    h.receipt.mockRejectedValue(rejected);
    await expect(h.receiptTool.execute("query-call", { resource_name: "bookstack.gx.1", operation_id: "operation-1" }, undefined, undefined, context())).rejects.toBe(rejected);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.receipt).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("preserves authorization and conflict failures without retrying", async () => {
    const h = harness(["read", "update"]);
    const forbidden = new WorkbenchHttpError(403, "Authorization changed");
    h.write.mockRejectedValue(forbidden);
    await expect(h.writeTool.execute("call", updateInput(), undefined, undefined, context())).rejects.toBe(forbidden);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledTimes(1);
    const conflict = new WorkbenchHttpError(409, "Version changed");
    h.write.mockRejectedValue(conflict);
    await expect(h.writeTool.execute("call", updateInput(), undefined, undefined, context())).rejects.toBe(conflict);
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("registers the tools through existing management policy and respects explicit denies", () => {
    const h = harness();
    const names = h.tools.map((tool) => tool.name);
    const management = { user: { id: "u", rootUserId: "u", roles: [], permissions: ["tools:execute"] }, projects: [{ id: "p", name: "Project" }] };
    expect(managementAgentToolNames(management, names)).toEqual(expect.arrayContaining(["workbench_read_bookstack", "workbench_write_bookstack"]));
    expect(createManagementPermissionSystemPolicy(management, names).tools).toMatchObject({ workbench_read_bookstack: "allow", workbench_write_bookstack: "allow", mcp: "deny" });
    const denied = { ...management, tools: { deny: ["workbench_write_bookstack"] } };
    expect(managementAgentToolNames(denied, names)).not.toContain("workbench_write_bookstack");
    expect(h.writeTool.parameters).toMatchObject({ additionalProperties: false });
    expect(JSON.stringify(h.writeTool.parameters)).not.toMatch(/actor|api_key|approval/u);
  });
});

function resource(actions?: WorkbenchResourceAction[]): AuthorizedResource {
  return { resourceType: "knowledge", resourceName: "bookstack.gx.1", resourceVersion: "live", source: "group", riskLevel: "L0", status: "published", displayName: "Book", description: "", dependencies: [], metadata: { provider: "bookstack" }, ...(actions === undefined ? {} : { actions }) };
}

function readResult(): BookstackReadResult {
  return { resourceName: "bookstack.gx.1", entityType: "page", entityId: 42, content: { name: "Page", html: "<p>Current</p>" }, baseVersion: "revision-3", actions: ["read", "update"] };
}

function writeResult(): BookstackOperationResult {
  return { operationId: "operation-1", status: "succeeded", resourceName: "bookstack.gx.1", action: "page.update", entityId: 42 };
}

function receiptResult(): BookstackOperationReceipt {
  return { ...writeResult(), createdAt: "2026-11-04T00:00:00Z", completedAt: "2026-11-04T00:00:01Z",
    actor: { id: "actual-user", username: "actual", displayName: "Actual User" } };
}

function updateInput() {
  return { resource_name: "bookstack.gx.1", action: "page.update" as const, entity_id: 42, markdown: "Updated", base_version: "revision-3" };
}

function harness(actions?: WorkbenchResourceAction[], identity?: { piSessionId: string; agentSessionId: string }, journal?: BookstackSessionJournal) {
  const workbench = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 1_000 });
  const read = vi.spyOn(workbench, "readBookstack").mockResolvedValue(readResult());
  const write = vi.spyOn(workbench, "writeBookstack").mockResolvedValue(writeResult());
  const receipt = vi.spyOn(workbench, "getBookstackOperation").mockResolvedValue(receiptResult());
  const issueToken = vi.spyOn(workbench, "issueKnowledgeToken");
  const invalidate = vi.fn();
  const state = { sessionId: identity?.agentSessionId ?? "agent", bearerToken: "agent-secret", expiresAt: "2099-01-01T00:00:00Z", authorizationRevision: 1, resources: [resource(actions)] };
  const getState = vi.fn<(_signal?: AbortSignal) => typeof state | Promise<typeof state>>(() => state);
  const tools = createWorkbenchToolDefinitions({
    getState,
    ...(journal ? { bookstackJournal: journal } : {}),
    workbench, mcp: new WorkbenchMcpClient({ mcpUrl: "https://mcp/mcp", timeoutMs: 1_000 }), invalidate,
    ...(identity === undefined ? {} : { auditContext: { sessionId: identity.piSessionId, userId: "actual-user", rootUserId: "actual-user", projectId: "project", cwd: "/work" } }),
  });
  const readTool = tools.find((tool) => tool.name === "workbench_read_bookstack");
  const writeTool = tools.find((tool) => tool.name === "workbench_write_bookstack");
  const receiptTool = tools.find((tool) => tool.name === "workbench_get_bookstack_operation");
  if (readTool === undefined || writeTool === undefined || receiptTool === undefined) throw new Error("BookStack entity tools are missing");
  return { tools, readTool, writeTool, receiptTool, read, write, receipt, state, getState, issueToken, invalidate };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function context(): ExtensionToolContext {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- these tools do not read extension context.
  return {} as ExtensionToolContext;
}
