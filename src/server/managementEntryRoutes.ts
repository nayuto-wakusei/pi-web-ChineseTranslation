import type { FastifyInstance } from "fastify";
import { createTranslator, type Translator } from "../shared/i18n.js";
import type { ManagementEntryTicketResponse } from "../shared/apiTypes.js";
import { isRecord } from "../shared/piWebConfigParsing.js";
import { encodeManagementContext, establishManagementSession, type ManagementEmbedRuntime } from "./managementEmbed.js";
import { ManagementEntryTickets } from "./managementEntryTickets.js";
import { MANAGEMENT_CONTEXT_HEADER_LIMIT, MANAGEMENT_ENTRY_BODY_LIMIT } from "./managementTransportLimits.js";

// Gateway login endpoints, deliberately not federated machine APIs.
export function registerManagementEntryRoutes(app: FastifyInstance, runtime: ManagementEmbedRuntime | undefined, t: Translator = createTranslator("en", {}), tickets = new ManagementEntryTickets()): void {
  app.addHook("onClose", () => { tickets.clear(); return Promise.resolve(); });
  app.post("/api/management-entry-tickets", { bodyLimit: MANAGEMENT_ENTRY_BODY_LIMIT }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (runtime?.enabled !== true || runtime.createSession === undefined) {
      return reply.code(503).send({ error: t("managementEntry.unavailable", "Management entry is unavailable") });
    }
    if (!isRecord(request.body) || typeof request.body["token"] !== "string" || request.body["token"].trim() === "") {
      return reply.code(400).send({ error: t("managementEntry.tokenRequired", "A signed management entry token is required") });
    }
    let context;
    try {
      // Never accept a browser Cookie as authorization for minting new entries.
      context = await runtime.authenticate(request.body["token"]);
    } catch {
      return reply.code(401).send({ error: t("managementEntry.invalidToken", "Management entry token is invalid or expired") });
    }
    if (encodeManagementContext(context).length > MANAGEMENT_CONTEXT_HEADER_LIMIT) {
      return reply.code(413).send({ error: t("managementEntry.tooLarge", "Management entry context is too large") });
    }
    const entry = tickets.create(context);
    if (entry === undefined) return reply.code(503).send({ error: t("managementEntry.busy", "Management entry is busy or expired; request a new entry") });
    const response: ManagementEntryTicketResponse = { entryPath: `management-entry?ticket=${entry.ticket}`, expiresAt: entry.expiresAt };
    return reply.code(201).send(response);
  });

  app.get("/management-entry", { exposeHeadRoute: false }, async (request, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    const ticket = isRecord(request.query) ? request.query["ticket"] : undefined;
    const context = typeof ticket === "string" ? tickets.take(ticket) : undefined;
    if (runtime?.enabled !== true || runtime.createSession === undefined || context === undefined) {
      return reply.code(401).send({ error: t("managementEntry.invalidTicket", "Management entry has expired or was already used; return to the platform") });
    }
    try {
      await runtime.prepareContext?.(context);
    } catch {
      return reply.code(503).send({ error: t("managementEntry.unavailable", "Management entry is unavailable") });
    }
    establishManagementSession(request, reply, runtime, context);
    return reply.redirect("./?embed=management", 303);
  });
}
