import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../shared/i18n.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { createServerPluginCatalogCapabilityFactory } from "../plugins/serverPluginCatalogCapability.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../sessions/piSessionManagerGateway.js";
import { PiSessionService } from "../sessions/piSessionService.js";
import { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import { registerSessionRoutes } from "../sessions/sessionRoutes.js";
import { registerPluginCatalogRoutes } from "./pluginCatalogRoutes.js";
import { registerSessionProxyRoutes } from "./sessionProxyRoutes.js";

async function fixture(prefix = "/api") {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-read-http-"));
  const root = join(directory, "managed");
  const store = join(directory, "sessions");
  const cwds = { ordinary: join(directory, "ordinary"), managed: join(root, "user"), unregistered: join(directory, "unregistered") };
  const block = { type: "image", mimeType: "image/png", data: Buffer.from("private image").toString("base64") };
  const mediaId = createHash("sha256").update(`image/png\0${block.data}`).digest("hex");
  await Promise.all([store, ...Object.values(cwds)].map((path) => mkdir(path, { recursive: true })));
  await Promise.all(Object.entries(cwds).map(([id, cwd]) => writeFile(join(store, `${id}.jsonl`), [
    { type: "session", version: 3, id, cwd, timestamp: "2026-01-01T00:00:00.000Z" },
    { type: "message", id: "entry", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: [block] } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n")));
  const projects = Object.entries(cwds).filter(([id]) => id !== "unregistered").map(([id, path]) => ({ id, path, name: id, createdAt: "now" }));
  const projectReader = {
    list: () => Promise.resolve(projects),
    requireProject: (id: string) => {
      const project = projects.find((candidate) => candidate.id === id);
      return project === undefined ? Promise.reject(new Error("Project not found")) : Promise.resolve(project);
    },
  };
  const createRuntime = vi.fn(() => { throw new Error("Must not create a runtime"); });
  const modelRuntime = vi.fn(() => Promise.reject(new Error("Must not initialize credentials")));
  const hub = new SessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: directory, translator: createTranslator("en", {}), managementProjectRoot: root,
    projectPathForCwd: (cwd) => Promise.resolve(projects.find((project) => project.path === cwd)?.path),
    normalModelRuntimeForCwd: modelRuntime, createAgentRuntime: createRuntime,
    sessionManager: createPiSessionManagerGateway({ agentDir: directory, env: { PI_CODING_AGENT_SESSION_DIR: store } }),
    archiveStore: new SessionArchiveStore(join(directory, "archives.json")), heartbeatIntervalMs: 60_000,
  });
  const catalogDependencies = {
    projects: projectReader,
    workspaces: { resolve: (project: typeof projects[number]) => Promise.resolve({
      projectId: project.id, status: "provider" as const, diagnostics: [],
      workspaces: [{ id: "main", projectId: project.id, path: project.path, label: "Main", isMain: true }],
    }) },
    sessions: service,
  };
  const daemon = Fastify();
  const gateway = Fastify();
  await daemon.register(fastifyWebsocket);
  await gateway.register(fastifyWebsocket);
  registerSessionRoutes(daemon, service, hub);
  registerPluginCatalogRoutes(daemon, catalogDependencies);
  const address = await daemon.listen({ host: "127.0.0.1", port: 0 });
  registerSessionProxyRoutes(gateway, new SessionDaemonClient({ baseUrl: address }), prefix);
  return { daemon, gateway, service, catalogDependencies, cwds, mediaId, block, createRuntime, modelRuntime,
    async close() { await gateway.close(); await daemon.close(); await service.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

describe("cold read entry-point authority", () => {
  it.each(["/api", "/api/machines/local"])("enforces media authority at the daemon and through %s", async (prefix) => {
    const f = await fixture(prefix);
    try {
      for (const id of ["ordinary", "managed", "unregistered"] as const) {
        const url = `/sessions/${id}/media/${f.mediaId}?cwd=${encodeURIComponent(f.cwds[id])}`;
        const expected = id === "ordinary" ? 200 : 404;
        expect((await f.daemon.inject({ url })).statusCode).toBe(expected);
        const response = await f.gateway.inject({ url: `${prefix}${url}` });
        expect(response.statusCode).toBe(expected);
        if (expected === 200) expect(response.rawPayload).toEqual(Buffer.from(f.block.data, "base64"));
        else expect(response.body).not.toContain(f.block.data);
      }
      expect(f.createRuntime).not.toHaveBeenCalled();
      expect(f.modelRuntime).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it("keeps browser and server-plugin catalogs behind the same current-root guard", async () => {
    const f = await fixture();
    const lifetime = new AbortController();
    const instance = createServerPluginCatalogCapabilityFactory(f.catalogDependencies).create({ pluginId: "consumer", packageRoot: "", lifetimeSignal: lifetime.signal });
    try {
      const path = (id: string) => `/plugin-catalog/projects/${id}/workspaces/main/sessions`;
      expect((await f.daemon.inject({ url: path("managed") })).statusCode).toBe(404);
      expect((await f.gateway.inject({ url: `/api${path("managed")}` })).statusCode).toBe(404);
      await expect(instance.value.sessions.list({ projectId: "managed", workspaceId: "main" })).rejects.toThrow("Session not found");
      const ordinary = await f.gateway.inject({ url: `/api${path("ordinary")}` });
      expect(ordinary.statusCode).toBe(200);
      expect(ordinary.json()).toEqual([{ id: "ordinary", cwd: f.cwds.ordinary, archived: false, runtime: "not-hosted" }]);
      expect(await instance.value.sessions.list({ projectId: "ordinary", workspaceId: "main" })).toEqual(ordinary.json());
      expect(f.createRuntime).not.toHaveBeenCalled();
      expect(f.modelRuntime).not.toHaveBeenCalled();
    } finally { lifetime.abort(); await instance.dispose?.(AbortSignal.abort()); await f.close(); }
  });
});
