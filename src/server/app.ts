import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { effectivePiWebConfig } from "../config.js";
import { ProjectStore } from "./storage/projectStore.js";
import { ProjectService } from "./projects/projectService.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { asWorkspaceCatalog, type WorkspaceCatalog, type WorkspaceCatalogInput, type WorkspaceCatalogRequestOptions } from "./workspaces/workspaceCatalog.js";
import { SessionDaemonWorkspaceCatalog } from "./workspaces/sessionDaemonWorkspaceCatalog.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { pathAccessForCwd } from "./workspaces/effectivePathAccess.js";
import { loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";
import { normalizeRequestCwd } from "./workingDirectory.js";
import { listDirectorySuggestions } from "./projects/directorySuggestions.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import { loadServerPluginRecoveryConfig } from "../serverPluginRecovery.js";
import { registerSessionProxyRoutes, type ManagementProjectCwdResolver, type SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { registerGitRoutes } from "./gitRoutes.js";
import { registerTerminalProxyRoutes } from "./terminalProxyRoutes.js";
import { registerPluginBackendProxyRoutes } from "./plugins/pluginBackendProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaces/workspaceDeletionRoutes.js";
import { createFilePiWebConfigService, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { PiWebPluginService } from "./piWebPluginService.js";
import { createActiveProfilePiPackageService, type PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";
import { createPiWebStatusCache, type PiWebStatusCache } from "./piWebStatusCache.js";
import { getPiWebRuntime, getPiWebStatus, getPiWebVersionStatus } from "./piWebStatus.js";
import {
  ActiveAgentProfileAccessError,
  requireActiveAgentProfile,
  SessionDaemonActiveAgentProfileProvider,
  type ActiveAgentProfileProvider,
} from "./activeAgentProfileProvider.js";
import { MachineService } from "./machines/machineService.js";
import { registerMachineRoutes } from "./machines/machineRoutes.js";
import { registerMachineProxyRoutes } from "./machines/machineProxyRoutes.js";
import { proxyMachinePluginAsset, registerMachinePluginProxyRoutes } from "./machines/machinePluginProxyRoutes.js";
import { NormalModeAuthService, registerNormalAuthRoutes, registerNormalModeAuthGate } from "./normalAuth.js";
import { requestLoggerOptions } from "./requestLogging.js";
import {
  assertManagedCwd,
  createManagementEmbedRuntime,
  managementContextForRequest,
  managementProjectRoot,
  projectFromManagedEmbedContext,
  projectsFromManagedEmbedContext,
  type ManagementEmbedRuntime,
} from "./managementEmbed.js";
import type { Project, Workspace } from "./types.js";
import { createWorkbenchManagementRuntime } from "./workbench/gatewayIntegration.js";

export interface AppDependencies {
  projects?: ProjectService;
  workspaces?: WorkspaceService;
  workspaceCatalog?: WorkspaceCatalog;
  machines?: MachineService;
  sessionDaemon?: SessionProxyDaemon;
  agentProfileProvider?: ActiveAgentProfileProvider;
  piWebPlugins?: Pick<PiWebPluginService, "manifest" | "plugins" | "readAsset">;
  piPackages?: PiPackageService;
  piWebStatusCache?: PiWebStatusCache;
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

function registerLocalProjectRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, prefix: string, options: LocalProjectRouteOptions = {}): void {
  const catalog = asWorkspaceCatalog(projects, workspaces);
  const managementEmbed = options.managementEmbed;

  app.get(`${prefix}/projects`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      if (context !== undefined) return await projectsFromManagedEmbedContext(managementProjectRoot(managementEmbed), context);
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
        const project = await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), context, request.params.projectId, { create: true });
        return await listWorkspacesWithEffectiveConfig(project, catalog, options.config, isLegacyWorkspaceService(workspaces) ? workspaces : undefined, { managementContext: context });
      }
      const project = await projects.requireProject(request.params.projectId);
      return await listWorkspacesWithEffectiveConfig(project, catalog, options.config, isLegacyWorkspaceService(workspaces) ? workspaces : undefined);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listWorkspacesWithEffectiveConfig(project: Project, workspaces: WorkspaceCatalog, config?: Pick<PiWebConfigService, "read">, legacyWorkspaces?: WorkspaceService, options: WorkspaceCatalogRequestOptions = {}): Promise<Workspace[]> {
  const [workspaceList, effectiveConfig] = await Promise.all([
    legacyWorkspaces === undefined ? workspaces.list(project.id, options) : legacyWorkspaces.list(project),
    workspaceEffectiveConfig(project.path, config),
  ]);
  return workspaceList.map((workspace) => ({
    ...workspace,
    isGitRepo: workspace.provider?.metadata?.["isGitRepo"] === true,
    isGitWorktree: workspace.provider?.metadata?.["isGitWorktree"] === true,
    effectiveConfig,
  }));
}

function isLegacyWorkspaceService(workspaces: WorkspaceCatalogInput): workspaces is WorkspaceService {
  return !("resolveProject" in workspaces);
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<NonNullable<Workspace["effectiveConfig"]>> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  return { uploads: await loadEffectiveProjectUploadsConfig(projectPath, globalConfig) };
}

interface LocalFileSuggestionRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

function registerLocalFileSuggestionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, prefix: string, options: LocalFileSuggestionRouteOptions = {}): void {
  const catalog = asWorkspaceCatalog(projects, workspaces);
  const managementEmbed = options.managementEmbed;

  app.get<{ Querystring: { cwd?: string; q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/files`, async (request, reply) => {
    if (request.query.cwd === undefined || request.query.cwd === "") return reply.code(400).send({ error: "cwd query parameter is required" });
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      const cwd = context === undefined ? normalizeRequestCwd(request.query.cwd) : await assertManagedCwd(managementProjectRoot(managementEmbed), context, request.query.cwd, { create: false });
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessForCwd(cwd, projects, catalog, options.config) : undefined;
      if (request.query.mode === "path") return await listPathSuggestions(cwd, query, pathAccess);
      return await listFileSuggestions(cwd, query, { kind: request.query.kind, scope: request.query.scope, pathAccess });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function readEffectiveConfig(config: Pick<PiWebConfigService, "read">) {
  return (await config.read()).effectiveConfig;
}

function invalidatePiWebStatusOnWrite(config: PiWebConfigService, statusCache: Pick<PiWebStatusCache, "invalidate">): PiWebConfigService {
  return {
    read: () => config.read(),
    write: async (nextConfig) => {
      const response = await config.write(nextConfig);
      statusCache.invalidate();
      return response;
    },
  };
}

async function withProfileDependency<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ActiveAgentProfileAccessError)) throw error;
    return reply.code(503).send({ error: error.message });
  }
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? requestLoggerOptions(), ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
  await app.register(fastifyCompress, {
    globalCompression: true,
    globalDecompression: false,
    threshold: 1024,
  });
  await app.register(fastifyWebsocket);

  const projects = deps.projects ?? new ProjectService(new ProjectStore());
  const legacyWorkspaces = deps.workspaces ?? new WorkspaceService();
  const configService = deps.config ?? createFilePiWebConfigService();
  const readConfig = () => readEffectiveConfig(configService);
  const sessionDaemon = deps.sessionDaemon ?? new SessionDaemonClient();
  const runtimeConfig = effectivePiWebConfig().config;
  const baseManagementEmbed = deps.managementEmbed ?? createManagementEmbedRuntime(runtimeConfig.managementEmbed);
  const managementEmbed = createWorkbenchManagementRuntime(baseManagementEmbed, runtimeConfig.workbenchIntegration, sessionDaemon);
  const workspaces: WorkspaceCatalog = deps.workspaceCatalog ?? (deps.workspaces === undefined
    ? new SessionDaemonWorkspaceCatalog(sessionDaemon, managementEmbed)
    : asWorkspaceCatalog(projects, legacyWorkspaces));
  const workspaceInput: WorkspaceCatalogInput = deps.workspaceCatalog ?? (deps.workspaces === undefined ? workspaces : legacyWorkspaces);
  const providerRuntime = workspaces.providerRuntime === undefined
    ? undefined
    : { providerRuntime: workspaces.providerRuntime.bind(workspaces) };
  const agentProfileProvider = deps.agentProfileProvider ?? new SessionDaemonActiveAgentProfileProvider(sessionDaemon);
  const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService({
    configProvider: readConfig,
    agentDirProvider: async () => (await requireActiveAgentProfile(agentProfileProvider)).dir,
    ...(providerRuntime === undefined ? {} : { runtimeProvider: providerRuntime }),
    recoveryProvider: () => loadServerPluginRecoveryConfig(),
  });
  const piPackages = deps.piPackages ?? createActiveProfilePiPackageService(agentProfileProvider);
  const piWebStatusCache = deps.piWebStatusCache ?? createPiWebStatusCache(
    async ({ force }) => {
      const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
      return getPiWebStatus(sessionDaemon, {
        forceReleaseCheck: force,
        ...(activeAgentProfile.status === "available" ? { activeAgentProfile: activeAgentProfile.profile } : {}),
      });
    },
    { onError: (error) => { app.log.warn({ err: error }, "failed to refresh PI WEB status cache"); } },
  );
  const machines = deps.machines ?? new MachineService(undefined, {
    localRuntime: () => getPiWebRuntime(sessionDaemon),
  });
  const resolveManagementProjectCwds: ManagementProjectCwdResolver = async (projectId, context) => {
    const project = await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), context, projectId, { create: false });
    const listed = isLegacyWorkspaceService(workspaceInput) ? await workspaceInput.list(project) : await workspaces.list(project.id, { managementContext: context });
    return listed.map((workspace) => workspace.path);
  };
  const normalAuth = new NormalModeAuthService(configService);
  const normalAuthLoginAttempts = registerNormalAuthRoutes(app, normalAuth);
  registerNormalModeAuthGate(app, normalAuth, managementEmbed, normalAuthLoginAttempts);

  app.get("/pi-web-plugins/manifest.json", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.manifest()));

  app.get<{ Params: { pluginId: string; "*": string } }>("/pi-web-plugins/:pluginId/*", async (request, reply) => {
    if (await proxyMachinePluginAsset(machines, request.params.pluginId, request.params["*"], request.url, reply)) return;

    return withProfileDependency(reply, async () => {
      const asset = await piWebPlugins.readAsset(request.params.pluginId, request.params["*"]);
      if (asset === undefined) return reply.code(404).send({ error: "Plugin asset not found" });
      return reply.type(asset.contentType).send(asset.content);
    });
  });

  app.get<{ Querystring: { refresh?: string } }>("/api/pi-web/status", async (request) => request.query.refresh === "1"
    ? piWebStatusCache.refresh({ force: true })
    : piWebStatusCache.get());
  app.get("/api/pi-web/version", async () => {
    const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
    return getPiWebVersionStatus(sessionDaemon, activeAgentProfile.status === "available" ? { activeAgentProfile: activeAgentProfile.profile } : {});
  });
  app.get("/api/pi-web/runtime", async () => getPiWebRuntime(sessionDaemon));
  app.get("/api/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  app.get("/api/machines/local/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  registerPiPackageRoutes(app, piPackages);
  registerPiPackageRoutes(app, piPackages, "/api/machines/local");
  const invalidatingConfigService = invalidatePiWebStatusOnWrite(configService, piWebStatusCache);
  registerConfigRoutes(app, invalidatingConfigService);
  registerLocalMachineConfigRoutes(app, invalidatingConfigService);

  registerMachineRoutes(app, machines);
  registerMachinePluginProxyRoutes(app, machines);

  registerLocalProjectRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed });
  registerLocalProjectRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed });

  registerSessionProxyRoutes(app, sessionDaemon, "/api", managementEmbed, resolveManagementProjectCwds);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed, resolveManagementProjectCwds);
  registerPluginBackendProxyRoutes(app, sessionDaemon, "/api/plugin-backends", managementEmbed);
  registerPluginBackendProxyRoutes(app, sessionDaemon, "/api/machines/local/plugin-backends", managementEmbed);
  registerWorkspaceExplorerRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed });
  registerWorkspaceExplorerRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed });
  registerGitRoutes(app, projects, legacyWorkspaces, "/api", managementEmbed);
  registerGitRoutes(app, projects, legacyWorkspaces, "/api/machines/local", managementEmbed);
  registerTerminalProxyRoutes(app, projects, workspaceInput, sessionDaemon, "/api", managementEmbed);
  registerTerminalProxyRoutes(app, projects, workspaceInput, sessionDaemon, "/api/machines/local", managementEmbed);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api", managementEmbed);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed);

  registerLocalFileSuggestionRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed });
  registerLocalFileSuggestionRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed });

  registerMachineProxyRoutes(app, machines);

  const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
  const clientDist = deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
  if (clientDist !== false && existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.url, "http://pi-web.local").pathname;
      const acceptsHtml = request.headers.accept?.split(",").some((value) => value.trim().split(";", 1)[0] === "text/html") ?? false;
      if (request.method === "GET" && acceptsHtml && !pathname.startsWith("/api/") && !pathname.startsWith("/assets/") && !pathname.startsWith("/pi-web-plugins/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
