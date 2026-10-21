import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "../../piAi.js";
import { createAgentSessionRuntime, SessionManager, type AgentSessionRuntime } from "../../piSdk.js";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, createTestModelRuntime, emptyArchiveStore, seedCredential, testManagementContext, TEST_MODEL_ID, TEST_MODEL_PROVIDER } from "./piSessionService.testSupport.js";

describe("Pi SDK compatibility through the production session service", () => {
  it("creates, streams, executes a real file tool, persists and reloads a normal session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-sdk-session-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd);
    await mkdir(agentDir);
    await writeFile(join(cwd, "input.txt"), "SDK compatibility sentinel");
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, TEST_MODEL_PROVIDER, { type: "api_key", key: "isolated-test-key" });
    const modelRuntime = await createTestModelRuntime(credentials);
    const model = modelRuntime.getModel(TEST_MODEL_PROVIDER, TEST_MODEL_ID);
    if (model === undefined) throw new Error("Expected the SDK model catalog entry");
    const hub = new CapturingSessionEventHub();
    let runtime: AgentSessionRuntime | undefined;
    let calls = 0;
    const service = new PiSessionService(hub, {
      agentDir,
      dataDir: join(root, "data"),
      archiveStore: emptyArchiveStore(),
      sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
      modelRuntime,
      projectPathForCwd: () => Promise.resolve(cwd),
      createAgentRuntime: async (createRuntime, options) => {
        if (!(options.sessionManager instanceof SessionManager)) throw new Error("Expected the real SDK session manager");
        runtime = await createAgentSessionRuntime(async (next) => {
          const result = await createRuntime({ ...next, initialModel: model });
          // Only the external model response is deterministic; runtime, tools, persistence and PI WEB wiring are real.
          result.session.agent.streamFunction = () => {
            calls += 1;
            const content: AssistantMessage["content"] = calls === 1
              ? [{ type: "toolCall", id: "read-input", name: "read", arguments: { path: "input.txt" } }]
              : [{ type: "text", text: "SDK compatibility complete" }];
            const message: AssistantMessage = {
              role: "assistant", content, api: "anthropic-messages", provider: TEST_MODEL_PROVIDER, model: TEST_MODEL_ID,
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: calls === 1 ? "toolUse" : "stop", timestamp: Date.now(),
            };
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "done", reason: calls === 1 ? "toolUse" : "stop", message });
            stream.end(message);
            return stream;
          };
          return result;
        }, { cwd: options.cwd, agentDir: options.agentDir, sessionManager: options.sessionManager });
        return runtime;
      },
    });
    try {
      const session = await service.start(cwd, { initialModel: model });
      const ref = { id: session.id, cwd };
      await service.runCommand(ref, "/name SDK compatibility");
      await service.prompt(ref, "Read input.txt and report completion");
      await vi.waitFor(() => {
        expect(runtime?.session.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "SDK compatibility complete" }] });
        expect(runtime?.session.isStreaming).toBe(false);
      }, { timeout: 10_000 });
      expect(calls).toBe(2);
      expect(runtime?.session.messages).toContainEqual(expect.objectContaining({ role: "toolResult", toolName: "read", isError: false }));
      expect(JSON.stringify(runtime?.session.messages)).toContain("SDK compatibility sentinel");
      expect(hub.sessionEvents.some(({ event }) => event.type === "message.end")).toBe(true);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "session.error")).toEqual([]);
      await expect(readFile(join(cwd, ".pi", "skills", "relay", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(cwd, ".pi", "skills", "relay-runner", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });

      const sessionFile = runtime?.session.sessionFile;
      if (sessionFile === undefined) throw new Error("SDK did not persist the session");
      const disk = SessionManager.open(sessionFile);
      expect(JSON.stringify(disk.buildSessionContext().messages)).toContain("SDK compatibility complete");
      expect((await service.list(cwd)).some(({ id }) => id === session.id)).toBe(true);
      expect(await service.runCommand(ref, "/reload")).toMatchObject({ type: "done" });
      expect(JSON.stringify(await service.messages(ref))).toContain("SDK compatibility complete");
      expect((await service.status(ref)).warnings ?? []).toEqual([]);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "session.error")).toEqual([]);
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it.each([
    { name: "default isolation", allowPrivileged: false, bash: false, network: false, hostFilesystem: false },
    { name: "ignored bash grant", allowPrivileged: false, bash: true, network: false, hostFilesystem: false },
    { name: "machine switch without a grant", allowPrivileged: true, bash: false, network: false, hostFilesystem: false },
    { name: "privileged bash", allowPrivileged: true, bash: true, network: false, hostFilesystem: true },
    { name: "network grant without host access", allowPrivileged: true, bash: false, network: true, hostFilesystem: false },
    { name: "full privileges", allowPrivileged: true, bash: true, network: true, hostFilesystem: true },
    { name: "full grants without machine opt-in", allowPrivileged: false, bash: true, network: true, hostFilesystem: false },
    { name: "full privileges with explicit denies", allowPrivileged: true, bash: true, network: true, hostFilesystem: true, deny: ["write", "bash", "extension_probe"] },
    { name: "refused full privileges with explicit denies", allowPrivileged: false, bash: true, network: true, hostFilesystem: false, deny: ["write", "bash", "extension_probe"] },
  ])("keeps managed skills and sandboxed bash scoped with $name", async ({ allowPrivileged, bash, network, hostFilesystem, deny }) => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-sdk-managed-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const projectSkill = join(cwd, ".pi", "skills", "relay", "SKILL.md");
    const projectRunner = join(cwd, ".pi", "skills", "relay-runner", "SKILL.md");
    await mkdir(join(cwd, ".pi", "skills", "relay"), { recursive: true });
    await mkdir(join(cwd, ".pi", "skills", "relay-runner"), { recursive: true });
    await mkdir(join(agentDir, "skills", "global-only"), { recursive: true });
    await mkdir(join(agentDir, "skills", "relay"), { recursive: true });
    await writeFile(projectSkill, "old project relay");
    await writeFile(projectRunner, "old project runner");
    await writeFile(join(agentDir, "skills", "global-only", "SKILL.md"), '---\nname: global-only\ndescription: Global only\n---\nPrivate global instructions\n');
    await writeFile(join(agentDir, "skills", "relay", "SKILL.md"), '---\nname: relay\ndescription: Global relay\n---\nPrivate global relay instructions\n');
    await writeFile(join(agentDir, "AGENTS.md"), "Private global context");
    const platformInstructions = "# Workbench read-only capabilities\nOnly use controlled workbench tools. PLATFORM_RESTRICTION_SENTINEL";
    await writeFile(join(cwd, "AGENTS.md"), platformInstructions);
    await mkdir(join(agentDir, "extensions"));
    await writeFile(join(agentDir, "extensions", "probe.ts"), `export default function (pi) {
      pi.registerTool({ name: "extension_probe", label: "Probe", description: "Resource probe: " + (process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"] ?? "default"),
        parameters: { type: "object", properties: {} },
        async execute() { return { content: [{ type: "text", text: "probe" }] }; }
      });
    }`);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url))] }));
    const modelRuntime = await createTestModelRuntime();
    const context = {
      ...testManagementContext(),
      projects: testManagementContext().projects.map((project) => ({ ...project, agentsInstructions: platformInstructions })),
      privileged: { bash, network },
      ...(deny === undefined ? {} : { tools: { allow: ["read"], deny } }),
    };
    let runtime: AgentSessionRuntime | undefined;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir, dataDir: join(root, "data"), archiveStore: emptyArchiveStore(), modelRuntime,
      managementAllowPrivileged: allowPrivileged,
      sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
      projectPathForCwd: () => Promise.resolve(cwd),
      subsessionsEnabled: true,
      spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd }) },
      createAgentRuntime: async (createRuntime, options) => {
        if (!(options.sessionManager instanceof SessionManager)) throw new Error("Expected the real SDK session manager");
        runtime = await createAgentSessionRuntime((next) => createRuntime({ ...next, managementContext: context }), {
          cwd: options.cwd, agentDir: options.agentDir, sessionManager: options.sessionManager,
        });
        return runtime;
      },
    });
    try {
      await service.start(cwd, { managementContext: context });
      const fullPrivileges = allowPrivileged && bash && network;
      const outsidePath = join(root, "outside.txt");
      if (deny !== undefined && !fullPrivileges) {
        for (const tool of deny) expect(runtime?.session.getActiveToolNames()).not.toContain(tool);
        expect(runtime?.session.getActiveToolNames()).toContain("read");
        expect(runtime?.session.systemPrompt).not.toContain("Private global context");
        expect(runtime?.session.systemPrompt).toContain("PLATFORM_RESTRICTION_SENTINEL");
        return;
      }
      const writeTool = runtime?.session.agent.state.tools.find((tool) => tool.name === "write");
      if (writeTool === undefined) throw new Error("Expected the real SDK write tool");
      if (fullPrivileges) {
        expect(runtime?.session.systemPrompt).not.toContain("PLATFORM_RESTRICTION_SENTINEL");
        expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(platformInstructions);
        expect(runtime?.session.getActiveToolNames()).toContain("extension_probe");
        expect(runtime?.session.getToolDefinition("extension_probe")?.description).toBe(`Resource probe: ${process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"] ?? "default"}`);
        expect(await readFile(projectSkill, "utf8")).toBe("old project relay");
        expect(await readFile(projectRunner, "utf8")).toBe("old project runner");
        expect(runtime?.services.resourceLoader.getSkills().skills.map((skill) => skill.name)).toContain("global-only");
        expect(runtime?.session.systemPrompt).toContain("Private global context");
        expect(runtime?.session.getToolDefinition("bash")?.description).not.toContain("sandbox");
        expect(runtime?.session.getToolDefinition("python")).toBeUndefined();
        await writeTool.execute("write-outside", { path: outsidePath, content: "full privilege sentinel" });
        expect(await readFile(outsidePath, "utf8")).toBe("full privilege sentinel");
        return;
      }
      await expect(writeTool.execute("write-outside", { path: outsidePath, content: "blocked" })).rejects.toThrow("path outside the managed project sandbox");
      expect(runtime?.session.getActiveToolNames()).not.toContain("extension_probe");
      expect(await readFile(projectSkill, "utf8")).toBe(await readFile(new URL("../../../skills/relay/SKILL.md", import.meta.url), "utf8"));
      expect(await readFile(projectRunner, "utf8")).toBe(await readFile(new URL("../../../skills/relay-runner/SKILL.md", import.meta.url), "utf8"));
      expect(runtime?.services.resourceLoader.getSkills().skills.map((skill) => skill.name).sort()).toEqual(["relay", "relay-runner"]);
      expect(runtime?.services.resourceLoader.getSkills().skills.map((skill) => skill.filePath)).toEqual(expect.arrayContaining([projectSkill, projectRunner]));
      expect(runtime?.services.resourceLoader.getSkills().diagnostics).toEqual([]);
      expect(runtime?.session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", "write", "python", "bash"]));
      const bashDefinition = runtime?.session.getToolDefinition("bash");
      expect(bashDefinition?.description).toContain(hostFilesystem ? "other host paths are read-only" : "Paths outside the project are blocked");
      expect(bashDefinition?.description).toContain(network && allowPrivileged ? "Network access is enabled" : "Network access is disabled");
      for (const tool of ["shell", "powershell", "terminal"]) {
        expect(runtime?.session.getActiveToolNames()).not.toContain(tool);
      }
      expect(runtime?.session.systemPrompt).not.toContain("Private global");
      if (runtime === undefined) throw new Error("Expected the managed SDK runtime");
      const list = vi.spyOn(service, "listSubsessions").mockResolvedValue([]);
      const check = vi.spyOn(service, "checkSubsession").mockResolvedValue({ sessionId: "child", cwd, status: "idle", finalText: "done", messageCount: 1 });
      const read = vi.spyOn(service, "readSubsession").mockResolvedValue({ sessionId: "child", cwd, status: "idle", entries: [], total: 0, matched: 0, start: 0, hasMore: false });
      for (const name of ["list_subsessions", "check_subsession", "read_subsession"]) {
        const tool = runtime.session.agent.state.tools.find((entry) => entry.name === name);
        if (tool === undefined) throw new Error(`Expected managed tool ${name}`);
        await tool.execute(`test-${name}`, { sessionId: "child" }, new AbortController().signal);
      }
      const parentId = runtime.session.sessionId;
      const parentFile = runtime.session.sessionFile;
      expect(list).toHaveBeenCalledWith(parentId, parentFile, context);
      expect(check).toHaveBeenCalledWith(parentId, "child", parentFile, context);
      expect(read).toHaveBeenCalledWith(parentId, "child", expect.any(Object), parentFile, context);
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
