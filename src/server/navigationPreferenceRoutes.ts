import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NAVIGATION_PREFERENCE_ROUTES } from "../shared/navigationPreferences.js";
import type { SessionPinStore } from "./storage/sessionPinStore.js";
import { InvalidNavigationPreferenceError, NavigationPreferenceConflictError, parseNavigationPreference, type NavigationPreferenceScope, type NavigationPreferenceStore } from "./storage/navigationPreferenceStore.js";
import { assertManagedCwd, managementContextForRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";
import { managementContextFromSessiondHeaders, resolveSessiondProject, type SessiondProjectReader } from "./sessiond/managementProjectResolver.js";
import type { WorkspaceCatalogResolver } from "./sessiond/workspaceCatalogRoutes.js";
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
  registerPreferenceRoutes(app, store, prefix, [0, 1], options);
}

/** Only sessiond registers these handlers; the web/API exclusively proxies them. */
export function registerSessionPinRoutes(
  app: FastifyInstance,
  pins: Pick<SessionPinStore, "get" | "put">,
  prefix = "",
  dependencies?: { projects: SessiondProjectReader; workspaces: Pick<WorkspaceCatalogResolver, "resolve">; managementProjectRoot?: string | undefined; translator?: Translator },
): void {
  const t = dependencies?.translator ?? createTranslator("en", {});
  app.route<{ Params: { projectId: string; workspaceId: string }; Body: unknown }>({
    method: ["GET", "PUT"], url: `${prefix}${NAVIGATION_PREFERENCE_ROUTES[2]}`,
    handler: async (request, reply) => {
      let managementContext;
      try { managementContext = managementContextFromSessiondHeaders(request.headers); } catch {
        return reply.code(401).send({ error: t("managementError.invalid.management.embed.context", "Invalid management embed context") });
      }
      const scope = { ...request.params, ...(managementContext === undefined ? {} : { managementContext }) };
      if (managementContext !== undefined) {
        if (dependencies?.managementProjectRoot === undefined) return reply.code(403).send({ error: t("managementError.management.embed.mode.is.not.configured", "Management embed mode is not configured") });
        try {
          const project = await resolveSessiondProject(request.headers, scope.projectId, dependencies);
          const resolution = await dependencies.workspaces.resolve(project);
          const workspace = resolution.workspaces.find((candidate) => candidate.id === scope.workspaceId);
          if (workspace === undefined) return await reply.code(404).send({ error: t("server.files.workspaceNotFound", "Workspace not found") });
          await assertManagedCwd(dependencies.managementProjectRoot, managementContext, workspace.path, { create: false });
        } catch {
          return reply.code(403).send({ error: t("managementError.managed.workspace.does.not.match.an.authorized.project", "Managed workspace does not match an authorized project") });
        }
      }
      if (request.method === "GET") return pins.get(scope);
      let preference;
      try { preference = parseNavigationPreference(request.body); } catch (error) {
        if (error instanceof InvalidNavigationPreferenceError) return reply.code(400).send({ error: userFacingErrorMessage(error, t) });
        throw error;
      }
      try { return await pins.put(scope, preference); } catch (error) {
        if (error instanceof NavigationPreferenceConflictError) return reply.code(409).send({ error: userFacingErrorMessage(error, t), ...error.current });
        throw error;
      }
    },
  });
}

function registerPreferenceRoutes(
  app: FastifyInstance,
  store: Pick<NavigationPreferenceStore, "get" | "put">,
  prefix: string,
  indexes: readonly (0 | 1 | 2)[],
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
  indexes.forEach((index) => {
    const path = NAVIGATION_PREFERENCE_ROUTES[index];
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
