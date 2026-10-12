import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectService } from "../projects/projectService.js";
import { registerProjectMutationRoutes } from "./projectMutationRoutes.js";

let app: FastifyInstance;
const projects = { add: vi.fn<ProjectService["add"]>(), close: vi.fn<ProjectService["close"]>() };

beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify({ logger: false });
  registerProjectMutationRoutes(app, projects);
});

afterEach(async () => { await app.close(); });

describe("session daemon project mutations", () => {
  it("validates add input and delegates valid project creation", async () => {
    const project = { id: "project-1", name: "Repo", path: "/repo", createdAt: "2026-01-01T00:00:00.000Z" };
    projects.add.mockResolvedValue(project);
    const input = { name: "Repo", path: "/repo", create: true };

    const response = await app.inject({ method: "POST", url: "/projects", payload: input });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(project);
    expect(projects.add).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([{}, { path: 3 }, { path: " " }, { path: "/repo", create: "yes" }, { path: "/repo", name: 3 }])("rejects invalid add input %j before calling the service", async (payload) => {
    const response = await app.inject({ method: "POST", url: "/projects", payload });
    expect(response.statusCode).toBe(400);
    expect(projects.add).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("Project path must be a directory"), 400],
    [Object.assign(new Error("Missing path"), { code: "ENOENT" }), 400],
    [new Error("Workspace catalog could not be reconciled"), 500],
    [new Error("Catalog reconciliation failed"), 500],
  ])("maps add failure %s to HTTP %s", async (error, statusCode) => {
    projects.add.mockRejectedValue(error);
    const response = await app.inject({ method: "POST", url: "/projects", payload: { path: "/repo" } });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error: error.message });
  });

  it("decodes close ids and maps project lookup errors", async () => {
    projects.close.mockResolvedValue(undefined);
    const closed = await app.inject({ method: "DELETE", url: "/projects/project%201" });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ closed: true });
    expect(projects.close).toHaveBeenCalledExactlyOnceWith("project 1");

    projects.close.mockRejectedValueOnce(new Error("Project not found"));
    const missing = await app.inject({ method: "DELETE", url: "/projects/missing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Project not found" });
  });

  it.each([["Project not found", 404], ["Catalog reconciliation failed", 500]])("maps close error %s to %s", async (message, status) => {
    projects.close.mockRejectedValue(new Error(message));
    const response = await app.inject({ method: "DELETE", url: "/projects/project-1" });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: message });
  });
});
