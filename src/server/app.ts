import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { effectivePiWebConfig } from "../config.js";
import { ProjectStore } from "./storage/projectStore.js";
import { ProjectService } from "./projects/projectService.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { pathAccessForCwd } from "./workspaces/effectivePathAccess.js";
import { loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";
import { normalizeRequestCwd } from "./workingDirectory.js";
import { listDirectorySuggestions } from "./projects/directorySuggestions.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { registerGitRoutes } from "./gitRoutes.js";
import { registerTerminalProxyRoutes } from "./terminalProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaces/workspaceDeletionRoutes.js";
import { createFilePiWebConfigService, registerConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { PiWebPluginService } from "./piWebPluginService.js";
import { createPiWebStatusCache } from "./piWebStatusCache.js";
import { getPiWebRuntime, getPiWebStatus, getPiWebVersionStatus } from "./piWebStatus.js";
import { MachineService } from "./machines/machineService.js";
import { registerMachineRoutes } from "./machines/machineRoutes.js";
import { registerMachineProxyRoutes } from "./machines/machineProxyRoutes.js";
import { proxyMachinePluginAsset, registerMachinePluginProxyRoutes } from "./machines/machinePluginProxyRoutes.js";
import {
  assertManagedCwd,
  createManagementEmbedRuntime,
  managementContextForRequest,
  projectFromManagedEmbedContext,
  projectsFromManagedEmbedContext,
  type ManagementEmbedRuntime,
} from "./managementEmbed.js";
import type { Project, Workspace } from "./types.js";

export interface AppDependencies {
  projects?: ProjectService;
  workspaces?: WorkspaceService;
  machines?: MachineService;
  sessionDaemon?: SessionProxyDaemon;
  piWebPlugins?: Pick<PiWebPluginService, "manifest" | "plugins" | "readAsset">;
  config?: PiWebConfigService;
  managementEmbed?: ManagementEmbedRuntime;
  clientDist?: string | false;
  logger?: FastifyServerOptions["logger"];
  /** Maximum accepted HTTP request body size in bytes. */
  bodyLimit?: number;
}

interface LocalProjectRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

function registerLocalProjectRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix: string, options: LocalProjectRouteOptions = {}): void {
  const managementEmbed = options.managementEmbed;

  app.get(`${prefix}/projects`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      if (context !== undefined) return await projectsFromManagedEmbedContext(managementEmbedProjectRoot(managementEmbed), context);
      return await projects.list();
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { name?: string; path: string; create?: boolean } }>(`${prefix}/projects`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Project management is disabled in management embed mode" });
      return await projects.add(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Project management is disabled in management embed mode" });
      await projects.close(request.params.projectId);
      return { closed: true };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Querystring: { q?: string } }>(`${prefix}/project-directories`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Project directory browsing is disabled in management embed mode" });
      return await listDirectorySuggestions(request.query.q ?? "");
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId/workspaces`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      if (context !== undefined) {
        const project = await projectFromManagedEmbedContext(managementEmbedProjectRoot(managementEmbed), context, request.params.projectId, { create: false });
        return await listWorkspacesWithEffectiveConfig(project, workspaces, options.config);
      }
      const project = await projects.requireProject(request.params.projectId);
      return await listWorkspacesWithEffectiveConfig(project, workspaces, options.config);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listWorkspacesWithEffectiveConfig(project: Project, workspaces: WorkspaceService, config?: Pick<PiWebConfigService, "read">): Promise<Workspace[]> {
  const [workspaceList, effectiveConfig] = await Promise.all([
    workspaces.list(project),
    workspaceEffectiveConfig(project.path, config),
  ]);
  return workspaceList.map((workspace) => ({ ...workspace, effectiveConfig }));
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<NonNullable<Workspace["effectiveConfig"]>> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  return { uploads: await loadEffectiveProjectUploadsConfig(projectPath, globalConfig) };
}

interface LocalFileSuggestionRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

function registerLocalFileSuggestionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix: string, options: LocalFileSuggestionRouteOptions = {}): void {
  const managementEmbed = options.managementEmbed;

  app.get<{ Querystring: { cwd?: string; q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/files`, async (request, reply) => {
    if (request.query.cwd === undefined || request.query.cwd === "") return reply.code(400).send({ error: "cwd query parameter is required" });
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      const cwd = context === undefined ? normalizeRequestCwd(request.query.cwd) : await assertManagedCwd(managementEmbedProjectRoot(managementEmbed), context, request.query.cwd, { create: false });
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessForCwd(cwd, projects, workspaces, options.config) : undefined;
      if (request.query.mode === "path") return await listPathSuggestions(cwd, query, pathAccess);
      return await listFileSuggestions(cwd, query, { kind: request.query.kind, scope: request.query.scope, pathAccess });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true, ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
  await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  await app.register(fastifyWebsocket);

  const projects = deps.projects ?? new ProjectService(new ProjectStore());
  const workspaces = deps.workspaces ?? new WorkspaceService();
  const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService();
  const configService = deps.config ?? createFilePiWebConfigService();
  const sessionDaemon = deps.sessionDaemon ?? new SessionDaemonClient();
  const piWebStatusCache = createPiWebStatusCache(() => getPiWebStatus(sessionDaemon), {
    onError: (error) => { app.log.warn({ err: error }, "failed to refresh PI WEB status cache"); },
  });
  const machines = deps.machines ?? new MachineService(undefined, {
    localRuntime: () => getPiWebRuntime(sessionDaemon),
  });
  const managementEmbed = deps.managementEmbed ?? createManagementEmbedRuntime(effectivePiWebConfig().config.managementEmbed);

  app.get("/pi-web-plugins/manifest.json", async () => piWebPlugins.manifest());

  app.get<{ Params: { pluginId: string; "*": string } }>("/pi-web-plugins/:pluginId/*", async (request, reply) => {
    if (await proxyMachinePluginAsset(machines, request.params.pluginId, request.params["*"], request.url, reply)) return;

    const asset = await piWebPlugins.readAsset(request.params.pluginId, request.params["*"]);
    if (asset === undefined) return reply.code(404).send({ error: "Plugin asset not found" });
    return reply.type(asset.contentType).send(asset.content);
  });

  app.get("/api/pi-web/status", async () => piWebStatusCache.get());
  app.get("/api/pi-web/version", async () => getPiWebVersionStatus(sessionDaemon));
  app.get("/api/pi-web/runtime", async () => getPiWebRuntime(sessionDaemon));
  app.get("/api/plugins", async () => piWebPlugins.plugins());
  registerConfigRoutes(app, configService);

  registerMachineRoutes(app, machines);
  registerMachinePluginProxyRoutes(app, machines);

  registerLocalProjectRoutes(app, projects, workspaces, "/api", { config: configService, managementEmbed });
  registerLocalProjectRoutes(app, projects, workspaces, "/api/machines/local", { config: configService, managementEmbed });

  registerSessionProxyRoutes(app, sessionDaemon, "/api", managementEmbed);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed);
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api", { config: configService, managementEmbed });
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api/machines/local", { config: configService, managementEmbed });
  registerGitRoutes(app, projects, workspaces, "/api", managementEmbed);
  registerGitRoutes(app, projects, workspaces, "/api/machines/local", managementEmbed);
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api", managementEmbed);
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local", managementEmbed);
  registerWorkspaceDeletionRoutes(app, projects, workspaces, sessionDaemon, "/api", managementEmbed);
  registerWorkspaceDeletionRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local", managementEmbed);

  registerLocalFileSuggestionRoutes(app, projects, workspaces, "/api", { config: configService, managementEmbed });
  registerLocalFileSuggestionRoutes(app, projects, workspaces, "/api/machines/local", { config: configService, managementEmbed });

  registerMachineProxyRoutes(app, machines);

  const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
  const clientDist = deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
  if (clientDist !== false && existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}

function managementEmbedProjectRoot(managementEmbed: ManagementEmbedRuntime | undefined): string {
  if (managementEmbed === undefined) throw new Error("Management embed mode is not configured");
  return managementEmbed.projectRoot;
}
