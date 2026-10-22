import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsApi } from "./clients";
import { setApiScope } from "./http";
import { parseSessionStatus } from "./parsers";
import { FEDERATED_HTTP_ROUTES } from "../../../shared/federatedRoutes";

const status = {
  sessionId: "session /?", isStreaming: true, isCompacting: false, isBashRunning: false,
  pendingMessageCount: 1, queuedMessages: [{ kind: "steer", text: "queued", hasAttachments: true, attachmentCount: 2 }],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
};

beforeEach(() => {
  setApiScope("normal");
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-web/" });
});
afterEach(() => { setApiScope("normal"); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("queue mutation transport", () => {
  it.each(["normal", "management"] as const)("routes a scoped %s mutation through the owning machine and nested gateway", async (scope) => {
    setApiScope(scope);
    vi.stubGlobal("location", { href: "https://pi.example.test/nested/pi-web/?embed=management&token=launch-token" });
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(JSON.stringify(status))));
    vi.stubGlobal("fetch", fetch);
    const mutation = { action: "toggle" as const, index: 0, expectedQueue: [{ kind: "steer" as const, text: "queued" }] };
    await expect(sessionsApi.mutateQueuedMessage({ id: status.sessionId, cwd: "/repo with spaces" }, mutation, "remote /?")).resolves.toMatchObject(status);
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = fetch.mock.calls[0];
    if (call === undefined) throw new Error("Missing queue mutation request");
    const [url, init] = call;
    const suffix = scope === "management" ? "?embed=management&token=launch-token" : "";
    expect(url).toBe(`https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/session%20%2F%3F/queue/message${suffix}`);
    expect(init?.method).toBe("POST");
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(init.body)).toEqual({ cwd: "/repo with spaces", ...mutation });
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "POST", path: "/sessions/:sessionId/queue/message" });
  });

  it("preserves attachment metadata and empty SDK-unavailable reasons without changing legacy status", () => {
    expect(parseSessionStatus({ ...status, queueMessageActionsUnavailable: "" })).toMatchObject({ ...status, queueMessageActionsUnavailable: "" });
    expect(parseSessionStatus({ ...status, queuedMessages: [{ kind: "followUp", text: "legacy" }] }).queuedMessages).toEqual([{ kind: "followUp", text: "legacy" }]);
    expect(parseSessionStatus(status)).not.toHaveProperty("queueMessageActionsUnavailable");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "2", null])("rejects invalid attachment count %j at the response boundary", (attachmentCount) => {
    expect(() => parseSessionStatus({ ...status, queuedMessages: [{ kind: "steer", text: "queued", attachmentCount }] })).toThrow();
  });

  it("rejects invalid optional status metadata", () => {
    expect(() => parseSessionStatus({ ...status, queueMessageActionsUnavailable: true })).toThrow();
    expect(() => parseSessionStatus({ ...status, queuedMessages: [{ kind: "steer", text: "queued", hasAttachments: "yes" }] })).toThrow();
  });
});
