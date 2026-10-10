import { afterEach, describe, expect, it, vi } from "vitest";
import { trustApi } from "./clients";
import { parseWorkspaceTrustResponse } from "./parsers";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("project trust API", () => {
  it("validates nullable decisions rather than casting network responses", () => {
    expect(parseWorkspaceTrustResponse({ path: "/repo", decision: null, trusted: false })).toEqual({ path: "/repo", decision: null, trusted: false });
    for (const invalid of [
      { path: "/repo", decision: "yes", trusted: true },
      { path: "/repo", decision: null, trusted: "false" },
      { decision: true, trusted: true },
    ]) expect(() => parseWorkspaceTrustResponse(invalid)).toThrow();
  });

  it("encodes owner identities and resolves the application prefix exactly once", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ path: "/repo", decision: true, trusted: true }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await trustApi.setWorkspaceTrust("p /?", "w /?", true, "remote /?");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://pi.example.test/nested/api/machines/remote%20%2F%3F/projects/p%20%2F%3F/workspaces/w%20%2F%3F/trust");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "PUT", body: JSON.stringify({ trusted: true }) });
  });
});
