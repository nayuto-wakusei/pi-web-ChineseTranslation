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
    registerAuthRoutes(app, { normal, management });

    try {
      const managementHeaders = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(testManagementContext()) };

      const normalSave = await app.inject({ method: "POST", url: "/auth/api-key", payload: { providerId: "anthropic", key: "sk-normal" } });
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
});

function testManagementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}
