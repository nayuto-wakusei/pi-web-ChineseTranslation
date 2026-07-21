import { constants } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { piWebDataDir } from "../../config.js";
import type { Project } from "../types.js";
import { AuthService, type AuthChange } from "./authService.js";

interface ProjectLister {
  list(): Promise<Project[]>;
}

interface WorkspaceLister {
  list(project: Project): Promise<readonly { path: string }[]>;
}

export interface ProjectAuthServiceDependencies {
  projects: ProjectLister;
  workspaces: WorkspaceLister;
  dataDir?: string;
  globalAgentDir?: string;
  createModelRuntime?: (paths: ProjectAuthStoragePaths) => Promise<ModelRuntime>;
}

export interface ProjectAuthStoragePaths {
  directory: string;
  authPath: string;
  modelsPath: string;
}

type ProjectAuthChangeListener = (change: AuthChange) => void;

/**
 * Owns the normal-mode auth/model registries that are scoped to registered
 * projects. Management-embed authentication intentionally stays outside this
 * service because it has a different security boundary.
 */
export class ProjectAuthService {
  private readonly services = new Map<string, AuthService>();
  private readonly initializations = new Map<string, Promise<AuthService>>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly listeners = new Set<ProjectAuthChangeListener>();
  private readonly dataDir: string;
  private readonly globalAgentDir: string;

  constructor(private readonly deps: ProjectAuthServiceDependencies) {
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
    const project = (await this.deps.projects.list()).find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new Error("Project not found");
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
    if (matches.length > 1) throw new Error("cwd 同时属于多个已注册项目，无法确定认证配置");
    const [project] = matches;
    if (project === undefined) throw new Error("cwd 必须属于一个已注册项目");
    return project;
  }

  async dispose(): Promise<void> {
    const pending = [...this.initializations.values()];
    this.initializations.clear();
    await Promise.allSettled(pending);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    const services = [...this.services.values()];
    this.services.clear();
    this.listeners.clear();
    for (const service of services) service.dispose();
  }

  private async forProjectRecord(project: Project): Promise<AuthService> {
    const paths = projectAuthStoragePaths(this.dataDir, project.path);
    const existing = this.services.get(paths.directory);
    if (existing !== undefined) return existing;
    const pending = this.initializations.get(paths.directory);
    if (pending !== undefined) return pending;

    const initialization = (async () => {
      await initializeProjectAuthFiles(paths, this.globalAgentDir);
      const service = new AuthService({
        modelRuntime: await (this.deps.createModelRuntime?.(paths)
          ?? ModelRuntime.create({ authPath: paths.authPath, modelsPath: paths.modelsPath })),
      });
      this.services.set(paths.directory, service);
      this.subscriptions.set(paths.directory, service.subscribe((change) => {
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
