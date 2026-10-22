import type { FastifyInstance } from "fastify";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { AuthService } from "./authService.js";
import { createTranslator, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";

export interface ProjectScopedAuthService {
  forProject(projectId: string): Promise<AuthService>;
}

export interface ScopedAuthServices {
  normal: ProjectScopedAuthService;
  management: AuthService;
}

export function registerAuthRoutes(app: FastifyInstance, auth: ScopedAuthServices, prefix = "", translator: Translator = createTranslator("en", {})): void {
  app.get<{ Querystring: AuthQuery }>(`${prefix}/models`, async (request, reply) => {
    let selected: AuthService;
    try {
      selected = await authForRequest(auth, request.headers, request.query.projectId, translator);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
    return selected.availableModels();
  });

  app.get<{ Querystring: AuthQuery }>(`${prefix}/auth/providers`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId, translator)).authProviders(request.query.mode ?? "login", request.query.authType);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string; key: string } }>(`${prefix}/auth/api-key`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId, translator)).saveApiKey(request.body.providerId, request.body.key);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string } }>(`${prefix}/auth/api-key/interactive`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId, translator)).startApiKeyLogin(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string } }>(`${prefix}/auth/logout`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId, translator)).logoutProvider(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string } }>(`${prefix}/auth/oauth`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId, translator)).startOAuthLogin(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.get<{ Params: { flowId: string }; Querystring: AuthQuery }>(`${prefix}/auth/oauth/:flowId`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId, translator)).oauthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(404).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Params: { flowId: string }; Querystring: AuthQuery; Body: { requestId: string; value: string } }>(`${prefix}/auth/oauth/:flowId/respond`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId, translator)).respondToOAuthFlow(request.params.flowId, request.body.requestId, request.body.value);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });

  app.post<{ Params: { flowId: string }; Querystring: AuthQuery }>(`${prefix}/auth/oauth/:flowId/cancel`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId, translator)).cancelOAuthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });
}

interface AuthQuery {
  mode?: "login" | "logout";
  authType?: "oauth" | "api_key";
  projectId?: string;
}

async function authForRequest(auth: ScopedAuthServices, headers: Record<string, string | string[] | undefined>, projectId: string | undefined, translator: Translator): Promise<AuthService> {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  const context = decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
  if (raw !== undefined && context === undefined) throw new Error(translator("providerAuth.invalidManagementContext", "Invalid management context"));
  if (context !== undefined) return auth.management;
  if (projectId === undefined || projectId === "") throw new Error(translator("providerAuth.projectRequired", "projectId query parameter is required"));
  return auth.normal.forProject(projectId);
}
