import type { FastifyInstance } from "fastify";
import { isPiWebPluginId } from "../../shared/pluginIds.js";
import { requestCancellation } from "../requestCancellation.js";
import type { Project } from "../types.js";
import type { WorkspaceChangeNotifier } from "../workspaces/workspaceChangeNotifier.js";
import { MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { createTranslator, UserFacingError, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";

const MAX_PENDING_NOTIFICATIONS = 32;

export interface WorkspaceNotificationRouteDependencies {
  projects: { requireProject(projectId: string): Promise<Project> };
  workspaces: { acceptNotification(project: Project, pluginId: string, signal: AbortSignal): Promise<boolean> };
  changes: Pick<WorkspaceChangeNotifier, "notify">;
  translator?: Translator;
}

/** Machine-local hints from provider-owned integrations, never a workspace registration API. */
export function registerWorkspaceNotificationRoutes(app: FastifyInstance, dependencies: WorkspaceNotificationRouteDependencies): void {
  const t = dependencies.translator ?? createTranslator("en", {});
  let pending = 0;
  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/workspace-notifications/projects/:projectId",
    { bodyLimit: 1_024 },
    async (request, reply) => {
      const { projectId } = request.params;
      const body = request.body;
      if (request.headers[MANAGEMENT_EMBED_CONTEXT_HEADER] !== undefined) {
        return await reply.code(403).send({ error: t("workspaceNotification.managementDenied", "Workspace notifications require an ordinary registered project") });
      }
      if (projectId === "" || projectId.length > 512
        || typeof body !== "object" || body === null || Array.isArray(body)
        || !("pluginId" in body) || typeof body.pluginId !== "string" || !isPiWebPluginId(body.pluginId)
        || Object.keys(body).some((key) => key !== "pluginId")) {
        return await reply.code(400).send({ error: t("workspaceNotification.invalidInput", "Workspace notification requires a registered project id and pluginId") });
      }
      if (pending >= MAX_PENDING_NOTIFICATIONS) return await reply.code(429).send({ error: t("workspaceNotification.busy", "Too many workspace notifications are being evaluated") });
      pending++;
      const cancellation = requestCancellation(request, reply);
      try {
        let project: Project;
        try {
          project = await dependencies.projects.requireProject(projectId);
        } catch (error) {
          const notFound = error instanceof UserFacingError ? error.messageKey === "projectError.notFound" : error instanceof Error && error.message === "Project not found";
          return await reply.code(notFound ? 404 : 500).send({ error: notFound
            ? t("projectError.notFound", "Project not found")
            : t("workspaceNotification.projectUnavailable", "Workspace notification project could not be resolved") });
        }
        cancellation.signal.throwIfAborted();
        const accepted = await dependencies.workspaces.acceptNotification(project, body.pluginId, cancellation.signal);
        if (accepted && !cancellation.signal.aborted) dependencies.changes.notify(project.id);
        return await reply.send({ accepted });
      } catch (error) {
        request.log.warn({ projectId, pluginId: body.pluginId }, "workspace notification could not be evaluated");
        return await reply.code(502).send({ error: error instanceof UserFacingError
          ? userFacingErrorMessage(error, t)
          : t("workspaceNotification.evaluationFailed", "Workspace notification could not be evaluated") });
      } finally {
        cancellation.dispose();
        pending--;
      }
    },
  );
}
