import type { FastifyReply } from "fastify";
import { createTranslator, type Translator } from "../../shared/i18n.js";
import { workspaceErrorMessage } from "./workspaceUserError.js";
import { workspaceCatalogHttpStatus } from "./workspaceCatalog.js";

export function sendWorkspaceRequestError(
  reply: FastifyReply,
  error: unknown,
  fallbackStatus: number,
  translate: Translator = createTranslator("en", {}),
): FastifyReply {
  return reply.code(workspaceCatalogHttpStatus(error, fallbackStatus)).send({
    error: workspaceErrorMessage(error, translate),
  });
}
