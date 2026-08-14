import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TerminalCommandRun, WorkspaceListing } from "../../shared/apiTypes.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import type { Project } from "../types.js";
import type { RunTerminalCommandOptions } from "../terminals/terminalService.js";
import { WorkspaceRemovalService } from "./workspaceRemovalService.js";

describe("WorkspaceRemovalService management scope", () => {
  it("runs the removal command with the originating management context", async () => {
    const project: Project = { id: "managed", name: "Managed", path: resolve("repo-main"), createdAt: "now" };
    const context: ManagementEmbedContext = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: project.id, name: project.name, root: project.path }],
      tools: { allow: ["terminal-command-runs"] },
    };
    const main = workspace(project, "main", project.path, true);
    const target = workspace(project, "feature", resolve("repo-feature"), false, "remove-feature");
    const runCommand = vi.fn((options: RunTerminalCommandOptions): TerminalCommandRun => ({
      id: "run-1",
      origin: options.origin,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      terminalId: "terminal-1",
      title: options.title,
      command: options.command,
      status: "running",
      createdAt: "now",
      metadata: {},
    }));
    const service = new WorkspaceRemovalService(
      {
        resolveRemoval: () => Promise.resolve({
          ownerPluginId: "git",
          target,
          workspaces: [main, target],
          prepare: () => Promise.resolve({ title: "删除工作区", command: "git worktree remove feature" }),
        }),
      },
      { closeForCwd: vi.fn(), runCommand },
      { preRemoveHook: { isExecutable: () => Promise.resolve(false) } },
    );

    await service.remove(project, target.id, "remove-feature", undefined, context);

    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ managementContext: context }));
  });
});

function workspace(project: Project, id: string, path: string, isMain: boolean, precondition?: string): WorkspaceListing {
  return {
    id,
    projectId: project.id,
    path,
    label: id,
    isMain,
    provider: { pluginId: "git", capabilities: { request: true, remove: true } },
    ...(precondition === undefined ? {} : {
      removal: { actionLabel: "删除工作区", confirmation: "确认删除？", precondition },
    }),
  };
}
