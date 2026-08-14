import type { FastifyReply } from "fastify";
import {
  managementContextForRequest,
  managementProjectRoot,
  projectFromManagedEmbedContext,
  type ManagementEmbedContext,
  type ManagementEmbedRuntime,
} from "../managementEmbed.js";
import type { ProjectService } from "../projects/projectService.js";
import { resolveProjectWorkspaceContext, resolveWorkspaceContext, type WorkspaceContext } from "./workspaceContext.js";
import { asWorkspaceCatalog, type WorkspaceCatalogInput } from "./workspaceCatalog.js";

interface RouteWorkspaceContextOptions {
  createManagedProject: boolean;
}

export async function resolveRouteWorkspaceContext(
  projects: ProjectService,
  workspaces: WorkspaceCatalogInput,
  managementEmbed: ManagementEmbedRuntime | undefined,
  request: Parameters<typeof managementContextForRequest>[0],
  reply: FastifyReply,
  projectId: string,
  workspaceId: string,
  options: RouteWorkspaceContextOptions,
): Promise<WorkspaceContext> {
  const managementContext = await managementContextForRequest(request, managementEmbed, reply);
  if (managementContext === undefined) return resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
  return resolveManagedWorkspaceContext(workspaces, managementEmbed, managementContext, projectId, workspaceId, options);
}

export async function resolveManagedWorkspaceContext(
  workspaces: WorkspaceCatalogInput,
  managementEmbed: ManagementEmbedRuntime | undefined,
  managementContext: ManagementEmbedContext,
  projectId: string,
  workspaceId: string,
  options: RouteWorkspaceContextOptions,
): Promise<WorkspaceContext> {
  const project = await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), managementContext, projectId, { create: options.createManagedProject });
  return resolveProjectWorkspaceContext(asWorkspaceCatalog({ requireProject: () => Promise.resolve(project) }, workspaces), project, workspaceId);
}
