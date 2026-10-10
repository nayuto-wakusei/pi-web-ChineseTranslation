export interface SessionDaemonShutdownLogger {
  error(details: Record<string, unknown>, message: string): void;
}

export interface SessionDaemonShutdownDependencies {
  quiesceServer(): void | Promise<void>;
  serverPlugins: {
    beginShutdown(): void | Promise<void>;
    stop(): void | Promise<void>;
  };
  catalogRefresher: { dispose(): void | Promise<void> };
  auth: { dispose(): void | Promise<void> };
  sessions: { dispose(): void | Promise<void> };
  unreadStore: { flush(): void | Promise<void> };
  pluginBackends: { closeAll(): void | Promise<void> };
  workspaceProviders: { closeAll(): void | Promise<void> };
  workspaceRemovals: { closeAll(): void | Promise<void> };
  closeServer(): void | Promise<void>;
  projectAuth?: { dispose(): void | Promise<void> };
  terminals?: { dispose(): void | Promise<void> };
  normalToolAudit?: { close(): void | Promise<void> };
  managementAudit?: { close(): void | Promise<void> };
  releaseStateOwnership?(): void | Promise<void>;
}

export interface SessionDaemonShutdownOptions {
  logger: SessionDaemonShutdownLogger;
  dependencies: SessionDaemonShutdownDependencies;
  onFailure?: () => void;
}

/** Quiesces ingress, disposes consumers, then tears down plugin providers and dependencies. */
export async function runSessionDaemonShutdown(options: SessionDaemonShutdownOptions): Promise<void> {
  const { dependencies } = options;
  const operations: readonly (readonly [string, () => void | Promise<void>])[] = [
    ["quiesce server", () => dependencies.quiesceServer()],
    // Revoke plugin-owned admission as soon as host ingress is closed.
    // beginShutdown retains publications while admitted contribution callbacks
    // and host-owned resources observe cancellation and drain below.
    ["cancel server plugin lifetimes", () => dependencies.serverPlugins.beginShutdown()],
    ["dispose catalog refresher", () => dependencies.catalogRefresher.dispose()],
    ["close workspace removal work", () => dependencies.workspaceRemovals.closeAll()],
    ["close plugin backend work", () => dependencies.pluginBackends.closeAll()],
    ["close workspace provider work", () => dependencies.workspaceProviders.closeAll()],
    // Plugin capability cleanup must finish while its host-owned sessions remain available.
    ["stop server plugins", () => dependencies.serverPlugins.stop()],
    ...(dependencies.terminals === undefined ? [] : [["dispose terminals", () => dependencies.terminals?.dispose()]] as const),
    ["dispose sessions", () => dependencies.sessions.dispose()],
    ["close server", () => dependencies.closeServer()],
    ["dispose auth", () => dependencies.auth.dispose()],
    ...(dependencies.projectAuth === undefined ? [] : [["dispose project auth", () => dependencies.projectAuth?.dispose()]] as const),
    ["flush session unread state", () => dependencies.unreadStore.flush()],
    ...(dependencies.normalToolAudit === undefined ? [] : [["close normal tool audit", () => dependencies.normalToolAudit?.close()]] as const),
    ...(dependencies.managementAudit === undefined ? [] : [["close management audit", () => dependencies.managementAudit?.close()]] as const),
    ...(dependencies.releaseStateOwnership === undefined ? [] : [["release state ownership", () => dependencies.releaseStateOwnership?.()]] as const),
  ];

  for (const [operation, run] of operations) {
    try {
      await run();
    } catch (error) {
      options.onFailure?.();
      options.logger.error({ err: error, operation }, "session daemon shutdown operation failed");
    }
  }
}
