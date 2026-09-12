import { normalizeRequestCwd } from "../workingDirectory.js";
import type { NormalProjectCwdResolver } from "../sessiond/sessionProxyRoutes.js";

export interface NormalProjectCwdResolverProject {
  readonly id: string;
}

export interface NormalProjectCwdResolverWorkspace {
  readonly path: string;
}

export interface NormalProjectCwdResolverSource<TProject extends NormalProjectCwdResolverProject> {
  listProjects(): Promise<readonly TProject[]>;
  listWorkspaces(project: TProject): Promise<readonly NormalProjectCwdResolverWorkspace[]>;
}

/**
 * Resolve registered workspace paths for normal-mode session mutations.
 *
 * A request with explicit cwd targets can proceed when those targets are all
 * present in successfully listed projects. A request without targets is a
 * global operation, so every project must list successfully before any path is
 * returned.
 */
export function createNormalProjectCwdResolver<TProject extends NormalProjectCwdResolverProject>(source: NormalProjectCwdResolverSource<TProject>): NormalProjectCwdResolver {
  return async (requestedCwds) => {
    const requested = requestedCwds === undefined ? undefined : new Set(requestedCwds.map(normalizeRequestCwd));
    const projects = await source.listProjects();
    const listed = await Promise.allSettled(projects.map(async (project) => {
      const workspaces = await source.listWorkspaces(project);
      return workspaces.map((workspace) => normalizeRequestCwd(workspace.path));
    }));
    const failed = listed.some((result) => result.status === "rejected");
    const successfulCwds = unique(listed.flatMap((result) => result.status === "fulfilled" ? result.value : []));

    if (requested === undefined) {
      if (failed) throw new Error("Unable to determine all registered project workspaces");
      return successfulCwds;
    }

    const successfulSet = new Set(successfulCwds);
    const missing = [...requested].some((cwd) => !successfulSet.has(cwd));
    if (failed && missing) throw new Error("Unable to verify requested project workspace scope");
    return successfulCwds;
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
