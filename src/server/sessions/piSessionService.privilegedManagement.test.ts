import { createAssistantMessageEventStream, type AssistantMessage } from "../../piAi.js";
import * as guardrails from "../guardrails/managementGuardrails.js";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
import { CapturingSessionEventHub, createTestModelRuntime, emptyArchiveStore, testManagementContext, testModel } from "./piSessionService.testSupport.js";

describe("privileged management session permissions", () => {
  it("uses the screened session message in both model content and persisted details", async () => {
    const h = await fixture(true, {}, "always", false, undefined, true);
    const enabled = vi.spyOn(guardrails, "managementGuardrailsEnabled").mockReturnValue(true);
    const material = vi.spyOn(guardrails, "checkManagementMaterial").mockResolvedValue({ text: "isolated", isolated: true });
    try {
      const sender = await h.start();
      const target = await h.start();
      const send = vi.spyOn(h.runtime().session, "sendCustomMessage").mockResolvedValue();
      await h.service.sendSessionMessage({ sendingCwd: h.cwd, sendingSessionId: sender.id, sessionId: target.id, message: "untrusted-marker" }, h.context);
      await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce(); });
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        content: `Message from session ${sender.id}:\n\nisolated`,
        details: { sendingSessionId: sender.id, body: "isolated" },
      });
    } finally {
      enabled.mockRestore();
      material.mockRestore();
      await h.dispose();
    }
  });

  it.each([false, true])("exposes scoped Relay dispatch in restricted management (denied=%s)", async (denied) => {
    const h = await fixture(false, {});
    try {
      h.context.tools = { allow: ["read"], deny: denied ? ["dispatch_relay"] : [] };
      const relayExtension = fileURLToPath(new URL("../../../pi-packages/relays/extensions/index.ts", import.meta.url)).replaceAll("\\", "/");
      await writeFile(join(h.cwd, ".pi", "extensions", "relay.ts"), `export { default } from ${JSON.stringify(relayExtension)};\n`);
      const packet = join(h.cwd, ".pi-web", "relays", "managed");
      await mkdir(packet, { recursive: true });
      await Promise.all(["charter.md", "status.md", "log.md"].map((name) => writeFile(join(packet, name), "Saved packet")));
      const spawn = vi.spyOn(h.service, "spawnSession").mockResolvedValue({ sessionId: "next-leg", cwd: h.cwd });
      const session = await h.start();
      const runtime = h.runtime();
      expect(runtime.session.getActiveToolNames().includes("dispatch_relay")).toBe(!denied);
      expect(runtime.session.getActiveToolNames()).toEqual(expect.arrayContaining([
        "spawn_session", "spawn_subsession", "list_subsessions", "check_subsession", "read_subsession", "yield_to_subsessions",
      ]));
      if (!denied) {
        const tool = runtime.session.agent.state.tools.find((entry) => entry.name === "dispatch_relay");
        if (tool === undefined) throw new Error("Expected managed Relay dispatch tool");
        await tool.execute("relay-dispatch", { packet: ".pi-web/relays/managed", leg: "1" }, new AbortController().signal);
        expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
          spawningSessionId: session.id, managementContext: h.context, cwd: await realpath(h.cwd),
          name: "Leg 1 – Relay managed",
        }));
        await h.service.runCommand({ id: session.id, cwd: h.cwd }, "/reload", h.context);
        expect(runtime.session.getActiveToolNames()).toContain("dispatch_relay");
      }
      expect(runtime.session.getActiveToolNames()).not.toContain("mcp");
    } finally {
      await h.dispose();
    }
  });
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
      const send = vi.spyOn(h.service, "sendSessionMessage").mockResolvedValue({ sessionId: "managed-target", delivery: "started" });
      const messageTool = runtime.session.agent.state.tools.find((entry) => entry.name === "send_session_message");
      if (messageTool === undefined) throw new Error("Expected scoped session messaging");
      await messageTool.execute("privileged-message", { sessionId: "managed-target", message: "status" }, new AbortController().signal);
      expect(send).toHaveBeenCalledWith({ sendingCwd: h.cwd, sendingSessionId: runtime.session.sessionId, sessionId: "managed-target", message: "status" }, h.context);
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
      if (process.platform !== "win32") {
        const code = `require("node:fs").writeFileSync(${JSON.stringify(h.outside.replaceAll("\\", "/"))}, "FULL_BASH_SENTINEL")`;
        const result = await bash.execute("outside-bash-write", { command: `node -e '${code}'` }, new AbortController().signal);
        expect(result, JSON.stringify(result)).toMatchObject({ structuredContent: { exit_code: 0 } });
        expect(await readFile(h.outside, "utf8")).toBe("FULL_BASH_SENTINEL");
      }
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

describe("embedded guardrail SDK boundaries", () => {
  it("screens split shell output, thrown tool errors, attachment filenames and folder writes", async () => {
    const h = await fixture(true, { bash: true, network: true });
    const raw = "unsafe-material-sentinel";
    const blocked = new guardrails.ManagementGuardrailError("protected_path", "write-event", 403);
    const enabled = vi.spyOn(guardrails, "managementGuardrailsEnabled").mockReturnValue(true);
    const material = vi.spyOn(guardrails, "checkManagementMaterial").mockImplementation((_scope, text) => Promise.resolve(
      text.includes(raw) ? { isolated: true, text: "Isolated. Event content-event." } : { isolated: false, text },
    ));
    const tools = vi.spyOn(guardrails, "checkManagementTool").mockImplementation((_scope, _tool, args) => {
      const path = args["path"];
      return typeof path === "string" && path.includes("blocked-folder") ? Promise.reject(blocked) : Promise.resolve();
    });
    const uninspectable = vi.spyOn(guardrails, "checkManagementUninspectableMaterial").mockRejectedValue(
      new guardrails.ManagementGuardrailError("material_requires_text", "image-event", 403));
    const plugin = vi.spyOn(guardrails, "createManagementGuardExtension").mockReturnValue(() => undefined);
    try {
      const { id } = await h.start();
      const ref = { id, cwd: h.cwd };
      const session = h.runtime().session;
      const previews: string[] = [];
      const result = await session.executeBash("example", (chunk) => { previews.push(chunk); }, {
        operations: { exec: (_command, _cwd, options) => {
          options.onData(Buffer.from("unsafe-material-")); options.onData(Buffer.from("sentinel"));
          return Promise.resolve({ exitCode: 0 });
        } },
      });
      expect(result.output).toContain("content-event");
      expect(previews.join("")).not.toContain(raw);
      expect(JSON.stringify(session.sessionManager.getBranch())).not.toContain(raw);
      const failure = await session.extensionRunner.emitToolResult({
        type: "tool_result", toolName: "read", toolCallId: "failed-read", input: {}, isError: true,
        content: [{ type: "text", text: "failure" }], details: { exception: raw }, structuredContent: { reason: raw },
      });
      expect(failure).toMatchObject({ content: [{ type: "text", text: "Isolated. Event content-event." }], isError: true, details: {} });
      expect(JSON.stringify(failure)).not.toContain(raw);
      const file = { kind: "file", mimeType: "text/plain", data: Buffer.from(raw).toString("base64"), name: raw + ".txt" };
      const [saved] = await h.service.saveAttachments(ref, [file], "uploads", h.context);
      if (!saved) throw new Error("Expected safe attachment");
      expect(saved.path).not.toContain(raw);
      expect(await readFile(join(h.cwd, saved.path), "utf8")).toContain("content-event");
      await expect(h.service.saveAttachments(ref, [file], "blocked-folder", h.context)).rejects.toBe(blocked);
      await expect(readdir(join(h.cwd, "blocked-folder"))).rejects.toMatchObject({ code: "ENOENT" });
      const image = { kind: "image", mimeType: "image/png", data: "QUJD" };
      await expect(h.service.saveAttachments(ref, [image], "uploads", h.context)).rejects.toThrow("image-event");
      const abort = vi.spyOn(session.agent, "abort");
      const unavailable = new guardrails.ManagementGuardrailError("detector_unavailable", "retry-event", 503);
      material.mockRejectedValueOnce(unavailable);
      const event = { type: "tool_result" as const, toolName: "read", toolCallId: "retry", input: {}, isError: false,
        content: [{ type: "text" as const, text: raw }], details: { preview: raw } };
      const paused = await session.extensionRunner.emitToolResult(event);
      expect(JSON.stringify(paused)).toContain("retry-event");
      expect(JSON.stringify(paused)).not.toContain(raw);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await session.extensionRunner.emitToolResult(event))).toContain("content-event");
    } finally {
      enabled.mockRestore(); material.mockRestore(); tools.mockRestore(); uninspectable.mockRestore(); plugin.mockRestore();
      await h.dispose();
    }
  });

  it.each([{}, { bash: true }, { bash: true, network: true }])("checks expanded input and actual tool results before history with grants %j", async (grants) => {
    const h = await fixture(true, grants);
    const secret = "external-injection-marker";
    const denied = new guardrails.ManagementGuardrailError("test_denied", "test-event", 403);
    const enabled = vi.spyOn(guardrails, "managementGuardrailsEnabled").mockReturnValue(true);
    const input = vi.spyOn(guardrails, "checkManagementInput").mockImplementation((_scope, text) => {
      return text.includes("forbidden-instruction") ? Promise.reject(denied) : Promise.resolve();
    });
    const material = vi.spyOn(guardrails, "checkManagementMaterial").mockImplementation((_scope, text) => Promise.resolve(
      text.includes(secret) ? { text: "Isolated. Event material-event.", isolated: true } : { text, isolated: false }
    ));
    const calls = vi.fn();
    const plugin = vi.spyOn(guardrails, "createManagementGuardExtension").mockImplementation(() => (pi) => {
      pi.on("tool_call", (event) => {
        calls(event.toolName);
        return event.toolName === "write" ? { block: true, reason: denied.message } : undefined;
      });
    });
    try {
      const target = join(h.cwd, "effect.txt");
      await mkdir(join(h.cwd, ".pi", "prompts"), { recursive: true });
      await writeFile(join(h.cwd, ".pi", "prompts", "unsafe-template.md"), "forbidden-instruction-$1");
      await writeFile(join(h.cwd, "material.txt"), secret);
      h.context.tools = { allow: ["read", "write"] };
      const { id } = await h.start();
      const ref = { id, cwd: h.cwd };
      const session = h.runtime().session;
      await h.managedModelRuntime.setRuntimeApiKey("anthropic", "isolated-test-key");
      await session.setModel(testModel());
      const contexts: unknown[] = [];
      session.agent.streamFunction = (_model, context) => {
        contexts.push(structuredClone(context.messages));
        const requests = contexts.length;
        const content: AssistantMessage["content"] = requests === 1
          ? [{ type: "toolCall", id: "read-call", name: "read", arguments: { path: "material.txt" } }]
          : requests === 2 ? [{ type: "toolCall", id: "write-call", name: "write", arguments: { path: target, content: "blocked side effect" } }]
            : [{ type: "text", text: "Finished." }];
        const message: AssistantMessage = {
          role: "assistant", api: "anthropic-messages", provider: "anthropic", model: testModel().id, content,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: requests < 3 ? "toolUse" : "stop", timestamp: Date.now(),
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: requests < 3 ? "toolUse" : "stop", message });
        stream.end(message);
        return stream;
      };
      await expect(h.service.prompt(ref, "forbidden-instruction", undefined, undefined, { managementContext: h.context })).rejects.toBe(denied);
      expect(JSON.stringify(h.events.sessionEvents)).not.toContain("forbidden-instruction");
      const prior = session.agent.state.messages;
      const nearlyFull: AssistantMessage = {
        role: "assistant", api: "anthropic-messages", model: testModel().id, provider: "anthropic", content: [{ type: "text", text: "Old turn." }],
        usage: { input: 250000, output: 2, totalTokens: 250002, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      session.agent.state.messages = [...prior, nearlyFull];
      await expect(session.prompt("/unsafe-template hello")).rejects.toBe(denied);
      session.agent.state.messages = prior;
      await expect(session.steer("/unsafe-template hello")).rejects.toBe(denied);
      await expect(session.followUp("/unsafe-template hello")).rejects.toBe(denied);
      expect(session.pendingMessageCount).toBe(0);
      expect(contexts).toHaveLength(0);
      await h.service.prompt(ref, "Inspect the current diagnostic.", undefined, undefined, { managementContext: h.context });
      await vi.waitFor(() => { expect(contexts).toHaveLength(3); }, { timeout: 5000 });
      await session.waitForIdle();
      expect(calls.mock.calls.flat()).toEqual(["read", "write"]);
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
      const history = await h.service.messages(ref, undefined, h.context);
      expect(JSON.stringify([contexts, history, h.events.sessionEvents])).not.toContain(secret);
      expect(JSON.stringify(history)).toContain("material-event");
      expect(JSON.stringify(history)).toContain("test-event");
      if (session.sessionFile === undefined) throw new Error("Expected durable SDK history");
      expect(await readFile(session.sessionFile, "utf8")).not.toContain(secret);
      expect(input.mock.calls.filter(([, text]) => text === "Inspect the current diagnostic.")).toHaveLength(1);
      expect(material.mock.calls.some(([, text]) => text.includes(secret))).toBe(true);
      // Simulate a pre-enforcement SDK file, then reopen through the actual service.
      session.sessionManager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "legacy-read",
        timestamp: Date.now(), content: [{ type: "text", text: secret }], isError: false });
      await expect(h.service.reload(ref, h.context)).rejects.toThrow("material-event");
      await expect(h.service.messages(ref, undefined, h.context)).rejects.toThrow("material-event");
    } finally {
      enabled.mockRestore(); input.mockRestore(); material.mockRestore(); plugin.mockRestore();
      await h.dispose();
    }
  });
});

async function fixture(enabled: boolean, grants: NonNullable<ManagementEmbedContext["privileged"]>, trust: "always" | "never" | "ask" = "always", withWorkbench = false, projectPathForCwd?: (cwd: string) => Promise<string>, scopedMessaging = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-privileged-managed-"));
  const cwd = scopedMessaging ? join(root, "root-user", "project-1") : join(root, "project");
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
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    ...(scopedMessaging && { managementProjectRoot: root }),
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
    cwd, agentDir, outside, context, service, events, managedModelRuntime, prepare, synchronize,
    cwdHash: createHash("sha256").update(cwd).digest("hex").slice(0, 16),
    start: () => service.start(cwd, { managementContext: context }),
    runtime: () => {
      if (runtime === undefined) throw new Error("Expected the real managed SDK runtime");
      return runtime;
    },
    dispose: async () => { await service.dispose(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); },
  };
}
