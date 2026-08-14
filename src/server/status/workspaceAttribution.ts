import { isAbsolute, relative } from "node:path";
import type { Project } from "../types.js";
import type { WorkspaceListing } from "../../shared/apiTypes.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "../realtime/sessionEventScope.js";

export interface CwdAttribution {
  projectId: string;
  workspaceId: string;
}

export interface WorkspaceAttribution {
  attribute(cwds: Iterable<string>, scope?: SessionEventScope): Promise<ReadonlyMap<string, CwdAttribution>>;
  invalidate(): void;
}

interface ProjectLister { list(scope?: SessionEventScope): Promise<Project[]>; }
interface WorkspaceLister { list(project: Project): Promise<WorkspaceListing[]>; }
interface AttributionLogger { warn(details: Record<string, unknown>, message: string): void; }

export interface WorkspaceAttributionDependencies {
  projects: ProjectLister;
  workspaces: WorkspaceLister;
  logger: AttributionLogger;
  topologyTtlMs?: number;
  now?: () => number;
}

const DEFAULT_WORKSPACE_TOPOLOGY_TTL_MS = 15_000;

interface AttributedWorkspacePath {
  path: string;
  depth: number;
  attribution: CwdAttribution;
}

interface TopologyCacheEntry {
  loadedAt: number;
  workspaces: Promise<readonly AttributedWorkspacePath[]>;
}

export class CachedWorkspaceAttribution implements WorkspaceAttribution {
  private readonly topologyTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<SessionEventScope, TopologyCacheEntry>();

  constructor(private readonly dependencies: WorkspaceAttributionDependencies) {
    this.topologyTtlMs = dependencies.topologyTtlMs ?? DEFAULT_WORKSPACE_TOPOLOGY_TTL_MS;
    this.now = dependencies.now ?? (() => Date.now());
  }

  async attribute(cwds: Iterable<string>, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): Promise<ReadonlyMap<string, CwdAttribution>> {
    const requested = [...new Set(cwds)].filter((cwd) => cwd !== "");
    if (requested.length === 0) return new Map();
    const workspaces = await this.topology(scope);
    const attributions = new Map<string, CwdAttribution>();
    for (const cwd of requested) {
      const canonical = canonicalizeStoredCwd(cwd);
      const owner = workspaces.find((workspace) => containsCwd(workspace.path, canonical));
      if (owner !== undefined) attributions.set(cwd, owner.attribution);
    }
    return attributions;
  }

  invalidate(): void { this.cache.clear(); }

  private topology(scope: SessionEventScope): Promise<readonly AttributedWorkspacePath[]> {
    const cached = this.cache.get(scope);
    if (cached !== undefined && this.now() - cached.loadedAt < this.topologyTtlMs) return cached.workspaces;
    const entry: TopologyCacheEntry = { loadedAt: this.now(), workspaces: this.loadTopology(scope) };
    this.cache.set(scope, entry);
    return entry.workspaces;
  }

  private async loadTopology(scope: SessionEventScope): Promise<readonly AttributedWorkspacePath[]> {
    let projects: Project[];
    try {
      projects = await this.dependencies.projects.list(scope);
    } catch (error) {
      this.dependencies.logger.warn({ err: error }, "workspace attribution could not list projects");
      return [];
    }
    const listed = await Promise.all(projects.map((project) => this.listWorkspaces(project)));
    return listed.flat().sort((left, right) => right.depth - left.depth);
  }

  private async listWorkspaces(project: Project): Promise<AttributedWorkspacePath[]> {
    try {
      return (await this.dependencies.workspaces.list(project)).map(attributedWorkspacePath);
    } catch (error) {
      this.dependencies.logger.warn({ err: error, projectId: project.id }, "workspace attribution could not list workspaces for a project");
      return [];
    }
  }
}

function attributedWorkspacePath(workspace: WorkspaceListing): AttributedWorkspacePath {
  const path = canonicalizeStoredCwd(workspace.path);
  return {
    path,
    depth: path.split(/[\\/]+/).filter((segment) => segment !== "").length,
    attribution: { projectId: workspace.projectId, workspaceId: workspace.id },
  };
}

function containsCwd(workspacePath: string, cwd: string): boolean {
  if (workspacePath === cwd) return true;
  const rel = relative(workspacePath, cwd);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
