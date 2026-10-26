import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerManagementAgentsRoutes } from "./managementAgentsRoutes.js";
import { managedProjectPath, type ManagementEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";
import type { ManagedAgentsStatus } from "../shared/managedAgents.js";

let app: FastifyInstance;
let root: string;
let projectPath: string;
let workspacePath: string;
let context: ManagementEmbedContext;
const query = "?embed=management&token=entry";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "managed-agents-routes-")));
  projectPath = await managedProjectPath(root, "owner", "p1");
  workspacePath = join(projectPath, "feature");
  await mkdir(workspacePath);
  await writeFile(join(projectPath, "AGENTS.md"), "PROJECT_ROOT");
  await writeFile(join(workspacePath, "AGENTS.md"), "WORKSPACE_LOCAL");
  await utimes(join(workspacePath, "AGENTS.md"), new Date("2026-01-01"), new Date("2026-01-01"));
  context = {
    user: { id: "user", rootUserId: "owner", roles: [], permissions: [] },
    projects: [{ id: "p1", name: "Project", agentsInstructions: "PLATFORM_TEMPLATE", agentsInstructionsUpdatedAt: "2026-10-26T12:00:00.000Z" }],
  };
  const runtime: ManagementEmbedRuntime = { enabled: true, projectRoot: root, authenticate: () => Promise.resolve(context) };
  const workspaces = { list: (project: { id: string; path: string }) => Promise.resolve([
    { id: "main", projectId: project.id, path: project.path, label: "Main", isMain: true },
    { id: "feature", projectId: project.id, path: workspacePath, label: "Feature", isMain: false },
  ]) };
  app = Fastify({ logger: false });
  registerManagementAgentsRoutes(app, workspaces, "/api", runtime);
  registerManagementAgentsRoutes(app, workspaces, "/api/machines/local", runtime);
});

afterEach(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

function status(value: ManagedAgentsStatus) {
  if (!value.available) throw new Error("Expected a managed template");
  return value;
}

describe("managed AGENTS.md gateway", () => {
  it.each(["/api", "/api/machines/local"])("uses authorized selected workspace paths for %s", async (prefix) => {
    const url = `${prefix}/projects/p1/workspaces/feature/agents-instructions${query}`;
    const initial = await app.inject({ method: "GET", url });
    expect(initial.statusCode).toBe(200);
    const current = status(initial.json<ManagedAgentsStatus>());
    expect(current.pending).toBe(true);
    const replaced = await app.inject({ method: "POST", url, payload: { action: "overwrite", revision: current.revision } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ pending: false });
    expect(await readFile(join(workspacePath, "AGENTS.md"), "utf8")).toBe("PLATFORM_TEMPLATE");
    expect(await readFile(join(projectPath, "AGENTS.md"), "utf8")).toBe("PROJECT_ROOT");
  });

  it("rejects ordinary requests and foreign project/workspace selections", async () => {
    expect((await app.inject("/api/projects/p1/workspaces/feature/agents-instructions")).statusCode).toBe(403);
    expect((await app.inject(`/api/projects/foreign/workspaces/feature/agents-instructions${query}`)).statusCode).toBe(403);
    expect((await app.inject(`/api/projects/p1/workspaces/missing/agents-instructions${query}`)).statusCode).not.toBe(200);
  });

  it("validates decisions and rejects template/path injection", async () => {
    const url = `/api/projects/p1/workspaces/feature/agents-instructions${query}`;
    const current = status((await app.inject(url)).json<ManagedAgentsStatus>());
    for (const payload of [null, {}, { action: "close", revision: current.revision }, { action: "overwrite", revision: current.revision, instructions: "injected" }, { action: "overwrite", revision: current.revision, path: "../AGENTS.md" }]) {
      expect((await app.inject({ method: "POST", url, payload: JSON.stringify(payload), headers: { "content-type": "application/json" } })).statusCode).toBe(400);
    }
    expect(await readFile(join(workspacePath, "AGENTS.md"), "utf8")).toBe("WORKSPACE_LOCAL");
  });

  it("returns conflict without acknowledging a stale decision", async () => {
    const url = `/api/projects/p1/workspaces/feature/agents-instructions${query}`;
    const current = status((await app.inject(url)).json<ManagedAgentsStatus>());
    await writeFile(join(workspacePath, "AGENTS.md"), "NEW_EDIT");
    const response = await app.inject({ method: "POST", url, payload: { action: "keep", revision: current.revision } });
    expect(response.statusCode).toBe(409);
    expect(await readFile(join(workspacePath, "AGENTS.md"), "utf8")).toBe("NEW_EDIT");
  });

  it("does not authorize a context with no template to overwrite files", async () => {
    context.projects = [{ id: "p1", name: "Project" }];
    const url = `/api/projects/p1/workspaces/feature/agents-instructions${query}`;
    expect((await app.inject(url)).json()).toEqual({ available: false });
    expect((await app.inject({ method: "POST", url, payload: { action: "overwrite", revision: "a".repeat(64) } })).statusCode).toBe(400);
  });
});
