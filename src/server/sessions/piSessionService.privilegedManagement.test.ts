import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSessionRuntime, SessionManager, type AgentSessionRuntime } from "../../piSdk.js";
import { describe, expect, it, vi } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { WorkbenchAccessStateStore } from "../workbench/accessStateStore.js";
import { WorkbenchMcpClient } from "../workbench/mcpClient.js";
import { WorkbenchSkillSynchronizer } from "../workbench/skillSync.js";
import { WorkbenchClient } from "../workbench/workbenchClient.js";
import { PiSessionService } from "./piSessionService.js";
import * as runtimeEnvironment from "./managementPermissionSystem.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, createTestModelRuntime, emptyArchiveStore, testManagementContext } from "./piSessionService.testSupport.js";

describe("privileged management session permissions", () => {
  it("removes only original managed Relay copies for full privileges and restores them after privileges are removed", async () => {
    const h = await fixture(true, { bash: true, network: true });
    const skillRoot = join(h.cwd, ".pi", "skills");
    const relayPath = join(skillRoot, "relay", "SKILL.md");
    const runnerPath = join(skillRoot, "relay-runner", "SKILL.md");
    const legacy = await readFile(new URL("./fixtures/relay-runner-legacy.md", import.meta.url), "utf8");
    const relay = await readFile(new URL("../../../skills/relay/SKILL.md", import.meta.url), "utf8");
    const custom = "---\nname: custom\ndescription: Custom skill\n---\nUser content\n";
    try {
      for (const name of ["relay", "relay-runner", "custom"]) await mkdir(join(skillRoot, name), { recursive: true });
      await writeFile(relayPath, relay);
      await writeFile(runnerPath, legacy);
      await writeFile(join(skillRoot, "custom", "SKILL.md"), custom);
      await writeFile(join(h.agentDir, "settings.json"), JSON.stringify({
        defaultProjectTrust: "always",
        packages: [fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url))],
      }));

      await h.service.start(h.cwd);
      expect(await readFile(relayPath, "utf8")).toBe(relay);
      expect(await readFile(runnerPath, "utf8")).toBe(legacy);
      expect(h.runtime().services.resourceLoader.getSkills().diagnostics).toContainEqual(expect.objectContaining({ type: "collision" }));

      const session = await h.start();
      const ref = { id: session.id, cwd: h.cwd };
      for (const path of [relayPath, runnerPath]) await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      const skills = h.runtime().services.resourceLoader.getSkills();
      expect(skills.skills.filter((skill) => skill.name === "relay-runner").map((skill) => skill.filePath)).toEqual([
        fileURLToPath(new URL("../../../pi-packages/relays/skills/relay-runner/SKILL.md", import.meta.url)),
      ]);
      expect(skills.diagnostics).toEqual([]);
      expect(await readFile(join(skillRoot, "custom", "SKILL.md"), "utf8")).toBe(custom);
      expect(h.runtime().session.getActiveToolNames()).toContain("mcp");

      await mkdir(join(skillRoot, "relay-runner"), { recursive: true });
      await writeFile(runnerPath, legacy);
      await h.service.runCommand(ref, "/reload", h.context);
      await expect(readFile(runnerPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await h.service.status(ref, h.context)).warnings?.filter((warning) => warning.source === "skill") ?? []).toEqual([]);

      await h.service.start(h.cwd, { managementContext: { ...h.context, privileged: {} } });
      expect(await readFile(relayPath, "utf8")).toBe(relay);
      expect(await readFile(runnerPath, "utf8")).toBe(await readFile(new URL("../../../skills/relay-runner/SKILL.md", import.meta.url), "utf8"));
      expect(h.runtime().services.resourceLoader.getSkills().skills.filter((skill) => skill.name === "relay-runner").map((skill) => skill.filePath)).toEqual([runnerPath]);
      expect(h.runtime().session.getActiveToolNames()).not.toContain("mcp");
      expect(await readFile(join(skillRoot, "custom", "SKILL.md"), "utf8")).toBe(custom);
    } finally {
      await h.dispose();
    }
  });

  it.each([false, true])("preserves the policy environment when reloading resources with full permissions=%s", async (full) => {
    const h = await fixture(full, full ? { bash: true, network: true } : {});
    vi.stubEnv("PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR", h.agentDir);
    try {
      await writeFile(join(h.cwd, ".pi", "extensions", "probe.js"), 'export default function(pi) { pi.registerCommand("project-probe", { description: process.env.PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR, async handler() {} }); }\n');
      const session = await h.start();
      const ref = { id: session.id, cwd: h.cwd };
      const initial = (await h.service.commands(ref, h.context)).find((command) => command.name === "project-probe")?.description;
      if (full) expect(initial).toBe(h.agentDir);
      else expect(initial).toContain("management-embed");
      expect(await h.service.runCommand(ref, "/reload", h.context)).toMatchObject({ type: "done" });
      expect((await h.service.commands(ref, h.context)).find((command) => command.name === "project-probe")?.description).toBe(initial);
      expect(process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]).toBe(h.agentDir);
    } finally {
      vi.unstubAllEnvs();
      await h.dispose();
    }
  });

  it("keeps concurrent managed startup policies isolated for the same user and workspace", async () => {
    const creation = vi.spyOn(runtimeEnvironment, "withRuntimeCreationEnvironment");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    let blocked = false;
    const h = await fixture(false, {}, "always", false, async (cwd) => {
      if (!blocked && process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]?.includes("management-embed") === true) {
        blocked = true;
        entered();
        await gate;
      }
      return cwd;
    });
    await writeFile(join(h.cwd, ".pi", "extensions", "probe.js"), `
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      export default function(pi) {
        const policy = JSON.parse(readFileSync(join(process.env.PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR, "pi-permissions.jsonc"), "utf8"));
        pi.registerCommand("policy-probe", { description: policy.tools.read, async handler() {} });
      }
    `);
    const first = h.start();
    let second: ReturnType<typeof h.service.start> | undefined;
    try {
      await enteredGate;
      const secondContext = { ...h.context, tools: { allow: ["write"], deny: ["read"] } };
      second = h.service.start(h.cwd, { managementContext: secondContext });
      await vi.waitFor(() => { expect(creation.mock.calls).toHaveLength(2); });
      release();
      const [a, b] = await Promise.all([first, second]);
      const firstCommands = await h.service.commands({ id: a.id, cwd: h.cwd }, h.context);
      const secondCommands = await h.service.commands({ id: b.id, cwd: h.cwd }, secondContext);
      expect(firstCommands.find((command) => command.name === "policy-probe")?.description).toBe("allow");
      expect(secondCommands.find((command) => command.name === "policy-probe")?.description).toBe("deny");
    } finally {
      release();
      await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
      creation.mockRestore();
      await h.dispose();
    }
  });

  it.each(["startup", "reload"] as const)("queues ordinary %s behind managed environment overrides", async (operation) => {
    const creation = vi.spyOn(runtimeEnvironment, "withRuntimeCreationEnvironment");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    let blocked = false;
    const h = await fixture(false, {}, "always", false, async (cwd) => {
      if (!blocked && process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]?.includes("management-embed") === true) {
        blocked = true;
        entered();
        await gate;
      }
      return cwd;
    });
    vi.stubEnv("PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR", h.agentDir);
    const ordinarySession = operation === "reload" ? await h.service.start(h.cwd) : undefined;
    const ordinaryRuntime = ordinarySession === undefined ? undefined : h.runtime();
    creation.mockClear();
    const managed = h.start();
    let ordinary: Promise<unknown> | undefined;
    try {
      await enteredGate;
      ordinary = ordinarySession === undefined ? h.service.start(h.cwd) : h.service.runCommand({ id: ordinarySession.id, cwd: h.cwd }, "/reload");
      await vi.waitFor(() => { expect(creation.mock.calls.some(([env]) => Object.keys(env).length === 0)).toBe(true); });
      release();
      await Promise.all([managed, ordinary]);
      expect((ordinaryRuntime ?? h.runtime()).session.getToolDefinition("mcp")?.description).toBe(`Test global MCP contribution: ${h.agentDir}`);
      expect(process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]).toBe(h.agentDir);
    } finally {
      release();
      await Promise.allSettled([managed, ...(ordinary === undefined ? [] : [ordinary])]);
      creation.mockRestore();
      vi.unstubAllEnvs();
      await h.dispose();
    }
  });
  it.each([
    { name: "no grants", enabled: true, grants: {}, ordinary: false },
    { name: "bash only", enabled: true, grants: { bash: true }, ordinary: false },
    { name: "network only", enabled: true, grants: { network: true }, ordinary: false },
    { name: "machine disabled", enabled: false, grants: { bash: true, network: true }, ordinary: false },
    { name: "both grants", enabled: true, grants: { bash: true, network: true }, ordinary: true },
  ])("uses the correct tool/resource boundary for $name", async ({ enabled, grants, ordinary }) => {
    const h = await fixture(enabled, grants);
    try {
      await h.start();
      const runtime = h.runtime();
      expect(runtime.services.modelRuntime).toBe(h.managedModelRuntime);
      expect(runtime.session.getActiveToolNames()).toContain("read");
      expect(runtime.session.getActiveToolNames().includes("bash")).toBe(ordinary);
      expect(runtime.session.getActiveToolNames().includes("write")).toBe(ordinary);
      expect(runtime.session.getActiveToolNames().includes("mcp")).toBe(ordinary);
      expect(runtime.session.getActiveToolNames().includes("spawn_session")).toBe(ordinary);
      expect(runtime.services.resourceLoader.getSkills().skills.some((skill) => skill.name === "global-probe")).toBe(ordinary);
      expect(runtime.session.systemPrompt.includes("GLOBAL_CONTEXT_SENTINEL")).toBe(ordinary);
      const read = runtime.session.agent.state.tools.find((tool) => tool.name === "read");
      if (read === undefined) throw new Error("Expected the real read tool");
      const result = read.execute("outside-read", { path: h.outside }, new AbortController().signal);
      if (ordinary) expect(JSON.stringify(await result)).toContain("OUTSIDE_WORKSPACE_SENTINEL");
      else await expect(result).rejects.toThrow("path outside the managed project sandbox");
      expect(() => h.service.connectSessionEvents({ id: runtime.session.sessionId, cwd: h.cwd }, new AbortController().signal)).toThrow("not hosted");
      const policyRoot = join(h.agentDir, "management-embed", "permission-system", "root-user", h.cwdHash);
      if (ordinary) await expect(readdir(policyRoot)).rejects.toMatchObject({ code: "ENOENT" });
      else {
        const policies = await readdir(policyRoot);
        expect(policies).toHaveLength(1);
        for (const policy of policies) {
          expect(JSON.parse(await readFile(join(policyRoot, policy, "pi-permissions.jsonc"), "utf8"))).toMatchObject({ tools: { bash: "deny", read: "allow" } });
        }
      }
    } finally {
      await h.dispose();
    }
  });

  it("matches ordinary tools and keeps management context on privileged delegation", async () => {
    const h = await fixture(true, { bash: true, network: true });
    try {
      await h.service.start(h.cwd);
      const ordinaryTools = h.runtime().session.getActiveToolNames().sort();
      await h.start();
      const runtime = h.runtime();
      expect(runtime.session.getActiveToolNames().sort()).toEqual(ordinaryTools);
      const write = runtime.session.agent.state.tools.find((tool) => tool.name === "write");
      if (write === undefined) throw new Error("Expected the ordinary write tool");
      await write.execute("outside-write", { path: h.outside, content: "PRIVILEGED_WRITE_SENTINEL" }, new AbortController().signal);
      expect(await readFile(h.outside, "utf8")).toBe("PRIVILEGED_WRITE_SENTINEL");

      const list = vi.spyOn(h.service, "listSubsessions").mockResolvedValue([]);
      const tool = runtime.session.agent.state.tools.find((entry) => entry.name === "list_subsessions");
      if (tool === undefined) throw new Error("Expected managed delegation tools");
      await tool.execute("privileged-list", {}, new AbortController().signal);
      expect(list).toHaveBeenCalledWith(runtime.session.sessionId, runtime.session.sessionFile, h.context);
    } finally {
      await h.dispose();
    }
  });

  it.each(["ask", "never"] as const)("trusts fully privileged management projects without approval when normal trust is %s", async (trust) => {
    const h = await fixture(true, { bash: true, network: true }, trust);
    try {
      const decisions = JSON.stringify({ [h.cwd]: false });
      await writeFile(join(h.agentDir, "trust.json"), decisions);
      const session = await h.start();
      const names = (await h.service.commands({ id: session.id, cwd: h.cwd }, h.context)).map((command) => command.name);
      expect(names).toContain("project-probe");
      expect(await readFile(join(h.agentDir, "trust.json"), "utf8")).toBe(decisions);
      expect(h.runtime().services.resourceLoader.getSkills().skills.map((skill) => skill.name)).toContain("global-probe");
      expect(h.runtime().session.getActiveToolNames()).toContain("bash");
    } finally {
      await h.dispose();
    }
  });

  it("matches ordinary prompts and tools without syncing managed resources when Workbench is configured", async () => {
    const h = await fixture(true, { bash: true, network: true }, "always", true);
    try {
      const relayPath = join(h.cwd, ".pi", "skills", "relay", "SKILL.md");
      const relay = "---\nname: relay\ndescription: Operator relay\n---\nOPERATOR_RELAY_SENTINEL\n";
      await mkdir(join(h.cwd, ".pi", "skills", "relay"), { recursive: true });
      await writeFile(relayPath, relay);
      await h.service.start(h.cwd);
      const ordinaryPrompt = h.runtime().session.systemPrompt;
      const ordinaryTools = h.runtime().session.agent.state.tools.map(({ name, description }) => ({ name, description }));
      await h.start();
      expect(h.runtime().session.systemPrompt).toBe(ordinaryPrompt);
      expect(h.runtime().session.agent.state.tools.map(({ name, description }) => ({ name, description }))).toEqual(ordinaryTools);
      expect(h.runtime().session.systemPrompt).not.toContain("L0只读能力");
      const bash = h.runtime().session.agent.state.tools.find((tool) => tool.name === "bash");
      if (bash === undefined) throw new Error("Expected the ordinary bash tool");
      const code = `require("node:fs").writeFileSync(${JSON.stringify(h.outside.replaceAll("\\", "/"))}, "FULL_BASH_SENTINEL")`;
      const result = await bash.execute("outside-bash-write", { command: `node -e '${code}'` }, new AbortController().signal);
      expect(result, JSON.stringify(result)).toMatchObject({ structuredContent: { exit_code: 0 } });
      expect(await readFile(h.outside, "utf8")).toBe("FULL_BASH_SENTINEL");
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.synchronize).not.toHaveBeenCalled();
      expect(await readFile(relayPath, "utf8")).toBe(relay);
      await expect(readFile(join(h.cwd, ".pi", "skills", "relay-runner", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await h.dispose();
    }
  });

  it("keeps a modified Relay runner and its real collision warning under full privileges", async () => {
    const h = await fixture(true, { bash: true, network: true });
    const runnerPath = join(h.cwd, ".pi", "skills", "relay-runner", "SKILL.md");
    const content = "---\nname: relay-runner\ndescription: Custom runner\n---\nOPERATOR_RUNNER_SENTINEL\n";
    try {
      await mkdir(join(h.cwd, ".pi", "skills", "relay-runner"), { recursive: true });
      await writeFile(runnerPath, content);
      await writeFile(join(h.agentDir, "settings.json"), JSON.stringify({
        defaultProjectTrust: "always",
        packages: [fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url))],
      }));
      const session = await h.start();
      const ref = { id: session.id, cwd: h.cwd };
      for (const phase of ["start", "reload"]) {
        if (phase === "reload") await h.service.runCommand(ref, "/reload", h.context);
        expect(await readFile(runnerPath, "utf8")).toBe(content);
        expect(h.runtime().services.resourceLoader.getSkills().skills.find((skill) => skill.name === "relay-runner")?.filePath).toBe(runnerPath);
        expect((await h.service.status(ref, h.context)).warnings).toContainEqual(expect.objectContaining({ source: "skill", message: 'name "relay-runner" collision' }));
        expect(h.runtime().session.getActiveToolNames()).toContain("mcp");
      }
    } finally {
      await h.dispose();
    }
  });

  it("does not require restricted Workbench resource authorization for full permissions", async () => {
    const h = await fixture(true, { bash: true, network: true }, "always", true);
    try {
      h.prepare.mockRejectedValue(new Error("Workbench resource authorization expired"));
      await h.start();
      expect(h.runtime().session.getActiveToolNames()).toContain("bash");
      expect(h.prepare).not.toHaveBeenCalled();
    } finally {
      await h.dispose();
    }
  });

  it("preserves the operator's ordinary permission policy environment", async () => {
    const h = await fixture(true, { bash: true, network: true });
    vi.stubEnv("PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR", h.agentDir);
    try {
      await h.service.start(h.cwd);
      const ordinaryDescription = h.runtime().session.getToolDefinition("mcp")?.description;
      expect(ordinaryDescription).toContain(h.agentDir);
      await h.start();
      expect(h.runtime().session.getToolDefinition("mcp")?.description).toBe(ordinaryDescription);
      expect(process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]).toBe(h.agentDir);
    } finally {
      vi.unstubAllEnvs();
      await h.dispose();
    }
  });

  it("retains managed Workbench tools and synchronization without full permission grants", async () => {
    const h = await fixture(true, { bash: true }, "always", true);
    try {
      h.context.tools = { deny: [] };
      await h.start();
      expect(h.prepare).toHaveBeenCalledOnce();
      expect(h.synchronize).toHaveBeenCalledOnce();
      expect(h.runtime().session.agent.state.tools.find((tool) => tool.name === "icnoc_call_capability")?.description).toContain("L0只读能力");
      expect(h.runtime().session.getActiveToolNames()).toContain("icnoc_call_capability");
      expect(await readFile(join(h.cwd, ".pi", "skills", "relay", "SKILL.md"), "utf8")).toContain("name: relay");
    } finally {
      await h.dispose();
    }
  });
});

async function fixture(enabled: boolean, grants: NonNullable<ManagementEmbedContext["privileged"]>, trust: "always" | "never" | "ask" = "always", withWorkbench = false, projectPathForCwd?: (cwd: string) => Promise<string>) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-privileged-managed-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const outside = join(root, "outside.txt");
  await mkdir(join(agentDir, "skills", "global-probe"), { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(outside, "OUTSIDE_WORKSPACE_SENTINEL");
  await writeFile(join(agentDir, "AGENTS.md"), "GLOBAL_CONTEXT_SENTINEL");
  await writeFile(join(agentDir, "skills", "global-probe", "SKILL.md"), "---\nname: global-probe\ndescription: Test global skill\n---\nGlobal resource fixture\n");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    defaultProjectTrust: trust,
    ...(process.env["PI_WEB_TEST_BASH"] === undefined ? {} : { shellPath: process.env["PI_WEB_TEST_BASH"] }),
  }));
  await writeFile(join(cwd, ".pi", "extensions", "probe.js"), 'export default function(pi) { pi.registerCommand("project-probe", { description: "Test project command", async handler() {} }); }\n');
  await writeFile(join(agentDir, "extensions", "mcp.js"), 'export default function(pi) { pi.registerTool({ name: "mcp", label: "mcp", description: "Test global MCP contribution: " + (process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"] ?? "default"), parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "GLOBAL_MCP_FIXTURE" }] }; } }); }\n');
  const managedModelRuntime = await createTestModelRuntime();
  const config = { baseUrl: "https://workbench.example", mcpUrl: "https://mcp.example" };
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected Workbench network access"));
  const client = new WorkbenchClient({ baseUrl: config.baseUrl, requestTimeoutMs: 1000, fetch: fetchImpl });
  const accessStates = new WorkbenchAccessStateStore();
  const skills = new WorkbenchSkillSynchronizer(config, client, join(root, "data"), fetchImpl);
  const prepare = vi.spyOn(accessStates, "prepare").mockResolvedValue({
    sessionId: "test-workbench-session", bearerToken: "test-only-token",
    expiresAt: "2099-01-01T00:00:00Z", authorizationRevision: 1, resources: [],
  });
  const synchronize = vi.spyOn(skills, "synchronize").mockResolvedValue({ authorizationRevision: 1, skills: [] });
  const context: ManagementEmbedContext = {
    ...testManagementContext(),
    privileged: grants,
    tools: { allow: ["read"], deny: ["bash", "write", "mcp", "spawn_session"] },
  };
  let runtime: AgentSessionRuntime | undefined;
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir,
    dataDir: join(root, "data"),
    modelRuntime: await createTestModelRuntime(),
    managementModelRuntime: managedModelRuntime,
    managementAllowPrivileged: enabled,
    ...(withWorkbench ? { workbench: {
      accessStates, client, skills,
      mcp: new WorkbenchMcpClient({ mcpUrl: config.mcpUrl, timeoutMs: 1000, fetch: fetchImpl }),
    } } : {}),
    subsessionsEnabled: true,
    spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd }) },
    archiveStore: emptyArchiveStore(),
    projectPathForCwd: projectPathForCwd ?? (() => Promise.resolve(cwd)),
    sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
    createAgentRuntime: async (createRuntime, options) => {
      if (!(options.sessionManager instanceof SessionManager)) throw new Error("Expected the real SDK session manager");
      runtime = await createAgentSessionRuntime((next) => createRuntime({ ...next, ...(options.managementContext === undefined ? {} : { managementContext: options.managementContext }) }), {
        cwd: options.cwd, agentDir: options.agentDir, sessionManager: options.sessionManager,
      });
      return runtime;
    },
  });
  return {
    cwd, agentDir, outside, context, service, managedModelRuntime, prepare, synchronize,
    cwdHash: createHash("sha256").update(cwd).digest("hex").slice(0, 16),
    start: () => service.start(cwd, { managementContext: context }),
    runtime: () => {
      if (runtime === undefined) throw new Error("Expected the real managed SDK runtime");
      return runtime;
    },
    dispose: async () => { await service.dispose(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); },
  };
}
