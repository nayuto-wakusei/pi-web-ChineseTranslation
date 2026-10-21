import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../pi-web-plugins/zh-cn/files.json";
import { createTranslator } from "../../shared/i18n.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { registerWorkspaceExplorerRoutes } from "../workspaceExplorerRoutes.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";
import { WorkspaceService } from "./workspaceService.js";
import { WorkspaceUserError, workspaceErrorMessage } from "./workspaceUserError.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await cleanupTempWorkspaces();
  vi.restoreAllMocks();
});

async function fixture(locale: string) {
  const root = await createTempWorkspace("pi-web-file-localization-");
  const projects = new ProjectService(new ProjectStore(root));
  const workspaces = new WorkspaceService();
  const project = { id: "p", name: "Project", path: root, createdAt: "2026-10-20T00:00:00.000Z" };
  vi.spyOn(projects, "requireProject").mockResolvedValue(project);
  vi.spyOn(workspaces, "list").mockResolvedValue([{
    id: "w", projectId: "p", path: root, label: "main", isMain: true, isGitRepo: false, isGitWorktree: false,
  }]);
  const app = Fastify({ logger: false });
  apps.push(app);
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api", { translate: createTranslator(locale, messages) });
  return { app, projects };
}

describe("workspace error localization boundary", () => {
  it.each([
    ["en", "path query parameter is required", "Path does not exist"],
    ["zh-CN", "必须提供 path 查询参数", "路径不存在"],
  ])("localizes owned errors in %s without changing missing-file status semantics", async (locale, required, missing) => {
    const { app } = await fixture(locale);
    const invalid = await app.inject("/api/projects/p/workspaces/w/file");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: required });

    const absent = await app.inject("/api/projects/p/workspaces/w/file?path=missing.txt");
    expect(absent.statusCode).toBe(404);
    expect(absent.json()).toEqual({ error: missing });

    const optional = await app.inject("/api/projects/p/workspaces/w/file?path=missing.txt&optional=true");
    expect(optional.statusCode).toBe(204);
  });

  it("does not translate arbitrary errors even when their message matches owned copy", async () => {
    const { app, projects } = await fixture("zh-CN");
    vi.spyOn(projects, "requireProject").mockRejectedValue(new Error("Path does not exist"));
    const response = await app.inject("/api/projects/p/workspaces/w/tree");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Path does not exist" });
  });

  it("retains English internal messages and preserves parameter contents", () => {
    const error = new WorkspaceUserError("server.files.fileExists", "File already exists: {path}", { path: "用户/{error}.txt" });
    expect(error.message).toBe("File already exists: 用户/{error}.txt");
    expect(workspaceErrorMessage(error, createTranslator("zh-CN", messages))).toBe("文件已存在：用户/{error}.txt");
    expect(workspaceErrorMessage(error, createTranslator("en", messages))).toBe(error.message);
  });
});
