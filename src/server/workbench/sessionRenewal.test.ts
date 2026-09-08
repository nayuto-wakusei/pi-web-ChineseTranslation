import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchAccessStateStore } from "./accessStateStore.js";
import { WorkbenchClient } from "./workbenchClient.js";
import type { WorkbenchAgentAccessState } from "./types.js";

afterEach(() => vi.useRealTimers());

const initial: WorkbenchAgentAccessState = {
  sessionId: "session-1", bearerToken: "private-token", expiresAt: "2026-09-08T01:00:00Z", authorizationRevision: 1, resources: [],
};
const renewed = { sessionId: "session-1", token: "private-token", expiresAt: "2026-09-08T03:00:00Z", authorizationRevision: 2, resources: [] };
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });

describe("private resource session renewal", () => {
  it("renews repeatedly after idle expiry without using an entry token or changing the daemon handle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T02:00:00Z");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, renewed))
      .mockResolvedValueOnce(json(200, { ...renewed, expiresAt: "2026-09-08T05:00:00Z" }));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    const store = new WorkbenchAccessStateStore();
    store.set("handle", initial);
    const states = await Promise.all([store.prepare("handle", client), store.prepare("handle", client)]);
    expect(states[0]).toBe(states[1]);
    expect(store.require("handle").authorizationRevision).toBe(2);
    vi.setSystemTime("2026-09-08T04:00:00Z");
    await store.prepare("handle", client);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(store.require("handle").expiresAt).toBe("2026-09-08T05:00:00Z");
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toEqual(new URL("http://backend/api/agent-access/sessions/renew"));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
    }
  });

  it("refreshes changed authorization before the local expiry and removes old resources", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T00:30:00Z");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(401, { error: "stale authorization" }))
      .mockResolvedValueOnce(json(200, renewed));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    const state = await client.refreshAgentAccessState({ ...initial, resources: [{
      resourceType: "capability", resourceName: "revoked", resourceVersion: "1", source: "group", riskLevel: "L0",
      status: "published", displayName: "Revoked", description: "", dependencies: [], metadata: {},
    }] });
    expect(state.resources).toEqual([]);
    expect(state.authorizationRevision).toBe(2);
  });

  it("fails closed on renewal rejection and can retry a transient failure without losing the credential", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T02:00:00Z");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, renewed));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    const store = new WorkbenchAccessStateStore();
    store.set("handle", initial);
    await expect(store.prepare("handle", client)).rejects.toThrow("503");
    await expect(store.prepare("handle", client)).rejects.toThrow("401");
    expect(() => store.require("handle")).toThrow();
    await expect(store.prepare("handle", client)).resolves.toMatchObject({ authorizationRevision: 2 });
  });

  it("never resurrects a deleted handle when renewal finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T02:00:00Z");
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    const store = new WorkbenchAccessStateStore();
    store.set("handle", initial);
    const pending = store.prepare("handle", client);
    store.delete("handle");
    resolve(json(200, renewed));
    await expect(pending).rejects.toThrow("changed during renewal");
    expect(() => store.require("handle")).toThrow();
  });

  it("does not downgrade a renewed daemon snapshot when an older gateway write arrives", () => {
    const store = new WorkbenchAccessStateStore();
    const latest = { ...initial, expiresAt: "2099-01-01T00:00:00Z", authorizationRevision: 2 };
    store.set("handle", latest);
    store.set("handle", initial);
    expect(store.require("handle")).toEqual(latest);
  });

  it("accepts a newer gateway refresh racing with a daemon renewal without downgrading it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T02:00:00Z");
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    const store = new WorkbenchAccessStateStore();
    store.set("handle", initial);
    const pending = store.prepare("handle", client);
    const latest = { ...initial, expiresAt: "2026-09-08T04:00:00Z", authorizationRevision: 3 };
    store.set("handle", latest);
    resolve(json(200, renewed));
    await expect(pending).resolves.toEqual(latest);
  });

  it("does not renew on a network/server error or accept a mismatched renewal identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T00:30:00Z");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json(503, {}));
    const client = new WorkbenchClient({ baseUrl: "http://backend", requestTimeoutMs: 1000, fetch: fetchImpl });
    await expect(client.refreshAgentAccessState(initial)).rejects.toThrow("503");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.setSystemTime("2026-09-08T02:00:00Z");
    fetchImpl.mockResolvedValueOnce(json(200, { ...renewed, sessionId: "other-session" }));
    await expect(client.refreshAgentAccessState(initial)).rejects.toThrow("does not match");
  });
});
