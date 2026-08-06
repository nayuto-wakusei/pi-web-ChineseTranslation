import type { AuthorizedResource } from "./types.js";

export interface SearchCapabilitiesInput {
  keyword?: string;
  bizDomain?: string;
  packName?: string;
  limit?: number;
}

export interface CapabilitySummary {
  name: string;
  version: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples: unknown[];
  packName?: string;
  bizDomain?: string;
  tags: string[];
  riskLevel: "L0";
}

export function searchAuthorizedCapabilities(resources: readonly AuthorizedResource[], input: SearchCapabilitiesInput): { items: CapabilitySummary[]; total: number } {
  const keyword = input.keyword?.trim().toLocaleLowerCase() ?? "";
  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const candidates = resources
    .filter(isAuthorizedL0Capability)
    .filter((item) => input.bizDomain === undefined || metadataString(item, "biz_domain") === input.bizDomain)
    .filter((item) => input.packName === undefined || metadataString(item, "pack_name") === input.packName)
    .map((item) => ({ item, score: capabilityScore(item, keyword) }))
    .filter((candidate) => keyword === "" || candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.item.resourceName.localeCompare(right.item.resourceName));
  return { items: candidates.slice(0, limit).map((candidate) => toCapabilitySummary(candidate.item)), total: candidates.length };
}

export function requireAuthorizedL0Capability(resources: readonly AuthorizedResource[], name: string): AuthorizedResource {
  const item = resources.find((resource) => resource.resourceName === name && isAuthorizedL0Capability(resource));
  if (item === undefined) throw new Error("当前账号未获授权使用该L0能力");
  return item;
}

function isAuthorizedL0Capability(item: AuthorizedResource): boolean {
  return item.resourceType === "capability" && item.status === "published" && item.riskLevel === "L0";
}

function capabilityScore(item: AuthorizedResource, keyword: string): number {
  if (keyword === "") return 1;
  const exactName = item.resourceName.toLocaleLowerCase() === keyword ? 1_000 : 0;
  const fields = [item.displayName, item.description, metadataString(item, "pack_name"), metadataString(item, "biz_domain"), ...metadataStrings(item, "tags")]
    .filter((field): field is string => field !== undefined);
  return exactName + fields.reduce((score, field, index) => score + (field.toLocaleLowerCase().includes(keyword) ? 100 - index : 0), 0);
}

function toCapabilitySummary(item: AuthorizedResource): CapabilitySummary {
  const packName = metadataString(item, "pack_name");
  const bizDomain = metadataString(item, "biz_domain");
  return {
    name: item.resourceName,
    version: item.resourceVersion,
    displayName: item.displayName,
    description: item.description,
    inputSchema: metadataRecord(item, "inputSchema"),
    outputSchema: metadataRecord(item, "outputSchema"),
    examples: Array.isArray(item.metadata["examples"]) ? item.metadata["examples"] : [],
    ...(packName === undefined ? {} : { packName }),
    ...(bizDomain === undefined ? {} : { bizDomain }),
    tags: metadataStrings(item, "tags"),
    riskLevel: "L0",
  };
}

function metadataString(item: AuthorizedResource, key: string): string | undefined {
  const value = item.metadata[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function metadataStrings(item: AuthorizedResource, key: string): string[] {
  const value = item.metadata[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function metadataRecord(item: AuthorizedResource, key: string): Record<string, unknown> {
  const value = item.metadata[key];
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
