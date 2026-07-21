import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../types.js";
import { ProjectAuthService, projectAuthStoragePaths } from "./projectAuthService.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectAuthService", () => {
  it("copies the global files once and keeps project credentials isolated", async () => {
    const root = await tempRoot();
    const globalAgentDir = join(root, "global-agent");
    const dataDir = join(root, "pi-web-data");
    await mkdir(globalAgentDir, { recursive: true });
    await writeFile(join(globalAgentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "global-key" } }));
    await writeFile(join(globalAgentDir, "models.json"), JSON.stringify({ providers: {} }));

    const projectA = project("a", join(root, "project-a"));
    const projectB = project("b", join(root, "project-b"));
    const auth = new ProjectAuthService({
      projects: { list: () => Promise.resolve([projectA, projectB]) },
      workspaces: { list: (candidate) => Promise.resolve([{ path: candidate.path }, { path: join(candidate.path, "worktree") }]) },
      dataDir,
      globalAgentDir,
      createModelRuntime: offlineModelRuntime,
    });

    const [serviceA, concurrentServiceA] = await Promise.all([auth.forProject(projectA.id), auth.forProject(projectA.id)]);
    const serviceB = await auth.forProject(projectB.id);
    expect(concurrentServiceA).toBe(serviceA);
    expect(serviceA).not.toBe(serviceB);
    const pathsA = projectAuthStoragePaths(dataDir, projectA.path);
    const pathsB = projectAuthStoragePaths(dataDir, projectB.path);
    expect(readStoredCredential("anthropic", pathsA.authPath)).toEqual({ type: "api_key", key: "global-key" });
    expect(readStoredCredential("anthropic", pathsB.authPath)).toEqual({ type: "api_key", key: "global-key" });

    await serviceA.saveApiKey("anthropic", "project-a-key");
    expect(readStoredCredential("anthropic", pathsA.authPath)).toEqual({ type: "api_key", key: "project-a-key" });
    expect(readStoredCredential("anthropic", pathsB.authPath)).toEqual({ type: "api_key", key: "global-key" });

    expect(pathsA.directory).not.toBe(pathsB.directory);
    expect(JSON.parse(await readFile(pathsA.modelsPath, "utf8"))).toEqual({ providers: {} });
    await writeFile(pathsA.modelsPath, JSON.stringify({ providers: { anthropic: { baseUrl: "https://project-a.example" } } }));
    await serviceA.modelRuntime.reloadConfig();
    expect(serviceA.modelRuntime.getModel("anthropic", "claude-haiku-4-5")?.baseUrl).toBe("https://project-a.example");
    expect(serviceB.modelRuntime.getModel("anthropic", "claude-haiku-4-5")?.baseUrl).not.toBe("https://project-a.example");
    await auth.dispose();
  });

  it("shares one registry across worktrees and rejects unknown or ambiguous paths", async () => {
    const root = await tempRoot();
    const projectA = project("a", join(root, "project-a"));
    const projectB = project("b", join(root, "project-b"));
    const auth = new ProjectAuthService({
      projects: { list: () => Promise.resolve([projectA, projectB]) },
      workspaces: {
        list: (candidate) => Promise.resolve(candidate.id === "a"
          ? [{ path: candidate.path }, { path: join(candidate.path, "worktree") }]
          : [{ path: candidate.path }]),
      },
      dataDir: join(root, "data"),
      globalAgentDir: join(root, "global"),
      createModelRuntime: offlineModelRuntime,
    });

    expect(await auth.forCwd(join(projectA.path, "worktree"))).toBe(await auth.forProject(projectA.id));
    await expect(auth.forCwd(join(root, "unknown"))).rejects.toThrow("已注册项目");

    const overlapping = new ProjectAuthService({
      projects: { list: () => Promise.resolve([projectA, projectB]) },
      workspaces: { list: () => Promise.resolve([{ path: join(root, "shared") }]) },
      dataDir: join(root, "other-data"),
      globalAgentDir: join(root, "other-global"),
      createModelRuntime: offlineModelRuntime,
    });
    await expect(overlapping.forCwd(join(root, "shared"))).rejects.toThrow("多个已注册项目");
    await auth.dispose();
    await overlapping.dispose();
  });

  it("does not overwrite an existing project file on later initialization", async () => {
    const root = await tempRoot();
    const projectA = project("a", join(root, "project-a"));
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global");
    await mkdir(globalAgentDir, { recursive: true });
    await writeFile(join(globalAgentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "global-key" } }));
    await writeFile(join(globalAgentDir, "models.json"), JSON.stringify({ providers: {} }));

    const first = new ProjectAuthService({ projects: { list: () => Promise.resolve([projectA]) }, workspaces: { list: () => Promise.resolve([{ path: projectA.path }]) }, dataDir, globalAgentDir, createModelRuntime: offlineModelRuntime });
    const firstService = await first.forProject(projectA.id);
    await firstService.saveApiKey("anthropic", "project-key");
    await first.dispose();
    await writeFile(join(globalAgentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "new-global-key" } }));

    const second = new ProjectAuthService({ projects: { list: () => Promise.resolve([projectA]) }, workspaces: { list: () => Promise.resolve([{ path: projectA.path }]) }, dataDir, globalAgentDir, createModelRuntime: offlineModelRuntime });
    await second.forProject(projectA.id);
    expect(readStoredCredential("anthropic", projectAuthStoragePaths(dataDir, projectA.path).authPath)).toEqual({ type: "api_key", key: "project-key" });
    await second.dispose();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-auth-"));
  tempRoots.push(root);
  return root;
}

function project(id: string, path: string): Project {
  return { id, path, name: id, createdAt: "2026-01-01T00:00:00.000Z" };
}

function offlineModelRuntime(paths: ReturnType<typeof projectAuthStoragePaths>): Promise<ModelRuntime> {
  return ModelRuntime.create({ authPath: paths.authPath, modelsPath: paths.modelsPath, allowModelNetwork: false });
}
