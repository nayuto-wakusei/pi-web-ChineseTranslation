#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WorkspaceActivityService } from "./activity/workspaceActivityService.js";
import { registerWorkspaceActivityRoutes } from "./activity/workspaceActivityRoutes.js";
import { MachineStatusService } from "./status/machineStatusService.js";
import { registerMachineStatusRoutes } from "./status/machineStatusRoutes.js";
import { CachedWorkspaceAttribution } from "./status/workspaceAttribution.js";
import { SessionEventHub } from "./realtime/sessionEventHub.js";
import { AuthService } from "./sessions/authService.js";
import { ProjectAuthService } from "./sessions/projectAuthService.js";
import { registerAuthRoutes } from "./sessions/authRoutes.js";
import { PiSessionService } from "./sessions/piSessionService.js";
import { createPiSessionManagerGateway } from "./sessions/piSessionManagerGateway.js";
import { registerSessionRoutes } from "./sessions/sessionRoutes.js";
import { ProjectScopedSpawnTargetResolver } from "./sessions/spawnTargetResolver.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { sessiondSocketPath } from "../sessiond/config.js";
import { TerminalService } from "./terminals/terminalService.js";
import { registerTerminalRoutes } from "./terminals/terminalRoutes.js";
import { getPiWebRuntimeComponent } from "./piWebStatus.js";
import { SESSIOND_RUNTIME_CAPABILITIES } from "../shared/capabilities.js";
import { DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX, DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS, DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS, DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS, PI_CODING_AGENT_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV, agentSessionDirEnvKeys, agentSessionDirEnvOverride, effectivePiWebConfig, maxUploadBytes, piWebDataDir } from "../config.js";
import { createActiveAgentProfileDescriptor } from "../sessiond/activeAgentProfile.js";
import { scrubNonAgentVisibleEnvKeys } from "./sessiond/agentProcessEnvironment.js";
import { claimSessiondStateOwnership, type SessiondStateOwnership } from "./sessiond/sessiondStateOwnership.js";
import { dockerEnvironmentPromptSections } from "./sessions/dockerEnvironmentFacts.js";
import { PI_WEB_SESSION_ENV, sessionEnvironmentPromptSections } from "./sessions/sessionEnvironmentFacts.js";
import { runSessionDaemonStartup } from "./sessiond/sessionDaemonStartup.js";
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
import { PiWebPluginCatalog } from "./piWebPluginCatalog.js";
import { loadServerPluginRecoveryConfig } from "../serverPluginRecovery.js";
import { createServerPluginExecFile } from "./plugins/serverPluginExec.js";
import { createServerPluginRuntime } from "./plugins/serverPluginRuntime.js";
import { eligibleWorkspaceProviderContributions, WorkspaceProviderRegistry } from "./workspaces/workspaceProviderRegistry.js";
import { createWorkspaceProviderRuntimeSnapshot } from "./workspaces/workspaceCatalog.js";
import { WorkspaceRemovalService } from "./workspaces/workspaceRemovalService.js";
import { registerPluginBackendRoutes } from "./sessiond/pluginBackendRoutes.js";
import { registerWorkspaceCatalogRoutes } from "./sessiond/workspaceCatalogRoutes.js";
import { registerWorkspaceRemovalRoutes } from "./sessiond/workspaceRemovalRoutes.js";

const daemonEnvironment: NodeJS.ProcessEnv = { ...process.env };
const serverPluginRecovery = loadServerPluginRecoveryConfig({ env: daemonEnvironment });
const { config } = effectivePiWebConfig({ env: daemonEnvironment });
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
scrubNonAgentVisibleEnvKeys(process.env);
let stateOwnership: SessiondStateOwnership | undefined;
const activeAgentProfile = createActiveAgentProfileDescriptor({
  command: config.agent.command,
  dir: config.agent.dir,
  sessionDirEnvKeys: agentSessionDirEnvKeys(config.agent.command),
});
const app = Fastify({ logger: requestLoggerOptions(), bodyLimit: maxUploadBytes(daemonEnvironment, config) });
const serverPluginCatalog = new PiWebPluginCatalog({
  cwd: process.cwd(),
  agentDir: activeAgentProfile.dir,
  configProvider: () => config,
  warningSink: (message) => { app.log.warn({ component: "server-plugins" }, message); },
});
await app.register(fastifyWebsocket);

await runSessionDaemonStartup({
  logger: app.log,
  async createRuntime() {
    stateOwnership = await claimSessiondStateOwnership({ env: daemonEnvironment, logger: app.log });
    const eventHub = new SessionEventHub();
    const workspaceActivity = new WorkspaceActivityService(eventHub, (scope) => { machineStatus.notifyChanged(scope); });
    const projects = new ProjectService(new ProjectStore());
    const workspaces = new WorkspaceService();
    const serverPlugins = await createServerPluginRuntime({
      catalog: serverPluginCatalog,
      ...(serverPluginRecovery.safeStart === undefined ? {} : { safeStart: serverPluginRecovery.safeStart }),
      logger: app.log,
      execFile: createServerPluginExecFile({ env: daemonEnvironment }),
    });
    const providerHealth = await serverPlugins.inspectHealth();
    const workspaceProviders = new WorkspaceProviderRegistry({
      contributions: eligibleWorkspaceProviderContributions(serverPlugins.providerContributions(), providerHealth),
      logger: app.log,
    });
    const workspaceProviderRuntime = createWorkspaceProviderRuntimeSnapshot(
      serverPlugins.healthRecords(),
      providerHealth,
      serverPlugins.safeStartLevel(),
      serverPlugins.catalogDiagnostics(),
    );
    const projectAuth = new ProjectAuthService({ projects, workspaces });
    const managementAuth = await AuthService.create({
      agentDir: join(piWebDataDir(), "management-embed"),
    });
    const accessStates = new WorkbenchAccessStateStore();
    const normalAuditConfig = config.auditLog?.normalMode;
    let normalToolAudit: NormalToolAuditStore | undefined;
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
    let managementAudit: ManagementAuditStore | undefined;
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
        accessStates,
        client,
        mcp: new WorkbenchMcpClient({
          mcpUrl: config.workbenchIntegration.mcpUrl,
          timeoutMs: config.workbenchIntegration.capabilityTimeoutMs ?? 30_000,
        }),
        skills: new WorkbenchSkillSynchronizer(config.workbenchIntegration, client, piWebDataDir(daemonEnvironment), fetch, app.log),
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
      ? new ProjectScopedSpawnTargetResolver({ projects: { list: projectsForScope }, workspaces })
      : undefined;
    const sessions = new PiSessionService(eventHub, {
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
      dataDir: piWebDataDir(),
      agentDir: activeAgentProfile.dir,
      workspaceActivity,
      onUnreadChanged: (scope) => { machineStatus.notifyChanged(scope); },
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
      appendSystemPromptSections: [
        ...sessionEnvironmentPromptSections({ env: daemonEnvironment, enabled: config.environmentFacts }),
        ...dockerEnvironmentPromptSections({ env: daemonEnvironment, enabled: config.environmentFacts, logger: app.log }),
      ],
      ...(workbench === undefined ? {} : { workbench }),
      sessionManager: createPiSessionManagerGateway({
        agentDir: activeAgentProfile.dir,
        env: daemonEnvironment,
        sessionDirEnvKeys: activeAgentProfile.sessionDirEnvKeys,
      }),
    });
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
    machineStatus.notifyChanged();
    projectAuth.subscribe((change) => { sessions.applyAuthChange(change); });
    managementAuth.subscribe((change) => { sessions.applyAuthChange(change); });
    const terminals = new TerminalService(eventHub, workspaceActivity);
    const workspaceRemovals = new WorkspaceRemovalService(workspaceProviders, terminals);
    const runtimeComponent = Object.freeze({
      ...getPiWebRuntimeComponent("sessiond", SESSIOND_RUNTIME_CAPABILITIES),
      activeAgentProfile,
    });
    return { eventHub, machineStatus, statusAttribution, workspaceActivity, projectAuth, managementAuth, sessions, terminals, accessStates, normalToolAudit, managementAudit, activeAgentProfile, runtimeComponent, serverPlugins, workspaceProviders, workspaceProviderRuntime, workspaceRemovals, projects };
  },
  registerRoutes({ eventHub, machineStatus, statusAttribution, workspaceActivity, projectAuth, managementAuth, sessions, terminals, accessStates, runtimeComponent, projects, workspaceProviders, workspaceProviderRuntime, workspaceRemovals }) {
    registerWorkspaceActivityRoutes(app, workspaceActivity);
    registerMachineStatusRoutes(app, machineStatus);
    registerAuthRoutes(app, { normal: projectAuth, management: managementAuth });
    registerSessionRoutes(app, sessions, eventHub);
    registerTerminalRoutes(app, terminals);
    registerWorkbenchAccessStateRoutes(app, accessStates);
    const managementProjectRoot = config.managementEmbed?.enabled === true
      ? config.managementEmbed.projectRoot ?? join(homedir(), "PiWeb")
      : undefined;
    registerWorkspaceCatalogRoutes(app, { projects, workspaces: workspaceProviders, providerRuntime: workspaceProviderRuntime, managementProjectRoot });
    registerPluginBackendRoutes(app, { projects, backends: workspaceProviders, managementProjectRoot, onWorkspacesMutated: (scope) => { statusAttribution.invalidate(); machineStatus.notifyChanged(scope); } });
    registerWorkspaceRemovalRoutes(app, { projects, removals: workspaceRemovals, managementProjectRoot, onWorkspacesMutated: (scope) => { statusAttribution.invalidate(); machineStatus.notifyChanged(scope); } });

    app.get("/health", () => ({
      ok: true,
      activeSessions: sessions.activeCount(),
      checkedAt: new Date().toISOString(),
      version: {
        component: runtimeComponent.component,
        label: runtimeComponent.label,
        ...(runtimeComponent.runtimeVersion === undefined ? {} : { runtimeVersion: runtimeComponent.runtimeVersion }),
        stale: false,
        available: runtimeComponent.available,
      },
    }));

    app.get("/runtime", () => runtimeComponent);
  },
  async listen({ projectAuth, managementAuth, sessions, terminals, normalToolAudit, managementAudit, serverPlugins }) {
    let shuttingDown = false;
    async function shutdown(signal: NodeJS.Signals): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, "shutting down session daemon");
      terminals.dispose();
      await serverPlugins.stop();
      await projectAuth.dispose();
      managementAuth.dispose();
      await sessions.dispose();
      try {
        normalToolAudit?.close();
      } catch (error) {
        app.log.info({ error: error instanceof Error ? error.message : String(error) }, "failed to close ordinary-mode tool audit database");
      }
      try {
        await managementAudit?.close();
      } catch (error) {
        app.log.info({ error: error instanceof Error ? error.message : String(error) }, "failed to flush management audit Elasticsearch queue");
      }
      await stateOwnership?.release();
      await app.close();
    }

    process.once("SIGINT", (signal) => { void shutdown(signal); });
    process.once("SIGTERM", (signal) => { void shutdown(signal); });

    const portValue = daemonEnvironment["PI_WEB_SESSIOND_PORT"];
    const port = portValue !== undefined && portValue !== "" ? Number(portValue) : undefined;
    const host = daemonEnvironment["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1";

    if (port !== undefined) {
      await app.listen({ port, host });
    } else {
      const path = sessiondSocketPath();
      await mkdir(dirname(path), { recursive: true });
      await rm(path, { force: true });
      await app.listen({ path });
      process.on("exit", () => void rm(path, { force: true }));
    }
  },
});
