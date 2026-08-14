import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { TerminalCommandRun } from "../../shared/apiTypes.js";
import type { Project } from "../types.js";
import { registerWorkspaceRemovalRoutes } from "./workspaceRemovalRoutes.js";

let app: FastifyInstance;
let projectRoot: string;
let removedProject: Project | undefined;
const normalProject: Project = { id: "normal", name: "Normal", path: "/normal", createdAt: new Date(0).toISOString() };

beforeEach(async () => {
  app = Fastify({ logger: false });
  projectRoot = await mkdtemp(join(process.env["TEMP"] ?? process.env["TMP"] ?? ".", "pi-web-managed-removal-"));
  removedProject = undefined;
  registerWorkspaceRemovalRoutes(app, {
    projects: { requireProject: (projectId) => projectId === normalProject.id ? Promise.resolve(normalProject) : Promise.reject(new Error("Project not found")) },
    managementProjectRoot: projectRoot,
    removals: {
      remove: (project: Project): Promise<TerminalCommandRun> => {
        removedProject = project;
        return Promise.resolve({
          id: "run-1",
          origin: "core",
          projectId: project.id,
          workspaceId: "feature",
          terminalId: "terminal-1",
          title: "Remove workspace",
          command: "remove",
          status: "running",
          createdAt: new Date(0).toISOString(),
          metadata: {},
        } satisfies TerminalCommandRun);
      },
    },
  });
});

afterEach(async () => {
  await app.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("sessiond workspace removal project resolution", () => {
  it("keeps ordinary removals on ProjectStore resolution", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/workspace-removals/projects/normal/workspaces/feature",
      payload: { precondition: "feature" },
    });

    expect(response.statusCode).toBe(200);
    expect(removedProject).toBe(normalProject);
  });

  it("resolves an authorized management project", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "DELETE",
      url: "/workspace-removals/projects/managed/workspaces/feature",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
      payload: { precondition: "feature" },
    });

    expect(response.statusCode).toBe(200);
    expect(removedProject).toMatchObject({ id: "managed", path: projectRoot });
  });

  it("rejects unauthorized management removals without fallback", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "DELETE",
      url: "/workspace-removals/projects/normal/workspaces/feature",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
      payload: { precondition: "feature" },
    });

    expect(response.statusCode).toBe(403);
    expect(removedProject).toBeUndefined();
  });
});
