import type { ManagedAgentsDecision, ManagedAgentsStatus } from "../../../shared/managedAgents";
import { request } from "./http";

export function parseManagedAgentsStatus(value: unknown): ManagedAgentsStatus {
  if (typeof value !== "object" || value === null || !("available" in value)) throw new Error("Invalid managed instructions status");
  if (value.available === false) return { available: false };
  if (value.available !== true || !("pending" in value) || typeof value.pending !== "boolean"
    || !("revision" in value) || typeof value.revision !== "string" || value.revision === ""
    || !("modifiedAt" in value) || (value.modifiedAt !== null && (typeof value.modifiedAt !== "string" || !Number.isFinite(Date.parse(value.modifiedAt))))
    || !("templateModifiedAt" in value) || (value.templateModifiedAt !== null && (typeof value.templateModifiedAt !== "string" || !Number.isFinite(Date.parse(value.templateModifiedAt))))
    || !("templateRevision" in value) || typeof value.templateRevision !== "string") throw new Error("Invalid managed instructions status");
  return { available: true, pending: value.pending, revision: value.revision, modifiedAt: value.modifiedAt, templateModifiedAt: value.templateModifiedAt, templateRevision: value.templateRevision };
}

function managedAgentsPath(projectId: string, workspaceId: string, machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/agents-instructions`;
}

export const managedAgentsApi = {
  status: (projectId: string, workspaceId: string, machineId: string, options?: { readonly signal?: AbortSignal }) =>
    request(managedAgentsPath(projectId, workspaceId, machineId), parseManagedAgentsStatus, options),
  decide: (projectId: string, workspaceId: string, machineId: string, decision: ManagedAgentsDecision) =>
    request(managedAgentsPath(projectId, workspaceId, machineId), parseManagedAgentsStatus, { method: "POST", body: JSON.stringify(decision) }),
};
