import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNormalProjectCwdResolver } from "./normalProjectCwdResolver.js";

describe("createNormalProjectCwdResolver", () => {
  it("authorizes explicit targets from successful projects when an unrelated listing fails", async () => {
    const healthyCwd = join(process.cwd(), "healthy");
    const resolve = createNormalProjectCwdResolver({
      listProjects: () => Promise.resolve([{ id: "healthy" }, { id: "broken" }]),
      listWorkspaces: (project) => project.id === "healthy"
        ? Promise.resolve([{ path: healthyCwd }])
        : Promise.reject(new Error("broken project cannot be listed")),
    });

    await expect(resolve([healthyCwd])).resolves.toEqual([healthyCwd]);
  });

  it("fails closed when a requested target is not confirmed and a project listing failed", async () => {
    const healthyCwd = join(process.cwd(), "healthy");
    const missingCwd = join(process.cwd(), "maybe-broken");
    const resolve = createNormalProjectCwdResolver({
      listProjects: () => Promise.resolve([{ id: "healthy" }, { id: "broken" }]),
      listWorkspaces: (project) => project.id === "healthy"
        ? Promise.resolve([{ path: healthyCwd }])
        : Promise.reject(new Error("broken project cannot be listed")),
    });

    await expect(resolve([missingCwd])).rejects.toThrow("Unable to verify requested project workspace scope");
  });

  it("fails closed for global cleanup when any project listing fails", async () => {
    const healthyCwd = join(process.cwd(), "healthy");
    const resolve = createNormalProjectCwdResolver({
      listProjects: () => Promise.resolve([{ id: "healthy" }, { id: "broken" }]),
      listWorkspaces: (project) => project.id === "healthy"
        ? Promise.resolve([{ path: healthyCwd }])
        : Promise.reject(new Error("broken project cannot be listed")),
    });

    await expect(resolve()).rejects.toThrow("Unable to determine all registered project workspaces");
  });

  it("returns every successfully listed workspace for a complete project set", async () => {
    const firstCwd = join(process.cwd(), "first");
    const secondCwd = join(process.cwd(), "second");
    const resolve = createNormalProjectCwdResolver({
      listProjects: () => Promise.resolve([{ id: "first" }, { id: "second" }]),
      listWorkspaces: (project) => Promise.resolve([{ path: project.id === "first" ? firstCwd : secondCwd }]),
    });

    await expect(resolve()).resolves.toEqual([firstCwd, secondCwd]);
  });
});
