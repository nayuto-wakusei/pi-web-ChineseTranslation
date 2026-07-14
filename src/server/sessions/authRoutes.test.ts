import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { AuthService } from "./authService.js";
import { registerAuthRoutes } from "./authRoutes.js";

describe("auth routes", () => {
  it("routes normal and management auth requests to separate credential stores", async () => {
    const normalStorage = AuthStorage.inMemory();
    const managementStorage = AuthStorage.inMemory();
    const normal = new AuthService({ modelRegistry: ModelRegistry.create(normalStorage) });
    const management = new AuthService({ modelRegistry: ModelRegistry.create(managementStorage) });
    const app = Fastify({ logger: false });
    registerAuthRoutes(app, {
      normal: {
        forProject: (projectId) => projectId === "normal"
          ? Promise.resolve(normal)
          : Promise.reject(new Error("Project not found")),
      },
      management,
    });

    try {
      const managementHeaders = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(testManagementContext()) };

      const normalSave = await app.inject({ method: "POST", url: "/auth/api-key?projectId=normal", payload: { providerId: "anthropic", key: "sk-normal" } });
      const managementSave = await app.inject({ method: "POST", url: "/auth/api-key", headers: managementHeaders, payload: { providerId: "anthropic", key: "sk-managed" } });

      expect(normalSave.statusCode).toBe(200);
      expect(managementSave.statusCode).toBe(200);
      expect(normalStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-normal" });
      expect(managementStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-managed" });

      const managementLogout = await app.inject({ method: "POST", url: "/auth/logout", headers: managementHeaders, payload: { providerId: "anthropic" } });

      expect(managementLogout.statusCode).toBe(200);
      expect(normalStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-normal" });
      expect(managementStorage.get("anthropic")).toBeUndefined();
    } finally {
      normal.dispose();
      management.dispose();
      await app.close();
    }
  });

  it("selects the normal auth store by project id and rejects missing projects", async () => {
    const projectA = new AuthService({ modelRegistry: ModelRegistry.create(AuthStorage.inMemory()) });
    const projectB = new AuthService({ modelRegistry: ModelRegistry.create(AuthStorage.inMemory()) });
    const app = Fastify({ logger: false });
    registerAuthRoutes(app, {
      normal: {
        forProject: (projectId) => {
          if (projectId === "a") return Promise.resolve(projectA);
          if (projectId === "b") return Promise.resolve(projectB);
          return Promise.reject(new Error("Project not found"));
        },
      },
      management: new AuthService({ modelRegistry: ModelRegistry.create(AuthStorage.inMemory()) }),
    });

    try {
      const missing = await app.inject({ method: "POST", url: "/auth/api-key", payload: { providerId: "anthropic", key: "sk-missing" } });
      const saveA = await app.inject({ method: "POST", url: "/auth/api-key?projectId=a", payload: { providerId: "anthropic", key: "sk-a" } });
      const saveB = await app.inject({ method: "POST", url: "/auth/api-key?projectId=b", payload: { providerId: "anthropic", key: "sk-b" } });

      expect(missing.statusCode).toBe(400);
      expect(saveA.statusCode).toBe(200);
      expect(saveB.statusCode).toBe(200);
      expect(projectA.modelRegistry.authStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-a" });
      expect(projectB.modelRegistry.authStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-b" });
    } finally {
      projectA.dispose();
      projectB.dispose();
      await app.close();
    }
  });
});

function testManagementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}
