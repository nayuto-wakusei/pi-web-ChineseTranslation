import type { FastifyInstance } from "fastify";
import { createTranslator, UserFacingError, userFacingErrorMessage, type Translator } from "../shared/i18n.js";
import type { ManagedAgentsDecision } from "../shared/managedAgents.js";
import { decideManagedAgents, managedAgentsStatus, ManagedAgentsConflictError } from "./managementAgents.js";
import { managementContextForRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";
import { resolveManagedWorkspaceContext } from "./workspaces/workspaceRouteContext.js";
import { workspaceCatalogHttpStatus, type WorkspaceCatalogInput } from "./workspaces/workspaceCatalog.js";

export function registerManagementAgentsRoutes(app: FastifyInstance, workspaces: WorkspaceCatalogInput, prefix = "/api", runtime?: ManagementEmbedRuntime, translate: Translator = createTranslator("en", {})): void {
  app.route<{ Params: { projectId: string; workspaceId: string }; Body: unknown }>({
    method: ["GET", "POST"],
    url: `${prefix}/projects/:projectId/workspaces/:workspaceId/agents-instructions`,
    handler: async (request, reply) => {
      let context;
      try { context = await managementContextForRequest(request, runtime, reply); } catch (error) {
        return reply.code(401).send({ error: userFacingErrorMessage(error, translate) });
      }
      if (context === undefined) return reply.code(403).send({ error: translate("managementAgents.managementOnly", "Managed AGENTS.md review is only available in management mode.") });
      try {
        const workspace = await resolveManagedWorkspaceContext(workspaces, runtime, context, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
        const entry = context.projects.find((item) => item.id === workspace.project.id) ?? { id: workspace.project.id, name: workspace.project.name };
        if (request.method === "GET") return await managedAgentsStatus(workspace.root, entry);
        return await decideManagedAgents(workspace.root, entry, parseDecision(request.body));
      } catch (error) {
        const unauthorized = error instanceof UserFacingError && error.messageKey === "managementError.project.is.not.authorized.for.this.management.session";
        return reply.code(error instanceof ManagedAgentsConflictError ? 409 : unauthorized ? 403 : workspaceCatalogHttpStatus(error, 400)).send({ error: userFacingErrorMessage(error, translate) });
      }
    },
  });
}

function parseDecision(value: unknown): ManagedAgentsDecision {
  if (typeof value !== "object" || value === null || !("action" in value) || (value.action !== "overwrite" && value.action !== "keep")
    || !("revision" in value) || typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision)
    || Object.keys(value).some((key) => key !== "action" && key !== "revision")) {
    throw new UserFacingError("managementAgents.invalidDecision", "Choose whether to overwrite AGENTS.md using the current revision.");
  }
  return { action: value.action, revision: value.revision };
}
