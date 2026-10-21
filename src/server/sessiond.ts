#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { loadNodeTranslator } from "../localization.js";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { installPluginBackendChannelWebSocketPayloadLimit } from "./webSocketBridge.js";
import { WorkspaceActivityService } from "./activity/workspaceActivityService.js";
import { registerWorkspaceActivityRoutes } from "./activity/workspaceActivityRoutes.js";
import { MachineStatusService } from "./status/machineStatusService.js";
import { registerMachineStatusRoutes } from "./status/machineStatusRoutes.js";
import { CachedWorkspaceAttribution } from "./status/workspaceAttribution.js";
import { SessionEventHub } from "./realtime/sessionEventHub.js";
import { ServerNoticeStore } from "./notices/serverNoticeStore.js";
import { ServerNoticeService } from "./notices/serverNoticeService.js";
import { registerServerNoticeRoutes } from "./notices/serverNoticeRoutes.js";
import { AuthService } from "./sessions/authService.js";
import { ProjectAuthService } from "./sessions/projectAuthService.js";
import { ModelCatalogRefresher } from "./sessions/modelCatalogRefresher.js";
import { SessionArchiveStore, defaultSessionArchiveFilePath } from "./sessions/sessionArchiveStore.js";
import { SessionNotificationStore } from "./sessions/sessionNotificationStore.js";
import { registerAuthRoutes } from "./sessions/authRoutes.js";
import { PiSessionService } from "./sessions/piSessionService.js";
import { createPiSessionManagerGateway } from "./sessions/piSessionManagerGateway.js";
import { registerSessionRoutes } from "./sessions/sessionRoutes.js";
import { ProjectScopedSpawnTargetResolver } from "./sessions/spawnTargetResolver.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectLifecycleService } from "./projects/projectLifecycleService.js";
import { ProjectStore, projectStorePath } from "./storage/projectStore.js";
import { FileSessionUnreadPersistence, SessionUnreadStore, defaultSessionUnreadFilePath } from "./sessions/sessionUnreadStore.js";
import { sessiondSocketPath } from "../sessiond/config.js";
import { ManagementCommandRunService } from "./terminals/managementCommandRunService.js";
import { registerManagementTerminalRoutes } from "./terminals/managementTerminalRoutes.js";
import { REQUIRED_TERMINAL_SERVICE_CAPABILITY, unavailableRequiredTerminalService } from "./terminals/requiredTerminalService.js";
import { getPiWebRuntimeComponent } from "./piWebStatus.js";
import { SESSIOND_RUNTIME_CAPABILITIES } from "../shared/capabilities.js";
import { DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX, DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS, DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS, DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS, PI_CODING_AGENT_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV, agentSessionDirEnvKeys, agentSessionDirEnvOverride, effectivePiWebConfig, maxUploadBytes, offlineModeEnabled, piWebDataDir } from "../config.js";
import { createActiveAgentProfileDescriptor, publicActiveAgentProfileDescriptor } from "../sessiond/activeAgentProfile.js";
import { scrubNonAgentVisibleEnvKeys } from "./sessiond/agentProcessEnvironment.js";
import { claimSessiondStateOwnership, type SessiondStateOwnership } from "./sessiond/sessiondStateOwnership.js";
import { dockerEnvironmentPromptSections } from "./sessions/dockerEnvironmentFacts.js";
import { PI_WEB_SESSION_ENV, sessionEnvironmentPromptSections } from "./sessions/sessionEnvironmentFacts.js";
import { runSessionDaemonStartup } from "./sessiond/sessionDaemonStartup.js";
import { runSessionDaemonShutdown } from "./sessiond/sessionDaemonShutdown.js";
import { applyAgentHttpIdleTimeout } from "./sessiond/agentHttpDispatcher.js";
import { requestLoggerOptions } from "./requestLogging.js";
import { WorkbenchAccessStateStore } from "./workbench/accessStateStore.js";
import { registerWorkbenchAccessStateRoutes } from "./workbench/accessStateRoutes.js";
import { WorkbenchClient } from "./workbench/workbenchClient.js";
import { WorkbenchMcpClient } from "./workbench/mcpClient.js";
import { WorkbenchSkillSynchronizer } from "./workbench/skillSync.js";
import { NormalToolAuditStore, normalToolAuditDatabasePath } from "./audit/normalToolAuditStore.js";
import { ManagementAuditStore } from "./audit/managementAuditStore.js";
import { managementProjectIdForCwd, projectsFromManagedEmbedContext } from "./managementEmbed.js";
import { managementContextFromEventScope, NORMAL_SESSION_EVENT_SCOPE } from "./realtime/sessionEventScope.js";
import { DefaultPiPackageProvider, PiWebPluginCatalog } from "./piWebPluginCatalog.js";
import { createDefaultPiPackageService } from "./piPackageService.js";
import { PiPackageDismissalStore, piPackageDismissalStorePath } from "./storage/piPackageDismissalStore.js";
import { reconcileAutoInstallablePiPackages } from "./sessiond/autoInstallPiPackages.js";
import { loadServerPluginRecoveryConfig } from "../serverPluginRecovery.js";
import { createServerPluginExecFile } from "./plugins/serverPluginExec.js";
import {
  PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY,
  PI_WEB_HOST_PI_SESSIONS_CAPABILITY,
  PI_WEB_HOST_WORKSPACES_CAPABILITY,
} from "../server-plugin-api.js";
import { createServerPluginRuntime } from "./plugins/serverPluginRuntime.js";
import { createServerPluginPiSessionEventsCapabilityFactory } from "./plugins/serverPluginPiSessionEventsCapability.js";
import { createServerPluginPiSessionsCapabilityFactory } from "./plugins/serverPluginPiSessionsCapability.js";
import { createServerPluginWorkspacesCapabilityFactory } from "./plugins/serverPluginWorkspacesCapability.js";
import { eligibleWorkspaceProviderContributions, WorkspaceProviderRegistry } from "./workspaces/workspaceProviderRegistry.js";
import { eligiblePluginBackendContributions, PluginBackendRegistry } from "./plugins/pluginBackendRegistry.js";
import { createWorkspaceProviderRuntimeSnapshot } from "./workspaces/workspaceCatalog.js";
import { WorkspaceRemovalService } from "./workspaces/workspaceRemovalService.js";
import { registerPluginBackendRoutes } from "./sessiond/pluginBackendRoutes.js";
import { registerPluginBackendChannelRoutes } from "./sessiond/pluginBackendChannelRoutes.js";
import { registerWorkspaceCatalogRoutes } from "./sessiond/workspaceCatalogRoutes.js";
import { registerWorkspaceRemovalRoutes } from "./sessiond/workspaceRemovalRoutes.js";
import { registerProjectMutationRoutes } from "./sessiond/projectMutationRoutes.js";
import { createFilePiWebConfigService } from "./configRoutes.js";

const daemonEnvironment: NodeJS.ProcessEnv = { ...process.env };
const serverPluginRecovery = loadServerPluginRecoveryConfig({ env: daemonEnvironment });
const { config, deprecatedAgentInputs } = effectivePiWebConfig({ env: daemonEnvironment });
const translator = loadNodeTranslator("server", config);
// Request-time defaults must observe Settings edits without restarting sessiond.
const configService = createFilePiWebConfigService({ env: daemonEnvironment });
// The embedded Pi SDK and every child process use the same resolved profile.
daemonEnvironment[PI_CODING_AGENT_DIR_ENV] = config.agent.dir;
process.env[PI_CODING_AGENT_DIR_ENV] = config.agent.dir;
const sessionDirOverride = agentSessionDirEnvOverride(daemonEnvironment, config.agent.command);
if (sessionDirOverride !== undefined) {
  daemonEnvironment[PI_CODING_AGENT_SESSION_DIR_ENV] = sessionDirOverride;
  process.env[PI_CODING_AGENT_SESSION_DIR_ENV] = sessionDirOverride;
}
process.env[PI_WEB_SESSION_ENV] = "1";
daemonEnvironment[PI_WEB_SESSION_ENV] = "1";
const scrubbedEnvKeys = scrubNonAgentVisibleEnvKeys(process.env);
let stateOwnership: SessiondStateOwnership | undefined;
const activeAgentProfile = createActiveAgentProfileDescriptor({
  command: config.agent.command,
  dir: config.agent.dir,
  sessionDirEnvKeys: agentSessionDirEnvKeys(config.agent.command),
});
Object.freeze(daemonEnvironment);
const app = Fastify({ logger: requestLoggerOptions(), bodyLimit: maxUploadBytes(daemonEnvironment, config) });
if (deprecatedAgentInputs.length > 0) {
  app.log.warn({ deprecatedAgentInputs }, "deprecated agent configuration inputs detected; support will be removed in a future release");
}
app.log.info({ scrubbedEnvKeys }, "daemon-only environment keys hidden from agent processes");
if (serverPluginRecovery.safeStartDiagnostic !== undefined) {
  app.log.error({ component: "server-plugins", configPath: serverPluginRecovery.path }, serverPluginRecovery.safeStartDiagnostic);
}
let serverQuiescing = false;
app.addHook("onRequest", async (_request, reply) => {
  if (serverQuiescing) await reply.code(503).send({ error: "Session daemon is shutting down" });
});
const serverPluginCatalog = new PiWebPluginCatalog({
  cwd: process.cwd(),
  agentDir: activeAgentProfile.dir,
  configProvider: () => config,
  warningSink: (message) => { app.log.warn({ component: "server-plugins" }, message); },
});
await app.register(fastifyWebsocket);
installPluginBackendChannelWebSocketPayloadLimit(app.websocketServer);
let runtimeShutdown: (() => Promise<void>) | undefined;
let pendingShutdownSignal: NodeJS.Signals | undefined;
let shutdownStarted = false;
async function requestShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  if (runtimeShutdown === undefined) {
    pendingShutdownSignal = signal;
    return;
  }
  shutdownStarted = true;
  app.log.info({ signal }, "shutting down session daemon");
  await runtimeShutdown();
}
process.once("SIGINT", (signal) => { void requestShutdown(signal); });
process.once("SIGTERM", (signal) => { void requestShutdown(signal); });

await runSessionDaemonStartup({
  logger: app.log,
  async createRuntime(registerCleanup) {
    stateOwnership = await claimSessiondStateOwnership({ env: daemonEnvironment, logger: app.log });
    registerCleanup(() => stateOwnership?.release());
    registerCleanup(() => app.close());
    const appliedHttpIdleTimeout = applyAgentHttpIdleTimeout({ agentDir: activeAgentProfile.dir, cwd: process.cwd() });
    if (appliedHttpIdleTimeout.warning !== undefined) {
      app.log.warn({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, appliedHttpIdleTimeout.warning);
    } else {
      app.log.info({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, "applied agent profile HTTP idle timeout to the session daemon HTTP stack");
    }
    void reconcileAutoInstallablePiPackages({
      profileDir: activeAgentProfile.dir,
      packageProvider: new DefaultPiPackageProvider(process.cwd(), activeAgentProfile.dir),
      installer: createDefaultPiPackageService(process.cwd(), activeAgentProfile.dir),
      dismissalChecker: new PiPackageDismissalStore(piPackageDismissalStorePath(daemonEnvironment)),
      logger: app.log,
    }).catch((error: unknown) => {
      app.log.warn({ err: error }, "Pi package auto-install reconciliation failed unexpectedly; continuing without it");
    });
    const eventHub = new SessionEventHub();
    const serverNotices = new ServerNoticeService(new ServerNoticeStore(), eventHub);
    const workspaceActivity = new WorkspaceActivityService(eventHub, (scope) => { machineStatus.notifyChanged(scope); });
    const projects = new ProjectService(new ProjectStore(projectStorePath(daemonEnvironment)));
    const unreadStore = new SessionUnreadStore({
      persistence: new FileSessionUnreadPersistence(defaultSessionUnreadFilePath(daemonEnvironment)),
      onPersistenceError(operation, error) {
        app.log.error({ err: error, operation }, "session unread persistence failed");
      },
    });
    await unreadStore.load();
    registerCleanup(() => unreadStore.flush());
    let normalToolAudit: NormalToolAuditStore | undefined;
    let managementAudit: ManagementAuditStore | undefined;
    const constructed: {
      projectAuth?: ProjectAuthService;
      managementAuth?: AuthService;
      sessions?: PiSessionService;
    } = {};
    // Construction failures must keep auth and sessions alive until plugin cleanup finishes.
    registerCleanup(() => normalToolAudit?.close());
    registerCleanup(() => managementAudit?.close());
    registerCleanup(() => constructed.projectAuth?.dispose());
    registerCleanup(() => { constructed.managementAuth?.dispose(); });
    registerCleanup(() => constructed.sessions?.dispose());
    const serverPlugins = await createServerPluginRuntime({
      translator,
      catalog: serverPluginCatalog,
      dataDir: piWebDataDir(daemonEnvironment),
      ...(serverPluginRecovery.safeStart === undefined ? {} : { safeStart: serverPluginRecovery.safeStart }),
      logger: app.log,
      execFile: createServerPluginExecFile({ env: daemonEnvironment }),
      noticeSink: (source, input) => { serverNotices.record({ ...input, source }); },
      lateHostCapabilities: [
        PI_WEB_HOST_WORKSPACES_CAPABILITY,
        PI_WEB_HOST_PI_SESSIONS_CAPABILITY,
        PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY,
      ],
    });
    registerCleanup(() => serverPlugins.stop());
    const providerContributions = serverPlugins.providerContributions();
    const providerPluginIds = providerContributions.map(({ pluginId }) => pluginId);
    const providerHealth = await serverPlugins.inspectHealth(providerPluginIds);
    const workspaceProviders = new WorkspaceProviderRegistry({
      contributions: eligibleWorkspaceProviderContributions(providerContributions, providerHealth),
      logger: app.log,
    });
    registerCleanup(() => workspaceProviders.closeAll());
    const projectAuth = new ProjectAuthService({ projects, workspaces: workspaceProviders, globalAgentDir: activeAgentProfile.dir, logger: app.log, offline: offlineModeEnabled(daemonEnvironment) });
    constructed.projectAuth = projectAuth;
    const managementAuth = await AuthService.create({
      agentDir: join(piWebDataDir(daemonEnvironment), "management-embed"),
    });
    constructed.managementAuth = managementAuth;
    const managementCatalogRefresher = new ModelCatalogRefresher({
      runtime: managementAuth.runtime,
      logger: app.log,
      offline: offlineModeEnabled(daemonEnvironment),
    });
    registerCleanup(() => { managementCatalogRefresher.dispose(); });
    managementCatalogRefresher.start();
    managementAuth.subscribe(() => { managementCatalogRefresher.requestRefresh(); });
    const accessStates = new WorkbenchAccessStateStore();
    const normalAuditConfig = config.auditLog?.normalMode;
    if (normalAuditConfig?.enabled !== false) {
      try {
        normalToolAudit = new NormalToolAuditStore({
          path: normalToolAuditDatabasePath(daemonEnvironment),
          retentionDays: normalAuditConfig?.retentionDays ?? DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS,
          maxRows: normalAuditConfig?.maxRows ?? DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS,
          onError: (error) => {
            app.log.info({ error: error instanceof Error ? error.message : String(error) }, "failed to maintain ordinary-mode tool audit database");
          },
        });
      } catch (error) {
        app.log.info({ error: error instanceof Error ? error.message : String(error) }, "failed to initialize ordinary-mode tool audit database");
      }
    }
    const managementAuditConfig = config.auditLog?.managementMode;
    if (managementAuditConfig?.enabled === true && managementAuditConfig.baseUrl !== undefined) {
      const apiKeyValue = daemonEnvironment["PI_WEB_AUDIT_ES_API_KEY"]?.trim();
      const usernameValue = daemonEnvironment["PI_WEB_AUDIT_ES_USERNAME"]?.trim();
      const apiKey = apiKeyValue === undefined || apiKeyValue === "" ? undefined : apiKeyValue;
      const username = usernameValue === undefined || usernameValue === "" ? undefined : usernameValue;
      const password = daemonEnvironment["PI_WEB_AUDIT_ES_PASSWORD"];
      if (apiKey === undefined && ((username === undefined) !== (password === undefined))) {
        app.log.info("management audit Elasticsearch basic authentication requires both PI_WEB_AUDIT_ES_USERNAME and PI_WEB_AUDIT_ES_PASSWORD");
      } else {
        managementAudit = new ManagementAuditStore({
          baseUrl: managementAuditConfig.baseUrl,
          indexPrefix: managementAuditConfig.indexPrefix ?? DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX,
          retentionDays: managementAuditConfig.retentionDays ?? DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS,
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(apiKey !== undefined || username === undefined || password === undefined ? {} : { username, password }),
          onError: (error) => { app.log.info({ error: error instanceof Error ? error.message : String(error) }, "management audit Elasticsearch operation failed"); },
        });
        await managementAudit.initialize().catch((error: unknown) => {
          app.log.info({ error: error instanceof Error ? error.message : String(error) }, "failed to initialize management audit Elasticsearch storage");
        });
      }
    }
    const workbench = config.workbenchIntegration === undefined ? undefined : (() => {
      const client = new WorkbenchClient({
        baseUrl: config.workbenchIntegration.baseUrl,
        requestTimeoutMs: config.workbenchIntegration.requestTimeoutMs ?? 10_000,
      });
      return {
        translator,
        accessStates,
        client,
        mcp: new WorkbenchMcpClient({
          mcpUrl: config.workbenchIntegration.mcpUrl,
          timeoutMs: config.workbenchIntegration.capabilityTimeoutMs ?? 30_000,
        }),
        skills: new WorkbenchSkillSynchronizer(config.workbenchIntegration, client, piWebDataDir(daemonEnvironment), fetch, app.log, translator),
      };
    })();
    const projectsForScope = (scope = NORMAL_SESSION_EVENT_SCOPE) => {
      const managementContext = managementContextFromEventScope(scope);
      if (managementContext === undefined) return projects.list();
      if (config.managementEmbed?.enabled !== true) throw new Error("Management embed mode is not configured");
      return projectsFromManagedEmbedContext(
        config.managementEmbed.projectRoot ?? join(homedir(), "PiWeb"),
        managementContext,
      );
    };
    const spawnTargets = config.spawnSessions
      ? new ProjectScopedSpawnTargetResolver({ projects: { list: projectsForScope }, workspaces: workspaceProviders })
      : undefined;
    const managementAllowPrivileged = config.managementEmbed?.allowPrivileged === true;
    const projectLifecycleRef: { current?: ProjectLifecycleService } = {};
    const sessions = new PiSessionService(eventHub, {
      translator,
      modelRuntime: managementAuth.modelRuntime,
      managementModelRuntime: managementAuth.modelRuntime,
      normalModelRuntimeForCwd: async (cwd) => (await projectAuth.forCwd(cwd)).modelRuntime,
      projectPathForCwd: async (cwd) => {
        try {
          return (await projectAuth.projectForCwd(cwd)).path;
        } catch {
          // Management embed may run outside a uniquely registered project;
          // preferences then land in the orphan settings scope.
          return undefined;
        }
      },
      dataDir: piWebDataDir(daemonEnvironment),
      agentDir: activeAgentProfile.dir,
      workspaceActivity,
      unreadStore,
      archiveStore: new SessionArchiveStore(defaultSessionArchiveFilePath(daemonEnvironment)),
      notificationStore: new SessionNotificationStore(),
      catalogRefreshStatus: projectAuth,
      onUnreadChanged: (scope, hasNewCompletion) => {
        machineStatus.notifyChanged(scope);
        if (scope === NORMAL_SESSION_EVENT_SCOPE && hasNewCompletion) projectLifecycleRef.current?.scheduleCleanup();
      },
      logger: app.log,
      ...(normalToolAudit === undefined ? {} : { normalToolAudit }),
      ...(managementAudit === undefined ? {} : {
        managementAudit,
        managementProjectIdForCwd: (cwd, context) => managementProjectIdForCwd(config.managementEmbed?.projectRoot ?? join(homedir(), "PiWeb"), context, cwd),
      }),
      ...(spawnTargets === undefined ? {} : { spawnTargets }),
      subsessionsEnabled: spawnTargets !== undefined && config.subsessions,
      askUserEnabled: config.askUser,
      extensionDialogsTimeoutMs: config.extensionDialogsTimeoutMs,
      config: configService,
      appendSystemPromptSections: [
        ...sessionEnvironmentPromptSections({ env: daemonEnvironment, enabled: config.environmentFacts }),
        ...dockerEnvironmentPromptSections({ env: daemonEnvironment, enabled: config.environmentFacts, logger: app.log }),
      ],
      ...(workbench === undefined ? {} : { workbench }),
      managementAllowPrivileged,
      sessionManager: createPiSessionManagerGateway({
        agentDir: activeAgentProfile.dir,
        env: daemonEnvironment,
        sessionDirEnvKeys: activeAgentProfile.sessionDirEnvKeys,
      }),
    });
    constructed.sessions = sessions;
    const statusAttribution = new CachedWorkspaceAttribution({
      projects: { list: projectsForScope },
      workspaces: { list: (project) => workspaceProviders.list(project) },
      logger: app.log,
    });
    const machineStatus = new MachineStatusService({
      activity: workspaceActivity,
      unread: { catalogSnapshot: (scope) => sessions.unreadCatalogForScope(scope ?? "normal") },
      attribution: statusAttribution,
      publisher: { publish: (snapshot, scope) => { eventHub.publishRealtime({ type: "machine.status", status: snapshot }, scope); } },
      logger: app.log,
    });
    eventHub.setGlobalJoinFrame((scope) => ({ type: "machine.status", status: machineStatus.snapshot(scope) }));
    await serverPlugins.resumeWithHostCapabilityFactories([
      createServerPluginWorkspacesCapabilityFactory({ projects, workspaces: workspaceProviders }),
      createServerPluginPiSessionsCapabilityFactory({ projects, workspaces: workspaceProviders, sessions }),
      createServerPluginPiSessionEventsCapabilityFactory({ projects, workspaces: workspaceProviders, sessions }),
    ]);
    const projectLifecycle = new ProjectLifecycleService({
      projects,
      workspaces: workspaceProviders,
      hasUnread: () => unreadStore.hasUnread(),
      reconcileUnreadWorkspaces: (cwds) => sessions.reconcileUnreadWorkspaces(cwds),
      logger: app.log,
      onProjectsChanged: () => {
        statusAttribution.invalidate();
        machineStatus.notifyChanged();
      },
    });
    projectLifecycleRef.current = projectLifecycle;
    registerCleanup(() => projectLifecycle.closeAll());
    machineStatus.notifyChanged();
    projectAuth.subscribe((change) => { sessions.applyAuthChange(change); });
    managementAuth.subscribe((change) => { sessions.applyAuthChange(change); });
    const managementTerminals = new ManagementCommandRunService(eventHub, workspaceActivity, undefined, managementAllowPrivileged);
    registerCleanup(() => { managementTerminals.dispose(); });
    const terminals = serverPlugins.safeStartLevel() === "none"
      ? unavailableRequiredTerminalService()
      : serverPlugins.resolve(REQUIRED_TERMINAL_SERVICE_CAPABILITY);
    terminals.bindActivitySink({
      updateTerminal: (terminal) => { workspaceActivity.updateTerminal(terminal); },
      removeTerminal: (terminalId, cwd) => { workspaceActivity.removeTerminal(terminalId, cwd); },
    });
    const providerPluginIdSet = new Set(providerPluginIds);
    const remainingActivePluginIds = serverPlugins.healthRecords()
      .filter(({ pluginId, state }) => state === "active" && !providerPluginIdSet.has(pluginId))
      .map(({ pluginId }) => pluginId);
    const remainingHealth = await serverPlugins.inspectHealth(remainingActivePluginIds);
    const pluginHealth = Object.freeze([...providerHealth, ...remainingHealth]
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId)));
    const workspaceProviderRuntime = createWorkspaceProviderRuntimeSnapshot(
      serverPlugins.healthRecords(),
      pluginHealth,
      serverPlugins.safeStartLevel(),
      serverPlugins.catalogDiagnostics(),
    );
    const pluginBackends = new PluginBackendRegistry({
      contributions: eligiblePluginBackendContributions(serverPlugins.pairedBackendContributions(), pluginHealth),
      workspaces: workspaceProviders,
      logger: app.log,
    });
    const workspaceRemovals = new WorkspaceRemovalService(workspaceProviders, {
      closeForCwd(cwd, managementContext) {
        if (managementContext === undefined) terminals.closeForCwd(cwd);
        else managementTerminals.closeForCwd(cwd, managementContext);
      },
      runCommand: (options) => options.managementContext === undefined
        ? terminals.runCommand(options)
        : managementTerminals.runCommand(options),
    }, { notices: serverNotices });
    registerCleanup(() => pluginBackends.closeAll());
    registerCleanup(() => workspaceRemovals.closeAll());
    const runtimeComponent = Object.freeze({
      ...getPiWebRuntimeComponent("sessiond", SESSIOND_RUNTIME_CAPABILITIES, deprecatedAgentInputs),
      activeAgentProfile: publicActiveAgentProfileDescriptor(activeAgentProfile),
    });
    projectLifecycle.scheduleCleanup();
    let shutdownPromise: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      shutdownPromise ??= runSessionDaemonShutdown({
        logger: app.log,
        onFailure: () => { process.exitCode = 1; },
        dependencies: {
          quiesceServer: async () => {
            serverQuiescing = true;
            await projectLifecycle.closeAll();
          },
          serverPlugins,
          catalogRefresher: managementCatalogRefresher,
          auth: managementAuth,
          projectAuth,
          sessions,
          terminals: managementTerminals,
          unreadStore,
          pluginBackends,
          workspaceProviders,
          workspaceRemovals,
          closeServer: () => app.close(),
          ...(normalToolAudit === undefined ? {} : { normalToolAudit }),
          ...(managementAudit === undefined ? {} : { managementAudit }),
          releaseStateOwnership: () => stateOwnership?.release(),
        },
      });
      return shutdownPromise;
    };
    return { eventHub, machineStatus, statusAttribution, projectLifecycle, workspaceActivity, projectAuth, managementAuth, sessions, managementTerminals, serverNotices, accessStates, normalToolAudit, managementAudit, activeAgentProfile, runtimeComponent, serverPlugins, workspaceProviders, pluginBackends, workspaceProviderRuntime, workspaceRemovals, projects, shutdown };
  },
  disposeRuntime: ({ shutdown }) => shutdown(),
  registerRoutes({ eventHub, machineStatus, statusAttribution, projectLifecycle, workspaceActivity, projectAuth, managementAuth, sessions, managementTerminals, serverNotices, accessStates, runtimeComponent, projects, workspaceProviders, pluginBackends, workspaceProviderRuntime, workspaceRemovals }) {
    registerProjectMutationRoutes(app, projectLifecycle, translator);
    registerWorkspaceActivityRoutes(app, workspaceActivity);
    registerMachineStatusRoutes(app, machineStatus);
    registerServerNoticeRoutes(app, serverNotices);
    registerAuthRoutes(app, { normal: projectAuth, management: managementAuth });
    registerSessionRoutes(app, sessions, eventHub);
    registerManagementTerminalRoutes(app, managementTerminals);
    registerWorkbenchAccessStateRoutes(app, accessStates);
    const managementProjectRoot = config.managementEmbed?.enabled === true
      ? config.managementEmbed.projectRoot ?? join(homedir(), "PiWeb")
      : undefined;
    registerWorkspaceCatalogRoutes(app, { projects, workspaces: workspaceProviders, providerRuntime: workspaceProviderRuntime, managementProjectRoot, translator });
    registerPluginBackendRoutes(app, { projects, backends: pluginBackends, managementProjectRoot, onWorkspacesMutated: (scope) => {
      statusAttribution.invalidate();
      machineStatus.notifyChanged(scope);
      if (scope === NORMAL_SESSION_EVENT_SCOPE) projectLifecycle.scheduleCleanup();
    } });
    registerPluginBackendChannelRoutes(app, { projects, backends: pluginBackends, managementProjectRoot });
    registerWorkspaceRemovalRoutes(app, { projects, removals: workspaceRemovals, managementProjectRoot, onWorkspacesMutated: (scope) => {
      statusAttribution.invalidate();
      machineStatus.notifyChanged(scope);
      if (scope === NORMAL_SESSION_EVENT_SCOPE) projectLifecycle.scheduleCleanup();
    } });

    app.get("/health", () => ({
      ok: true,
      activeSessions: sessions.activeCount(),
      checkedAt: new Date().toISOString(),
      version: {
        component: runtimeComponent.component,
        label: runtimeComponent.label,
        ...(runtimeComponent.runtimeVersion === undefined ? {} : { runtimeVersion: runtimeComponent.runtimeVersion }),
        ...(runtimeComponent.piVersion === undefined ? {} : { piVersion: runtimeComponent.piVersion }),
        stale: false,
        available: runtimeComponent.available,
      },
    }));

    app.get("/runtime", () => runtimeComponent);
  },
  async listen({ shutdown }) {
    runtimeShutdown = shutdown;
    if (pendingShutdownSignal !== undefined) {
      await requestShutdown(pendingShutdownSignal);
      return;
    }

    const portValue = daemonEnvironment["PI_WEB_SESSIOND_PORT"];
    const port = portValue !== undefined && portValue !== "" ? Number(portValue) : undefined;
    const host = daemonEnvironment["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1";

    if (port !== undefined) {
      await app.listen({ port, host });
    } else {
      const path = sessiondSocketPath(daemonEnvironment);
      await mkdir(dirname(path), { recursive: true });
      await rm(path, { force: true });
      await app.listen({ path });
      process.on("exit", () => void rm(path, { force: true }));
    }
  },
});
