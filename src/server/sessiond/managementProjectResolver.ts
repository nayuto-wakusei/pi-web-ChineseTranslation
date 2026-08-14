import {
  decodeManagementContext,
  MANAGEMENT_EMBED_CONTEXT_HEADER,
  projectFromManagedEmbedContext,
} from "../managementEmbed.js";
import type { Project } from "../types.js";

export interface SessiondProjectReader {
  requireProject(projectId: string): Promise<Project>;
}

export interface SessiondProjectResolverDependencies {
  projects: SessiondProjectReader;
  managementProjectRoot?: string | undefined;
}

/** Resolve the project at the daemon boundary without allowing managed ids into ProjectStore. */
export async function resolveSessiondProject(
  headers: Record<string, string | string[] | undefined>,
  projectId: string,
  dependencies: SessiondProjectResolverDependencies,
): Promise<Project> {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  const context = decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
  if (context === undefined) return dependencies.projects.requireProject(projectId);
  const projectRoot = dependencies.managementProjectRoot;
  if (projectRoot === undefined || projectRoot === "") throw new Error("Management embed mode is not configured");
  return projectFromManagedEmbedContext(projectRoot, context, projectId, { create: true });
}
