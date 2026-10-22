import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { testManagementContext } from "../sessions/piSessionService.testSupport.js";
import type { Project, WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import { registerWorkspaceCatalogRoutes } from "./workspaceCatalogRoutes.js";

it("reconciles ordinary catalog authority but never uses ordinary integrations for a management project with the same id", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-discovery-managed-")));
  const app = Fastify();
  const normal: Project = { id: "same-project", name: "Normal", path: "/ordinary", createdAt: new Date(0).toISOString() };
  const requireProject = vi.fn(() => Promise.resolve(normal));
  const resolve = vi.fn((project: Project): Promise<WorkspaceProviderAuthorityResolution> => Promise.resolve({ status: "folder", projectId: project.id, workspaces: [], diagnostics: [] }));
  const reconcileProject = vi.fn(() => Promise.resolve());
  registerWorkspaceCatalogRoutes(app, {
    projects: { requireProject }, workspaces: { resolve, reconcileProject }, managementProjectRoot: root,
    providerRuntime: { protocolVersion: 2, terminalMode: "recovery-disabled", safeStart: "none", records: [], health: [], diagnostics: [] },
  });
  try {
    expect((await app.inject({ method: "GET", url: "/workspace-catalog/projects/same-project/workspaces" })).statusCode).toBe(200);
    expect(reconcileProject).toHaveBeenCalledExactlyOnceWith(normal, { status: "folder", projectId: normal.id, workspaces: [], diagnostics: [] });
    const context = { ...testManagementContext(), projects: [{ id: normal.id, name: "Managed", root }] };
    expect((await app.inject({ method: "GET", url: "/workspace-catalog/projects/same-project/workspaces", headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) } })).statusCode).toBe(200);
    expect(resolve.mock.calls.at(-1)?.[0]).toMatchObject({ id: normal.id, path: root });
    expect(requireProject).toHaveBeenCalledTimes(1);
    expect(reconcileProject).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("wires captured project settings, normal-scope notifications and post-listen reconciliation through the existing daemon startup", async () => {
  const source = await readFile(new URL("../sessiond.ts", import.meta.url), "utf8");
  expect(source).toContain("await runSessionDaemonStartup({");
  expect(source).toContain("projectSettings.resolve(pluginId, settings, project, signal)");
  expect(source).toContain("createWorkspaceNotificationCommandFactory({");
  expect(source).toContain("eventHub.publishRealtime(event, NORMAL_SESSION_EVENT_SCOPE)");
  expect(source).toContain("registerWorkspaceNotificationRoutes(app, { projects, workspaces: workspaceProviders, changes: workspaceChanges, translator })");
  const listener = source.slice(source.indexOf("async listen({"));
  expect(listener.indexOf("await app.listen(")).toBeGreaterThan(-1);
  expect(listener.indexOf("workspaceProviders.reconcileProject(project)")).toBeGreaterThan(listener.lastIndexOf("await app.listen("));
  expect(listener).toContain("if (!shutdownStarted) throw error");
});
