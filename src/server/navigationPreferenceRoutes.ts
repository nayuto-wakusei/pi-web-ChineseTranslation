import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NAVIGATION_PREFERENCE_ROUTES } from "../shared/navigationPreferences.js";
import { InvalidNavigationPreferenceError, NavigationPreferenceConflictError, parseNavigationPreference, type NavigationPreferenceScope, type NavigationPreferenceStore } from "./storage/navigationPreferenceStore.js";
import { managementContextForRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";
import { createTranslator, userFacingErrorMessage, type Translator } from "../shared/i18n.js";

export interface NavigationPreferenceRouteOptions {
  managementEmbed?: ManagementEmbedRuntime;
  translator?: Translator;
}

interface PreferenceParams {
  projectId?: string;
  workspaceId?: string;
}

function preferenceScope(index: number, params: PreferenceParams): NavigationPreferenceScope {
  if (index === 0) return { kind: "projects" };
  if (params.projectId === undefined) throw new Error("Missing project scope");
  if (index === 1) return { kind: "workspaces", projectId: params.projectId };
  if (params.workspaceId === undefined) throw new Error("Missing workspace scope");
  return { kind: "session-pins", projectId: params.projectId, workspaceId: params.workspaceId };
}

export function registerNavigationPreferenceRoutes(
  app: FastifyInstance,
  store: Pick<NavigationPreferenceStore, "get" | "put">,
  prefix = "/api",
  options: NavigationPreferenceRouteOptions = {},
): void {
  const translate = options.translator ?? createTranslator("en", {});
  const normalRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    try {
      if (await managementContextForRequest(request, options.managementEmbed, reply) === undefined) return true;
      await reply.code(403).send({ error: translate("navigationPreference.managementUnavailable", "Navigation ordering is unavailable in management mode") });
    } catch (error) {
      await reply.code(401).send({ error: userFacingErrorMessage(error, translate) });
    }
    return false;
  };
  NAVIGATION_PREFERENCE_ROUTES.forEach((path, index) => {
    app.get<{ Params: PreferenceParams }>(`${prefix}${path}`, async (request, reply) => {
      if (!await normalRequest(request, reply)) return;
      return store.get(preferenceScope(index, request.params));
    });
    app.put<{ Params: PreferenceParams; Body: unknown }>(`${prefix}${path}`, async (request, reply) => {
      if (!await normalRequest(request, reply)) return;
      let preference;
      try {
        preference = parseNavigationPreference(request.body);
      } catch (error) {
        if (error instanceof InvalidNavigationPreferenceError) return reply.code(400).send({ error: userFacingErrorMessage(error, translate) });
        throw error;
      }
      try {
        return await store.put(preferenceScope(index, request.params), preference);
      } catch (error) {
        if (error instanceof NavigationPreferenceConflictError) {
          return reply.code(409).send({ error: userFacingErrorMessage(error, translate), ...error.current });
        }
        throw error;
      }
    });
  });
}
