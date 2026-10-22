import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsApi } from "./clients";
import { setApiScope } from "./http";
import { parseSessionStatus, parseRealtimeStreamEvent } from "./parsers";
import { parseSessionSocketEvent } from "../sessionSocket";

const legacyActivityWarning = {
  severity: "info", source: "PI-WEB",
  message: "Recently active in another PI-WEB instance. Avoid working on this session in both instances at once.",
};
beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});
afterEach(() => {
  setApiScope("normal");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("upstream session consistency API", () => {
  it("normalizes the previous Chinese daemon activity warning without translating unrelated payloads", () => {
    const message = "此会话最近在另一个 PI WEB 实例中活动。请避免在两个实例中同时操作此会话。";
    const extensionWarning = { ...legacyActivityWarning, source: "extension", message };
    const parsed = parseSessionStatus({ ...statusWire(), warnings: [{ ...legacyActivityWarning, message }, extensionWarning] });
    expect(parsed.recentlyActiveElsewhere).toBe(true);
    expect(parsed.warnings).toEqual([extensionWarning]);
  });
it.each([true, false])("preserves recentlyActiveElsewhere=%s independently of warnings", (recentlyActiveElsewhere) => {
    const wire = { ...statusWire(), recentlyActiveElsewhere };
    expect(parseSessionStatus(wire)).toMatchObject({ recentlyActiveElsewhere });
    expect(parseRealtimeStreamEvent({ type: "status.update", status: wire })).toEqual({
      type: "status.update", status: parseSessionStatus(wire),
    });
    expect(parseSessionStatus(wire).warnings).toBeUndefined();
  });

it("normalizes older daemon activity warnings into status while retaining ordinary diagnostics", () => {
    const skillWarning = { severity: "error", message: "bad skill", source: "skill" };
    const extensionWarning = { ...legacyActivityWarning, source: "extension" };
    const parsed = parseSessionStatus({ ...statusWire(), warnings: [legacyActivityWarning, skillWarning, extensionWarning] });

    expect(parsed.recentlyActiveElsewhere).toBe(true);
    expect(parsed.warnings).toEqual([skillWarning, extensionWarning]);
  });

it.each([true, false])("prefers explicit activity status %s over a legacy warning", (recentlyActiveElsewhere) => {
    const parsed = parseSessionStatus({ ...statusWire(), recentlyActiveElsewhere, warnings: [legacyActivityWarning] });
    expect(parsed.recentlyActiveElsewhere).toBe(recentlyActiveElsewhere);
    expect(parsed.warnings).toEqual([]);
  });

it("normalizes older snapshots without an activity warning to false", () => {
    expect(parseSessionStatus(statusWire()).recentlyActiveElsewhere).toBe(false);
    expect(parseSessionStatus({ ...statusWire(), warnings: [{ ...legacyActivityWarning, source: "extension" }] }).recentlyActiveElsewhere).toBe(false);
  });

it.each(["true", 1, null])("rejects malformed recentlyActiveElsewhere: %s", (value) => {
    expect(() => parseSessionStatus({ ...statusWire(), recentlyActiveElsewhere: value })).toThrow("Expected optional boolean field: recentlyActiveElsewhere");
  });
it("reads a consistent transcript snapshot through a nested encoded machine route with cwd and limit", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-web/" });
    const page = { messages: [{ role: "user", content: "hello", entryId: "entry-1" }], start: 10, total: 11 };
    const partial = { role: "assistant", content: [{ type: "text", text: "streaming" }] };
    const fetchMock = stubJsonFetch({ page, status: statusWire(), seq: 12, partial });

    await expect(sessionsApi.transcriptSnapshot({ id: "s /?", cwd: "/repo with spaces" }, { limit: 25 }, "remote /?")).resolves.toEqual({
      page, status: parseSessionStatus(statusWire()), seq: 12, partial,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(fetchMock, 0);
    expect(url).toBe("https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/s%20%2F%3F/transcript-snapshot?cwd=%2Frepo+with+spaces&limit=25&media=reference");
    expect(init?.method ?? "GET").toBe("GET");
  });

it.each([undefined, {}])("defaults transcript snapshots to local without an unspecified limit (%j)", async (options) => {
    const fetchMock = stubJsonFetch({ page: { messages: [], start: 0, total: 0 }, status: statusWire(), seq: 0, partial: null });

    await sessionsApi.transcriptSnapshot({ id: "s-1", cwd: "/repo" }, options);

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://pi.example.test/api/machines/local/sessions/s-1/transcript-snapshot?cwd=%2Frepo&media=reference");
  });

it("rejects an incomplete transcript snapshot instead of returning a partial response", async () => {
    stubJsonFetch({ page: { messages: [], start: 0, total: 0 }, status: statusWire(), seq: 0 });

    await expect(sessionsApi.transcriptSnapshot({ id: "s-1", cwd: "/repo" })).rejects.toThrow("Expected field: partial");
  });

  it.each(["normal", "management"] as const)("keeps snapshot machine/cwd identity and %s scope", async (mode) => {
    setApiScope(mode);
    vi.stubGlobal("location", { href: "https://pi.example.test/?embed=management&token=entry" });
    const fetchMock = stubJsonFetch({ page: { messages: [], start: 0, total: 0, leafId: "leaf" }, status: statusWire(), seq: 0, partial: null });
    const result = await sessionsApi.transcriptSnapshot({ id: "Case-Sensitive", cwd: "/repo" }, {}, "remote");
    const url = new URL(fetchCall(fetchMock, 0)[0]);
    expect(url.pathname).toBe("/api/machines/remote/sessions/Case-Sensitive/transcript-snapshot");
    expect(url.searchParams.get("cwd")).toBe("/repo");
    expect(url.searchParams.get("media")).toBe("reference");
    expect(url.searchParams.get("embed")).toBe(mode === "management" ? "management" : null);
    expect(result.page.leafId).toBe("leaf");
  });

  it.each([undefined, false, true])("forwards retainCheckpoint=%s for both history actions", async (retainCheckpoint) => {
    const fetchMock = stubJsonFetch({ cancelled: true });
    const option = retainCheckpoint === undefined ? {} : { retainCheckpoint };
    await sessionsApi.navigateTree({ id: "full-id", cwd: "/repo" }, { targetId: "entry", expectedLeafId: "leaf", summary: { mode: "none" }, ...option }, "remote");
    await sessionsApi.forkTree({ id: "full-id", cwd: "/repo" }, { entryId: "entry", expectedLeafId: "leaf", ...option }, "remote");
    for (const [, init] of fetchMock.mock.calls) {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const body: unknown = JSON.parse(init.body);
      expect(body).toMatchObject({ cwd: "/repo", expectedLeafId: "leaf", ...option });
      if (retainCheckpoint === undefined) expect(body).not.toHaveProperty("retainCheckpoint");
    }
  });

  it.each([
    { type: "assistant.start", message: { role: "assistant", streamId: "stream" }, seq: 1 },
    { type: "assistant.delta", text: "text", streamId: "stream", seq: 2 },
    { type: "assistant.thinking.delta", text: "thinking", streamId: "stream", seq: 3 },
    { type: "session.tree.changed", seq: 4 },
    { type: "session.diagnostic", message: "technical details", seq: 5 },
  ])("validates and preserves the new stream frame %j", (event) => {
    expect(parseSessionSocketEvent({ ...event, ignored: "field" })).toEqual(event);
  });
  it.each([
    { type: "assistant.start" },
    { type: "assistant.delta", text: "text", streamId: 42 },
    { type: "session.diagnostic", message: 42 },
    { type: "session.tree.navigated", result: { editorText: "old" } },
  ])("drops malformed or retired stream frames %j", (event) => {
    expect(parseSessionSocketEvent(event)).toBeUndefined();
  });
});

function statusWire() {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function stubJsonFetch(body: unknown) {
  const mock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", mock);
  return mock;
}
function fetchCall(mock: ReturnType<typeof stubJsonFetch>, index: number): [string, RequestInit | undefined] {
  const call = mock.mock.calls[index];
  if (call === undefined) throw new Error("Missing fetch call");
  const [input, init] = call;
  return [typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init];
}
