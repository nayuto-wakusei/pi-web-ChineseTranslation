import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { Project } from "../types.js";
import type { WorkspaceProviderAuthorityResolution } from "../workspaces/workspaceProviderRegistry.js";
import { registerWorkspaceCatalogRoutes } from "./workspaceCatalogRoutes.js";

let app: FastifyInstance;
let projectRoot: string;
let resolvedProject: Project | undefined;
const normalProject: Project = { id: "normal", name: "Normal", path: "/normal", createdAt: new Date(0).toISOString() };

beforeEach(async () => {
  app = Fastify({ logger: false });
  projectRoot = await mkdtemp(join(process.env["TEMP"] ?? process.env["TMP"] ?? ".", "pi-web-managed-catalog-"));
  resolvedProject = undefined;
  registerWorkspaceCatalogRoutes(app, {
    projects: { requireProject: (projectId) => projectId === normalProject.id ? Promise.resolve(normalProject) : Promise.reject(new Error("Project not found")) },
    managementProjectRoot: projectRoot,
    providerRuntime: { protocolVersion: 1, records: [], health: [], diagnostics: [] },
    workspaces: {
      resolve: (project: Project): Promise<WorkspaceProviderAuthorityResolution> => {
        resolvedProject = project;
        return Promise.resolve({
          status: "folder",
          projectId: project.id,
          workspaces: [{ id: "main", projectId: project.id, path: project.path, label: project.name, isMain: true }],
          diagnostics: [],
        });
      },
    },
  });
});

afterEach(async () => {
  await app.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("sessiond workspace catalog project resolution", () => {
  it("keeps ordinary catalog requests on ProjectStore resolution", async () => {
    const response = await app.inject({ method: "GET", url: "/workspace-catalog/projects/normal/workspaces" });

    expect(response.statusCode).toBe(200);
    expect(resolvedProject).toBe(normalProject);
  });

  it("resolves an authorized management project for catalog GETs", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "GET",
      url: "/workspace-catalog/projects/managed/workspaces",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
    });

    expect(response.statusCode).toBe(200);
    expect(resolvedProject).toMatchObject({ id: "managed", path: projectRoot });
  });

  it("rejects unauthorized management catalog projects", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "GET",
      url: "/workspace-catalog/projects/normal/workspaces",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
    });

    expect(response.statusCode).toBe(403);
    expect(resolvedProject).toBeUndefined();
  });
});
