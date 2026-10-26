import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { effectivePiWebConfig } from "../config.js";
import { loadNodeTranslator } from "../localization.js";
import { userFacingErrorMessage, type Translator } from "../shared/i18n.js";
import { ProjectStore } from "./storage/projectStore.js";
import { NavigationPreferenceStore } from "./storage/navigationPreferenceStore.js";
import { registerNavigationPreferenceRoutes } from "./navigationPreferenceRoutes.js";
import { ProjectService } from "./projects/projectService.js";
import { asWorkspaceCatalog, type WorkspaceCatalog, type WorkspaceCatalogInput, type WorkspaceCatalogRequestOptions, type WorkspaceListAdapter } from "./workspaces/workspaceCatalog.js";
import { SessionDaemonWorkspaceCatalog } from "./workspaces/sessionDaemonWorkspaceCatalog.js";
import { sendWorkspaceRequestError } from "./workspaces/workspaceRouteErrors.js";
import { createNormalProjectCwdResolver } from "./workspaces/normalProjectCwdResolver.js";
import { FileSuggestionCatalog, isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { pathAccessForCwd } from "./workspaces/effectivePathAccess.js";
import { loadEffectiveProjectAttachmentsConfig, loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";
import { normalizeRequestCwd } from "./workingDirectory.js";
import { listDirectorySuggestions } from "./projects/directorySuggestions.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import { loadServerPluginRecoveryConfig } from "../serverPluginRecovery.js";
import { registerSessionProxyRoutes, type ManagementProjectCwdResolver, type NormalProjectCwdResolver, type SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { registerProjectTrustRoutes } from "./projectTrustRoutes.js";
import { registerManagementTerminalProxyRoutes } from "./managementTerminalProxyRoutes.js";
import { registerManagementAgentsRoutes } from "./managementAgentsRoutes.js";
import { registerPluginBackendProxyRoutes } from "./plugins/pluginBackendProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaces/workspaceDeletionRoutes.js";
import { createFilePiWebConfigService, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { PiWebPluginManifestRuntimeError, PiWebPluginService } from "./piWebPluginService.js";
import { createActiveProfilePiPackageService, type PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";
import { createPiWebStatusCache, type PiWebStatusCache } from "./piWebStatusCache.js";
import { detectPiWebInstallation, getPiWebRuntime, getPiWebStatus, getPiWebVersionStatus } from "./piWebStatus.js";
import { createDeploymentFlavorResolver, type PiWebDeploymentFlavor } from "./deploymentIdentity.js";
import { registerDeploymentIdentityAssetRoutes } from "./deploymentIdentityRoutes.js";
import {
  ActiveAgentProfileAccessError,
  requireActiveAgentProfile,
  SessionDaemonActiveAgentProfileProvider,
  type ActiveAgentProfileProvider,
} from "./activeAgentProfileProvider.js";
import { MachineService } from "./machines/machineService.js";
import { registerMachineRoutes } from "./machines/machineRoutes.js";
import { registerMachineProxyRoutes } from "./machines/machineProxyRoutes.js";
import { registerPluginBackendChannelProxyRoutes } from "./plugins/pluginBackendChannelProxyRoutes.js";
import { handleWebSocketError, installPluginBackendChannelWebSocketPayloadLimit } from "./webSocketBridge.js";
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
import type { Project, WorkspaceEffectiveConfig } from "./types.js";
import type { WorkspaceProviderResolution } from "../shared/apiTypes.js";
import { createWorkbenchManagementRuntime } from "./workbench/gatewayIntegration.js";

export interface AppDependencies {
  translator?: Translator;
  projects?: ProjectService;
  navigationPreferences?: Pick<NavigationPreferenceStore, "get" | "put">;
  workspaces?: WorkspaceListAdapter;
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
  /** Overrides deployment-flavor detection (dev/stable asset identity) in tests. */
  deploymentFlavor?: () => Promise<PiWebDeploymentFlavor>;
  logger?: FastifyServerOptions["logger"];
  /** Maximum accepted HTTP request body size in bytes. */
  bodyLimit?: number;
}

interface LocalProjectRouteOptions {
  translator: Translator;
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

function registerLocalProjectRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, prefix: string, options: LocalProjectRouteOptions): void {
  const catalog = asWorkspaceCatalog(projects, workspaces);
  const managementEmbed = options.managementEmbed;
  const t = options.translator;

  app.get(`${prefix}/projects`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      if (context !== undefined) return await projectsFromManagedEmbedContext(managementProjectRoot(managementEmbed), context, t);
      return await projects.list();
    } catch (error) {
      return reply.code(401).send({ error: userFacingErrorMessage(error, t) });
    }
  });

  app.get<{ Querystring: { q?: string } }>(`${prefix}/project-directories`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: t("gateway.projectBrowsingDisabled", "Project directory browsing is disabled in management embed mode") });
      return await listDirectorySuggestions(request.query.q ?? "");
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, t) });
    }
  });

  app.get<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId/workspaces`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      if (context !== undefined) {
        const project = await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), context, request.params.projectId, { create: true });
        return await resolveWorkspacesWithEffectiveConfig(project, catalog, options.config, { managementContext: context }, isLegacyWorkspaceService(workspaces) ? workspaces : undefined);
      }
      const project = await projects.requireProject(request.params.projectId);
      return await resolveWorkspacesWithEffectiveConfig(project, catalog, options.config);
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 404);
    }
  });
}

async function resolveWorkspacesWithEffectiveConfig(project: Project, workspaces: WorkspaceCatalog, config?: Pick<PiWebConfigService, "read">, options: WorkspaceCatalogRequestOptions = {}, legacyWorkspaces?: WorkspaceListAdapter): Promise<WorkspaceProviderResolution> {
  const catalog = legacyWorkspaces === undefined
    ? workspaces
    : asWorkspaceCatalog({ requireProject: () => Promise.resolve(project) }, legacyWorkspaces);
  const [resolution, effectiveConfig] = await Promise.all([catalog.resolveProject(project.id, options), workspaceEffectiveConfig(project.path, config)]);
  return {
    ...resolution,
    workspaces: resolution.workspaces.map((workspace) => ({
      ...workspace,
      isGitRepo: workspace.provider === undefined ? "isGitRepo" in workspace && workspace.isGitRepo === true : workspace.provider.metadata?.["isGitRepo"] === true,
      isGitWorktree: workspace.provider === undefined ? "isGitWorktree" in workspace && workspace.isGitWorktree === true : workspace.provider.metadata?.["isGitWorktree"] === true,
      effectiveConfig,
    })),
  };
}

function isLegacyWorkspaceService(workspaces: WorkspaceCatalogInput): workspaces is WorkspaceListAdapter {
  return !("resolveProject" in workspaces);
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<WorkspaceEffectiveConfig> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  const [uploads, attachments] = await Promise.all([
    loadEffectiveProjectUploadsConfig(projectPath, globalConfig),
    loadEffectiveProjectAttachmentsConfig(projectPath, globalConfig),
  ]);
  return { uploads, attachments };
}

interface LocalFileSuggestionRouteOptions {
  translator: Translator;
  fileSuggestions?: FileSuggestionCatalog;
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

function registerLocalFileSuggestionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, prefix: string, options: LocalFileSuggestionRouteOptions): void {
  const catalog = asWorkspaceCatalog(projects, workspaces);
  const managementEmbed = options.managementEmbed;
  const t = options.translator;

  app.get<{ Querystring: { cwd?: string; q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/files`, async (request, reply) => {
    if (request.query.cwd === undefined || request.query.cwd === "") return reply.code(400).send({ error: options.translator("gateway.cwdRequired", "cwd query parameter is required") });
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      const cwd = context === undefined ? normalizeRequestCwd(request.query.cwd) : await assertManagedCwd(managementProjectRoot(managementEmbed), context, request.query.cwd, { create: false });
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessForCwd(cwd, projects, catalog, options.config) : undefined;
      if (request.query.mode === "path") return await listPathSuggestions(cwd, query, pathAccess);
      return await listFileSuggestions(cwd, query, { kind: request.query.kind, scope: request.query.scope, pathAccess }, { ...(options.fileSuggestions === undefined ? {} : { catalog: options.fileSuggestions }), catalogKey: JSON.stringify([context?.user, cwd]) });
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, t) });
    }
  });
}

async function readEffectiveConfig(config: Pick<PiWebConfigService, "read">) {
  return (await config.read()).effectiveConfig;
}

async function desiredPluginAgentDir(
  profiles: ActiveAgentProfileProvider,
  config: Pick<PiWebConfigService, "read">,
): Promise<string> {
  try {
    return (await requireActiveAgentProfile(profiles)).dir;
  } catch (error) {
    if (!(error instanceof ActiveAgentProfileAccessError)) throw error;
    const desiredDir = (await config.read()).effectiveConfig.agent?.dir;
    if (desiredDir === undefined || desiredDir === "") throw error;
    return desiredDir;
  }
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
    if (error instanceof ActiveAgentProfileAccessError) return reply.code(503).send({ error: error.message });
    if (error instanceof PiWebPluginManifestRuntimeError) {
      return reply.code(error.statusCode).send({
        error: `Required Terminal plugin runtime is ${error.runtimeStatus}`,
        code: `required-plugin-runtime-${error.runtimeStatus}`,
        detail: error.message,
      });
    }
    throw error;
  }
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? requestLoggerOptions(), ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
  await app.register(fastifyCompress, {
    globalCompression: true,
    globalDecompression: false,
    threshold: 1024,
  });
  await app.register(fastifyWebsocket, { errorHandler: handleWebSocketError });
  installPluginBackendChannelWebSocketPayloadLimit(app.websocketServer);

  const projects = deps.projects ?? new ProjectService(new ProjectStore());
  const configService = deps.config ?? createFilePiWebConfigService();
  const readConfig = () => readEffectiveConfig(configService);
  const t = deps.translator ?? loadNodeTranslator("server", await readConfig());
  const sessionDaemon = deps.sessionDaemon ?? new SessionDaemonClient();
  const runtimeConfig = effectivePiWebConfig().config;
  const baseManagementEmbed = deps.managementEmbed ?? createManagementEmbedRuntime(runtimeConfig.managementEmbed);
  const managementEmbed = createWorkbenchManagementRuntime(baseManagementEmbed, runtimeConfig.workbenchIntegration, sessionDaemon, {
    allowPrivileged: runtimeConfig.managementEmbed?.allowPrivileged === true,
  });
  const workspaces: WorkspaceCatalog = deps.workspaceCatalog ?? (deps.workspaces === undefined
    ? new SessionDaemonWorkspaceCatalog(sessionDaemon, managementEmbed)
    : asWorkspaceCatalog(projects, deps.workspaces));
  const workspaceInput: WorkspaceCatalogInput = deps.workspaceCatalog ?? deps.workspaces ?? workspaces;
  const providerRuntime = workspaces.providerRuntime === undefined
    ? undefined
    : { providerRuntime: workspaces.providerRuntime.bind(workspaces) };
  const agentProfileProvider = deps.agentProfileProvider ?? new SessionDaemonActiveAgentProfileProvider(sessionDaemon);
  const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService({
    configProvider: readConfig,
    agentDirProvider: () => desiredPluginAgentDir(agentProfileProvider, configService),
    ...(providerRuntime === undefined ? {} : { runtimeProvider: providerRuntime }),
    recoveryProvider: () => loadServerPluginRecoveryConfig(),
  });
  const piPackages = deps.piPackages ?? createActiveProfilePiPackageService(agentProfileProvider, undefined, undefined, t);
  const piWebStatusCache = deps.piWebStatusCache ?? createPiWebStatusCache(
    async ({ force }) => {
      const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
      return getPiWebStatus(sessionDaemon, {
        translator: t,
        forceReleaseCheck: force,
        ...(activeAgentProfile.status === "available" ? { activeAgentProfile: activeAgentProfile.profile } : {}),
      });
    },
    { onError: (error) => { app.log.warn({ err: error }, "failed to refresh PI WEB status cache"); } },
  );
  const machines = deps.machines ?? new MachineService(undefined, {
    translate: t,
    localRuntime: () => getPiWebRuntime(sessionDaemon),
  });
  const resolveManagementProjectCwds: ManagementProjectCwdResolver = async (projectId, context) => {
    const project = await projectFromManagedEmbedContext(managementProjectRoot(managementEmbed), context, projectId, { create: false });
    const listed = isLegacyWorkspaceService(workspaceInput) ? await workspaceInput.list(project) : await workspaces.list(project.id, { managementContext: context });
    return listed.map((workspace) => workspace.path);
  };
  const resolveNormalProjectCwds: NormalProjectCwdResolver = createNormalProjectCwdResolver({
    listProjects: () => projects.list(),
    listWorkspaces: async (project) => isLegacyWorkspaceService(workspaceInput)
      ? await workspaceInput.list(project)
      : await workspaces.list(project.id),
  });
  const normalAuth = new NormalModeAuthService(configService, undefined, undefined, t);
  const normalAuthLoginAttempts = registerNormalAuthRoutes(app, normalAuth);
  registerNormalModeAuthGate(app, normalAuth, managementEmbed, normalAuthLoginAttempts);

  app.get("/pi-web-plugins/manifest.json", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.manifest(t)));
  const languagePlugins = new PiWebPluginService({ configProvider: readConfig, packageProvider: false });
  app.get("/pi-web-plugins/localization.json", async () => {
    return languagePlugins.localizationManifest();
  });

  app.get<{ Params: { pluginId: string; "*": string }; Querystring: { v?: string } }>("/pi-web-plugins/:pluginId/*", async (request, reply) => {
    if (await proxyMachinePluginAsset(machines, request.params.pluginId, request.params["*"], request.url, reply, t)) return;

    return withProfileDependency(reply, async () => {
      // Bootstrap resources must use the same bundled catalog as the language
      // manifest, independently of sessiond and active Pi-package discovery.
      if (request.params.pluginId === "zh-cn") await languagePlugins.localizationManifest();
      const asset = await (request.params.pluginId === "zh-cn" ? languagePlugins : piWebPlugins).readAsset(
        request.params.pluginId,
        request.params["*"],
        new URL(request.url, "http://pi-web.local").searchParams.get("v") ?? undefined,
      );
      if (asset === undefined) return reply.code(404).send({ error: t("gateway.pluginAssetNotFound", "Plugin asset not found") });
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
  // Web readiness must not wait for sessiond: dev Compose starts the daemon
  // only after the web-owned initial build and API startup have completed.
  app.get("/api/pi-web/health", () => Promise.resolve({ ok: true }));
  app.get("/api/pi-web/runtime", async () => getPiWebRuntime(sessionDaemon));
  app.get("/api/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  app.get("/api/machines/local/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  registerPiPackageRoutes(app, piPackages);
  registerPiPackageRoutes(app, piPackages, "/api/machines/local");
  const invalidatingConfigService = invalidatePiWebStatusOnWrite(configService, piWebStatusCache);
  registerConfigRoutes(app, invalidatingConfigService, t);
  registerLocalMachineConfigRoutes(app, invalidatingConfigService, t);

  const navigationPreferences = deps.navigationPreferences ?? new NavigationPreferenceStore();
  registerNavigationPreferenceRoutes(app, navigationPreferences, "/api", { ...(managementEmbed === undefined ? {} : { managementEmbed }), translator: t });
  registerNavigationPreferenceRoutes(app, navigationPreferences, "/api/machines/local", { ...(managementEmbed === undefined ? {} : { managementEmbed }), translator: t });

  registerMachineRoutes(app, machines, managementEmbed, t);
  registerMachinePluginProxyRoutes(app, machines, t);

  registerLocalProjectRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed, translator: t });
  registerLocalProjectRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed, translator: t });
  const projectTrustDeps = {
    agentDir: async () => (await requireActiveAgentProfile(agentProfileProvider)).dir,
    authorize: async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      if (await managementContextForRequest(request, managementEmbed, reply) === undefined) return true;
      await reply.code(403).send({ error: "Project trust is unavailable in management embed mode" });
      return false;
    },
  };
  registerProjectTrustRoutes(app, projects, asWorkspaceCatalog(projects, workspaceInput), projectTrustDeps);
  registerProjectTrustRoutes(app, projects, asWorkspaceCatalog(projects, workspaceInput), projectTrustDeps, "/api/machines/local");

  registerSessionProxyRoutes(app, sessionDaemon, "/api", managementEmbed, resolveManagementProjectCwds, resolveNormalProjectCwds, t);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed, resolveManagementProjectCwds, resolveNormalProjectCwds, t);
  registerPluginBackendProxyRoutes(app, sessionDaemon, "/api", managementEmbed);
  registerPluginBackendProxyRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed);
  registerPluginBackendChannelProxyRoutes(app, sessionDaemon, "/api", managementEmbed);
  registerPluginBackendChannelProxyRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed);
  const fileSuggestions = new FileSuggestionCatalog();
  registerWorkspaceExplorerRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed, fileSuggestions, translate: t });
  registerWorkspaceExplorerRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed, fileSuggestions, translate: t });
  registerManagementTerminalProxyRoutes(app, workspaceInput, sessionDaemon, "/api", managementEmbed);
  registerManagementTerminalProxyRoutes(app, workspaceInput, sessionDaemon, "/api/machines/local", managementEmbed);
  registerManagementAgentsRoutes(app, workspaceInput, "/api", managementEmbed, t);
  registerManagementAgentsRoutes(app, workspaceInput, "/api/machines/local", managementEmbed, t);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api", managementEmbed);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api/machines/local", managementEmbed);

  registerLocalFileSuggestionRoutes(app, projects, workspaceInput, "/api", { config: configService, managementEmbed, fileSuggestions, translator: t });
  registerLocalFileSuggestionRoutes(app, projects, workspaceInput, "/api/machines/local", { config: configService, managementEmbed, fileSuggestions, translator: t });

  registerMachineProxyRoutes(app, machines, undefined, t);

  const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
  const clientDist = deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
  if (clientDist !== false && existsSync(clientDist)) {
    const hashedAssetsDir = join(clientDist, "assets") + sep;
    await app.register(fastifyStatic, {
      root: clientDist,
      // Vite content-hashes every file under assets/, so a URL never changes
      // meaning; let browsers skip revalidation on reload. Everything else,
      // notably index.html, keeps the default revalidating policy.
      setHeaders: (res, filePath) => {
        if (filePath.startsWith(hashedAssetsDir)) res.header("cache-control", "public, max-age=31536000, immutable");
      },
    });
    const deploymentFlavor = deps.deploymentFlavor ?? createDeploymentFlavorResolver(
      async () => {
        const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
        return detectPiWebInstallation(activeAgentProfile.status === "available" ? activeAgentProfile.profile.dir : undefined);
      },
      (error) => { app.log.warn({ err: error }, "failed to detect PI WEB deployment flavor"); },
    );
    registerDeploymentIdentityAssetRoutes(app, { clientDist, flavor: deploymentFlavor });
    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.url, "http://pi-web.local").pathname;
      const acceptsHtml = request.headers.accept?.split(",").some((value) => value.trim().split(";", 1)[0] === "text/html") ?? false;
      if (request.method === "GET" && acceptsHtml && !pathname.startsWith("/api/") && !pathname.startsWith("/assets/") && !pathname.startsWith("/pi-web-plugins/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: t("gateway.notFound", "Not Found") });
    });
  }

  return app;
}
