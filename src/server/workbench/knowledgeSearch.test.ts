import { describe, expect, it } from "vitest";
import { requireAuthorizedRagflowKnowledge, searchAuthorizedKnowledge } from "./knowledgeSearch.js";
import type { AuthorizedResource } from "./types.js";

describe("authorized knowledge search", () => {
  it("returns only authorized published L0 RAGFlow knowledge and prioritizes an exact name", () => {
    const result = searchAuthorizedKnowledge([
      knowledge("knowledge.nanning.optical", { displayName: "南宁光衰处理手册", metadata: { provider: "ragflow", tags: ["装维"] } }),
      knowledge("knowledge.nanning.other", { displayName: "其他手册" }),
      knowledge("hidden", { status: "disabled", displayName: "南宁光衰处理手册" }),
      knowledge("write", { riskLevel: "L1", displayName: "南宁光衰处理手册" }),
      knowledge("hindsight.live", { displayName: "南宁光衰处理手册", metadata: { provider: "hindsight" } }),
      { ...knowledge("capability-shaped"), resourceType: "capability" },
    ], { keyword: "knowledge.nanning.optical" });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.resourceName)).toEqual(["knowledge.nanning.optical"]);
  });

  it("filters by safe Workbench metadata and does not expose raw backend identifiers", () => {
    const result = searchAuthorizedKnowledge([
      knowledge("knowledge.nanning.optical", {
        metadata: {
          provider: "ragflow",
          spaceCode: "gx",
          domain: "broadband",
          categoryPath: ["宽带", "光衰"],
          classification: "internal",
          tags: ["装维"],
          documentCount: 2,
          source: "网操中心",
          ownerOrganization: "南宁",
          effectiveDate: "2026-08-30",
          ragflow_dataset_id: "dataset-secret",
          apiKey: "secret",
        },
      }),
      knowledge("knowledge.guilin.optical", { metadata: { provider: "ragflow", spaceCode: "gl", domain: "broadband", classification: "internal" } }),
    ], { spaceCode: "gx", domain: "broadband", classification: "internal" });

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      resourceName: "knowledge.nanning.optical",
      resourceVersion: "r3",
      displayName: "knowledge.nanning.optical",
      description: "",
      spaceCode: "gx",
      domain: "broadband",
      categoryPath: ["宽带", "光衰"],
      classification: "internal",
      tags: ["装维"],
      documentCount: 2,
      source: "网操中心",
      ownerOrganization: "南宁",
      effectiveDate: "2026-08-30",
      provider: "ragflow",
      riskLevel: "L0",
    });
    expect(JSON.stringify(result)).not.toContain("dataset-secret");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("rejects unknown, stale-version, and non-RAGFlow knowledge resources", () => {
    const resources = [
      knowledge("knowledge.nanning.optical"),
      knowledge("hindsight.live", { metadata: { provider: "hindsight" } }),
    ];

    expect(() => requireAuthorizedRagflowKnowledge(resources, "invented")).toThrow("未获授权");
    expect(() => requireAuthorizedRagflowKnowledge(resources, "knowledge.nanning.optical", "r2")).toThrow("版本不在当前授权快照");
    expect(() => requireAuthorizedRagflowKnowledge(resources, "hindsight.live")).toThrow("未获授权");
  });
});

function knowledge(name: string, patch: Partial<AuthorizedResource> = {}): AuthorizedResource {
  return {
    resourceType: "knowledge",
    resourceName: name,
    resourceVersion: "r3",
    source: "group",
    riskLevel: "L0",
    status: "published",
    displayName: name,
    description: "",
    dependencies: [],
    metadata: {},
    ...patch,
  };
}
