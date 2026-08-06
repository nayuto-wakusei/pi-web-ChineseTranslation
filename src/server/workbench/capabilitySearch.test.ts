import { describe, expect, it } from "vitest";
import { requireAuthorizedL0Capability, searchAuthorizedCapabilities } from "./capabilitySearch.js";
import type { AuthorizedResource } from "./types.js";

describe("authorized capability search", () => {
  it("returns only authorized published L0 capabilities and prioritizes an exact name", () => {
    const result = searchAuthorizedCapabilities([
      capability("broadband.query_optical_power", { displayName: "查询宽带光衰", tags: ["装维"] }),
      capability("broadband.other", { displayName: "其他光衰查询" }),
      capability("hidden", { status: "disabled", displayName: "查询宽带光衰" }),
      capability("write", { riskLevel: "L1", displayName: "查询宽带光衰" }),
    ], { keyword: "broadband.query_optical_power" });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.name)).toEqual(["broadband.query_optical_power"]);
  });

  it("rejects names outside the authorized L0 snapshot", () => {
    expect(() => requireAuthorizedL0Capability([capability("allowed")], "invented")).toThrow("未获授权");
  });
});

function capability(name: string, patch: Partial<AuthorizedResource> & { tags?: string[] } = {}): AuthorizedResource {
  const { tags = [], ...resourcePatch } = patch;
  return {
    resourceType: "capability",
    resourceName: name,
    resourceVersion: "2",
    source: "group",
    riskLevel: "L0",
    status: "published",
    displayName: name,
    description: "",
    dependencies: [],
    metadata: { inputSchema: { type: "object" }, outputSchema: {}, examples: [], tags },
    ...resourcePatch,
  };
}
