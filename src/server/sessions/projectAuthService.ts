import { constants } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { piWebDataDir } from "../../config.js";
import { loadNodeTranslator } from "../../localization.js";
import type { Translator } from "../../shared/i18n.js";
import type { Project } from "../types.js";
import { AuthService, createModelRuntimeForAgentDir, type AuthChange } from "./authService.js";
import { bootstrapAndFreezeGlobalExtensionProviders, type GlobalProviderBootstrapLogger } from "./globalProviderPolicy.js";
import { ModelCatalogRefresher, type ModelCatalogRefresherOptions } from "./modelCatalogRefresher.js";

interface ProjectLister {
  list(): Promise<Project[]>;
}

interface WorkspaceLister {
  list(project: Project): Promise<readonly { path: string }[]>;
}

export interface ProjectAuthServiceDependencies {
  translator?: Translator;
  projects: ProjectLister;
  workspaces: WorkspaceLister;
  dataDir?: string;
  globalAgentDir?: string;
  createModelRuntime?: (paths: ProjectAuthStoragePaths) => Promise<ModelRuntime>;
  logger?: GlobalProviderBootstrapLogger;
  offline?: boolean;
  bootstrapProviders?: typeof bootstrapAndFreezeGlobalExtensionProviders;
  createCatalogRefresher?: (options: ModelCatalogRefresherOptions) => Pick<ModelCatalogRefresher, "start" | "requestRefresh" | "dispose" | "isRefreshInFlight">;
}

export interface ProjectAuthStoragePaths {
  directory: string;
  authPath: string;
  modelsPath: string;
}

type ProjectAuthChangeListener = (change: AuthChange) => void;
const noopLogger: GlobalProviderBootstrapLogger = { error() { /* no-op */ }, info() { /* no-op */ }, warn() { /* no-op */ } };

/**
 * Owns the normal-mode auth/model registries that are scoped to registered
 * projects. Management-embed authentication intentionally stays outside this
 * service because it has a different security boundary.
 */
export class ProjectAuthService {
  private readonly t: Translator;
  private readonly services = new Map<string, AuthService>();
  private readonly initializations = new Map<string, Promise<AuthService>>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly listeners = new Set<ProjectAuthChangeListener>();
  private readonly refreshers = new Map<string, Pick<ModelCatalogRefresher, "start" | "requestRefresh" | "dispose" | "isRefreshInFlight">>();
  private readonly dataDir: string;
  private readonly globalAgentDir: string;
  private disposed = false;

  constructor(private readonly deps: ProjectAuthServiceDependencies) {
    this.t = deps.translator ?? loadNodeTranslator("server");
    this.dataDir = deps.dataDir ?? piWebDataDir();
    this.globalAgentDir = deps.globalAgentDir ?? getAgentDir();
  }

  subscribe(listener: ProjectAuthChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async forProject(projectId: string): Promise<AuthService> {
    if (this.disposed) throw new Error("Project auth service is disposed");
    const project = (await this.deps.projects.list()).find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new Error(this.t("project.notFound", "Project not found"));
    return this.forProjectRecord(project);
  }

  async forCwd(cwd: string): Promise<AuthService> {
    const project = await this.projectForCwd(cwd);
    return this.forProjectRecord(project);
  }

  async projectForCwd(cwd: string): Promise<Project> {
    const projects = await this.deps.projects.list();
    const normalizedCwd = normalizeProjectPath(cwd);
    const matches: Project[] = [];
    for (const project of projects) {
      const workspaces = await this.deps.workspaces.list(project);
      if (workspaces.some((workspace) => normalizeProjectPath(workspace.path) === normalizedCwd)) matches.push(project);
    }
    if (matches.length > 1) throw new Error(this.t("project.authAmbiguous", "cwd belongs to multiple registered projects; cannot select authentication settings"));
    const [project] = matches;
    if (project === undefined) throw new Error(this.t("project.cwdUnregistered", "cwd must belong to a registered project"));
    return project;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const pending = [...this.initializations.values()];
    this.initializations.clear();
    await Promise.allSettled(pending);
    for (const refresher of this.refreshers.values()) refresher.dispose();
    this.refreshers.clear();
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    const services = [...this.services.values()];
    this.services.clear();
    this.listeners.clear();
    for (const service of services) service.dispose();
  }

  private async forProjectRecord(project: Project): Promise<AuthService> {
    if (this.disposed) throw new Error("Project auth service is disposed");
    const paths = projectAuthStoragePaths(this.dataDir, project.path);
    const existing = this.services.get(paths.directory);
    if (existing !== undefined) return existing;
    const pending = this.initializations.get(paths.directory);
    if (pending !== undefined) return pending;

    const initialization = (async () => {
      await initializeProjectAuthFiles(paths, this.globalAgentDir);
      const modelRuntime = await (this.deps.createModelRuntime?.(paths) ?? createModelRuntimeForAgentDir(paths.directory));
      const logger = this.deps.logger ?? noopLogger;
      await (this.deps.bootstrapProviders ?? bootstrapAndFreezeGlobalExtensionProviders)(modelRuntime, this.globalAgentDir, logger);
      if (this.disposed) throw new Error("Project auth service is disposed");
      const service = new AuthService({
        modelRuntime,
        logger,
      });
      const refresher = (this.deps.createCatalogRefresher ?? ((options) => new ModelCatalogRefresher(options)))({ runtime: modelRuntime, logger, offline: this.deps.offline ?? false });
      this.refreshers.set(paths.directory, refresher);
      refresher.start();
      this.services.set(paths.directory, service);
      this.subscriptions.set(paths.directory, service.subscribe((change) => {
        refresher.requestRefresh();
        for (const listener of this.listeners) listener(change);
      }));
      return service;
    })();
    this.initializations.set(paths.directory, initialization);
    try {
      return await initialization;
    } finally {
      if (this.initializations.get(paths.directory) === initialization) this.initializations.delete(paths.directory);
    }
  }

  isRefreshInFlight(): boolean {
    return [...this.refreshers.values()].some((refresher) => refresher.isRefreshInFlight());
  }
}

export function projectAuthStoragePaths(dataDir: string, projectPath: string): ProjectAuthStoragePaths {
  const normalizedPath = normalizeProjectPath(projectPath);
  const projectKey = createHash("sha256").update(normalizedPath, "utf8").digest("hex");
  const directory = join(resolve(dataDir), "projects", projectKey);
  return { directory, authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") };
}

async function initializeProjectAuthFiles(paths: ProjectAuthStoragePaths, globalAgentDir: string): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await ensureCopiedOrCreated(paths.authPath, join(globalAgentDir, "auth.json"), "{}\n");
  await ensureCopiedOrCreated(paths.modelsPath, join(globalAgentDir, "models.json"), '{"providers":{}}\n');
}

async function ensureCopiedOrCreated(destination: string, source: string, fallback: string): Promise<void> {
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
    return;
  } catch (error) {
    if (!isNodeError(error, "EEXIST") && !isNodeError(error, "ENOENT")) throw error;
  }

  try {
    await writeFile(destination, fallback, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
}

function normalizeProjectPath(projectPath: string): string {
  const normalized = resolve(projectPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
