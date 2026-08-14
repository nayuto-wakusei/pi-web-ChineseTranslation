import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { Project } from "../types.js";
import type { WorkspaceProviderRequest } from "../workspaces/workspaceProviderRegistry.js";
import { registerPluginBackendRoutes } from "./pluginBackendRoutes.js";

let app: FastifyInstance;
let projectRoot: string;
let requestProject: Project | undefined;
const normalProject: Project = { id: "normal", name: "Normal", path: "/normal", createdAt: new Date(0).toISOString() };

beforeEach(async () => {
  app = Fastify({ logger: false });
  projectRoot = await mkdtemp(join(process.env["TEMP"] ?? process.env["TMP"] ?? ".", "pi-web-managed-plugin-"));
  requestProject = undefined;
  registerPluginBackendRoutes(app, {
    projects: { requireProject: (projectId) => projectId === normalProject.id ? Promise.resolve(normalProject) : Promise.reject(new Error("Project not found")) },
    managementProjectRoot: projectRoot,
    backends: {
      request: (request: WorkspaceProviderRequest) => {
        requestProject = request.project;
        return Promise.resolve({ ok: true });
      },
    },
  });
});

afterEach(async () => {
  await app.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("sessiond plugin backend project resolution", () => {
  it("keeps ordinary requests on ProjectStore resolution", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/plugin-backends/git/projects/normal/workspaces/main/list",
      payload: { revision: "v1", input: {} },
    });

    expect(response.statusCode).toBe(200);
    expect(requestProject).toBe(normalProject);
  });

  it("resolves an authorized management project without passing context to the backend", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "POST",
      url: "/plugin-backends/git/projects/managed/workspaces/main/list",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
      payload: { revision: "v1", input: {} },
    });

    expect(response.statusCode).toBe(200);
    expect(requestProject).toMatchObject({ id: "managed", name: "Managed", path: projectRoot });
  });

  it("rejects an unauthorized management project instead of falling back to ProjectStore", async () => {
    const context = {
      user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
      projects: [{ id: "managed", name: "Managed", root: projectRoot }],
    };
    const response = await app.inject({
      method: "POST",
      url: "/plugin-backends/git/projects/normal/workspaces/main/list",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
      payload: { revision: "v1", input: {} },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "project-not-authorized" });
    expect(requestProject).toBeUndefined();
  });
});
