export interface SessionDaemonStartupLogger {
  debug(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface SessionDaemonStartupSteps<Runtime> {
  logger: SessionDaemonStartupLogger;
  createRuntime(registerCleanup: (cleanup: () => void | Promise<void>) => void): Runtime | Promise<Runtime>;
  registerRoutes(runtime: Runtime): void;
  listen(runtime: Runtime): Promise<void>;
  disposeRuntime(runtime: Runtime): void | Promise<void>;
}

export async function runSessionDaemonStartup<Runtime>(
  steps: SessionDaemonStartupSteps<Runtime>,
): Promise<Runtime> {
  const constructionCleanup: (() => void | Promise<void>)[] = [];
  let runtime: Runtime;
  try {
    runtime = await steps.createRuntime((cleanup) => { constructionCleanup.push(cleanup); });
  } catch (error) {
    for (const cleanup of constructionCleanup.reverse()) {
      try {
        await cleanup();
      } catch (cleanupError) {
        steps.logger.error({ err: cleanupError }, "session daemon construction cleanup failed");
      }
    }
    throw error;
  }
  try {
    steps.registerRoutes(runtime);
    await steps.listen(runtime);
    return runtime;
  } catch (error) {
    try {
      await steps.disposeRuntime(runtime);
    } catch (cleanupError) {
      steps.logger.error({ err: cleanupError }, "session daemon startup cleanup failed");
    }
    throw error;
  }
}
