export interface SessionDaemonStartupLogger {
  debug(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface SessionDaemonStartupSteps<Runtime> {
  logger: SessionDaemonStartupLogger;
  createRuntime(): Runtime | Promise<Runtime>;
  registerRoutes(runtime: Runtime): void;
  listen(runtime: Runtime): Promise<void>;
}

export async function runSessionDaemonStartup<Runtime>(
  steps: SessionDaemonStartupSteps<Runtime>,
): Promise<Runtime> {
  const runtime = await steps.createRuntime();
  steps.registerRoutes(runtime);
  await steps.listen(runtime);
  return runtime;
}
