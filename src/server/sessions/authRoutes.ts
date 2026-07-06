import type { FastifyInstance } from "fastify";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { AuthService } from "./authService.js";

export interface ScopedAuthServices {
  normal: AuthService;
  management: AuthService;
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService | ScopedAuthServices, prefix = ""): void {
  app.get<{ Querystring: { mode?: "login" | "logout"; authType?: "oauth" | "api_key" } }>(`${prefix}/auth/providers`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).authProviders(request.query.mode ?? "login", request.query.authType);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { providerId: string; key: string } }>(`${prefix}/auth/api-key`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).saveApiKey(request.body.providerId, request.body.key);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { providerId: string } }>(`${prefix}/auth/logout`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).logoutProvider(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { providerId: string } }>(`${prefix}/auth/oauth`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).startOAuthLogin(request.body.providerId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { flowId: string } }>(`${prefix}/auth/oauth/:flowId`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).oauthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { flowId: string }; Body: { requestId: string; value: string } }>(`${prefix}/auth/oauth/:flowId/respond`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).respondToOAuthFlow(request.params.flowId, request.body.requestId, request.body.value);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { flowId: string } }>(`${prefix}/auth/oauth/:flowId/cancel`, async (request, reply) => {
    try {
      return authForRequest(auth, request.headers).cancelOAuthFlow(request.params.flowId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function authForRequest(auth: AuthService | ScopedAuthServices, headers: Record<string, string | string[] | undefined>): AuthService {
  if (!("normal" in auth)) return auth;
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  const context = decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
  return context === undefined ? auth.normal : auth.management;
}
