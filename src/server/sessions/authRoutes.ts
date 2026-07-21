import type { FastifyInstance } from "fastify";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { AuthService } from "./authService.js";

export interface ProjectScopedAuthService {
  forProject(projectId: string): Promise<AuthService>;
}

export interface ScopedAuthServices {
  normal: ProjectScopedAuthService;
  management: AuthService;
}

export function registerAuthRoutes(app: FastifyInstance, auth: ScopedAuthServices, prefix = ""): void {
  app.get<{ Querystring: AuthQuery }>(`${prefix}/auth/providers`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId)).authProviders(request.query.mode ?? "login", request.query.authType);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string; key: string } }>(`${prefix}/auth/api-key`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId)).saveApiKey(request.body.providerId, request.body.key);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string } }>(`${prefix}/auth/logout`, async (request, reply) => {
    try {
      return await (await authForRequest(auth, request.headers, request.query.projectId)).logoutProvider(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Querystring: AuthQuery; Body: { providerId: string } }>(`${prefix}/auth/oauth`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId)).startOAuthLogin(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { flowId: string }; Querystring: AuthQuery }>(`${prefix}/auth/oauth/:flowId`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId)).oauthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { flowId: string }; Querystring: AuthQuery; Body: { requestId: string; value: string } }>(`${prefix}/auth/oauth/:flowId/respond`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId)).respondToOAuthFlow(request.params.flowId, request.body.requestId, request.body.value);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { flowId: string }; Querystring: AuthQuery }>(`${prefix}/auth/oauth/:flowId/cancel`, async (request, reply) => {
    try {
      return (await authForRequest(auth, request.headers, request.query.projectId)).cancelOAuthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

interface AuthQuery {
  mode?: "login" | "logout";
  authType?: "oauth" | "api_key";
  projectId?: string;
}

async function authForRequest(auth: ScopedAuthServices, headers: Record<string, string | string[] | undefined>, projectId: string | undefined): Promise<AuthService> {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  const context = decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
  if (context !== undefined) return auth.management;
  if (projectId === undefined || projectId === "") throw new Error("projectId query parameter is required");
  return auth.normal.forProject(projectId);
}
