import type { FastifyInstance } from "fastify";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunStatus } from "../../shared/apiTypes.js";
import type { RunTerminalCommandOptions } from "./managementCommandRunService.js";
import { decodeManagementContext, managementToolAllowed, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";

export interface ManagementTerminalRouteService {
  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun;
  listCommandRuns(filter?: TerminalCommandRunFilter, managementContext?: ManagementEmbedContext): TerminalCommandRun[];
  getCommandRun(runId: string, managementContext?: ManagementEmbedContext): TerminalCommandRun | undefined;
  cancelCommandRun(runId: string, managementContext?: ManagementEmbedContext): TerminalCommandRun;
}

/** Only the forwarded management context may use the controlled command-run service. */
export function registerManagementTerminalRoutes(app: FastifyInstance, terminals: ManagementTerminalRouteService): void {
  app.register((routes, _options, done) => {
    routes.addHook("onRequest", async (request, reply) => {
      const context = managementContextFromHeaders(request.headers);
      if (context === undefined) return await reply.code(410).send({ error: "Ordinary terminals use the bundled Terminal plugin peer" });
      if (context.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(context, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
    });
    registerCommandRunRoutes(routes, terminals);
    done();
  });
  for (const path of ["/terminals", "/terminals/*"]) {
    app.route({ method: ["GET", "POST", "DELETE"], url: path, handler: (request, reply) => {
      const context = managementContextFromHeaders(request.headers);
      return reply.code(context === undefined ? 410 : 403).send({ error: context === undefined
        ? "Ordinary terminals use the bundled Terminal plugin peer"
        : "Interactive terminal is disabled in management embed mode" });
    } });
  }
}

function registerCommandRunRoutes(app: FastifyInstance, terminals: ManagementTerminalRouteService): void {
  app.post<{ Body: RunTerminalCommandOptions }>(`/terminal-command-runs`, (request, reply) => {
    try {
      const managementContext = managementContextFromHeaders(request.headers);
      return terminals.runCommand({ ...request.body, cwd: normalizeRequestCwd(request.body.cwd), ...(managementContext === undefined ? {} : { managementContext }) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Querystring: TerminalCommandRunQuery }>(`/terminal-command-runs`, (request, reply) => {
    try {
      return terminals.listCommandRuns(parseCommandRunFilter(request.query), managementContextFromHeaders(request.headers));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { runId: string } }>(`/terminal-command-runs/:runId/cancel`, (request, reply) => {
    try {
      return terminals.cancelCommandRun(request.params.runId, managementContextFromHeaders(request.headers));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { runId: string } }>(`/terminal-command-runs/:runId`, (request, reply) => {
    const run = terminals.getCommandRun(request.params.runId, managementContextFromHeaders(request.headers));
    if (run === undefined) return reply.code(404).send({ error: "Terminal command run not found" });
    return run;
  });

}

function managementContextFromHeaders(headers: Record<string, string | string[] | undefined>): ManagementEmbedContext | undefined {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  return decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
}

interface TerminalCommandRunQuery {
  projectId?: string;
  workspaceId?: string;
  terminalId?: string;
  statuses?: string;
  metadata?: string;
}

function parseCommandRunFilter(query: TerminalCommandRunQuery): TerminalCommandRunFilter {
  const metadata = query.metadata === undefined || query.metadata === "" ? undefined : parseMetadataFilter(query.metadata);
  const statuses = query.statuses === undefined || query.statuses === "" ? undefined : query.statuses.split(",").filter((status) => status !== "").map(parseCommandRunStatus);
  return {
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
    ...(query.terminalId === undefined ? {} : { terminalId: query.terminalId }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseCommandRunStatus(value: string): TerminalCommandRunStatus {
  if (value !== "queued" && value !== "running" && value !== "succeeded" && value !== "failed") throw new Error(`Invalid command run status: ${value}`);
  return value;
}

function parseMetadataFilter(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error("metadata filter must be an object");
  return Object.fromEntries(Object.entries(parsed).map(([key, metadataValue]) => {
    if (typeof metadataValue !== "string") throw new Error(`metadata filter value must be a string: ${key}`);
    return [key, metadataValue];
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
