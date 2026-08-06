import type { FastifyInstance } from "fastify";
import { WorkbenchAccessStateStore } from "./accessStateStore.js";
import type { WorkbenchAgentAccessState } from "./types.js";
import { isRecord, parseAuthorizedResources } from "./workbenchClient.js";

export const WORKBENCH_ACCESS_STATE_ROUTE = "/_internal/workbench/access-states";

export function registerWorkbenchAccessStateRoutes(app: FastifyInstance, store: WorkbenchAccessStateStore): void {
  app.put<{ Params: { handle: string }; Body: unknown }>(`${WORKBENCH_ACCESS_STATE_ROUTE}/:handle`, async (request, reply) => {
    try {
      store.set(request.params.handle, parseAccessState(request.body));
      return await reply.code(204).send();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete<{ Params: { handle: string } }>(`${WORKBENCH_ACCESS_STATE_ROUTE}/:handle`, async (request, reply) => {
    store.delete(request.params.handle);
    return reply.code(204).send();
  });
}

function parseAccessState(value: unknown): WorkbenchAgentAccessState {
  if (!isRecord(value)) throw new Error("Workbench access state must be an object");
  const sessionId = value["sessionId"];
  const bearerToken = value["bearerToken"];
  const expiresAt = value["expiresAt"];
  const authorizationRevision = value["authorizationRevision"];
  if (typeof sessionId !== "string" || typeof bearerToken !== "string" || typeof expiresAt !== "string" || typeof authorizationRevision !== "number" || !Number.isInteger(authorizationRevision)) {
    throw new Error("Workbench access state is invalid");
  }
  return { sessionId, bearerToken, expiresAt, authorizationRevision, resources: parseAuthorizedResources(value["resources"]) };
}
