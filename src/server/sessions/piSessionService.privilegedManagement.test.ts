import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionRuntime, SessionManager, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { WorkbenchAccessStateStore } from "../workbench/accessStateStore.js";
import { WorkbenchMcpClient } from "../workbench/mcpClient.js";
import { WorkbenchSkillSynchronizer } from "../workbench/skillSync.js";
import { WorkbenchClient } from "../workbench/workbenchClient.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, createTestModelRuntime, emptyArchiveStore, testManagementContext } from "./piSessionService.testSupport.js";

describe("privileged management session permissions", () => {
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
      const policyPath = join(h.agentDir, "management-embed", "permission-system", "root-user", h.cwdHash, "pi-permissions.jsonc");
      if (ordinary) await expect(readFile(policyPath)).rejects.toMatchObject({ code: "ENOENT" });
      else expect(JSON.parse(await readFile(policyPath, "utf8"))).toMatchObject({ tools: { bash: "deny", read: "allow" } });
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

  it("keeps ordinary project trust rules for a fully privileged management session", async () => {
    const h = await fixture(true, { bash: true, network: true }, "never");
    try {
      const session = await h.start();
      const names = (await h.service.commands({ id: session.id, cwd: h.cwd }, h.context)).map((command) => command.name);
      expect(names).not.toContain("project-probe");
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
      await bash.execute("outside-bash-write", { command: `node -e '${code}'` }, new AbortController().signal);
      expect(await readFile(h.outside, "utf8")).toBe("FULL_BASH_SENTINEL");
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.synchronize).not.toHaveBeenCalled();
      expect(await readFile(relayPath, "utf8")).toBe(relay);
      await expect(readFile(join(h.cwd, ".pi", "skills", "relay-runner", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
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

async function fixture(enabled: boolean, grants: NonNullable<ManagementEmbedContext["privileged"]>, trust: "always" | "never" = "always", withWorkbench = false) {
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
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: trust }));
  await writeFile(join(cwd, ".pi", "extensions", "probe.js"), 'export default function(pi) { pi.registerCommand("project-probe", { description: "Test project command", async handler() {} }); }\n');
  await writeFile(join(agentDir, "extensions", "mcp.js"), 'export default function(pi) { pi.registerTool({ name: "mcp", label: "mcp", description: "Test global MCP contribution", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "GLOBAL_MCP_FIXTURE" }] }; } }); }\n');
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
    projectPathForCwd: () => Promise.resolve(cwd),
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
