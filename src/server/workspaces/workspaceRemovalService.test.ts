import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TerminalCommandRun, WorkspaceListing } from "../../shared/apiTypes.js";
import { ServerNoticeStore } from "../notices/serverNoticeStore.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import type { ServerNoticeCreator } from "../notices/serverNoticeService.js";
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
    const closeForCwd = vi.fn();
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
      { closeForCwd, runCommand },
      { preRemoveHook: { isExecutable: () => Promise.resolve(false) } },
    );

    await service.remove(project, target.id, "remove-feature", undefined, context);

    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ managementContext: context }));
    expect(closeForCwd).toHaveBeenCalledWith(target.path, context);
  });

  it("records a server notice when removal fails before command creation", async () => {
    const project: Project = { id: "project", name: "Project", path: resolve("repo-main"), createdAt: "now" };
    const records: Parameters<ServerNoticeCreator["record"]>[0][] = [];
    const notices: ServerNoticeCreator = {
      record: (input) => {
        records.push(input);
        return new ServerNoticeStore().record(input).notice;
      },
    };
    const service = new WorkspaceRemovalService(
      { resolveRemoval: () => Promise.reject(new Error("workspace has unsubmitted changes")) },
      { closeForCwd: vi.fn(), runCommand: vi.fn() },
      { notices },
    );

    await expect(service.remove(project, "feature", "remove-feature")).rejects.toThrow("workspace has unsubmitted changes");
    expect(records).toEqual([{
      severity: "error",
      message: "工作区移除失败：workspace has unsubmitted changes",
      source: "workspace.delete",
      scope: { projectId: project.id },
      context: { projectId: project.id, workspaceId: "feature" },
    }]);
  });

  it("does not record a notice when the removal request is cancelled", async () => {
    const project: Project = { id: "project", name: "Project", path: resolve("repo-main"), createdAt: "now" };
    const records: Parameters<ServerNoticeCreator["record"]>[0][] = [];
    const notices: ServerNoticeCreator = {
      record: (input) => {
        records.push(input);
        return new ServerNoticeStore().record(input).notice;
      },
    };
    const service = new WorkspaceRemovalService(
      {
        resolveRemoval: (_project, _workspaceId, signal) => new Promise((_resolvePromise, rejectPromise) => {
          signal.addEventListener("abort", () => {
            rejectPromise(signal.reason instanceof Error ? signal.reason : new Error("Request cancelled"));
          }, { once: true });
        }),
      },
      { closeForCwd: vi.fn(), runCommand: vi.fn() },
      { notices },
    );
    const controller = new AbortController();
    const pending = service.remove(project, "feature", "remove-feature", controller.signal);

    controller.abort(new DOMException("Request cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(records).toEqual([]);
  });

  it("cancels admitted removal planning on shutdown and rejects later removals", async () => {
    const project: Project = { id: "project", name: "Project", path: resolve("repo-main"), createdAt: "now" };
    let planningSignal: AbortSignal | undefined;
    let planningStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => { planningStarted = resolvePromise; });
    const runCommand = vi.fn();
    const closeForCwd = vi.fn();
    const service = new WorkspaceRemovalService(
      {
        resolveRemoval: (_project, _workspaceId, signal) => {
          planningSignal = signal;
          planningStarted();
          return new Promise((_resolvePromise, rejectPromise) => {
            signal.addEventListener("abort", () => {
              rejectPromise(signal.reason instanceof Error ? signal.reason : new Error("Removal cancelled"));
            }, { once: true });
          });
        },
      },
      { closeForCwd, runCommand },
    );
    const removal = service.remove(project, "feature", "remove-feature");
    const rejected = expect(removal).rejects.toMatchObject({ name: "AbortError" });
    await started;
    const closing = service.closeAll();
    expect(service.closeAll()).toBe(closing);
    await closing;
    await rejected;
    expect(planningSignal?.aborted).toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
    expect(closeForCwd).not.toHaveBeenCalled();
    await expect(service.remove(project, "feature", "remove-feature")).rejects.toMatchObject({ name: "AbortError" });
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
