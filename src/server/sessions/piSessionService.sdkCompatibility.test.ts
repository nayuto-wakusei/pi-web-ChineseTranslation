import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSessionRuntime, SessionManager, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
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

  it("force-syncs management Relay and keeps global skills and generic shell tools excluded", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-sdk-managed-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const projectSkill = join(cwd, ".pi", "skills", "relay", "SKILL.md");
    await mkdir(join(cwd, ".pi", "skills", "relay"), { recursive: true });
    await mkdir(join(agentDir, "skills", "global-only"), { recursive: true });
    await mkdir(join(agentDir, "skills", "relay"), { recursive: true });
    await writeFile(projectSkill, "old project relay");
    await writeFile(join(agentDir, "skills", "global-only", "SKILL.md"), '---\nname: global-only\ndescription: Global only\n---\nPrivate global instructions\n');
    await writeFile(join(agentDir, "skills", "relay", "SKILL.md"), '---\nname: relay\ndescription: Global relay\n---\nPrivate global relay instructions\n');
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url))] }));
    const modelRuntime = await createTestModelRuntime();
    const context = testManagementContext();
    let runtime: AgentSessionRuntime | undefined;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir, dataDir: join(root, "data"), archiveStore: emptyArchiveStore(), modelRuntime,
      sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
      projectPathForCwd: () => Promise.resolve(cwd),
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
      expect(await readFile(projectSkill, "utf8")).toBe(await readFile(new URL("../../../skills/relay/SKILL.md", import.meta.url), "utf8"));
      expect(runtime?.services.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["relay"]);
      expect(runtime?.services.resourceLoader.getSkills().skills[0]?.filePath).toBe(projectSkill);
      expect(runtime?.services.resourceLoader.getSkills().diagnostics).toEqual([]);
      expect(runtime?.session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", "write", "python"]));
      expect(runtime?.session.getActiveToolNames()).not.toEqual(expect.arrayContaining(["bash"]));
      expect(runtime?.session.systemPrompt).not.toContain("Private global");
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
