import { afterEach, expect, it, vi } from "vitest";
import { setApiScope } from "./http";
import { managedAgentsApi, parseManagedAgentsStatus } from "./managedAgents";

const status = { available: true, pending: true, revision: "snapshot", modifiedAt: "2026-10-26T01:00:00.000Z", templateModifiedAt: "2026-10-26T02:00:00.000Z", templateRevision: "template-2" };

afterEach(() => { setApiScope("normal"); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("validates status rather than trusting malformed timestamps or snapshot fields", () => {
  expect(parseManagedAgentsStatus(status)).toEqual(status);
  expect(parseManagedAgentsStatus({ available: false })).toEqual({ available: false });
  for (const value of [null, {}, { ...status, pending: "true" }, { ...status, revision: "" }, { ...status, modifiedAt: "invalid" }, { ...status, templateModifiedAt: 42 }]) {
    expect(() => parseManagedAgentsStatus(value)).toThrow("Invalid managed instructions status");
  }
});

it("keeps management authority, machine identity and application base on status and decision requests", async () => {
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/" });
  vi.stubGlobal("location", { href: "https://pi.example.test/nested/?embed=management&token=entry" });
  setApiScope("management");
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(Response.json(status)));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await managedAgentsApi.status("project a", "workspace/a", "remote/a", { signal: controller.signal });
  await managedAgentsApi.decide("project a", "workspace/a", "remote/a", { action: "keep", revision: "snapshot" });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://pi.example.test/nested/api/machines/remote%2Fa/projects/project%20a/workspaces/workspace%2Fa/agents-instructions?embed=management&token=entry");
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "keep", revision: "snapshot" }) });
});
