import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { AuthService } from "./authService.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import { createTranslator } from "../../shared/i18n.js";
import translations from "../../../pi-web-plugins/zh-cn/provider-auth.json";

beforeEach(() => {
  vi.stubEnv("PI_OFFLINE", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth routes", () => {
  it("localizes owned validation without rewriting provider errors or changing status codes", async () => {
    const runtime = await createTestModelRuntime();
    const translator = createTranslator("zh-CN", translations);
    const auth = new AuthService({ modelRuntime: runtime.modelRuntime, translator });
    const app = Fastify({ logger: false });
    registerAuthRoutes(app, { normal: { forProject: () => Promise.resolve(auth) }, management: auth }, "", translator);
    try {
      const missingProject = await app.inject({ method: "GET", url: "/auth/providers" });
      expect(missingProject.statusCode).toBe(400);
      expect(missingProject.json()).toEqual({ error: "必须提供 projectId 查询参数" });
      const blankKey = await app.inject({ method: "POST", url: "/auth/api-key?projectId=normal", payload: { providerId: "anthropic", key: " " } });
      expect(blankKey.statusCode).toBe(400);
      expect(blankKey.json()).toEqual({ error: "必须填写 API key" });
      vi.spyOn(auth, "saveApiKey").mockRejectedValue(new Error("upstream: keep original"));
      const upstream = await app.inject({ method: "POST", url: "/auth/api-key?projectId=normal", payload: { providerId: "anthropic", key: "example" } });
      expect(upstream.json()).toEqual({ error: "upstream: keep original" });
    } finally {
      auth.dispose();
      await app.close();
    }
  });

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
