import { t, setTranslator } from "./i18n.js";
import { basename, resolve } from "node:path";
import type {
  PiWebServerPlugin,
  ProjectInput,
  ProviderClaim,
  ProviderRemoveContext,
  ProviderWorkspace,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProvider,
  WorkspaceRemovePlan,
} from "@chainingintention/pi-web-cn/server-plugin-api";
import { requestGitBackend } from "./git-backend.js";

const GIT_LOCAL_ENV_VARS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
]);

interface GitWorktreeInfo {
  path: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  prunable?: boolean;
}

const plugin: Extract<PiWebServerPlugin, { apiVersion: 3 }> = {
  apiVersion: 3,
  name: "Git",
  activate(context) {
    setTranslator(context.translate);
    return {
      workspaceProvider: createGitWorkspaceProvider(context),
      peer: { request: (request) => requestGitBackend(context, request) },
    };
  },
};

export default plugin;

export function createGitWorkspaceProvider(context: ServerPluginActivationContext): WorkspaceProvider {
  return Object.freeze({
    fallback: true,
    async probe(project: ProjectInput, signal: AbortSignal): Promise<ProviderClaim> {
      const result = await runGit(context, project.path, ["rev-parse", "--is-inside-work-tree"], signal);
      if (result.signal !== null) throw new Error(t("ui.main.8919cbc9c0bd", "Git repository probe ended with signal {arg0}", { arg0: result.signal }));
      if (result.exitCode !== 0) return "pass";
      return result.stdout.trim() === "true" ? "claim" : "pass";
    },
    async list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]> {
      const rootResult = await requireGit(
        runGit(context, project.path, ["rev-parse", "--show-toplevel"], signal),
        t("ui.main.49c35c822771", "resolve the Git worktree root"),
      );
      const mainRootOutput = rootResult.stdout.trim();
      if (mainRootOutput === "") throw new Error(t("ui.main.f1639c9e2fd7", "Git returned an empty worktree root"));
      const mainRoot = resolve(mainRootOutput);
      const commonDirectoryResult = await requireGit(
        runGit(context, project.path, ["rev-parse", "--git-common-dir"], signal),
        t("ui.main.d59fce8c03cf", "resolve the Git common directory"),
      );
      const commonDirectoryOutput = commonDirectoryResult.stdout.trim();
      if (commonDirectoryOutput === "") throw new Error(t("ui.main.8d51c7fbda53", "Git returned an empty common directory"));
      const commonDirectory = resolve(project.path, commonDirectoryOutput);

      const listResult = await requireGit(
        runGit(context, project.path, ["worktree", "list", "--porcelain", "-z"], signal),
        t("ui.main.09734cee0f68", "list Git worktrees"),
      );
      const worktrees = parseGitWorktreeList(listResult.stdout)
        .filter((worktree) => worktree.bare !== true)
        .map((worktree) => {
          const path = resolve(worktree.path);
          return { worktree: { ...worktree, path }, path };
        });
      // Prefer the checkout Git identifies for the registered project. A
      // submodule is the exception: its sole worktree record points at common
      // storage under the superproject instead of at --show-toplevel.
      const mainWorkspacePath = worktrees.some(({ path }) => path === mainRoot)
        ? mainRoot
        : commonDirectory;
      const selectable = worktrees
        .map(({ worktree, path }) => ({ worktree, path, isMain: path === mainWorkspacePath }))
        .filter(({ worktree, path, isMain }) => worktree.prunable !== true || isMain || path === project.path);
      if (selectable.length === 0) return [singleGitWorkspace(project)];

      return selectable.map(({ worktree, path, isMain }) => {
        const label = worktree.branch ?? (worktree.detached === true ? t("ui.workspaceGitPanel.detachedHead", "Detached HEAD") : basename(worktree.path) || worktree.path);
        return {
          key: path,
          path,
          label,
          isMain,
          data: {
            worktreePath: worktree.path,
            ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
          },
          publicMetadata: {
            isGitRepo: true,
            isGitWorktree: true,
            ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
            ...(worktree.detached === undefined ? {} : { detached: worktree.detached }),
          },
          ...(isMain ? {} : { removal: gitRemovalPresentation(label, path) }),
        };
      });
    },
    async prepareRemove({ project, workspace, signal }: ProviderRemoveContext): Promise<WorkspaceRemovePlan> {
      const privatePath = gitPrivateWorktreePath(workspace);
      if (resolve(privatePath) !== workspace.path) {
        throw new Error(t("ui.main.ee323b371b28", "Git workspace removal data no longer matches the current workspace path"));
      }
      const listResult = await requireGit(
        runGit(context, project.path, ["worktree", "list", "--porcelain", "-z"], signal),
        t("ui.main.67b7774d37e3", "validate the Git worktree before removal"),
      );
      const current = parseGitWorktreeList(listResult.stdout)
        .find((worktree) => resolve(worktree.path) === workspace.path);
      if (current === undefined || current.prunable === true) {
        throw new Error(t("ui.main.2eaaec45ffc2", "Git worktree is no longer available for removal"));
      }
      if (current.bare === true) throw new Error(t("ui.main.e316bd0c1e32", "A bare Git workspace cannot be removed as a linked worktree"));
      return {
        title: t("ui.shared.168f8f19045c", "Delete workspace: {workspace}", { workspace: workspace.label }),
        command: `git worktree remove ${shellQuote(workspace.path)}`,
      };
    },
  });
}

/** Parse `git worktree list --porcelain -z` without path quoting or space loss. */
export function parseGitWorktreeList(stdout: string): GitWorktreeInfo[] {
  return stdout.split("\0\0").flatMap((record) => {
    if (record === "") return [];
    const info: GitWorktreeInfo = { path: "" };
    for (const field of record.split("\0")) {
      const separator = field.indexOf(" ");
      const key = separator === -1 ? field : field.slice(0, separator);
      const value = separator === -1 ? "" : field.slice(separator + 1);
      if (key === "worktree") info.path = value;
      else if (key === "branch") info.branch = value.replace(/^refs\/heads\//u, "");
      else if (key === "bare") info.bare = true;
      else if (key === "detached") info.detached = true;
      else if (key === "prunable") info.prunable = true;
    }
    return info.path === "" ? [] : [info];
  });
}

function singleGitWorkspace(project: ProjectInput): ProviderWorkspace {
  return {
    key: project.path,
    path: project.path,
    label: project.name,
    isMain: true,
    data: { worktreePath: project.path },
    publicMetadata: { isGitRepo: true, isGitWorktree: false },
  };
}

function gitRemovalPresentation(label: string, path: string): NonNullable<ProviderWorkspace["removal"]> {
  return {
    actionLabel: t("client.actions.delete.workspace.1bca7e", "Delete workspace"),
    confirmation: t("ui.main.8e2b2416adcd", "Delete workspace {arg0}?\n\nThis runs git worktree remove and deletes:\n{arg1}\n\nThe corresponding Git branch will not be deleted.", { arg0: label, arg1: path }),
  };
}

function gitPrivateWorktreePath(workspace: ProviderWorkspace): string {
  const data = workspace.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(t("ui.main.b6c981521483", "Git workspace removal data is unavailable"));
  }
  const path: unknown = Reflect.get(data, "worktreePath");
  if (typeof path !== "string" || path === "") throw new Error(t("ui.main.2f42169d50eb", "Git worktree path is unavailable for removal"));
  return path;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runGit(
  context: ServerPluginActivationContext,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ServerPluginExecFileResult> {
  const result = await context.execFile({
    file: "git",
    args: ["-C", cwd, ...args],
    unsetEnv: GIT_LOCAL_ENV_VARS,
    signal,
  });
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(t("ui.main.f1dbb26bf138", "git {arg0} exceeded the host output limit", { arg0: args.join(" ") }));
  }
  return result;
}

async function requireGit(
  resultPromise: Promise<ServerPluginExecFileResult>,
  action: string,
): Promise<ServerPluginExecFileResult> {
  const result = await resultPromise;
  if (result.signal === null && result.exitCode === 0) return result;
  const detail = result.stderr.trim();
  const outcome = result.signal === null ? t("client.shellMessages.exit.code.2beadf", "Exit code {value1}", { value1: String(result.exitCode) }) : t("ui.main.c008196ee907", "signal {arg0}", { arg0: result.signal });
  throw new Error(t("ui.main.0def9a625382", "Could not {arg0} ({arg1}){arg2}", { arg0: action, arg1: outcome, arg2: detail === "" ? "" : `：${detail}` }));
}
