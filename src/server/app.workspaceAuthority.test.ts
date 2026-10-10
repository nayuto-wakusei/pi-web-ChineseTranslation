import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProviderAuthorityResolution } from "../shared/apiTypes.js";
import { buildApp } from "./app.js";
import { installTestAuth } from "./app.testSupport.js";
import { createFilePiWebConfigService } from "./configRoutes.js";
import { PiWebPluginManifestRuntimeError } from "./piWebPluginService.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import { WorkspaceCatalogProtocolError, WorkspaceCatalogUnavailableError } from "./workspaces/workspaceCatalog.js";

let root: string;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-gateway-authority-"));
  vi.stubEnv("PI_WEB_CONFIG", join(root, "config.json"));
  vi.stubEnv("PI_WEB_DATA_DIR", join(root, "data"));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function authorityApp(resolveProject: (projectId: string) => Promise<WorkspaceProviderAuthorityResolution>, pluginFailure?: PiWebPluginManifestRuntimeError) {
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const project = await projects.add({ name: "Fixture", path: join(root, "project"), create: true });
  app = await buildApp({
    projects,
    config: createFilePiWebConfigService(),
    workspaceCatalog: {
      resolveProject,
      list: () => { throw new Error("Gateway must preserve the complete authority resolution"); },
      resolve: () => { throw new WorkspaceCatalogUnavailableError("daemon unavailable"); },
    },
    sessionDaemon: { request: () => { throw new Error("daemon must not participate in Web readiness"); }, connectWebSocket: () => { throw new Error("unused socket"); } },
    ...(pluginFailure === undefined ? {} : { piWebPlugins: { manifest: () => { throw pluginFailure; }, plugins: () => { throw pluginFailure; }, readAsset: () => { throw pluginFailure; } } }),
    clientDist: false,
    logger: false,
  });
  await installTestAuth(app);
  return { app, project };
}

describe("gateway workspace authority contracts", () => {
  it("preserves degraded provider diagnostics and adds browser workspace configuration", async () => {
    const { app, project } = await authorityApp((projectId) => Promise.resolve({ status: "degraded", projectId, diagnostics: [{ code: "claim-conflict", tier: "primary", pluginIds: ["first", "second"], message: "two owners" }], workspaces: [{ id: "main", projectId, path: join(root, "project"), label: "Main", isMain: true }] }));
    for (const prefix of ["/api", "/api/machines/local"]) {
      const response = await app.inject({ method: "GET", url: `${prefix}/projects/${project.id}/workspaces` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "degraded", projectId: project.id, diagnostics: [{ code: "claim-conflict" }], workspaces: [{ effectiveConfig: { uploads: { defaultFolder: ".pi-web/uploads" }, attachments: { defaultFolder: ".pi-web/attachments" } } }] });
    }
  });

  it.each([{ error: new WorkspaceCatalogUnavailableError("offline"), status: 503 }, { error: new WorkspaceCatalogProtocolError("invalid catalog"), status: 502 }])("preserves authority error status $status", async ({ error, status }) => {
    const { app, project } = await authorityApp(() => Promise.reject(error));
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces` });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: error.message });
    const file = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/main/file?path=README.md` });
    expect(file.statusCode).toBe(503);
  });

  it.each(["unavailable", "incompatible"] as const)("returns structured required Terminal %s diagnostics", async (runtimeStatus) => {
    const failure = new PiWebPluginManifestRuntimeError(runtimeStatus, "terminal runtime mismatch");
    const { app } = await authorityApp(() => Promise.reject(new Error("unused")), failure);
    const response = await app.inject({ method: "GET", url: "/pi-web-plugins/manifest.json" });
    expect(response.statusCode).toBe(failure.statusCode);
    expect(response.json()).toEqual({ error: `Required Terminal plugin runtime is ${runtimeStatus}`, code: `required-plugin-runtime-${runtimeStatus}`, detail: failure.message });
  });
});
