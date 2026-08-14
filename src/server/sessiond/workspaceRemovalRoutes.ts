import type { FastifyInstance, FastifyReply } from "fastify";
import type { TerminalCommandRun } from "../../shared/apiTypes.js";
import {
  parseWorkspaceRemovalRequest,
  WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES,
} from "../../shared/workspaceRemovalProtocol.js";
import { requestCancellation } from "../requestCancellation.js";
import type { Project } from "../types.js";
import { workspaceRemovalHttpStatus } from "../workspaces/workspaceRemovalService.js";
import { resolveSessiondProject, type SessiondProjectReader } from "./managementProjectResolver.js";

export interface WorkspaceRemover {
  remove(
    project: Project,
    workspaceId: string,
    precondition: string,
    signal: AbortSignal,
  ): Promise<TerminalCommandRun>;
}

export interface WorkspaceRemovalRouteDependencies {
  projects: SessiondProjectReader;
  removals: WorkspaceRemover;
  managementProjectRoot?: string | undefined;
  onWorkspacesMutated?: () => void;
}

/** Internal sessiond endpoint for host-orchestrated provider workspace removal. */
export function registerWorkspaceRemovalRoutes(
  app: FastifyInstance,
  dependencies: WorkspaceRemovalRouteDependencies,
  prefix = "/workspace-removals",
): void {
  app.delete<{ Params: { projectId: string; workspaceId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId`,
    { bodyLimit: WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      let precondition: string;
      try {
        precondition = parseWorkspaceRemovalRequest(request.body).precondition;
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }

      let project: Project;
      try {
        project = await resolveSessiondProject(request.headers, request.params.projectId, dependencies);
      } catch (error) {
        const message = errorMessage(error);
        return reply.code(projectErrorStatus(message)).send({ error: message });
      }

      const cancellation = requestCancellation(request, reply);
      try {
        const result = await dependencies.removals.remove(
          project,
          request.params.workspaceId,
          precondition,
          cancellation.signal,
        );
        dependencies.onWorkspacesMutated?.();
        return result;
      } catch (error) {
        return await removalRequestFailed(reply, error);
      } finally {
        cancellation.dispose();
      }
    },
  );
}

function removalRequestFailed(reply: FastifyReply, error: unknown): FastifyReply {
  return reply.code(workspaceRemovalHttpStatus(error)).send({ error: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectErrorStatus(message: string): number {
  if (message === "Project not found") return 404;
  if (message === "Project is not authorized for this management session") return 403;
  return 500;
}
