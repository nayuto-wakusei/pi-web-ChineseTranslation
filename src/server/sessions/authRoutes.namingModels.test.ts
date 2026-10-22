import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import type { ModelSelectionResponse } from "../../shared/apiTypes.js";
import { createTranslator } from "../../shared/i18n.js";
import { AuthService } from "./authService.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import { testManagementContext } from "./piSessionService.testSupport.js";

beforeEach(() => {
  vi.stubEnv("PI_OFFLINE", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  const a = await createTestModelRuntime({ anthropic: { type: "api_key", key: "secret-project-a" } });
  const b = await createTestModelRuntime();
  const managed = await createTestModelRuntime();
  const services = [a, b, managed].map(({ modelRuntime }) => new AuthService({ modelRuntime }));
  const [projectA, projectB, management] = services;
  if (!projectA || !projectB || !management) throw new Error("Missing auth services");
  const forProject = vi.fn((id: string) => {
    if (id === "a") return Promise.resolve(projectA);
    if (id === "b") return Promise.resolve(projectB);
    return Promise.reject(new Error("Project not found"));
  });
  const app = Fastify({ logger: false });
  registerAuthRoutes(app, { normal: { forProject }, management }, "", createTranslator("en", {}));
  return { app, a, b, managed, forProject, dispose: async () => { services.forEach((service) => { service.dispose(); }); await app.close(); } };
}

describe("project-scoped naming model catalog", () => {
  it("returns upstream selection metadata without credentials from the exact owning runtime", async () => {
    const f = await fixture();
    try {
      const refresh = vi.spyOn(f.a.modelRuntime, "refresh");
      const response = await f.app.inject({ url: "/models?projectId=a" });
      expect(response.statusCode).toBe(200);
      expect(refresh).toHaveBeenCalledWith({ allowNetwork: false });
      expect(response.json()).toEqual({ models: f.a.modelRuntime.getAvailableSnapshot().map((model) => ({ provider: model.provider, id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning })) });
      expect(response.json<ModelSelectionResponse>().models).toContainEqual(expect.objectContaining({ provider: "anthropic" }));
      expect(response.body).not.toContain("secret-project-a");
      expect(response.body).not.toContain("baseUrl");
      const other = await f.app.inject({ url: "/models?projectId=b" });
      expect(other.statusCode).toBe(200);
      expect(other.json<ModelSelectionResponse>().models).not.toContainEqual(expect.objectContaining({ provider: "anthropic" }));
    } finally { await f.dispose(); }
  });

  it("refreshes credential availability without discarding unavailable catalog models", async () => {
    const f = await fixture();
    try {
      expect(f.a.modelRuntime.getModels("anthropic").length).toBeGreaterThan(0);
      await f.a.credentials.delete("anthropic");
      const response = await f.app.inject({ url: "/models?projectId=a" });
      expect(response.statusCode).toBe(200);
      expect(response.json<ModelSelectionResponse>().models).not.toContainEqual(expect.objectContaining({ provider: "anthropic" }));
      expect(f.a.modelRuntime.getModels("anthropic").length).toBeGreaterThan(0);
    } finally { await f.dispose(); }
  });

  it("reports runtime refresh errors rather than an empty successful catalog", async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.a.modelRuntime, "refresh").mockRejectedValue(new Error("catalog unavailable"));
      const response = await f.app.inject({ url: "/models?projectId=a" });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ message: "catalog unavailable" });
    } finally { await f.dispose(); }
  });

  it("rejects missing or unknown projects and malformed management context without a global fallback", async () => {
    const f = await fixture();
    try {
      for (const url of ["/models", "/models?projectId=missing"]) expect((await f.app.inject({ url })).statusCode).toBe(400);
      f.forProject.mockClear();
      const invalid = await f.app.inject({ url: "/models?projectId=a", headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: "invalid" } });
      expect(invalid.statusCode).toBe(400);
      expect(f.forProject).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
  });

  it("uses the independent management runtime even when a normal project is supplied", async () => {
    const f = await fixture();
    try {
      const refresh = vi.spyOn(f.managed.modelRuntime, "refresh");
      const response = await f.app.inject({ url: "/models?projectId=a", headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(testManagementContext()) } });
      expect(response.statusCode).toBe(200);
      expect(refresh).toHaveBeenCalledWith({ allowNetwork: false });
      expect(f.forProject).not.toHaveBeenCalled();
      expect(response.json<ModelSelectionResponse>().models).not.toContainEqual(expect.objectContaining({ provider: "anthropic" }));
    } finally { await f.dispose(); }
  });
});
