import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "../../piSdk.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types.js";
import { ProjectAuthService, projectAuthStoragePaths } from "./projectAuthService.js";
import { WorkspaceProviderRegistry } from "../workspaces/workspaceProviderRegistry.js";
import { ProjectScopedSpawnTargetResolver } from "./spawnTargetResolver.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectAuthService", () => {
  it("bootstraps the real global provider baseline separately for each project and freezes later mutations", async () => {
    const root = await tempRoot();
    const agentDir = join(root, "global");
    await mkdir(join(agentDir, "extensions"), { recursive: true });
    await writeFile(join(agentDir, "extensions", "provider.js"), 'export default function(pi) { pi.registerProvider("project-baseline-fixture", { api: "openai-completions", baseUrl: "https://baseline.invalid", apiKey: "test-baseline-secret", models: [] }); }');
    const owners = [project("a", join(root, "a")), project("b", join(root, "b"))];
    const logEntries: Record<string, unknown>[] = [];
    const record = (details: Record<string, unknown>) => { logEntries.push(details); };
    const auth = new ProjectAuthService({ projects: { list: () => Promise.resolve(owners) }, workspaces: { list: (owner) => Promise.resolve([{ path: owner.path }]) }, dataDir: join(root, "data"), globalAgentDir: agentDir, createModelRuntime: offlineModelRuntime, offline: true, logger: { info: record, warn: record, error: record } });
    try {
      const first = await auth.forProject("a");
      const second = await auth.forProject("b");
      expect(first.modelRuntime).not.toBe(second.modelRuntime);
      expect(first.modelRuntime.getRegisteredProviderConfig("project-baseline-fixture")?.baseUrl).toBe("https://baseline.invalid");
      first.modelRuntime.registerProvider("project-baseline-fixture", { baseUrl: "https://project-mutation.invalid" });
      expect(first.modelRuntime.getRegisteredProviderConfig("project-baseline-fixture")?.baseUrl).toBe("https://baseline.invalid");
      expect(second.modelRuntime.getRegisteredProviderConfig("project-baseline-fixture")?.baseUrl).toBe("https://baseline.invalid");
      expect(JSON.stringify(logEntries)).not.toContain("test-baseline-secret");
    } finally {
      await auth.dispose();
    }
  });

  it("does not publish a registry or restart catalog timers when bootstrap finishes after disposal", async () => {
    const root = await tempRoot();
    const owner = project("a", join(root, "a"));
    let releaseBootstrap: (() => void) | undefined;
    const bootstrap = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
    let startedBootstrap: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { startedBootstrap = resolve; });
    const createCatalogRefresher = vi.fn(() => ({ start() { /* no-op */ }, requestRefresh() { /* no-op */ }, dispose() { /* no-op */ }, isRefreshInFlight: () => false }));
    const auth = new ProjectAuthService({ projects: { list: () => Promise.resolve([owner]) }, workspaces: { list: () => Promise.resolve([{ path: owner.path }]) }, dataDir: join(root, "data"), globalAgentDir: join(root, "global"), createModelRuntime: offlineModelRuntime, bootstrapProviders: () => { startedBootstrap?.(); return bootstrap; }, createCatalogRefresher });
    const pending = auth.forProject("a");
    await started;
    const rejected = expect(pending).rejects.toThrow("disposed");
    const disposed = auth.dispose();
    releaseBootstrap?.();
    await rejected;
    await disposed;
    expect(createCatalogRefresher).not.toHaveBeenCalled();
  });
  it("owns one provider baseline and catalog refresher per project registry", async () => {
    const root = await tempRoot();
    const owners = [project("a", join(root, "a")), project("b", join(root, "b"))];
    const bootstrapProviders = vi.fn((runtime: ModelRuntime) => { void runtime; return Promise.resolve(); });
    const refreshers = owners.map(() => ({ start: vi.fn(), requestRefresh: vi.fn(), dispose: vi.fn(), isRefreshInFlight: () => false }));
    let refresherIndex = 0;
    const auth = new ProjectAuthService({
      projects: { list: () => Promise.resolve(owners) }, workspaces: { list: (owner) => Promise.resolve([{ path: owner.path }]) },
      dataDir: join(root, "data"), globalAgentDir: join(root, "global"), createModelRuntime: offlineModelRuntime,
      bootstrapProviders,
      createCatalogRefresher: () => {
        const refresher = refreshers[refresherIndex++];
        if (refresher === undefined) throw new Error("unexpected registry");
        return refresher;
      },
    });
    try {
      const first = await auth.forProject("a");
      const owner = owners[0];
      if (owner === undefined) throw new Error("Expected project fixture");
      expect(await auth.forCwd(owner.path)).toBe(first);
      const second = await auth.forProject("b");
      expect(bootstrapProviders.mock.calls).toHaveLength(2);
      expect(bootstrapProviders.mock.calls[0]?.[0]).toBe(first.modelRuntime);
      expect(bootstrapProviders.mock.calls[1]?.[0]).toBe(second.modelRuntime);
      expect(refreshers[0]?.start).toHaveBeenCalledOnce();
      expect(refreshers[1]?.start).toHaveBeenCalledOnce();
      await first.saveApiKey("anthropic", "project-only-test-key");
      expect(refreshers[0]?.requestRefresh).toHaveBeenCalledOnce();
      expect(refreshers[1]?.requestRefresh).not.toHaveBeenCalled();
    } finally {
      await auth.dispose();
    }
    expect(refreshers[0]?.dispose).toHaveBeenCalledOnce();
    expect(refreshers[1]?.dispose).toHaveBeenCalledOnce();
    await expect(auth.forProject("a")).rejects.toThrow("disposed");
  });
  it("resolves provider-owned workspaces consistently for auth and spawned sessions", async () => {
    const root = await tempRoot();
    const owner = project("provider-project", join(root, "project"));
    const extraPath = join(root, "provider-workspace");
    const projects = { list: () => Promise.resolve([owner]) };
    const workspaces = new WorkspaceProviderRegistry({
      logger: { warn() { /* no-op */ } },
      pathInspector: () => true,
      contributions: [{
        pluginId: "test-provider", pluginName: "Test provider", packageRoot: root,
        source: "test", scope: "user", moduleRevision: "test-revision",
        provider: {
          probe: () => Promise.resolve("claim"),
          list: () => Promise.resolve([
            { key: "main", path: owner.path, label: "Main", isMain: true },
            { key: "extra", path: extraPath, label: "Extra", isMain: false },
          ]),
        },
      }],
    });
    const auth = new ProjectAuthService({
      projects, workspaces, dataDir: join(root, "data"), globalAgentDir: join(root, "global"),
      createModelRuntime: offlineModelRuntime,
    });
    try {
      expect((await workspaces.list(owner)).map((item) => item.path)).toContain(extraPath);
      expect(await auth.forCwd(extraPath)).toBe(await auth.forProject(owner.id));
      const spawn = new ProjectScopedSpawnTargetResolver({ projects, workspaces });
      await expect(spawn.resolveSpawnTarget(owner.path, extraPath)).resolves.toEqual({ allowed: true, cwd: extraPath });
      await expect(auth.forCwd(join(root, "outside"))).rejects.toThrow("已注册项目");
    } finally {
      await auth.dispose();
    }
  });

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
    await serviceA.modelRuntime.refresh();
    expect(serviceA.modelRuntime.getModel("anthropic", "claude-haiku-4-5")?.baseUrl).toBe("https://project-a.example");
    expect(serviceB.modelRuntime.getModel("anthropic", "claude-haiku-4-5")?.baseUrl).not.toBe("https://project-a.example");
    await auth.dispose();
  }, 15_000);

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
  }, 15_000);
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-auth-"));
  tempRoots.push(root);
  return root;
}

function project(id: string, path: string): Project {
  return { id, path, name: id, createdAt: "2026-01-01T00:00:00.000Z" };
}

async function offlineModelRuntime(paths: ReturnType<typeof projectAuthStoragePaths>): Promise<ModelRuntime> {
  const previous = process.env["PI_OFFLINE"];
  process.env["PI_OFFLINE"] = "1";
  try {
    return await ModelRuntime.create({ authPath: paths.authPath, modelsPath: paths.modelsPath });
  } finally {
    if (previous === undefined) delete process.env["PI_OFFLINE"];
    else process.env["PI_OFFLINE"] = previous;
  }
}
