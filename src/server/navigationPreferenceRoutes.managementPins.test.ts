import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { PI_WEB_CAPABILITIES } from "../shared/capabilities.js";
import { registerNavigationPreferenceRoutes, registerSessionPinRoutes } from "./navigationPreferenceRoutes.js";
import { projectFromManagedEmbedContext, type ManagementEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";
import { registerSessionProxyRoutes } from "./sessiond/sessionProxyRoutes.js";
import { NavigationPreferenceStore } from "./storage/navigationPreferenceStore.js";
import { SessionPinStore, sessionPinStorePath } from "./storage/sessionPinStore.js";

describe("embedded navigation pins across gateway and daemon", () => {
  it.each([false, true])("persists authenticated pins without crossing users or ordinary mode (privileged=%s)", async (privileged) => {
    const directory = await mkdtemp(join(tmpdir(), "managed-navigation-pins-"));
    const daemon = Fastify();
    const gateway = Fastify();
    await gateway.register(fastifyWebsocket);
    const context: ManagementEmbedContext = {
      user: { id: "user", rootUserId: "root", roles: [], permissions: [] },
      projects: [{ id: "project", name: "Managed" }],
      ...(privileged ? { privileged: { bash: true, network: true } } : {}),
    };
    const runtime: ManagementEmbedRuntime = {
      enabled: true, projectRoot: directory,
      authenticate: (token) => token === "user" || token === "other"
        ? Promise.resolve({ ...context, user: { ...context.user, id: token } })
        : Promise.reject(new Error("Invalid entry token")),
    };
    const legacy = join(directory, "navigation-preferences.json");
    const file = sessionPinStorePath({ PI_WEB_DATA_DIR: directory });
    const pins = new SessionPinStore(file, legacy);
    await projectFromManagedEmbedContext(directory, context, "project");
    registerSessionPinRoutes(daemon, pins, "", {
      managementProjectRoot: directory,
      projects: { requireProject: () => Promise.reject(new Error("Not an ordinary project")) },
      workspaces: { resolve: (project) => Promise.resolve({ status: "folder", projectId: project.id, diagnostics: [], workspaces: [
        { id: "workspace", projectId: project.id, path: project.path, label: "Root", isMain: true },
      ] }) },
    });
    daemon.get("/runtime", () => ({ component: "sessiond", label: "Session daemon", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionPinsDaemonOwned, PI_WEB_CAPABILITIES.sessionPinsManagementScoped] }));
    const proxy = {
      request: async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
        if (method !== "GET" && method !== "PUT") throw new Error("Unexpected test method");
        const response = await daemon.inject({ method, url: path, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { ...headers, "content-type": "application/json" } }), ...(body !== undefined || headers === undefined ? {} : { headers }) });
        return { statusCode: response.statusCode, headers: {}, body: response.body };
      },
      requestStream: () => Promise.reject(new Error("Unexpected stream")),
      connectWebSocket: () => { throw new Error("Unexpected socket"); },
    };
    for (const prefix of ["/api", "/api/machines/local"]) {
      registerSessionProxyRoutes(gateway, proxy, prefix, runtime);
      registerNavigationPreferenceRoutes(gateway, new NavigationPreferenceStore(legacy), prefix, { managementEmbed: runtime });
    }
    const path = "/navigation/projects/project/workspaces/workspace/session-pins";
    const query = "?embed=management&token=user";
    try {
      const put = await gateway.inject({ method: "PUT", url: `/api${path}${query}`, payload: { ids: ["managed-session"], revision: 0 } });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ ids: ["managed-session"], revision: 1 });
      expect((await gateway.inject({ method: "GET", url: `/api/machines/local${path}${query}` })).json()).toEqual(put.json());
      expect((await gateway.inject({ method: "GET", url: `/api${path}?embed=management&token=other` })).json()).toEqual({ ids: [], revision: 0 });
      expect((await gateway.inject({ method: "GET", url: `/api${path}` })).json()).toEqual({ ids: [], revision: 0 });
      expect((await gateway.inject({ method: "PUT", url: `/api${path}${query}`, payload: { ids: [], revision: 0 } })).statusCode).toBe(409);
      expect((await gateway.inject({ method: "GET", url: `/api${path.replace("/project/", "/forbidden/")}${query}` })).statusCode).toBe(403);
      expect((await gateway.inject({ method: "GET", url: `/api/navigation/projects${query}` })).statusCode).toBe(403);
      expect(await new SessionPinStore(file, legacy).get({ projectId: "project", workspaceId: "workspace", managementContext: context })).toEqual({ ids: ["managed-session"], revision: 1 });
      expect(await pins.pinnedSessionIds()).toEqual([]);
    } finally {
      await gateway.close();
      await daemon.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
