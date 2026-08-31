import type { AuthorizedResource } from "./types.js";

export interface SearchKnowledgeInput {
  keyword?: string;
  spaceCode?: string;
  domain?: string;
  classification?: string;
  limit?: number;
}

export interface KnowledgeSummary {
  resourceName: string;
  resourceVersion: string;
  displayName: string;
  description: string;
  spaceCode?: string;
  domain?: string;
  categoryPath: string[];
  classification?: string;
  tags: string[];
  documentCount?: number;
  source?: string;
  ownerOrganization?: string;
  effectiveDate?: string;
  provider: "ragflow";
  riskLevel: "L0";
}

export function searchAuthorizedKnowledge(resources: readonly AuthorizedResource[], input: SearchKnowledgeInput): { items: KnowledgeSummary[]; total: number } {
  const keyword = input.keyword?.trim().toLocaleLowerCase() ?? "";
  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const candidates = resources
    .filter(isAuthorizedRagflowKnowledge)
    .filter((item) => input.spaceCode === undefined || metadataString(item, "spaceCode") === input.spaceCode)
    .filter((item) => input.domain === undefined || metadataString(item, "domain") === input.domain)
    .filter((item) => input.classification === undefined || metadataString(item, "classification") === input.classification)
    .map((item) => ({ item, score: knowledgeScore(item, keyword) }))
    .filter((candidate) => keyword === "" || candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.item.resourceName.localeCompare(right.item.resourceName));
  return { items: candidates.slice(0, limit).map((candidate) => toKnowledgeSummary(candidate.item)), total: candidates.length };
}

export function requireAuthorizedRagflowKnowledge(resources: readonly AuthorizedResource[], name: string, version?: string): AuthorizedResource {
  const resourceName = name.trim();
  const resourceVersion = version?.trim();
  const item = resources.find((resource) => resource.resourceName === resourceName && isAuthorizedRagflowKnowledge(resource));
  if (item === undefined) throw new Error("当前账号未获授权检索该知识资源");
  if (resourceVersion !== undefined && resourceVersion !== "" && item.resourceVersion !== resourceVersion) {
    throw new Error("知识资源版本不在当前授权快照中");
  }
  return item;
}

function isAuthorizedRagflowKnowledge(item: AuthorizedResource): boolean {
  return item.resourceType === "knowledge" &&
    item.status === "published" &&
    item.riskLevel === "L0" &&
    knowledgeProvider(item) === "ragflow";
}

function knowledgeProvider(item: AuthorizedResource): string {
  const provider = metadataString(item, "provider");
  return provider === undefined || provider === "ragflow" ? "ragflow" : provider;
}

function knowledgeScore(item: AuthorizedResource, keyword: string): number {
  if (keyword === "") return 1;
  const exactName = item.resourceName.toLocaleLowerCase() === keyword ? 1_000 : 0;
  const fields = [
    item.displayName,
    item.description,
    metadataString(item, "spaceCode"),
    metadataString(item, "domain"),
    metadataString(item, "classification"),
    metadataString(item, "source"),
    metadataString(item, "ownerOrganization"),
    ...metadataStrings(item, "categoryPath"),
    ...metadataStrings(item, "tags"),
  ].filter((field): field is string => field !== undefined);
  return exactName + fields.reduce((score, field, index) => score + (field.toLocaleLowerCase().includes(keyword) ? 100 - index : 0), 0);
}

function toKnowledgeSummary(item: AuthorizedResource): KnowledgeSummary {
  const spaceCode = metadataString(item, "spaceCode");
  const domain = metadataString(item, "domain");
  const classification = metadataString(item, "classification");
  const documentCount = metadataNumber(item, "documentCount");
  const source = metadataString(item, "source");
  const ownerOrganization = metadataString(item, "ownerOrganization");
  const effectiveDate = metadataString(item, "effectiveDate");
  return {
    resourceName: item.resourceName,
    resourceVersion: item.resourceVersion,
    displayName: item.displayName,
    description: item.description,
    ...(spaceCode === undefined ? {} : { spaceCode }),
    ...(domain === undefined ? {} : { domain }),
    categoryPath: metadataStrings(item, "categoryPath"),
    ...(classification === undefined ? {} : { classification }),
    tags: metadataStrings(item, "tags"),
    ...(documentCount === undefined ? {} : { documentCount }),
    ...(source === undefined ? {} : { source }),
    ...(ownerOrganization === undefined ? {} : { ownerOrganization }),
    ...(effectiveDate === undefined ? {} : { effectiveDate }),
    provider: "ragflow",
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

function metadataNumber(item: AuthorizedResource, key: string): number | undefined {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
