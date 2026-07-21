import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { AuthService } from "./authService.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";

describe("auth routes", () => {
  it("routes normal and management auth requests to separate credential stores", async () => {
    const normalRuntime = await createTestModelRuntime();
    const managementRuntime = await createTestModelRuntime();
    const normal = new AuthService({ modelRuntime: normalRuntime.modelRuntime });
    const management = new AuthService({ modelRuntime: managementRuntime.modelRuntime });
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
      await expect(normalRuntime.credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-normal" });
      await expect(managementRuntime.credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-managed" });

      const managementLogout = await app.inject({ method: "POST", url: "/auth/logout", headers: managementHeaders, payload: { providerId: "anthropic" } });

      expect(managementLogout.statusCode).toBe(200);
      await expect(normalRuntime.credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-normal" });
      await expect(managementRuntime.credentials.read("anthropic")).resolves.toBeUndefined();
    } finally {
      normal.dispose();
      management.dispose();
      await app.close();
    }
  });

  it("selects the normal auth store by project id and rejects missing projects", async () => {
    const runtimeA = await createTestModelRuntime();
    const runtimeB = await createTestModelRuntime();
    const managementRuntime = await createTestModelRuntime();
    const projectA = new AuthService({ modelRuntime: runtimeA.modelRuntime });
    const projectB = new AuthService({ modelRuntime: runtimeB.modelRuntime });
    const management = new AuthService({ modelRuntime: managementRuntime.modelRuntime });
    const app = Fastify({ logger: false });
    registerAuthRoutes(app, {
      normal: {
        forProject: (projectId) => {
          if (projectId === "a") return Promise.resolve(projectA);
          if (projectId === "b") return Promise.resolve(projectB);
          return Promise.reject(new Error("Project not found"));
        },
      },
      management,
    });

    try {
      const missing = await app.inject({ method: "POST", url: "/auth/api-key", payload: { providerId: "anthropic", key: "sk-missing" } });
      const saveA = await app.inject({ method: "POST", url: "/auth/api-key?projectId=a", payload: { providerId: "anthropic", key: "sk-a" } });
      const saveB = await app.inject({ method: "POST", url: "/auth/api-key?projectId=b", payload: { providerId: "anthropic", key: "sk-b" } });

      expect(missing.statusCode).toBe(400);
      expect(saveA.statusCode).toBe(200);
      expect(saveB.statusCode).toBe(200);
      await expect(runtimeA.credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-a" });
      await expect(runtimeB.credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-b" });
    } finally {
      projectA.dispose();
      projectB.dispose();
      management.dispose();
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
