import type { FastifyInstance } from "fastify";
import type { TerminalCommandRun, Workspace } from "../../shared/apiTypes.js";
import { workspaceDeletionMetadata } from "../../shared/workspaceDeletion.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import type { ProjectService } from "../projects/projectService.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import {
  encodeManagementContext,
  managementContextForRequest,
  managementToolAllowed,
  MANAGEMENT_EMBED_CONTEXT_HEADER,
  projectFromManagedEmbedContext,
  type ManagementEmbedContext,
  type ManagementEmbedRuntime,
} from "../managementEmbed.js";
import type { WorkspaceService } from "./workspaceService.js";

export function registerWorkspaceDeletionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.delete<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed);
      if (managementContext !== undefined && !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      return await deleteWorkspace(projects, workspaces, daemon, request.params.projectId, request.params.workspaceId, managementEmbed, managementContext);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function deleteWorkspace(projects: ProjectService, workspaces: WorkspaceService, daemon: SessionProxyDaemon, projectId: string, workspaceId: string, managementEmbed: ManagementEmbedRuntime | undefined, managementContext: ManagementEmbedContext | undefined): Promise<TerminalCommandRun> {
  const project = managementContext === undefined
    ? await projects.requireProject(projectId)
    : await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), managementContext, projectId);
  const projectWorkspaces = await workspaces.list(project);
  const targetWorkspace = projectWorkspaces.find((workspace) => workspace.id === workspaceId);
  if (targetWorkspace === undefined) throw new Error("Workspace not found");
  if (!canDeleteWorkspace(targetWorkspace)) throw new Error("Only secondary Git worktrees can be deleted");

  const commandWorkspace = projectWorkspaces.find((workspace) => workspace.isMain) ?? projectWorkspaces.find((workspace) => workspace.id !== targetWorkspace.id);
  if (commandWorkspace === undefined) throw new Error("Project main workspace not found");

  const closeResponse = await requestJson(daemon, "DELETE", `/terminals?cwd=${encodeURIComponent(targetWorkspace.path)}`, undefined, managementHeaders(managementContext));
  if (closeResponse.statusCode < 200 || closeResponse.statusCode >= 300) throw new Error(`Failed to close workspace terminals: ${responseError(closeResponse.body, closeResponse.statusCode)}`);

  const deleteResponse = await requestJson(daemon, "POST", "/terminal-command-runs", {
    origin: "core",
    projectId: project.id,
    workspaceId: commandWorkspace.id,
    cwd: commandWorkspace.path,
    title: `Delete workspace: ${workspaceLabel(targetWorkspace)}`,
    command: `git worktree remove ${shellQuote(targetWorkspace.path)}`,
    metadata: workspaceDeletionMetadata(targetWorkspace),
  }, managementHeaders(managementContext));
  if (deleteResponse.statusCode < 200 || deleteResponse.statusCode >= 300) throw new Error(`Failed to start workspace deletion: ${responseError(deleteResponse.body, deleteResponse.statusCode)}`);
  return parseTerminalCommandRun(deleteResponse.body);
}

function canDeleteWorkspace(workspace: Workspace): boolean {
  return workspace.isGitWorktree && !workspace.isMain;
}

function workspaceLabel(workspace: Workspace): string {
  return workspace.branch ?? workspace.label;
}

async function requestJson(daemon: SessionProxyDaemon, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; body: unknown }> {
  const response = await daemon.request(method, path, body, headers);
  return { statusCode: response.statusCode, body: response.body === "" ? undefined : JSON.parse(response.body) };
}

function managementHeaders(context: ManagementEmbedContext | undefined): Record<string, string> | undefined {
  return context === undefined ? undefined : { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
}

function managementProjectRoot(managementEmbed: ManagementEmbedRuntime | undefined): string {
  if (managementEmbed === undefined) throw new Error("Management embed mode is not configured");
  return managementEmbed.projectRoot;
}

function responseError(body: unknown, statusCode: number): string {
  if (isRecord(body) && typeof body["error"] === "string") return body["error"];
  return `HTTP ${String(statusCode)}`;
}

function parseTerminalCommandRun(value: unknown): TerminalCommandRun {
  if (!isRecord(value)) throw new Error("Invalid terminal command run response");
  const metadata = value["metadata"];
  if (!isRecord(metadata)) throw new Error("Invalid terminal command run response");
  const startedAt = optionalString(value, "startedAt");
  const exitCode = optionalNumber(value, "exitCode");
  const completedAt = optionalString(value, "completedAt");
  return {
    id: requireString(value, "id"),
    origin: requireString(value, "origin"),
    projectId: requireString(value, "projectId"),
    workspaceId: requireString(value, "workspaceId"),
    terminalId: requireString(value, "terminalId"),
    title: requireString(value, "title"),
    command: requireString(value, "command"),
    status: parseStatus(value["status"]),
    createdAt: requireString(value, "createdAt"),
    metadata: Object.fromEntries(Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function parseStatus(value: unknown): TerminalCommandRun["status"] {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed") return value;
  throw new Error("Invalid terminal command run response");
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new Error("Invalid terminal command run response");
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid terminal command run response");
  return value;
}

function optionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error("Invalid terminal command run response");
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
