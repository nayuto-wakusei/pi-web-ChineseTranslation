import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance, InjectOptions, LightMyRequestCallback, LightMyRequestChain, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import type { MachineClient } from "./machines/machineClient.js";
import { MachineService } from "./machines/machineService.js";
import { MachineStore } from "./machines/machineStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import type { PiPackageService } from "./piPackageService.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { PI_WEB_CAPABILITIES } from "../shared/capabilities.js";
import { machineScopedPluginId } from "../shared/machinePluginIds.js";
import type { PiPackageInfo, PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import type { Project, Workspace } from "./types.js";
import type { ManagementEmbedRuntime } from "./managementEmbed.js";

let app: FastifyInstance;
let tempDir: string;
let projectDir: string;
let remoteClient: MachineClient | undefined;
let piWebConfig: PiWebConfigValues;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "pi-web-app-test-")));
  projectDir = join(tempDir, "project");
  remoteClient = undefined;
  piWebConfig = {};
  app = await buildApp({
    projects: new ProjectService(new ProjectStore(join(tempDir, "projects.json"))),
    workspaces: new WorkspaceService(),
    machines: new MachineService(new MachineStore(join(tempDir, "machines.json")), {
      remoteClientFactory: () => {
        if (remoteClient === undefined) throw new Error("No remote machine client configured");
        return remoteClient;
      },
      now: () => new Date("2026-05-25T00:00:00.000Z"),
      localRuntime: () => Promise.resolve({
        packageName: "@chainingintention/pi-web-cn",
        generatedAt: "2026-05-25T00:00:00.000Z",
        components: {
          web: { component: "web", label: "PI WEB", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] },
          sessiond: { component: "sessiond", label: "PI WEB Session Daemon", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] },
        },
        capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived],
      }),
    }),
    sessionDaemon: fakeSessionDaemon(),
    config: fakeConfigService(),
    piPackages: fakePiPackageService(),
    piWebPlugins: {
      manifest: () => Promise.resolve({ plugins: [{ id: "fake", module: "/pi-web-plugins/fake/plugin.js?v=1", source: "test", scope: "local", machineSpecific: false }] }),
      plugins: () => Promise.resolve({ plugins: [{ id: "fake", module: "/pi-web-plugins/fake/plugin.js?v=1", source: "test", scope: "local", machineSpecific: false, enabled: true }] }),
      readAsset: (pluginId, assetPath) => Promise.resolve(pluginId === "fake" && assetPath === "plugin.js" ? { content: Buffer.from("export default {};"), contentType: "application/javascript; charset=utf-8" } : undefined),
    },
    clientDist: false,
    logger: false,
  });
  const setupResponse = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "test-password" } });
  installDefaultAuthCookie(app, authCookie(setupResponse));
});

afterEach(async () => {
  await app.close();
  await removeTempDir(tempDir);
});

describe("buildApp", () => {
  it("uses the SPA fallback only for HTML navigation requests", async () => {
    await app.close();
    const clientDist = join(tempDir, "client");
    await mkdir(clientDist, { recursive: true });
    await writeFile(join(clientDist, "index.html"), "<!doctype html><title>PI WEB test client</title>", "utf8");
    app = await buildApp({ clientDist, logger: false });

    const navigation = await app.inject({ method: "GET", url: "/settings", headers: { accept: "text/html" } });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.body).toContain("PI WEB test client");

    const missingAsset = await app.inject({ method: "GET", url: "/assets/missing.js", headers: { accept: "*/*" } });
    expect(missingAsset.statusCode).toBe(404);
    expect(missingAsset.json()).toEqual({ error: "Not Found" });

    const missingImage = await app.inject({ method: "GET", url: "/missing.png", headers: { accept: "image/*" } });
    expect(missingImage.statusCode).toBe(404);
    expect(missingImage.json()).toEqual({ error: "Not Found" });
  });

  it("reports effective machine runtime capabilities for remote machines", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const requestJson = vi.fn<MachineClient["requestJson"]>(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: {
        packageName: "@chainingintention/pi-web-cn",
        generatedAt: "2026-05-25T00:00:00.000Z",
        components: {
          web: { component: "web", label: "Remote Web", runtimeVersion: "1.0.0", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived, PI_WEB_CAPABILITIES.piPackagesManage, "future.capability"] },
          sessiond: { component: "sessiond", label: "Remote Sessiond", runtimeVersion: "1.0.0", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] },
        },
        capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived, PI_WEB_CAPABILITIES.piPackagesManage, "future.capability"],
      },
    }));
    remoteClient = fakeRemoteClient({ requestJson });

    const runtime = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/runtime` });

    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({ machineId: remote.id, ok: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived, PI_WEB_CAPABILITIES.piPackagesManage] });
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/pi-web/runtime", undefined, { timeoutMs: 3000 });
  });

  it("proxies allowlisted remote HTTP routes through the selected machine", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json", connection: "close" },
      body: Readable.from([JSON.stringify([{ id: "p1", name: "Remote Project", path: "/repo", createdAt: "now" }])]),
    }));
    remoteClient = fakeRemoteClient({ request });

    const response = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects?active=true` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual([{ id: "p1", name: "Remote Project", path: "/repo", createdAt: "now" }]);
    expect(request).toHaveBeenCalledWith("GET", "/api/projects?active=true", undefined);
  });

  it("filters remote selected-machine config reads to machine-safe keys", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const requestJson = vi.fn<MachineClient["requestJson"]>(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json", "set-cookie": "secret=1" },
      body: piWebConfigResponse(fullPiWebConfig()),
    }));
    remoteClient = fakeRemoteClient({ requestJson });

    const response = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/config` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json<PiWebConfigResponse>()).toEqual({
      ...piWebConfigResponse(fullPiWebConfig()),
      config: selectedMachinePiWebConfig(),
      effectiveConfig: selectedMachinePiWebConfig(),
    });
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/config");
  });

  it("merges remote selected-machine config updates into the target machine config", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const requestJson = vi.fn<MachineClient["requestJson"]>((method, _path, body) => {
      if (method === "GET") return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: piWebConfigResponse(fullPiWebConfig()) });
      return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: piWebConfigResponse(configFromMachineConfigWriteBody(body)) });
    });
    remoteClient = fakeRemoteClient({ requestJson });

    const response = await app.inject({
      method: "PUT",
      url: `/api/machines/${remote.id}/config`,
      payload: { config: { plugins: { info: { enabled: false } }, pathAccess: { allowedPaths: ["/srv/remote"] }, uploads: { defaultFolder: "remote\\uploads" }, maxUploadBytes: 4096, spawnSessions: true } },
    });

    const expectedMerged: PiWebConfigValues = {
      ...fullPiWebConfig(),
      plugins: { info: { enabled: false } },
      pathAccess: { allowedPaths: ["/srv/remote"] },
      uploads: { defaultFolder: "remote/uploads" },
      maxUploadBytes: 4096,
      spawnSessions: true,
    };
    expect(response.statusCode).toBe(200);
    expect(requestJson).toHaveBeenNthCalledWith(1, "GET", "/api/config");
    expect(requestJson).toHaveBeenNthCalledWith(2, "PUT", "/api/config", { config: expectedMerged });
    expect(response.json<PiWebConfigResponse>().config).toEqual({
      plugins: { info: { enabled: false } },
      pathAccess: { allowedPaths: ["/srv/remote"] },
      uploads: { defaultFolder: "remote/uploads" },
      maxUploadBytes: 4096,
      spawnSessions: true,
      subsessions: false,
    });
  });

  it("preserves remote file preview security headers while proxying safe response metadata", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>(() => Promise.resolve({
      statusCode: 200,
      headers: {
        "content-type": "image/svg+xml",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "set-cookie": "session=secret",
      },
      body: Readable.from(["<svg xmlns=\"http://www.w3.org/2000/svg\" />"]),
    }));
    remoteClient = fakeRemoteClient({ request });

    const response = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file/preview?path=${encodeURIComponent("diagram.svg")}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).toBe("<svg xmlns=\"http://www.w3.org/2000/svg\" />");
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", "/api/projects/p1/workspaces/w1/file/preview?path=diagram.svg", undefined]);
    expect(request.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("requires ordinary mode password setup before serving normal API routes", async () => {
    piWebConfig = {};

    const blockedResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: "" } });
    const statusResponse = await app.inject({ method: "GET", url: "/api/normal-auth/status" });
    const setupResponse = await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
    const cookie = authCookie(setupResponse);
    const projectsResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    const secondSetupResponse = await app.inject({ method: "POST", url: "/api/normal-auth/setup", headers: { cookie }, payload: { password: "other-pass" } });

    expect(blockedResponse.statusCode).toBe(401);
    expect(blockedResponse.json()).toEqual({ error: "Ordinary mode password setup is required" });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({ configured: false, authenticated: false });
    expect(setupResponse.statusCode).toBe(200);
    expect(setupResponse.json()).toEqual({ accepted: true });
    expect(piWebConfig.normalAuth?.passwordHash).toMatch(/^pbkdf2-sha256\$\d+\$/u);
    expect(piWebConfig.normalAuth?.passwordHash).not.toContain("secret-pass");
    expect(projectsResponse.statusCode).toBe(200);
    expect(projectsResponse.json()).toEqual([]);
    expect(secondSetupResponse.statusCode).toBe(409);
  });

  it("logs in with the configured ordinary mode password and rejects wrong passwords", async () => {
    piWebConfig = { normalAuth: { passwordHash: testPasswordHash("secret-pass") } };

    const blockedResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: "" } });
    const wrongLoginResponse = await app.inject({ method: "POST", url: "/api/normal-auth/login", payload: { password: "wrong-pass" } });
    const loginResponse = await app.inject({ method: "POST", url: "/api/normal-auth/login", payload: { password: "secret-pass" } });
    const statusResponse = await app.inject({ method: "GET", url: "/api/normal-auth/status", headers: { cookie: authCookie(loginResponse) } });
    const projectsResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: authCookie(loginResponse) } });

    expect(blockedResponse.statusCode).toBe(401);
    expect(wrongLoginResponse.statusCode).toBe(401);
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.headers["set-cookie"]).toContain("HttpOnly");
    expect(statusResponse.json()).toEqual({ configured: true, authenticated: true });
    expect(projectsResponse.statusCode).toBe(200);
  });

  it("allows ordinary mode API requests with the configured password as a bearer token", async () => {
    piWebConfig = { normalAuth: { passwordHash: testPasswordHash("secret-pass") } };

    const wrongBearerResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer wrong-pass", cookie: "" } });
    const bearerResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer secret-pass", cookie: "" } });

    expect(wrongBearerResponse.statusCode).toBe(401);
    expect(bearerResponse.statusCode).toBe(200);
    expect(bearerResponse.json()).toEqual([]);
  });

  it("changes ordinary mode password and invalidates old sessions", async () => {
    piWebConfig = { normalAuth: { passwordHash: testPasswordHash("old-pass") } };
    const loginResponse = await app.inject({ method: "POST", url: "/api/normal-auth/login", payload: { password: "old-pass" } });
    const oldCookie = authCookie(loginResponse);

    const changeResponse = await app.inject({ method: "POST", url: "/api/normal-auth/change-password", headers: { cookie: oldCookie }, payload: { currentPassword: "old-pass", newPassword: "new-pass" } });
    const oldCookieResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: oldCookie } });
    const oldPasswordLoginResponse = await app.inject({ method: "POST", url: "/api/normal-auth/login", payload: { password: "old-pass" } });
    const newPasswordLoginResponse = await app.inject({ method: "POST", url: "/api/normal-auth/login", payload: { password: "new-pass" } });

    expect(changeResponse.statusCode).toBe(200);
    expect(changeResponse.json()).toEqual({ accepted: true });
    expect(changeResponse.headers["set-cookie"]).toContain("HttpOnly");
    expect(piWebConfig.normalAuth?.passwordHash).not.toBe(testPasswordHash("old-pass"));
    expect(oldCookieResponse.statusCode).toBe(401);
    expect(oldPasswordLoginResponse.statusCode).toBe(401);
    expect(newPasswordLoginResponse.statusCode).toBe(200);
  });

  it("serves the PI WEB plugin manifest and plugin assets", async () => {
    const manifestResponse = await app.inject({ method: "GET", url: "/pi-web-plugins/manifest.json" });
    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.json()).toEqual({ plugins: [{ id: "fake", module: "/pi-web-plugins/fake/plugin.js?v=1", source: "test", scope: "local", machineSpecific: false }] });

    const pluginsResponse = await app.inject({ method: "GET", url: "/api/plugins" });
    expect(pluginsResponse.statusCode).toBe(200);
    expect(pluginsResponse.json()).toEqual({ plugins: [{ id: "fake", module: "/pi-web-plugins/fake/plugin.js?v=1", source: "test", scope: "local", machineSpecific: false, enabled: true }] });

    const localMachinePluginsResponse = await app.inject({ method: "GET", url: "/api/machines/local/plugins" });
    expect(localMachinePluginsResponse.statusCode).toBe(200);
    expect(localMachinePluginsResponse.json()).toEqual({ plugins: [{ id: "fake", module: "/pi-web-plugins/fake/plugin.js?v=1", source: "test", scope: "local", machineSpecific: false, enabled: true }] });

    const assetResponse = await app.inject({ method: "GET", url: "/pi-web-plugins/fake/plugin.js?v=1" });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("application/javascript");
    expect(assetResponse.body).toBe("export default {};");

    const missingResponse = await app.inject({ method: "GET", url: "/pi-web-plugins/fake/missing.js" });
    expect(missingResponse.statusCode).toBe(404);
  });

  it("rewrites and proxies remote machine plugin manifests and assets", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const requestJson = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: { plugins: [{ id: "remote-tools", module: "/pi-web-plugins/remote-tools/pi-web-plugin.js?v=123", source: "local", scope: "local", machineSpecific: true }] },
    }));
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/javascript", "set-cookie": "secret=1" },
      body: Readable.from(["export default {};"]),
    }));
    remoteClient = fakeRemoteClient({ requestJson, request });

    const manifestResponse = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/pi-web-plugins/manifest.json` });
    const scopedPluginId = machineScopedPluginId(remote.id, "remote-tools");
    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.json()).toEqual({
      plugins: [{ id: "remote-tools", module: `../../../../pi-web-plugins/${scopedPluginId}/pi-web-plugin.js?v=123`, source: "local", scope: "local", machineSpecific: true }],
    });
    expect(requestJson).toHaveBeenCalledWith("GET", "/pi-web-plugins/manifest.json", undefined, { timeoutMs: 10000 });

    const assetResponse = await app.inject({ method: "GET", url: `/pi-web-plugins/${scopedPluginId}/pi-web-plugin.js?v=123` });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("application/javascript");
    expect(assetResponse.headers["set-cookie"]).toBeUndefined();
    expect(assetResponse.body).toBe("export default {};");
    expect(request).toHaveBeenCalledWith("GET", "/pi-web-plugins/remote-tools/pi-web-plugin.js?v=123");
  });

  it("drops unsafe remote machine plugin manifest modules", async () => {
    const addResponse = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    remoteClient = fakeRemoteClient({
      requestJson: vi.fn(() => Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: {
          plugins: [
            { id: "safe-tools", module: "nested/pi-web-plugin.js?v=1", source: "local", scope: "local" },
            { id: "traversal-tools", module: "..%2F..%2Fapi%2Fconfig", source: "local", scope: "local" },
            { id: "wrong-root", module: "/pi-web-plugins/other/pi-web-plugin.js", source: "local", scope: "local" },
          ],
        },
      })),
    });

    const manifestResponse = await app.inject({ method: "GET", url: `/api/machines/${remote.id}/pi-web-plugins/manifest.json` });

    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.json()).toEqual({
      plugins: [{ id: "safe-tools", module: `../../../../pi-web-plugins/${machineScopedPluginId(remote.id, "safe-tools")}/nested/pi-web-plugin.js?v=1`, source: "local", scope: "local" }],
    });
  });

  it("creates managed project directories before exposing their workspace tree", async () => {
    await app.close();
    piWebConfig = { normalAuth: { passwordHash: testPasswordHash("ordinary-pass") } };
    const managementRoot = join(tempDir, "managed");
    const managementEmbed: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: managementRoot,
      authenticate: () => Promise.resolve({
        user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
        projects: [{ id: "p1", name: "Managed Project" }],
      }),
    };
    app = await buildApp({
      projects: new ProjectService(new ProjectStore(join(tempDir, "managed-projects.json"))),
      workspaces: new WorkspaceService(),
      machines: new MachineService(new MachineStore(join(tempDir, "managed-machines.json"))),
      sessionDaemon: fakeSessionDaemon(),
      config: fakeConfigService(),
      piWebPlugins: {
        manifest: () => Promise.resolve({ plugins: [] }),
        plugins: () => Promise.resolve({ plugins: [] }),
        readAsset: () => Promise.resolve(undefined),
      },
      managementEmbed,
      clientDist: false,
      logger: false,
    });
    const headers = { "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": "token" };

    const ordinaryProjectsResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: "" } });
    const projectsResponse = await app.inject({ method: "GET", url: "/api/projects", headers });
    expect(ordinaryProjectsResponse.statusCode).toBe(401);
    expect(projectsResponse.statusCode).toBe(200);
    const [project] = projectsResponse.json<Project[]>();
    if (project === undefined) throw new Error("Expected managed project");
    await expect(pathExists(project.path)).resolves.toBe(false);

    const workspacesResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces`, headers });
    expect(workspacesResponse.statusCode).toBe(200);
    const [workspace] = workspacesResponse.json<Workspace[]>();
    if (workspace === undefined) throw new Error("Expected managed workspace");
    await expect(pathExists(workspace.path)).resolves.toBe(true);

    const treeResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/${workspace.id}/tree`, headers });
    expect(treeResponse.statusCode).toBe(200);
    expect(treeResponse.json()).toMatchObject({ path: "", entries: [], truncated: false });
  });

  it("lets project-local upload config override global upload config on workspace responses", async () => {
    piWebConfig = { normalAuth: { passwordHash: testPasswordHash("test-password") }, uploads: { defaultFolder: "global-uploads" } };
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Project Upload Defaults", path: projectDir, create: true },
    });
    const project = addResponse.json<Project>();
    await mkdir(join(projectDir, ".pi-web"), { recursive: true });
    await writeFile(join(projectDir, ".pi-web", "config.json"), `${JSON.stringify({ version: 1, uploads: { defaultFolder: "project-uploads" } }, null, 2)}\n`);

    const workspacesResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces` });

    expect(workspacesResponse.statusCode).toBe(200);
    expect(workspacesResponse.json<Workspace[]>()).toEqual([
      expect.objectContaining({
        projectId: project.id,
        effectiveConfig: {
          uploads: { defaultFolder: "project-uploads" },
          attachments: { defaultFolder: ".pi-web/attachments" },
        },
      }),
    ]);
  });

  it("writes workspace files through the HTTP contract", async () => {
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "WriteTest", path: projectDir, create: true },
    });
    const project = addResponse.json<Project>();
    const workspacesResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces` });
    const workspace = workspacesResponse.json<Workspace[]>()[0];
    if (workspace === undefined) throw new Error("Expected workspace");

    const missingFileResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("missing.txt")}` });
    expect(missingFileResponse.statusCode).toBe(404);
    expect(missingFileResponse.json()).toEqual({ error: "Path does not exist" });

    const optionalMissingFileResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("missing.txt")}&optional=true` });
    expect(optionalMissingFileResponse.statusCode).toBe(204);
    expect(optionalMissingFileResponse.body).toBe("");

    const writeTextResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("hello.txt")}`,
      payload: "hello world",
      headers: { "content-type": "text/plain" },
    });
    expect(writeTextResponse.statusCode).toBe(200);
    expect(writeTextResponse.json()).toMatchObject({ path: "hello.txt", created: true });
    expect(typeof writeTextResponse.json<{ size: unknown }>().size).toBe("number");

    const readResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("hello.txt")}` });
    expect(readResponse.json<{ content: unknown }>().content).toBe("hello world");

    const writeBinaryResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("image.png")}`,
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { "content-type": "application/octet-stream" },
    });
    expect(writeBinaryResponse.statusCode).toBe(200);
    expect(writeBinaryResponse.json()).toMatchObject({ path: "image.png", created: true });

    const createEmptyResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("empty.txt")}`,
      payload: Buffer.alloc(0),
      headers: { "content-type": "application/octet-stream" },
    });
    expect(createEmptyResponse.statusCode).toBe(200);
    expect(createEmptyResponse.json()).toMatchObject({ path: "empty.txt", size: 0, created: true });

    const writeDeepResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("deep/nested/dir/file.txt")}`,
      payload: "deep content",
      headers: { "content-type": "text/plain" },
    });
    expect(writeDeepResponse.statusCode).toBe(200);

    const readDeepResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("deep/nested/dir/file.txt")}` });
    expect(readDeepResponse.json<{ content: unknown }>().content).toBe("deep content");

    const overwriteResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("hello.txt")}`,
      payload: "updated",
      headers: { "content-type": "text/plain" },
    });
    expect(overwriteResponse.json()).toMatchObject({ path: "hello.txt", created: false });

    const noOverwriteResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("hello.txt")}&overwrite=false`,
      payload: "should fail",
      headers: { "content-type": "text/plain" },
    });
    expect(noOverwriteResponse.statusCode).toBe(400);
    expect(noOverwriteResponse.json<{ error: string }>().error).toContain("File already exists");

    const traversalResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("../../etc/passwd")}`,
      payload: "evil",
      headers: { "content-type": "text/plain" },
    });
    expect(traversalResponse.statusCode).toBe(400);
    expect(traversalResponse.json<{ error: string }>().error).toContain("Path traversal");

    const noPathResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file`,
      payload: "no path",
      headers: { "content-type": "text/plain" },
    });
    expect(noPathResponse.statusCode).toBe(400);
    expect(noPathResponse.json<{ error: string }>().error).toContain("path query parameter is required");

    const noDirsResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("nonexistent/parent/file.txt")}&createDirs=false`,
      payload: "should fail",
      headers: { "content-type": "text/plain" },
    });
    expect(noDirsResponse.statusCode).toBe(400);

    await mkdir(join(projectDir, "subdir"), { recursive: true });
    const dirWriteResponse = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent("subdir")}`,
      payload: "should fail",
      headers: { "content-type": "text/plain" },
    });
    expect(dirWriteResponse.statusCode).toBe(400);
  });
});

function fakeConfigService() {
  return {
    read: () => piWebConfigResponse(piWebConfig),
    write: (config: PiWebConfigValues) => {
      piWebConfig = config;
      return piWebConfigResponse(config);
    },
  };
}

function fullPiWebConfig(): PiWebConfigValues {
  return {
    host: "127.0.0.1",
    port: 8504,
    allowedHosts: ["gateway.example.test"],
    shortcuts: { "core:view.chat": "mod+1" },
    plugins: { info: { enabled: true, settings: { note: "remote" } } },
    pathAccess: { allowedPaths: ["/srv/repos"] },
    uploads: { defaultFolder: "uploads" },
    maxUploadBytes: 1024,
    spawnSessions: false,
    subsessions: false,
  };
}

function selectedMachinePiWebConfig(): PiWebConfigValues {
  return {
    plugins: { info: { enabled: true, settings: { note: "remote" } } },
    pathAccess: { allowedPaths: ["/srv/repos"] },
    uploads: { defaultFolder: "uploads" },
    maxUploadBytes: 1024,
    spawnSessions: false,
    subsessions: false,
  };
}

function piWebConfigResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: join(tempDir, "config.json"),
    exists: false,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

function authCookie(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const value = typeof header === "string" ? header : Array.isArray(header) && typeof header[0] === "string" ? header[0] : undefined;
  if (typeof value !== "string") throw new Error("Expected auth cookie");
  return value.split(";")[0] ?? value;
}

function installDefaultAuthCookie(target: FastifyInstance, cookie: string): void {
  const originalInject = target.inject.bind(target);
  function injectWithDefaultAuth(options: InjectOptions | string, callback: LightMyRequestCallback): void;
  function injectWithDefaultAuth(options: InjectOptions | string): Promise<LightMyRequestResponse>;
  function injectWithDefaultAuth(): LightMyRequestChain;
  function injectWithDefaultAuth(options?: InjectOptions | string, callback?: LightMyRequestCallback): void | Promise<LightMyRequestResponse> | LightMyRequestChain {
    if (options === undefined) return originalInject();
    const nextOptions = withDefaultAuthCookie(options, cookie);
    if (callback !== undefined) {
      originalInject(nextOptions, callback);
      return;
    }
    return originalInject(nextOptions);
  }
  target.inject = injectWithDefaultAuth;
}

function withDefaultAuthCookie(options: InjectOptions | string, cookie: string): InjectOptions | string {
  if (typeof options === "string") return options;
  const url = typeof options.url === "string" ? options.url : "";
  if (!url.startsWith("/api/") || url.startsWith("/api/normal-auth/")) return options;
  const headers = options.headers ?? {};
  if (headers.cookie !== undefined) return options;
  return { ...options, headers: { ...headers, cookie } };
}

function testPasswordHash(password: string): string {
  const salt = Buffer.from("test-salt");
  const iterations = 120_000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2-sha256$${String(iterations)}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

interface MachineConfigWriteBody {
  config: PiWebConfigValues;
}

function configFromMachineConfigWriteBody(body: unknown): PiWebConfigValues {
  if (!isMachineConfigWriteBody(body)) throw new Error("Expected machine config write body");
  return body.config;
}

function isMachineConfigWriteBody(value: unknown): value is MachineConfigWriteBody {
  if (!isRecord(value)) return false;
  return isRecord(value["config"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fakePiPackageService(): PiPackageService {
  const packages: PiPackageInfo[] = [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/tmp/pi-tools" }];
  return {
    list: () => Promise.resolve({ packages }),
    install: (source) => Promise.resolve({ action: "install", source, packages }),
    remove: (source, scope = "user") => Promise.resolve({ action: "remove", source, scope, removed: true, packages }),
    update: (source) => Promise.resolve({ action: "update", ...(source === undefined ? {} : { source }), packages }),
  };
}

function fakeSessionDaemon(): SessionProxyDaemon {
  return {
    request: (method, path, body) => {
      const captured = { method, path, ...(body === undefined ? {} : { body }) };
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(captured),
      });
    },
    connectWebSocket: () => { throw new Error("WebSocket not configured for test"); },
  };
}

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt === 4) throw error;
      await delay(50 * (attempt + 1));
    }
  }
}

function isRetryableRemoveError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "EBUSY" || error.code === "ENOTEMPTY" || error.code === "EPERM";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function fakeRemoteClient(overrides: Partial<MachineClient>): MachineClient {
  return {
    request: () => Promise.resolve({ statusCode: 200, headers: {}, body: Readable.from([]) }),
    requestJson: () => Promise.resolve({ statusCode: 200, headers: {}, body: undefined }),
    connectWebSocket: () => { throw new Error("WebSocket not configured for test"); },
    ...overrides,
  };
}
