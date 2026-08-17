import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSessionEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { ensureManagedRelaySkill, filterManagedGlobalContextFiles, filterManagedProjectSkills, filterManagedWorkbenchSkills, PiSessionService, type PiAgentSession, type PiSessionManager, type PiSessionModelRuntime, type PiSessionRuntime, type PiSessionServiceDependencies } from "./piSessionService.js";
import type { SpawnTargetDecision } from "./spawnTargetResolver.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import { testExtensionUiContext } from "./piSessionService.testSupport.js";

class CapturingSessionEventHub extends SessionEventHub {
  readonly sessionEvents: { sessionId: string; event: SessionUiEvent; scope?: string }[] = [];
  readonly globalEvents: { event: GlobalSessionEvent; scope?: string }[] = [];

  override publish(sessionId: string, event: SessionUiEvent, scope?: string): void {
    super.publish(sessionId, event, scope);
    this.sessionEvents.push({ sessionId, event, ...(scope === undefined ? {} : { scope }) });
  }

  override publishGlobal(event: GlobalSessionEvent, scope?: string): void {
    this.globalEvents.push({ event, ...(scope === undefined ? {} : { scope }) });
  }
}

type SessionGateway = NonNullable<PiSessionServiceDependencies["sessionManager"]>;
type RuntimeCreator = NonNullable<PiSessionServiceDependencies["createAgentRuntime"]>;

interface TestSession extends PiAgentSession {
  sessionName: string | undefined;
  model: PiAgentSession["model"];
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  getSteeringMessages: () => readonly string[];
  getFollowUpMessages: () => readonly string[];
}

function fakeSessionManager(cwd = "/workspace", patch: Partial<PiSessionManager> = {}): PiSessionManager {
  return {
    getCwd: () => cwd,
    getSessionId: () => "test-session",
    getSessionFile: () => undefined,
    getBranch: () => [],
    getLeafId: () => "leaf-1",
    ...patch,
  };
}

function sessionRecord(id: string, cwd = "/workspace") {
  return { id, path: `/sessions/${id}.jsonl`, cwd, created: new Date("2026-01-01T00:00:00.000Z"), modified: new Date("2026-01-01T00:01:00.000Z"), messageCount: 0, firstMessage: "", allMessagesText: "" };
}

function sessionRef(id: string, cwd = "/workspace") {
  return { id, cwd };
}

function testManagementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}

function testModel(): NonNullable<PiAgentSession["model"]> {
  return {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  };
}

function fakeModelRuntime(configured = true): PiSessionModelRuntime {
  const model = testModel();
  return {
    refresh: () => Promise.resolve(),
    getAvailable: () => Promise.resolve(configured ? [model] : []),
    getModel: (provider: string, modelId: string) => provider === model.provider && modelId === model.id ? model : undefined,
    hasConfiguredAuth: (provider: string) => configured && provider === model.provider,
  };
}

function fakeRuntime(sessionId = "session-1", patch: Partial<TestSession> = {}) {
  const promptCalls: { text: string; options: unknown }[] = [];
  const customMessageCalls: { message: { customType: string; content: string; display: boolean; details?: unknown }; options: unknown }[] = [];
  const bindExtensionCalls: unknown[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const calls = { abort: 0, bindExtensions: bindExtensionCalls, clearQueue: 0, dispose: 0, prompt: promptCalls, reload: 0, sendCustomMessage: customMessageCalls };
  const session: TestSession = {
    sessionId,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    messages: [],
    state: {},
    sessionName: undefined,
    model: undefined,
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    sessionManager: fakeSessionManager(),
    modelRuntime: fakeModelRuntime(),
    settingsManager: { getWarnings: () => ({}), setWarnings: () => undefined },
    scopedModels: [],
    extensionRunner: { getRegisteredCommands: () => [], getUIContext: () => testExtensionUiContext, setUIContext: () => undefined },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    bindExtensions: (bindings: unknown) => {
      calls.bindExtensions.push(bindings);
      return Promise.resolve();
    },
    getSessionStats: () => ({ sessionId, totalMessages: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
    getContextUsage: () => undefined,
    reload: () => {
      calls.reload += 1;
      return Promise.resolve();
    },
    prompt: (text: string, options: unknown) => {
      calls.prompt.push({ text, options });
      return Promise.resolve();
    },
    sendCustomMessage: (message: { customType: string; content: string; display: boolean; details?: unknown }, options: unknown) => {
      calls.sendCustomMessage.push({ message, options });
      return Promise.resolve();
    },
    executeBash: () => Promise.resolve({ output: "", exitCode: 0, cancelled: false, truncated: false }),
    abort: () => {
      calls.abort += 1;
      return Promise.resolve();
    },
    clearQueue: () => {
      calls.clearQueue += 1;
      return { steering: [], followUp: [] };
    },
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    setModel: () => Promise.resolve(),
    cycleModel: () => Promise.resolve(undefined),
    getAvailableThinkingLevels: () => [],
    setThinkingLevel: () => undefined,
    cycleThinkingLevel: () => undefined,
    setSessionName: (name: string) => { session.sessionName = name; },
    compact: () => Promise.resolve({ summary: "", tokensBefore: 0 }),
    getUserMessagesForForking: () => [],
    agent: { streamFunction: () => { throw new Error("streamFunction should not be called in this test"); } },
    ...patch,
  };
  const runtime: PiSessionRuntime = {
    cwd: session.sessionManager.getCwd(),
    session,
    setRebindSession: () => undefined,
    fork: () => Promise.resolve({ cancelled: false }),
    dispose: () => {
      calls.dispose += 1;
      return Promise.resolve();
    },
  };
  return { runtime, session, calls, emit: (event: unknown) => { for (const listener of [...listeners]) listener(event); } };
}

function runtimeCreator(runtime: PiSessionRuntime): RuntimeCreator {
  return async () => {
    await Promise.resolve();
    return runtime;
  };
}

function sessionGateway(records: ReturnType<typeof sessionRecord>[]): SessionGateway {
  return {
    create: () => fakeSessionManager(),
    list: () => Promise.resolve(records),
    open: () => fakeSessionManager(),
  };
}

describe("filterManagedGlobalContextFiles", () => {
  it("removes global agent context files while keeping project context files", () => {
    const cwd = resolve("/home/user/PiWeb/project");
    const agentDir = resolve("/home/user/.pi/agent");
    const homeAgents = resolve("/home/user/AGENTS.md");
    const managedRootAgents = resolve("/home/user/PiWeb/AGENTS.md");
    const projectAgents = join(cwd, "AGENTS.md");
    const nestedAgents = join(cwd, "subdir/AGENTS.md");
    const unrelatedAgentFile = join(agentDir, "notes.md");

    const result = filterManagedGlobalContextFiles(cwd, agentDir, {
      agentsFiles: [
        { path: join(agentDir, "AGENTS.md"), content: "global agents" },
        { path: join(agentDir, "AGENTS.MD"), content: "global uppercase agents" },
        { path: join(agentDir, "CLAUDE.md"), content: "global claude" },
        { path: join(agentDir, "CLAUDE.MD"), content: "global uppercase claude" },
        { path: homeAgents, content: "home agents" },
        { path: managedRootAgents, content: "managed root agents" },
        { path: projectAgents, content: "project agents" },
        { path: nestedAgents, content: "nested agents" },
        { path: unrelatedAgentFile, content: "not context" },
      ],
    });

    expect(result.agentsFiles).toEqual([
      { path: projectAgents, content: "project agents" },
      { path: nestedAgents, content: "nested agents" },
      { path: unrelatedAgentFile, content: "not context" },
    ]);
  });
});

describe("filterManagedProjectSkills", () => {
  it("keeps project skills while removing global and package skills outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-skills-"));
    const cwd = join(root, "project");
    const projectSkillPath = join(cwd, ".pi/skills/project-skill/SKILL.md");
    const projectPackageSkillPath = join(cwd, ".pi/npm/node_modules/project-package/skills/package-skill/SKILL.md");
    const globalSkillPath = join(root, "agent/skills/global-skill/SKILL.md");
    const globalPackageSkillPath = join(root, "agent/npm/node_modules/global-package/skills/package-skill/SKILL.md");

    try {
      await Promise.all([projectSkillPath, projectPackageSkillPath, globalSkillPath, globalPackageSkillPath].map(async (filePath) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, "skill");
      }));
      const projectSkill = testSkill("project-skill", projectSkillPath, "project");
      const projectPackageSkill = testSkill("project-package-skill", projectPackageSkillPath, "temporary");
      const globalSkill = testSkill("global-skill", globalSkillPath, "user");
      const globalPackageSkill = testSkill("global-package-skill", globalPackageSkillPath, "user");

      const result = filterManagedProjectSkills(cwd, {
        skills: [globalSkill, projectSkill, globalPackageSkill, projectPackageSkill],
        diagnostics: [
          { type: "warning", message: "preserved diagnostic" },
          { type: "warning", message: "project diagnostic", path: projectSkillPath },
          {
            type: "collision",
            message: 'name "project-skill" collision',
            path: globalSkillPath,
            collision: {
              resourceType: "skill",
              name: "project-skill",
              winnerPath: projectSkillPath,
              loserPath: globalSkillPath,
            },
          },
        ],
      });

      expect(result).toEqual({
        skills: [projectSkill, projectPackageSkill],
        diagnostics: [
          { type: "warning", message: "preserved diagnostic" },
          { type: "warning", message: "project diagnostic", path: projectSkillPath },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureManagedRelaySkill", () => {
  it("adds the bundled relay skill when the project does not have one", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const bundledSkillPath = join(root, "bundled-relay", "SKILL.md");

    try {
      await Promise.all([
        mkdir(cwd, { recursive: true }),
        mkdir(dirname(bundledSkillPath), { recursive: true }),
      ]);
      await writeFile(bundledSkillPath, "bundled relay");

      const skillPath = await ensureManagedRelaySkill(cwd, bundledSkillPath);

      expect(skillPath).toBe(join(cwd, ".pi", "skills", "relay", "SKILL.md"));
      await expect(readFile(skillPath, "utf8")).resolves.toBe("bundled relay");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves an existing project relay skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const bundledSkillPath = join(root, "bundled-relay", "SKILL.md");
    const projectSkillPath = join(cwd, ".pi", "skills", "relay", "SKILL.md");

    try {
      await Promise.all([dirname(projectSkillPath), dirname(bundledSkillPath)].map((directory) => mkdir(directory, { recursive: true })));
      await Promise.all([
        writeFile(projectSkillPath, "project relay"),
        writeFile(bundledSkillPath, "bundled relay"),
      ]);

      await ensureManagedRelaySkill(cwd, bundledSkillPath);

      await expect(readFile(projectSkillPath, "utf8")).resolves.toBe("project relay");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a project skill directory that escapes through a junction", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const outside = join(root, "outside");
    const bundledSkillPath = join(root, "bundled-relay", "SKILL.md");

    try {
      await Promise.all([cwd, outside, dirname(bundledSkillPath)].map((directory) => mkdir(directory, { recursive: true })));
      await Promise.all([
        symlink(outside, join(cwd, ".pi"), "junction"),
        writeFile(bundledSkillPath, "bundled relay"),
      ]);

      await expect(ensureManagedRelaySkill(cwd, bundledSkillPath)).rejects.toThrow("Managed skill path is invalid");
      await expect(readFile(join(outside, "skills", "relay", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("filterManagedWorkbenchSkills", () => {
  it("keeps the project relay skill alongside Workbench-authorized skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-workbench-skills-"));
    const cwd = join(root, "project");
    const relayPath = join(cwd, ".pi", "skills", "relay", "SKILL.md");
    const authorizedPath = join(cwd, ".pi", "skills", "workbench-approved", "SKILL.md");
    const otherPath = join(cwd, ".pi", "skills", "other", "SKILL.md");

    try {
      await Promise.all([relayPath, authorizedPath, otherPath].map(async (filePath) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, "skill");
      }));
      const relay = testSkill("relay", relayPath, "project");
      const authorized = testSkill("approved", authorizedPath, "project");
      const other = testSkill("other", otherPath, "project");

      const result = filterManagedWorkbenchSkills(cwd, {
        skills: [relay, authorized, other],
        diagnostics: [
          {
            type: "collision",
            message: 'name "relay" collision',
            path: otherPath,
            collision: { resourceType: "skill", name: "relay", winnerPath: relayPath, loserPath: otherPath },
          },
        ],
      }, {
        authorizationRevision: 1,
        skills: [{ name: "approved", version: "1", directory: "workbench-approved", contentSha256: "hash", files: [], degradedCapabilities: [] }],
      });

      expect(result.skills).toEqual([relay, authorized]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function testSkill(name: string, filePath: string, scope: "user" | "project" | "temporary") {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: dirname(filePath),
    sourceInfo: { path: filePath, source: "test", scope, origin: "top-level" as const },
    disableModelInvocation: false,
  };
}

function emptyArchiveStore(): NonNullable<PiSessionServiceDependencies["archiveStore"]> {
  return {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(undefined),
    archive: () => Promise.reject(new Error("archive should not be called")),
    restore: () => Promise.resolve(),
    isArchived: () => Promise.resolve(false),
  };
}

describe("PiSessionService", () => {
  it("rejects normal session access when the cwd has no project registry", async () => {
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      normalModelRuntimeForCwd: () => Promise.reject(new Error("cwd 必须属于一个已注册项目")),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.list("/unregistered")).rejects.toThrow("已注册项目");
    await expect(service.start("/unregistered")).rejects.toThrow("已注册项目");
    await service.dispose();
  });

  it("starts sessions through an injected runtime creator", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime();
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      createCalls += 1;
      await Promise.resolve();
      return fake.runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    const session = await service.start("/workspace");

    expect(createCalls).toBe(1);
    expect(fake.calls.bindExtensions).toHaveLength(1);
    expect(session).toMatchObject({ id: "session-1", cwd: "/workspace", messageCount: 0 });
    expect(service.activeCount()).toBe(1);
    expect(hub.globalEvents.some(({ event }) => event.type === "status.update" && event.status.sessionId === "session-1")).toBe(true);
    expect(hub.globalEvents.some(({ event }) => event.type === "session.created" && event.session.id === "session-1" && event.session.cwd === "/workspace")).toBe(true);

    await service.dispose();
    expect(fake.calls.abort).toBe(1);
    expect(fake.calls.dispose).toBe(1);
  });

  it("refreshes model configuration before listing models", async () => {
    const model = testModel();
    let refreshed = false;
    const modelRuntime: PiSessionModelRuntime = {
      refresh: () => {
        refreshed = true;
        return Promise.resolve();
      },
      getAvailable: () => Promise.resolve(refreshed ? [model] : []),
      getModel: () => undefined,
      hasConfiguredAuth: () => true,
    };
    const fake = fakeRuntime("models-session", { modelRuntime });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: () => Promise.resolve(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("models-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.availableModels(sessionRef("models-session"))).resolves.toEqual([
      expect.objectContaining({ id: model.id, provider: model.provider }),
    ]);
    expect(refreshed).toBe(true);

    await service.dispose();
  });

  it("refreshes model configuration before selecting a model", async () => {
    const model = testModel();
    let refreshed = false;
    let selectedModel: typeof model | undefined;
    const modelRuntime: PiSessionModelRuntime = {
      refresh: () => {
        refreshed = true;
        return Promise.resolve();
      },
      getAvailable: () => Promise.resolve(refreshed ? [model] : []),
      getModel: () => undefined,
      hasConfiguredAuth: () => true,
    };
    const fake = fakeRuntime("set-model-session", {
      modelRuntime,
      setModel: (selected) => {
        selectedModel = selected;
        return Promise.resolve();
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: () => Promise.resolve(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("set-model-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.setModel(sessionRef("set-model-session"), model.provider, model.id);

    expect(refreshed).toBe(true);
    expect(selectedModel).toBe(model);
    await service.dispose();
  });

  it("passes management embed context into runtime creation", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime();
    const managementContext = testManagementContext();
    const createCalls: unknown[] = [];
    const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
      createCalls.push(options);
      await Promise.resolve();
      return fake.runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace", { managementContext });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({ managementContext });

    await service.dispose();
  });

  it("keeps an existing host-mode runtime while handling a managed prompt in a separate runtime", async () => {
    const hub = new CapturingSessionEventHub();
    const hostRuntime = fakeRuntime("managed-session");
    const managedRuntime = fakeRuntime("managed-session");
    const createCalls: unknown[] = [];
    const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
      createCalls.push(options);
      await Promise.resolve();
      return createCalls.length === 1 ? hostRuntime.runtime : managedRuntime.runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("managed-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("managed-session"));
    await service.prompt(sessionRef("managed-session"), "Build the thing", undefined, undefined, { managementContext: testManagementContext() });

    expect(hostRuntime.calls.abort).toBe(0);
    expect(hostRuntime.calls.dispose).toBe(0);
    expect(managedRuntime.calls.prompt).toEqual([{ text: "Build the thing", options: undefined }]);
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).not.toHaveProperty("managementContext");
    expect(createCalls[1]).toHaveProperty("managementContext");
    expect(service.activeCount()).toBe(2);

    await service.dispose();
  });

  it("keeps an existing host-mode runtime while reading managed thinking levels from a separate runtime", async () => {
    const hub = new CapturingSessionEventHub();
    const hostRuntime = fakeRuntime("managed-session");
    const managedRuntime = fakeRuntime("managed-session", { getAvailableThinkingLevels: () => ["off", "medium"] });
    const createCalls: unknown[] = [];
    const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
      createCalls.push(options);
      await Promise.resolve();
      return createCalls.length === 1 ? hostRuntime.runtime : managedRuntime.runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("managed-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("managed-session"));
    await expect(service.availableThinkingLevels(sessionRef("managed-session"), testManagementContext())).resolves.toEqual(["off", "medium"]);

    expect(hostRuntime.calls.abort).toBe(0);
    expect(hostRuntime.calls.dispose).toBe(0);
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).not.toHaveProperty("managementContext");
    expect(createCalls[1]).toHaveProperty("managementContext");
    expect(service.activeCount()).toBe(2);

    await service.dispose();
  });

  it("aborts only the runtime for the requested session scope", async () => {
    const hub = new CapturingSessionEventHub();
    const hostRuntime = fakeRuntime("managed-session");
    const managedRuntime = fakeRuntime("managed-session");
    const createCalls: unknown[] = [];
    const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
      createCalls.push(options);
      await Promise.resolve();
      return createCalls.length === 1 ? hostRuntime.runtime : managedRuntime.runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("managed-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const managementContext = testManagementContext();

    await service.status(sessionRef("managed-session"));
    await service.status(sessionRef("managed-session"), managementContext);
    await service.abort(sessionRef("managed-session"), managementContext);

    expect(hostRuntime.calls.abort).toBe(0);
    expect(managedRuntime.calls.abort).toBe(1);

    await service.dispose();
  });

  it("reloads only the runtime for the requested session scope", async () => {
    const hub = new CapturingSessionEventHub();
    const hostRuntime = fakeRuntime("managed-session");
    const firstManagedRuntime = fakeRuntime("managed-session");
    const secondManagedRuntime = fakeRuntime("managed-session");
    const runtimes = [hostRuntime.runtime, firstManagedRuntime.runtime, secondManagedRuntime.runtime];
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      await Promise.resolve();
      const runtime = runtimes[createCalls];
      createCalls += 1;
      if (runtime === undefined) throw new Error("unexpected runtime creation");
      return runtime;
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("managed-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const managementContext = testManagementContext();

    await service.status(sessionRef("managed-session"));
    await service.status(sessionRef("managed-session"), managementContext);
    await service.reload(sessionRef("managed-session"), managementContext);

    expect(hostRuntime.calls.abort).toBe(0);
    expect(hostRuntime.calls.dispose).toBe(0);
    expect(firstManagedRuntime.calls.abort).toBe(1);
    expect(firstManagedRuntime.calls.dispose).toBe(1);
    expect(secondManagedRuntime.calls.abort).toBe(0);
    expect(service.activeCount()).toBe(2);

    await service.dispose();
  });

  it("reports persistence from actual session-file existence for fresh active sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-persisted-"));
    const sessionFile = join(dir, "new-session.jsonl");
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("new-session", { sessionFile });
    let service: PiSessionService | undefined;
    try {
      service = new PiSessionService(hub, {
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([]),
        heartbeatIntervalMs: 60_000,
      });

      const session = await service.start("/workspace");
      const createdEvent = hub.globalEvents.find(({ event }) => event.type === "session.created")?.event;

      expect(session).toMatchObject({ id: "new-session", path: sessionFile, persisted: false });
      expect(createdEvent).toMatchObject({ type: "session.created", session: { id: "new-session", persisted: false } });
      await expect(service.status(sessionRef("new-session"))).resolves.toMatchObject({ sessionId: "new-session", persisted: false });

      await writeFile(sessionFile, '{"type":"session","id":"new-session"}\n', "utf8");

      await expect(service.status(sessionRef("new-session"))).resolves.toMatchObject({ sessionId: "new-session", persisted: true });
    } finally {
      await service?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("opens legacy id-only lookups from the default session store gateway", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("legacy-session");
    const open = vi.fn(() => fakeSessionManager());
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([]),
        listAll: () => Promise.resolve([sessionRecord("legacy-session")]),
        open,
      },
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status("legacy")).resolves.toMatchObject({ sessionId: "legacy-session" });
    expect(open).toHaveBeenCalledWith("/sessions/legacy-session.jsonl");

    await service.dispose();
  });

  it("binds extensions again when the SDK runtime replaces the active session", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("session-1");
    const replacement = fakeRuntime("session-2");
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    fake.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    Object.defineProperty(fake.runtime, "session", { configurable: true, value: replacement.session });
    await rebindSession?.(replacement.session);

    expect(fake.calls.bindExtensions).toHaveLength(1);
    expect(replacement.calls.bindExtensions).toHaveLength(1);
    expect(service.activeCount()).toBe(1);
    expect(await service.status("session-2")).toMatchObject({ sessionId: "session-2" });

    await service.dispose();
  });

  it("publishes extension errors reported while binding session extensions", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("extension-session", {
      bindExtensions: (bindings) => {
        bindings.onError?.({ extensionPath: "pi-mcp-adapter", event: "session_start", error: "MCP failed" });
        return Promise.resolve();
      },
    });
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");

    expect(hub.sessionEvents).toContainEqual({
      sessionId: "extension-session",
      event: { type: "session.error", message: "pi-mcp-adapter: MCP failed" },
      scope: "normal",
    });
    const extensionErrorActivity = hub.globalEvents.find(({ event }) => event.type === "activity.update" && event.activity.sessionId === "extension-session");
    expect(extensionErrorActivity?.event).toMatchObject({
      type: "activity.update",
      activity: { sessionId: "extension-session", phase: "error", label: "扩展错误", detail: "pi-mcp-adapter: MCP failed" },
    });

    await service.dispose();
  });

  it("clears stale active activity once a previously active session becomes idle", async () => {
    vi.useFakeTimers();
    let service: PiSessionService | undefined;
    try {
      const hub = new CapturingSessionEventHub();
      let listener: ((event: unknown) => void) | undefined;
      const fake = fakeRuntime("idle-session", {
        isStreaming: true,
        subscribe: (next) => {
          listener = next;
          return () => undefined;
        },
      });
      service = new PiSessionService(hub, {
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("idle-session")]),
        heartbeatIntervalMs: 1_000,
      });

      await service.status(sessionRef("idle-session"));
      hub.globalEvents.length = 0;
      listener?.({ type: "agent_start" });

      const activityPhases = () => hub.globalEvents
        .filter((entry): entry is { event: Extract<GlobalSessionEvent, { type: "activity.update" }>; scope?: string } => entry.event.type === "activity.update")
        .map(({ event }) => event.activity.phase);
      expect(activityPhases()).toEqual(["active"]);

      fake.session.isStreaming = false;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(activityPhases()).toEqual(["active", "idle"]);
    } finally {
      await service?.dispose();
      vi.useRealTimers();
    }
  });

  it("publishes idle activity for SDK completion events", async () => {
    const hub = new CapturingSessionEventHub();
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("completion-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("completion-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("completion-session"));
    hub.globalEvents.length = 0;
    listener?.({ type: "tool_execution_end", toolName: "read", isError: false });

    expect(hub.globalEvents.filter(({ event }) => event.type === "activity.update").map(({ event }) => event)).toMatchObject([
      { activity: { sessionId: "completion-session", phase: "idle", label: "工具执行完成", detail: "read" } },
    ]);

    await service.dispose();
  });

  it("audits ordinary-mode tool execution without arguments or results", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("audit-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const normalToolAudit = { record: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("audit-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit,
    });

    await service.status(sessionRef("audit-session"));
    listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: { token: "secret" } });
    listener?.({ type: "tool_execution_end", toolName: "read", toolCallId: "call-1", isError: false, result: "private result" });

    expect(logger.info).toHaveBeenNthCalledWith(1, {
      mode: "normal",
      sessionId: "audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      status: "started",
    }, "Pi tool execution audit");
    expect(logger.info).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: "normal", status: "completed" }), "Pi tool execution audit");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private result");
    expect(normalToolAudit.record).toHaveBeenCalledTimes(2);
    expect(normalToolAudit.record).toHaveBeenLastCalledWith({
      sessionId: "audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      status: "completed",
    });

    await service.dispose();
  });

  it("writes management-mode tool arguments and results only to Elasticsearch audit", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("managed-audit-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const normalToolAudit = { record: vi.fn() };
    const managementAudit = { record: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("managed-audit-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit,
      managementAudit,
      managementProjectIdForCwd: vi.fn().mockResolvedValue("matched-project"),
    });

    const managementContext = testManagementContext();
    managementContext.user.displayName = "测试用户";
    await service.status(sessionRef("managed-audit-session"), managementContext);
    listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: { path: "/workspace/file.txt" } });
    listener?.({ type: "tool_execution_end", toolName: "read", toolCallId: "call-1", isError: false, result: { content: [{ type: "text", text: "file body" }] } });

    expect(normalToolAudit.record).not.toHaveBeenCalled();
    expect(managementAudit.record).toHaveBeenNthCalledWith(1, {
      action: "tool_execution",
      status: "started",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      content: { path: "/workspace/file.txt" },
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(2, {
      action: "tool_execution",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      content: { content: [{ type: "text", text: "file body" }] },
    });
    await service.prompt(
      sessionRef("managed-audit-session"),
      "用户的完整问题",
      undefined,
      undefined,
      { managementContext },
    );
    listener?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "模型的完整回复" },
        ],
      },
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(3, {
      action: "user_prompt",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      content: "用户的完整问题",
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(4, {
      action: "assistant_response",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      content: {
        role: "assistant",
        content: [{ type: "text", text: "模型的完整回复" }],
      },
    });
    expect(JSON.stringify(managementAudit.record.mock.calls)).not.toContain("private reasoning");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ mode: "management", userId: "account-1", userDisplayName: "测试用户", projectId: "matched-project" }), "Pi tool execution audit");
    await service.dispose();
  });

  it("keeps ordinary tool execution running when SQLite audit persistence fails", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("audit-failure-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("audit-failure-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit: { record() { throw new Error("database unavailable"); } },
    });

    await service.status(sessionRef("audit-failure-session"));
    expect(() => { listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1" }); }).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith({
      sessionId: "audit-failure-session",
      toolCallId: "call-1",
      error: "database unavailable",
    }, "failed to persist ordinary-mode tool audit");
    await service.dispose();
  });

  it("localizes realtime session activity events", async () => {
    const hub = new CapturingSessionEventHub();
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("response-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("response-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("response-session"));
    const cases = [
      [{ type: "agent_start" }, "active", "代理正在运行"],
      [{ type: "agent_end" }, "idle", "空闲"],
      [{ type: "turn_end" }, "idle", "本轮已完成"],
      [{ type: "message_start" }, "active", "消息开始处理"],
      [{ type: "message_end" }, "idle", "消息处理完成"],
      [{ type: "message_update" }, "active", "正在接收回复"],
      [{ type: "tool_execution_start", toolName: "read" }, "active", "正在运行工具", "read"],
      [{ type: "tool_execution_end", toolName: "read", isError: false }, "idle", "工具执行完成", "read"],
      [{ type: "tool_execution_end", toolName: "read", isError: true }, "error", "工具执行失败", "read"],
      [{ type: "bash_execution_start" }, "active", "正在运行命令"],
      [{ type: "bash_execution_end" }, "idle", "命令执行完成"],
    ] as const;

    for (const [event, phase, label, detail] of cases) {
      hub.globalEvents.length = 0;
      listener?.(event);
      const activity = hub.globalEvents.find(({ event: published }) => published.type === "activity.update");
      expect(activity?.event).toMatchObject({
        activity: { sessionId: "response-session", phase, label, ...(detail === undefined ? {} : { detail }) },
      });
    }

    fake.session.isStreaming = true;
    hub.globalEvents.length = 0;
    listener?.({ type: "resource_update" });
    const fallbackActivity = hub.globalEvents.find(({ event }) => event.type === "activity.update");
    expect(fallbackActivity?.event).toMatchObject({ activity: { sessionId: "response-session", phase: "active", label: "正在处理" } });

    await service.dispose();
  });

  it("uses injected archive and session-manager gateways for listing", async () => {
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z" }]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.resolve({ sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z" }),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([
          { ...sessionRecord("active"), messageCount: 1, firstMessage: "hello", allMessagesText: "hello" },
          { ...sessionRecord("archived"), messageCount: 2, firstMessage: "bye", allMessagesText: "bye" },
        ]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    const sessions = await service.list("/workspace");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ id: "active", persisted: true });
    expect(sessions[0]?.archived).toBeUndefined();
    expect(sessions[1]).toMatchObject({ id: "archived", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" });

    await service.dispose();
  });

  it("lists archived records that have been moved out of the active session directory", async () => {
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", originalPath: "/sessions/archived.jsonl", archivePath: "/archive/archived.jsonl", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 2, firstMessage: "bye" }]),
        get: () => Promise.resolve(undefined),
        archive: () => { throw new Error("archive should not be called for moved records"); },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([{ ...sessionRecord("active"), messageCount: 1, firstMessage: "hello", allMessagesText: "hello" }]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    const sessions = await service.list("/workspace");

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ id: "active" });
    expect(sessions[0]?.archived).toBeUndefined();
    expect(sessions[1]).toMatchObject({ id: "archived", path: "/sessions/archived.jsonl", archived: true, archivedAt: "2026-01-02T00:00:00.000Z" });

    await service.dispose();
  });

  it("archives a session subtree within the root workspace", async () => {
    const archivedInputs: string[] = [];
    const root = sessionRecord("root");
    const directChild = { ...sessionRecord("direct-child"), path: "/sessions/direct-child.jsonl", parentSessionPath: root.path };
    const archivedChild = { ...sessionRecord("archived-child"), path: "/sessions/archived-child.jsonl", parentSessionPath: root.path };
    const grandchild = { ...sessionRecord("grandchild"), path: "/sessions/grandchild.jsonl", parentSessionPath: archivedChild.path };
    const otherWorkspaceChild = { ...sessionRecord("other-child", "/other"), path: "/sessions/other-child.jsonl", parentSessionPath: root.path };
    const fake = fakeRuntime("root", { sessionFile: root.path });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived-child", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", originalPath: archivedChild.path, archivePath: "/archive/archived-child.jsonl", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 1, firstMessage: "archived", parentSessionPath: root.path }]),
        get: () => Promise.resolve(undefined),
        archive: (input) => {
          archivedInputs.push(input.sessionId);
          return Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" });
        },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: (cwd) => Promise.resolve(cwd === "/workspace" ? [root, directChild, archivedChild, grandchild] : [otherWorkspaceChild]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.archiveTree(sessionRef("root"))).resolves.toEqual({
      archived: true,
      sessionIds: ["root", "direct-child", "grandchild"],
      archivedCount: 3,
      skippedAlreadyArchivedCount: 1,
    });
    expect(archivedInputs).toEqual(["root", "direct-child", "grandchild"]);

    await service.dispose();
  });

  it("permanently deletes archived sessions through the archive store", async () => {
    const deletedSessionIds: string[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([]),
        get: (sessionId) => Promise.resolve(sessionId === "archived" || "archived".startsWith(sessionId)
          ? { sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/archived.jsonl" }
          : undefined),
        archive: () => { throw new Error("archive should not be called for records that already have archive files"); },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
        deleteArchived: (sessionId) => {
          deletedSessionIds.push(sessionId);
          return Promise.resolve();
        },
      },
      sessionManager: sessionGateway([sessionRecord("active")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.deleteArchived("arch")).resolves.toBeUndefined();
    await expect(service.deleteArchived("active")).rejects.toThrow("未找到已归档会话");

    expect(deletedSessionIds).toEqual(["archived"]);
    await service.dispose();
  });

  it("bulk archives inactive sessions by cwd without opening runtimes", async () => {
    const recordsByCwd = new Map([
      ["/one", [sessionRecord("a", "/one"), sessionRecord("b", "/one")]],
      ["/two", [sessionRecord("c", "/two")]],
    ]);
    const listCalls: string[] = [];
    const open = vi.fn(() => { throw new Error("bulk archive should not open inactive runtimes"); });
    const archiveMany = vi.fn((inputs: readonly { sessionId: string; cwd: string }[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }))));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        archive: (input) => Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }),
        archiveMany,
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: (cwd) => {
          listCalls.push(cwd);
          return Promise.resolve(recordsByCwd.get(cwd) ?? []);
        },
        open,
      },
      heartbeatIntervalMs: 60_000,
    });

    const result = await service.archiveMany([{ id: "a", cwd: "/one" }, { id: "b", cwd: "/one" }, { id: "c", cwd: "/two" }]);

    expect(result).toMatchObject({ archived: true, archivedSessionIds: ["a", "b", "c"], failures: [] });
    expect(listCalls).toEqual(["/one", "/two"]);
    expect(open).not.toHaveBeenCalled();
    expect(archiveMany).toHaveBeenCalledTimes(1);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["a", "b", "c"]);
    await service.dispose();
  });

  it("bulk archive reports per-session failures without aborting other archives", async () => {
    const busy = fakeRuntime("busy", { isStreaming: true });
    let createCalls = 0;
    const archiveMany = vi.fn((inputs: readonly { sessionId: string; cwd: string }[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }))));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: () => {
        createCalls += 1;
        return Promise.resolve(busy.runtime);
      },
      archiveStore: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        archive: (input) => Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }),
        archiveMany,
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([sessionRecord("busy"), sessionRecord("ok")]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("busy"));
    const result = await service.archiveMany([{ id: "busy", cwd: "/workspace" }, { id: "ok", cwd: "/workspace" }, { id: "missing", cwd: "/workspace" }]);

    expect(createCalls).toBe(1);
    expect(busy.calls.abort).toBe(0);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["ok"]);
    expect(result.archivedSessionIds).toEqual(["ok"]);
    expect(result.failures).toEqual([
      { sessionId: "busy", error: "Stop current session activity before archiving" },
      { sessionId: "missing", error: "Session not found" },
    ]);
    await service.dispose();
  });

  it("bulk deletes only archived sessions and skips busy active archived runtimes", async () => {
    const busyRecord = { sessionId: "busy-archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/busy.jsonl" };
    const idleRecord = { sessionId: "idle-archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/idle.jsonl" };
    const busy = fakeRuntime("busy-archived", { isStreaming: true });
    const deleteArchivedMany = vi.fn((sessionIds: readonly string[]) => Promise.resolve([...sessionIds]));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(busy.runtime),
      archiveStore: {
        list: () => Promise.resolve([busyRecord, idleRecord]),
        get: (sessionId) => Promise.resolve(sessionId === "busy-archived" ? busyRecord : undefined),
        archive: () => { throw new Error("archive should not be called for records that already have archive files"); },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
        deleteArchived: () => Promise.resolve(),
        deleteArchivedMany,
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([sessionRecord("unarchived")]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("busy-archived"));
    const result = await service.deleteArchivedMany([{ id: "busy-archived", cwd: "/workspace" }, { id: "idle-archived", cwd: "/workspace" }, { id: "unarchived", cwd: "/workspace" }]);

    expect(busy.calls.abort).toBe(0);
    expect(deleteArchivedMany).toHaveBeenCalledWith(["idle-archived"]);
    expect(result.deletedSessionIds).toEqual(["idle-archived"]);
    expect(result.failures).toEqual([
      { sessionId: "busy-archived", error: "Stop current session activity before deleting archived session" },
      { sessionId: "unarchived", error: "Archived session not found" },
    ]);
    await service.dispose();
  });

  it("bulk delete moves legacy archived records with one workspace scan before deleting", async () => {
    const archiveMany = vi.fn((inputs: readonly { sessionId: string; cwd: string }[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z", archivePath: `/archive/${input.sessionId}.jsonl` }))));
    const deleteArchivedMany = vi.fn((sessionIds: readonly string[]) => Promise.resolve([...sessionIds]));
    const listCalls: string[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([
          { sessionId: "legacy-a", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z" },
          { sessionId: "legacy-b", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z" },
          { sessionId: "moved", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/moved.jsonl" },
        ]),
        get: () => Promise.resolve(undefined),
        archive: (input) => Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }),
        archiveMany,
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
        deleteArchived: () => Promise.resolve(),
        deleteArchivedMany,
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: (cwd) => {
          listCalls.push(cwd);
          return Promise.resolve([sessionRecord("legacy-a"), sessionRecord("legacy-b"), sessionRecord("unarchived")]);
        },
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    const result = await service.deleteArchivedMany([{ id: "legacy-a", cwd: "/workspace" }, { id: "legacy-b", cwd: "/workspace" }, { id: "moved", cwd: "/workspace" }]);

    expect(listCalls).toEqual(["/workspace"]);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["legacy-a", "legacy-b"]);
    expect(deleteArchivedMany).toHaveBeenCalledWith(["legacy-a", "legacy-b", "moved"]);
    expect(result.deletedSessionIds).toEqual(["legacy-a", "legacy-b", "moved"]);
    expect(result.failures).toEqual([]);
    await service.dispose();
  });

  it("previews session cleanup without mutating and executes a recomputed plan", async () => {
    const archivedInputs: string[] = [];
    const deletedSessionIds: string[] = [];
    let listAllCalls = 0;
    const archived = { sessionId: "archived-old", cwd: "/old-project", archivedAt: "2026-04-01T00:00:00.000Z", archivePath: "/archive/archived-old.jsonl" };
    const otherArchived = { sessionId: "archived-other", cwd: "/other-project", archivedAt: "2026-04-01T00:00:00.000Z", archivePath: "/archive/archived-other.jsonl" };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      archiveStore: {
        list: () => Promise.resolve([archived, otherArchived]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("cleanup should use archiveMany")),
        archiveMany: (inputs) => {
          archivedInputs.push(...inputs.map((input) => input.sessionId));
          return Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-06-25T00:00:00.000Z" })));
        },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
        deleteArchived: () => Promise.reject(new Error("cleanup should use deleteArchivedMany")),
        deleteArchivedMany: (sessionIds) => {
          deletedSessionIds.push(...sessionIds);
          return Promise.resolve([...sessionIds]);
        },
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([]),
        listAll: () => {
          listAllCalls += 1;
          return Promise.resolve([
            listAllCalls === 1 ? sessionRecord("preview-only", "/old-project") : sessionRecord("execute-only", "/old-project"),
            listAllCalls === 1 ? sessionRecord("preview-other", "/other-project") : sessionRecord("execute-other", "/other-project"),
          ]);
        },
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    const preview = await service.cleanupPreview({ thresholds: { archiveIdleDays: 30, deleteArchivedDays: 30 }, projectCwds: ["/old-project"] });
    expect(preview.totals).toEqual({ archiveCount: 1, deleteCount: 1 });
    expect(preview.projects).toEqual([{ cwd: "/old-project", archiveCount: 1, deleteCount: 1 }]);
    expect(archivedInputs).toEqual([]);
    expect(deletedSessionIds).toEqual([]);

    const result = await service.cleanup({ thresholds: { archiveIdleDays: 30, deleteArchivedDays: 30 }, projectCwds: ["/old-project"] });
    expect(result.archivedSessionIds).toEqual(["execute-only"]);
    expect(result.deletedSessionIds).toEqual(["archived-old"]);
    expect(archivedInputs).toEqual(["execute-only"]);
    expect(deletedSessionIds).toEqual(["archived-old"]);

    await service.dispose();
  });

  it("moves legacy cleanup delete records with one workspace scan before batch deleting", async () => {
    const listCalls: string[] = [];
    const archiveMany = vi.fn((inputs: readonly { sessionId: string; cwd: string }[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-06-25T00:00:00.000Z", archivePath: `/archive/${input.sessionId}.jsonl` }))));
    const deleteArchivedMany = vi.fn((sessionIds: readonly string[]) => Promise.resolve([...sessionIds]));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      archiveStore: {
        list: () => Promise.resolve([
          { sessionId: "legacy-a", cwd: "/old-project", archivedAt: "2026-04-01T00:00:00.000Z" },
          { sessionId: "legacy-b", cwd: "/old-project", archivedAt: "2026-04-01T00:00:00.000Z" },
        ]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("cleanup should use archiveMany")),
        archiveMany,
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
        deleteArchived: () => Promise.reject(new Error("cleanup should use deleteArchivedMany")),
        deleteArchivedMany,
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: (cwd) => {
          listCalls.push(cwd);
          return Promise.resolve([sessionRecord("legacy-a", cwd), sessionRecord("legacy-b", cwd)]);
        },
        listAll: () => Promise.resolve([]),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    const result = await service.cleanup({ thresholds: { deleteArchivedDays: 30 }, projectCwds: ["/old-project"] });

    expect(listCalls).toEqual(["/old-project"]);
    expect(archiveMany).toHaveBeenCalledTimes(1);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["legacy-a", "legacy-b"]);
    expect(deleteArchivedMany).toHaveBeenCalledWith(["legacy-a", "legacy-b"]);
    expect(result.deletedSessionIds).toEqual(["legacy-a", "legacy-b"]);

    await service.dispose();
  });

  it("skips busy active sessions during cleanup execution", async () => {
    const fake = fakeRuntime("busy-open", { isStreaming: true, sessionManager: fakeSessionManager("/old-project"), sessionFile: "/sessions/busy-open.jsonl" });
    const archivedInputs: string[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      createAgentRuntime: runtimeCreator(fake.runtime),
      archiveStore: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        archive: (input) => {
          archivedInputs.push(input.sessionId);
          return Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-06-25T00:00:00.000Z" });
        },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager("/old-project"),
        list: () => Promise.resolve([sessionRecord("busy-open", "/old-project")]),
        listAll: () => Promise.resolve([sessionRecord("busy-open", "/old-project")]),
        open: () => fakeSessionManager("/old-project"),
      },
      heartbeatIntervalMs: 60_000,
    });

    await service.status("busy-open");
    const result = await service.cleanup({ thresholds: { archiveIdleDays: 1 } });

    expect(result.archivedSessionIds).toEqual([]);
    expect(result.skippedBusySessionIds).toEqual(["busy-open"]);
    expect(archivedInputs).toEqual([]);
    expect(fake.calls.abort).toBe(0);

    await service.dispose();
  });

  it("runs /reload by refreshing the active runtime resources in place", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("runtime-reload-session");
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("runtime-reload-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.runCommand(sessionRef("runtime-reload-session"), "/reload")).resolves.toEqual({
      type: "done",
      message: "会话运行时资源已重新加载。扩展、技能、提示词模板、主题以及上下文/系统提示词文件已刷新；PI WEB 浏览器插件变更仍需另行刷新浏览器页面。",
    });

    expect(fake.calls.reload).toBe(1);
    expect(fake.calls.abort).toBe(0);
    expect(fake.calls.dispose).toBe(0);
    expect(hub.globalEvents.some(({ event }) => event.type === "activity.update" && event.activity.sessionId === "runtime-reload-session" && event.activity.label === "资源已重新加载")).toBe(true);
    expect(hub.globalEvents.some(({ event }) => event.type === "status.update" && event.status.sessionId === "runtime-reload-session")).toBe(true);

    await service.dispose();
  });

  it("reloads a session by closing the active runtime and re-opening it from disk", async () => {
    const first = fakeRuntime("reload-session");
    const second = fakeRuntime("reload-session");
    const runtimes = [first.runtime, second.runtime];
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      await Promise.resolve();
      const runtime = runtimes[createCalls];
      createCalls += 1;
      if (runtime === undefined) throw new Error("unexpected runtime creation");
      return runtime;
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("reload-session")]),
      heartbeatIntervalMs: 60_000,
    });

    // Open once so there is an active runtime to reload.
    await service.status(sessionRef("reload-session"));
    expect(createCalls).toBe(1);

    await expect(service.reload(sessionRef("reload-session"))).resolves.toBeUndefined();

    // The original runtime was torn down and a fresh one opened from disk.
    expect(first.calls.abort).toBe(1);
    expect(first.calls.dispose).toBe(1);
    expect(createCalls).toBe(2);
    expect(service.activeCount()).toBe(1);

    await service.dispose();
  });

  it("refuses to reload a session that has active work in progress", async () => {
    const fake = fakeRuntime("busy-session", { isStreaming: true });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("busy-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.reload(sessionRef("busy-session"))).rejects.toThrow("重新加载前请先停止当前会话活动");
    expect(fake.calls.abort).toBe(0);
    expect(fake.calls.dispose).toBe(0);

    await service.dispose();
  });

  it("refuses to reload an archived session", async () => {
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([]),
        get: (sessionId) => Promise.resolve(sessionId === "archived" || "archived".startsWith(sessionId)
          ? { sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/archived.jsonl" }
          : undefined),
        archive: () => Promise.resolve({ sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z" }),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(true),
      },
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.reload(sessionRef("archived"))).rejects.toThrow("已归档会话为只读");

    await service.dispose();
  });

  it("reconciles workspace activity when listing only archived sessions", async () => {
    const reconciliations: { cwd: string; sessionIds: string[] }[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", originalPath: "/sessions/archived.jsonl", archivePath: "/archive/archived.jsonl", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 2, firstMessage: "bye" }]),
        get: () => Promise.resolve(undefined),
        archive: () => { throw new Error("archive should not be called for moved records"); },
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([]),
        open: () => fakeSessionManager(),
      },
      workspaceActivity: {
        applySessionStatus: () => undefined,
        applySessionActivity: () => undefined,
        removeSession: () => undefined,
        reconcileSessionActivity: (cwd, sessionIds) => { reconciliations.push({ cwd, sessionIds: [...sessionIds] }); },
      },
      heartbeatIntervalMs: 60_000,
    });

    const sessions = await service.list("/workspace");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "archived", archived: true });
    expect(reconciliations).toEqual([{ cwd: "/workspace", sessionIds: [] }]);

    await service.dispose();
  });

  it("sends prompts to an injected runtime without touching the SDK runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("prompt-session"), "Build the thing");

    expect(fake.calls.prompt).toEqual([{ text: "Build the thing", options: undefined }]);
    await service.dispose();
  });

  it("echoes the user message for direct prompts but not command-forwarded ones", async () => {
    const fake = fakeRuntime("echo-session", {
      resourceLoader: { getSkills: () => ({ skills: [{ name: "skill-creator" }] }) },
    });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("echo-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("echo-session"), "Build the thing");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);

    // The client optimistically renders command-forwarded prompts (e.g. /skill:*),
    // so the server must not publish a second copy via message.append.
    await service.runCommand(sessionRef("echo-session"), "/skill:skill-creator");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
    expect(fake.calls.prompt).toEqual([
      { text: "Build the thing", options: undefined },
      { text: "/skill:skill-creator", options: undefined },
    ]);

    await service.dispose();
  });

  it("rejects malformed prompt text before opening the runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      createCalls += 1;
      await Promise.resolve();
      return fake.runtime;
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.prompt("prompt-session", undefined)).rejects.toThrow("提示文本为必填项");

    expect(createCalls).toBe(0);
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("generates a session name for the first prompt via the session's agent.streamFunction", async () => {
    const model = testModel();
    const streamCalls: unknown[] = [];
    const streamFn: StreamFn = (streamModel, context, options) => {
      streamCalls.push({ streamModel, context, options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Fix login bug" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("name-session", { model, agent: { streamFunction: streamFn } });
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("name-session"), "Please fix the login bug");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Fix login bug"); });

    expect(streamCalls).toHaveLength(1);
    expect(hub.sessionEvents.some(({ event }) => event.type === "session.name" && event.name === "Fix login bug")).toBe(true);
    await service.dispose();
  });

  it("includes queued message details in session status", async () => {
    const fake = fakeRuntime("status-session", {
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      pendingMessageCount: 2,
      getSteeringMessages: () => ["adjust this turn"],
      getFollowUpMessages: () => ["then do this"],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("status-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status(sessionRef("status-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "adjust this turn" }, { kind: "followUp", text: "then do this" }],
      messageCount: 2,
    });
    await service.dispose();
  });

  it("does not enqueue duplicate queued message text", async () => {
    const fake = fakeRuntime("dedupe-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getFollowUpMessages: () => ["already queued"],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("dedupe-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("dedupe-session"), "already queued", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("does not append queued prompts to the transcript before delivery", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("queued-session", { isStreaming: true });
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("queued-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("queued-session"), "Wait for the current turn", "followUp");

    expect(fake.calls.prompt).toEqual([{ text: "Wait for the current turn", options: { streamingBehavior: "followUp" } }]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append")).toBe(false);
    await service.dispose();
  });

  it("holds prompts sent during compaction until compaction finishes", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("compacting-session", { isCompacting: true });
    let resolveFirstPrompt: (() => void) | undefined;
    fake.session.prompt = (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
      fake.calls.prompt.push({ text, options });
      if (options === undefined) {
        fake.session.isStreaming = true;
        return new Promise<void>((resolve) => { resolveFirstPrompt = resolve; });
      }
      return Promise.resolve();
    };
    const service = new PiSessionService(hub, {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("compacting-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("compacting-session"), "Start task 1", "followUp");
    await service.prompt(sessionRef("compacting-session"), "Then task 2", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append")).toBe(false);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "followUp", text: "Start task 1" }, { kind: "followUp", text: "Then task 2" }],
    });

    fake.session.isCompacting = false;
    fake.emit({ type: "compaction_end" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fake.calls.prompt).toEqual([{ text: "Start task 1", options: undefined }]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append" && JSON.stringify(event.message).includes("Start task 1"))).toBe(true);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 1,
      queuedMessages: [{ kind: "followUp", text: "Then task 2" }],
    });

    fake.emit({ type: "agent_start" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fake.calls.prompt).toEqual([
      { text: "Start task 1", options: undefined },
      { text: "Then task 2", options: { streamingBehavior: "followUp" } },
    ]);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 0,
      queuedMessages: [],
    });
    resolveFirstPrompt?.();
    await service.dispose();
  });

  it("clears queued messages when aborting active work", async () => {
    const fake = fakeRuntime("abort-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("abort-session"));
    await service.abort(sessionRef("abort-session"));

    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.abort).toBe(1);
    await service.dispose();
  });

  it("clears prompts queued during compaction when aborting active work", async () => {
    const fake = fakeRuntime("abort-compaction-session", { isCompacting: true });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("abort-compaction-session"), "Do not deliver after abort", "followUp");
    await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 1 });
    await service.abort(sessionRef("abort-compaction-session"));

    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.prompt).toEqual([]);
    await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("refreshes auth state and dedupes warnings when logout removes the current model's credentials", async () => {
    const hub = new CapturingSessionEventHub();
    const { modelRuntime, credentials } = await createTestModelRuntime({ anthropic: { type: "api_key", key: "sk-test" } });
    const model = modelRuntime.getModel("anthropic", "claude-haiku-4-5");
    if (model === undefined) throw new Error("Expected Anthropic model fixture");
    const fake = fakeRuntime("auth-session", { model, modelRuntime });

    const service = new PiSessionService(hub, {
      modelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("auth-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("auth-session"));
    hub.sessionEvents.length = 0;
    hub.globalEvents.length = 0;

    await credentials.delete("anthropic");
    await modelRuntime.refresh({ allowNetwork: false });
    service.applyAuthChange({ modelRuntime, removedProviderId: "anthropic" });
    service.applyAuthChange({ modelRuntime, removedProviderId: "anthropic" });

    const warningCount = () => hub.sessionEvents.filter(({ event }) => event.type === "command.output" && event.level === "error" && event.message.includes("anthropic/claude-haiku-4-5")).length;
    expect(warningCount()).toBe(1);
    expect(hub.globalEvents.some(({ event }) => event.type === "status.update" && event.status.sessionId === "auth-session")).toBe(true);

    await credentials.modify("anthropic", () => Promise.resolve({ type: "api_key", key: "sk-new" }));
    await modelRuntime.refresh({ allowNetwork: false });
    service.applyAuthChange({ modelRuntime });
    await credentials.delete("anthropic");
    await modelRuntime.refresh({ allowNetwork: false });
    service.applyAuthChange({ modelRuntime, removedProviderId: "anthropic" });
    expect(warningCount()).toBe(2);

    await service.dispose();
  });

  it("applies auth changes only to runtimes using the changed model registry", async () => {
    const hub = new CapturingSessionEventHub();
    const normal = await createTestModelRuntime({ anthropic: { type: "api_key", key: "sk-normal" } });
    const management = await createTestModelRuntime();
    const model = normal.modelRuntime.getModel("anthropic", "claude-haiku-4-5");
    if (model === undefined) throw new Error("Expected Anthropic model fixture");
    const normalRuntime = fakeRuntime("auth-scope-session", { model, modelRuntime: normal.modelRuntime });
    const managedRuntime = fakeRuntime("auth-scope-session", { model, modelRuntime: management.modelRuntime });
    let createCalls = 0;

    const service = new PiSessionService(hub, {
      modelRuntime: normal.modelRuntime,
      managementModelRuntime: management.modelRuntime,
      createAgentRuntime: async () => {
        createCalls += 1;
        return await Promise.resolve(createCalls === 1 ? normalRuntime.runtime : managedRuntime.runtime);
      },
      sessionManager: sessionGateway([sessionRecord("auth-scope-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("auth-scope-session"));
    await service.status(sessionRef("auth-scope-session"), testManagementContext());
    hub.sessionEvents.length = 0;

    await normal.credentials.delete("anthropic");
    await normal.modelRuntime.refresh({ allowNetwork: false });
    service.applyAuthChange({ modelRuntime: normal.modelRuntime, removedProviderId: "anthropic" });

    expect(hub.sessionEvents.filter(({ event, scope }) => event.type === "command.output" && scope === "normal")).toHaveLength(1);
    expect(hub.sessionEvents.some(({ event, scope }) => event.type === "command.output" && (scope?.includes("account-1") ?? false))).toBe(false);

    service.applyAuthChange({ modelRuntime: management.modelRuntime, removedProviderId: "anthropic" });

    expect(hub.sessionEvents.filter(({ event, scope }) => event.type === "command.output" && (scope?.includes("account-1") ?? false))).toHaveLength(1);

    await service.dispose();
  });

  it("clears queued messages when stopping a session runtime", async () => {
    const fake = fakeRuntime("stop-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("stop-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("stop-session"));
    await service.stop(sessionRef("stop-session"));

    expect(fake.calls.clearQueue).toBe(1);
    await service.dispose();
  });

  describe("spawnSession", () => {
    function spawnService(decision: SpawnTargetDecision) {
      const fake = fakeRuntime("spawned-1", { sessionFile: "/tmp/spawned-1.jsonl" });
      const log: { details: Record<string, unknown>; message: string }[] = [];
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([]),
        spawnTargets: { resolveSpawnTarget: () => Promise.resolve(decision) },
        logger: { info: (details, message) => { log.push({ details, message }); } },
        heartbeatIntervalMs: 60_000,
      });
      return { fake, service, log };
    }

    it("starts a session at the resolved target, delivers the prompt, and logs the spawn", async () => {
      const { fake, service, log } = spawnService({ allowed: true, cwd: "/workspace-feature" });

      const result = await service.spawnSession({ spawningCwd: "/workspace", spawningSessionId: "spawner-1", prompt: "continue the plan", cwd: "/workspace-feature" });

      expect(result).toEqual({ sessionId: "spawned-1", cwd: "/workspace-feature" });
      expect(fake.calls.prompt).toEqual([{ text: "continue the plan", options: undefined }]);
      expect(log).toEqual([{ details: { spawningCwd: "/workspace", sessionId: "spawned-1", cwd: "/workspace-feature", promptLength: 17 }, message: "spawn_session started a new session" }]);
      await service.dispose();
    });

    it("uses the dispatching session's model as the spawned session's initial model", async () => {
      const fake = fakeRuntime("spawned-1", { sessionFile: "/tmp/spawned-1.jsonl" });
      const model = testModel();
      let initialModel: PiAgentSession["model"];
      const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
        await Promise.resolve();
        initialModel = options.initialModel;
        return fake.runtime;
      };
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime,
        sessionManager: sessionGateway([]),
        spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace-feature" }) },
        heartbeatIntervalMs: 60_000,
      });

      await service.spawnSession({ spawningCwd: "/workspace", spawningSessionId: "spawner-1", prompt: "continue", cwd: "/workspace-feature", model });

      expect(initialModel).toBe(model);
      await service.dispose();
    });

    it("rejects an out-of-project target without starting a session", async () => {
      const { fake, service } = spawnService({ allowed: false, reason: "out-of-project", allowedCwds: ["/workspace"] });

      await expect(service.spawnSession({ spawningCwd: "/workspace", spawningSessionId: "spawner-1", prompt: "go", cwd: "/elsewhere" }))
        .rejects.toThrow("cwd 必须是此项目的工作区。允许的路径：/workspace");
      expect(fake.calls.prompt).toEqual([]);
      expect(service.activeCount()).toBe(0);
      await service.dispose();
    });

    it("rejects when the spawning session is not in a registered project", async () => {
      const { service } = spawnService({ allowed: false, reason: "not-registered" });

      await expect(service.spawnSession({ spawningCwd: "/workspace", spawningSessionId: "spawner-1", prompt: "go", cwd: undefined }))
        .rejects.toThrow("派生会话不在已注册项目中");
      await service.dispose();
    });

    it("is disabled when no spawn target resolver is configured", async () => {
      const fake = fakeRuntime("spawned-x");
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([]),
        heartbeatIntervalMs: 60_000,
      });

      await expect(service.spawnSession({ spawningCwd: "/workspace", spawningSessionId: "spawner-1", prompt: "go", cwd: undefined }))
        .rejects.toThrow("派生会话已禁用");
      await service.dispose();
    });
  });

  describe("spawnSubsession", () => {
    function subsessionService(decision: SpawnTargetDecision, heartbeatIntervalMs = 60_000) {
      const parent = fakeRuntime("parent-1", { sessionFile: "/tmp/parent-1.jsonl" });
      const child = fakeRuntime("child-1", { sessionFile: "/tmp/child-1.jsonl", sessionManager: fakeSessionManager("/workspace") });
      const created = [parent.runtime, child.runtime];
      let index = 0;
      const createAgentRuntime: RuntimeCreator = async () => {
        await Promise.resolve();
        const runtime = created[Math.min(index, created.length - 1)] ?? child.runtime;
        index += 1;
        return runtime;
      };
      const archived = new Map<string, { sessionId: string; cwd: string; archivedAt: string }>();
      const archiveStore = {
        list: () => Promise.resolve([...archived.values()]),
        get: (sessionId: string) => Promise.resolve(archived.get(sessionId)),
        archive: (input: { sessionId: string; cwd: string }) => {
          const record = { sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-01T00:00:00.000Z" };
          archived.set(input.sessionId, record);
          return Promise.resolve(record);
        },
        restore: (sessionId: string) => { archived.delete(sessionId); return Promise.resolve(); },
        isArchived: (sessionId: string) => Promise.resolve(archived.has(sessionId)),
      };
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime,
        sessionManager: sessionGateway([]),
        archiveStore,
        spawnTargets: { resolveSpawnTarget: () => Promise.resolve(decision) },
        heartbeatIntervalMs,
      });
      return { parent, child, service };
    }

    it("records the parent, delivers the prompt, and lists the tracked child", async () => {
      const { child, service } = subsessionService({ allowed: true, cwd: "/workspace" });
      await service.start("/workspace"); // bring the parent online so it can be notified

      const result = await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "do the slice", cwd: "/workspace" });

      expect(result).toEqual({ sessionId: "child-1", cwd: "/workspace" });
      expect(child.calls.prompt).toEqual([{ text: "do the slice", options: undefined }]);
      await expect(service.listSubsessions("parent-1")).resolves.toEqual([
        { sessionId: "child-1", cwd: "/workspace", status: "idle" },
      ]);
      await service.dispose();
    });

    it("uses the parent session's model as the tracked child's initial model", async () => {
      const parent = fakeRuntime("parent-1", { sessionFile: "/tmp/parent-1.jsonl" });
      const child = fakeRuntime("child-1", { sessionFile: "/tmp/child-1.jsonl", sessionManager: fakeSessionManager("/workspace") });
      const model = testModel();
      const initialModels: PiAgentSession["model"][] = [];
      const runtimes = [parent.runtime, child.runtime];
      let index = 0;
      const createAgentRuntime: RuntimeCreator = async (_createRuntime, options) => {
        await Promise.resolve();
        initialModels.push(options.initialModel);
        const runtime = runtimes[index] ?? child.runtime;
        index += 1;
        return runtime;
      };
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime,
        sessionManager: sessionGateway([]),
        archiveStore: emptyArchiveStore(),
        spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace" }) },
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "do the slice", cwd: "/workspace", model });

      expect(initialModels).toEqual([undefined, model]);
      await service.dispose();
    });

    it("persists tracked child links in the parent and child sessions", async () => {
      const parentPersisted: { customType: string; data?: unknown }[] = [];
      const childPersisted: { customType: string; data?: unknown }[] = [];
      const parent = fakeRuntime("parent-1", {
        sessionFile: "/tmp/parent-1.jsonl",
        sessionManager: fakeSessionManager("/workspace", {
          appendCustomEntry: (customType, data) => {
            parentPersisted.push({ customType, data });
            return "parent-entry-1";
          },
        }),
      });
      const child = fakeRuntime("child-1", {
        sessionFile: "/tmp/child-1.jsonl",
        sessionManager: fakeSessionManager("/workspace", {
          appendCustomEntry: (customType, data) => {
            childPersisted.push({ customType, data });
            return "child-entry-1";
          },
        }),
      });
      const runtimes = [parent.runtime, child.runtime];
      let index = 0;
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: () => {
          const runtime = runtimes[index] ?? child.runtime;
          index += 1;
          return Promise.resolve(runtime);
        },
        sessionManager: sessionGateway([]),
        archiveStore: emptyArchiveStore(),
        spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace" }) },
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "do the slice", cwd: "/workspace" });

      expect(parentPersisted).toEqual([
        {
          customType: "pi-web.subsession.link",
          data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: "/tmp/child-1.jsonl", cwd: "/workspace" },
        },
      ]);
      expect(childPersisted).toEqual([
        {
          customType: "pi-web.subsession.spawned",
          data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" },
        },
      ]);
      await service.dispose();
    });

    it("hydrates persisted child links after a service restart so the parent can inspect them", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getBranch: () => [{ type: "message", message: { role: "assistant", content: "finished" } }],
        });
        const parent = fakeRuntime("parent-1", {
          sessionFile: parentFile,
          sessionManager: fakeSessionManager("/workspace", {
            getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
          }),
        });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const runtimes = [parent.runtime, child.runtime];
        let index = 0;
        const open = vi.fn(() => childManager);
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? child.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: { create: () => parent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([]), open },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.start("/workspace");

        await expect(service.checkSubsession("parent-1", "child-1")).resolves.toEqual({
          sessionId: "child-1",
          cwd: "/workspace",
          status: "idle",
          finalText: "finished",
          messageCount: 1,
        });
        expect(open).toHaveBeenCalledWith(childFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("ignores stale persisted child links when the child no longer records the parent", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-stale-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");

      try {
        const parent = fakeRuntime("parent-1", {
          sessionFile: parentFile,
          sessionManager: fakeSessionManager("/workspace", {
            getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
          }),
        });
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: runtimeCreator(parent.runtime),
          sessionManager: { create: () => parent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([]), open: () => fakeSessionManager() },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.start("/workspace");

        await expect(service.listSubsessions("parent-1")).resolves.toEqual([]);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not hydrate persisted links when the exact child file is unavailable", async () => {
      const parentFile = "/sessions/parent-1.jsonl";
      const parent = fakeRuntime("parent-1", {
        sessionFile: parentFile,
        sessionManager: fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: "/sessions/child-1.jsonl", cwd: "/workspace" } }],
        }),
      });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(parent.runtime),
        sessionManager: { create: () => parent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([]), open: () => fakeSessionManager() },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");

      await expect(service.listSubsessions("parent-1")).resolves.toEqual([]);
      await service.dispose();
    });

    it("does not hydrate parent links without a child file", async () => {
      const parentFile = "/sessions/parent-1.jsonl";
      const parent = fakeRuntime("parent-1", {
        sessionFile: parentFile,
        sessionManager: fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child", cwd: "/workspace" } }],
        }),
      });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(parent.runtime),
        sessionManager: { create: () => parent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([]), open: () => fakeSessionManager() },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");

      await expect(service.listSubsessions("parent-1")).resolves.toEqual([]);
      await service.dispose();
    });

    it("does not invent subsession links from existing child session headers", async () => {
      const parentFile = "/sessions/parent-1.jsonl";
      const childRecord = { ...sessionRecord("child-1", "/workspace"), path: "/sessions/child-1.jsonl", parentSessionPath: parentFile };
      const parent = fakeRuntime("parent-1", {
        sessionFile: parentFile,
        sessionManager: fakeSessionManager("/workspace", { getEntries: () => [] }),
      });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(parent.runtime),
        sessionManager: { create: () => parent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([childRecord]), open: () => fakeSessionManager() },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");

      await expect(service.listSubsessions("parent-1")).resolves.toEqual([]);
      await service.dispose();
    });

    it("does not hydrate copied parent links when the opened parent has a different id", async () => {
      const forkedParent = fakeRuntime("parent-fork-1", {
        sessionFile: "/sessions/parent-fork-1.jsonl",
        sessionManager: fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: "/sessions/child-1.jsonl", cwd: "/workspace" } }],
        }),
      });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(forkedParent.runtime),
        sessionManager: { create: () => forkedParent.session.sessionManager, list: () => Promise.resolve([]), listAll: () => Promise.resolve([]), open: () => fakeSessionManager() },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");

      await expect(service.listSubsessions("parent-fork-1")).resolves.toEqual([]);
      await service.dispose();
    });

    it("relinks a spawned child when the child session is opened after restart", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-open-child-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getHeader: () => ({ parentSession: parentFile }),
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
        });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const runtimes = [child.runtime, parent.runtime];
        let index = 0;
        const open = vi.fn((path: string) => path === parentFile ? parentManager : childManager);
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? parent.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: {
            create: () => childManager,
            list: () => Promise.resolve([{ ...sessionRecord("child-1", "/workspace"), path: childFile, parentSessionPath: parentFile }]),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(parent.calls.sendCustomMessage).toHaveLength(1);
        expect(parent.calls.sendCustomMessage[0]?.message.content).toContain("Subsession child-1 stopped working");
        expect(open).toHaveBeenCalledWith(parentFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("notifies the validated parent file instead of an active prefix-matched parent id", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-prefix-parent-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const forkParentFile = join(tempDir, "parent-fork.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(forkParentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1-fork", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getHeader: () => ({ parentSession: parentFile }),
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
        });
        const forkManager = fakeSessionManager("/workspace");
        const fork = fakeRuntime("parent-1-fork", { sessionFile: forkParentFile, sessionManager: forkManager });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const runtimes = [fork.runtime, child.runtime, parent.runtime];
        let index = 0;
        const open = vi.fn((path: string) => {
          if (path === parentFile) return parentManager;
          if (path === forkParentFile) return forkManager;
          return childManager;
        });
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? parent.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: {
            create: () => forkManager,
            list: () => Promise.resolve([
              { ...sessionRecord("parent-1-fork", "/workspace"), path: forkParentFile },
              { ...sessionRecord("child-1", "/workspace"), path: childFile, parentSessionPath: parentFile },
            ]),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("parent-1-fork", "/workspace"));
        await service.status(sessionRef("child-1", "/workspace"));
        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(fork.calls.sendCustomMessage).toHaveLength(0);
        expect(parent.calls.sendCustomMessage).toHaveLength(1);
        expect(open).toHaveBeenCalledWith(parentFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not relink a copied child with the original session id unless the parent link names the current child file", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-copied-child-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const originalChildFile = join(tempDir, "original-child.jsonl");
      const copiedChildFile = join(tempDir, "copied-child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(originalChildFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");
      await writeFile(copiedChildFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getHeader: () => ({ parentSession: parentFile }),
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: originalChildFile, cwd: "/workspace" } }],
        });
        const child = fakeRuntime("child-1", { sessionFile: copiedChildFile, sessionManager: childManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const runtimes = [child.runtime, parent.runtime];
        let index = 0;
        const open = vi.fn((path: string) => path === parentFile ? parentManager : childManager);
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? parent.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: {
            create: () => childManager,
            list: () => Promise.resolve([{ ...sessionRecord("child-1", "/workspace"), path: copiedChildFile, parentSessionPath: parentFile }]),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(parent.calls.sendCustomMessage).toHaveLength(0);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("uses the verified child file instead of an active copied child with the same id", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-active-copy-child-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const originalChildFile = join(tempDir, "original-child.jsonl");
      const copiedChildFile = join(tempDir, "copied-child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(originalChildFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");
      await writeFile(copiedChildFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const copiedManager = fakeSessionManager("/workspace", {
          getBranch: () => [{ type: "message", message: { role: "assistant", content: "copied child result" } }],
        });
        const originalManager = fakeSessionManager("/workspace", {
          getBranch: () => [{ type: "message", message: { role: "assistant", content: "original child result" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: originalChildFile, cwd: "/workspace" } }],
        });
        const copiedChild = fakeRuntime("child-1", { sessionFile: copiedChildFile, sessionManager: copiedManager, isStreaming: true });
        const originalChild = fakeRuntime("child-1", { sessionFile: originalChildFile, sessionManager: originalManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const createAgentRuntime: RuntimeCreator = (_createRuntime, options) => {
          if (options.sessionManager === copiedManager) return Promise.resolve(copiedChild.runtime);
          if (options.sessionManager === originalManager) return Promise.resolve(originalChild.runtime);
          if (options.sessionManager === parentManager) return Promise.resolve(parent.runtime);
          throw new Error("unexpected session manager");
        };
        const open = vi.fn((path: string) => {
          if (path === copiedChildFile) return copiedManager;
          if (path === originalChildFile) return originalManager;
          if (path === parentFile) return parentManager;
          throw new Error(`unexpected open path ${path}`);
        });
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime,
          sessionManager: {
            create: () => parentManager,
            list: (cwd: string) => Promise.resolve(cwd === "/workspace" ? [{ ...sessionRecord("child-1", "/workspace"), path: copiedChildFile, parentSessionPath: parentFile }] : []),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        await service.start("/workspace");

        await expect(service.listSubsessions("parent-1", parentFile)).resolves.toEqual([
          { sessionId: "child-1", cwd: "/workspace", status: "idle" },
        ]);

        copiedChild.session.isStreaming = true;
        copiedChild.emit({ type: "agent_start" });
        copiedChild.session.isStreaming = false;
        copiedChild.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(parent.calls.sendCustomMessage).toHaveLength(0);

        await expect(service.checkSubsession("parent-1", "child-1", parentFile)).resolves.toMatchObject({
          sessionId: "child-1",
          cwd: "/workspace",
          status: "idle",
          finalText: "original child result",
          messageCount: 1,
        });
        const read = await service.readSubsession("parent-1", "child-1", { roles: ["assistant"] }, parentFile);
        expect(read.entries[0]?.parts[0]).toMatchObject({ kind: "text", text: "original child result" });
        expect(open).toHaveBeenCalledWith(originalChildFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("uses the verified parent file instead of an active copied parent with the same id", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-active-copy-parent-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const copiedParentFile = join(tempDir, "copied-parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(copiedParentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: parentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
          getBranch: () => [{ type: "message", message: { role: "assistant", content: "child result" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
        });
        const copiedParentManager = fakeSessionManager("/workspace", { getEntries: () => [] });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const copiedParent = fakeRuntime("parent-1", { sessionFile: copiedParentFile, sessionManager: copiedParentManager });
        const createAgentRuntime: RuntimeCreator = (_createRuntime, options) => {
          if (options.sessionManager === childManager) return Promise.resolve(child.runtime);
          if (options.sessionManager === parentManager) return Promise.resolve(parent.runtime);
          if (options.sessionManager === copiedParentManager) return Promise.resolve(copiedParent.runtime);
          throw new Error("unexpected session manager");
        };
        const open = vi.fn((path: string) => {
          if (path === childFile) return childManager;
          if (path === parentFile) return parentManager;
          if (path === copiedParentFile) return copiedParentManager;
          throw new Error(`unexpected open path ${path}`);
        });
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime,
          sessionManager: {
            create: () => copiedParentManager,
            list: () => Promise.resolve([
              { ...sessionRecord("parent-1", "/workspace"), path: copiedParentFile },
              { ...sessionRecord("child-1", "/workspace"), path: childFile, parentSessionPath: parentFile },
            ]),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        await service.status(sessionRef("parent-1", "/workspace"));

        await expect(service.listSubsessions("parent-1", copiedParentFile)).resolves.toEqual([]);
        await expect(service.checkSubsession("parent-1", "child-1", copiedParentFile)).rejects.toThrow("not one of your subsessions");
        await expect(service.readSubsession("parent-1", "child-1", {}, copiedParentFile)).rejects.toThrow("not one of your subsessions");

        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(copiedParent.calls.sendCustomMessage).toHaveLength(0);
        expect(parent.calls.sendCustomMessage).toHaveLength(1);
        expect(parent.calls.sendCustomMessage[0]?.message.content).toContain("Subsession child-1 stopped working");
        expect(open).toHaveBeenCalledWith(parentFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not relink a child marker when the current child file header no longer records the parent", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-stale-child-header-"));
      const parentFile = join(tempDir, "parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: "parent-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getHeader: () => ({ parentSession: parentFile }),
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
        });
        const parentManager = fakeSessionManager("/workspace", {
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: childFile, cwd: "/workspace" } }],
        });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const parent = fakeRuntime("parent-1", { sessionFile: parentFile, sessionManager: parentManager });
        const runtimes = [child.runtime, parent.runtime];
        let index = 0;
        const open = vi.fn((path: string) => path === parentFile ? parentManager : childManager);
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? parent.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: {
            create: () => childManager,
            list: () => Promise.resolve([{ ...sessionRecord("child-1", "/workspace"), path: childFile, parentSessionPath: parentFile }]),
            listAll: () => Promise.resolve([]),
            open,
          },
          archiveStore: {
            ...emptyArchiveStore(),
            get: (sessionId) => Promise.resolve(sessionId === "child-1" ? { sessionId: "child-1", cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z", parentSessionPath: parentFile } : undefined),
          },
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(parent.calls.sendCustomMessage).toHaveLength(0);
        expect(open).not.toHaveBeenCalledWith(parentFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not relink a child marker when the child header points at a different parent id", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pi-web-subsession-wrong-parent-"));
      const mismatchedParentFile = join(tempDir, "other-parent.jsonl");
      const actualParentFile = join(tempDir, "parent.jsonl");
      const childFile = join(tempDir, "child.jsonl");
      await writeFile(mismatchedParentFile, `${JSON.stringify({ type: "session", version: 3, id: "other-parent", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" })}\n`, "utf8");
      await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: mismatchedParentFile })}\n`, "utf8");

      try {
        const childManager = fakeSessionManager("/workspace", {
          getHeader: () => ({ parentSession: mismatchedParentFile }),
          getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
        });
        const parent = fakeRuntime("parent-1", { sessionFile: actualParentFile, sessionManager: fakeSessionManager("/workspace") });
        const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
        const runtimes = [child.runtime, parent.runtime];
        let index = 0;
        const open = vi.fn((path: string) => path === actualParentFile ? parent.session.sessionManager : childManager);
        const service = new PiSessionService(new CapturingSessionEventHub(), {
          createAgentRuntime: () => {
            const runtime = runtimes[index] ?? parent.runtime;
            index += 1;
            return Promise.resolve(runtime);
          },
          sessionManager: {
            create: () => childManager,
            list: () => Promise.resolve([{ ...sessionRecord("child-1", "/workspace"), path: childFile, parentSessionPath: mismatchedParentFile }]),
            listAll: () => Promise.resolve([{ ...sessionRecord("parent-1", "/workspace"), path: actualParentFile }]),
            open,
          },
          archiveStore: emptyArchiveStore(),
          heartbeatIntervalMs: 60_000,
        });

        await service.status(sessionRef("child-1", "/workspace"));
        child.session.isStreaming = true;
        child.emit({ type: "agent_start" });
        child.session.isStreaming = false;
        child.emit({ type: "agent_end" });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(parent.calls.sendCustomMessage).toHaveLength(0);
        expect(open).not.toHaveBeenCalledWith(actualParentFile);
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("does not relink copied child markers when the opened child has a different id", async () => {
      const parentFile = "/sessions/parent-1.jsonl";
      const childFile = "/sessions/child-fork-1.jsonl";
      const childManager = fakeSessionManager("/workspace", {
        getHeader: () => ({ parentSession: parentFile }),
        getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } }],
      });
      const child = fakeRuntime("child-fork-1", { sessionFile: childFile, sessionManager: childManager });
      const open = vi.fn(() => childManager);
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(child.runtime),
        sessionManager: {
          create: () => childManager,
          list: () => Promise.resolve([{ ...sessionRecord("child-fork-1", "/workspace"), path: childFile, parentSessionPath: parentFile }]),
          listAll: () => Promise.resolve([]),
          open,
        },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
      });

      await service.status(sessionRef("child-fork-1", "/workspace"));
      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.session.isStreaming = false;
      child.emit({ type: "agent_end" });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(open).not.toHaveBeenCalledWith(parentFile);
      await expect(service.listSubsessions("parent-1")).resolves.toEqual([]);
      await service.dispose();
    });

    it("notifies the parent once when the tracked child stops working", async () => {
      const { parent, child, service } = subsessionService({ allowed: true, cwd: "/workspace" });
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace" });
      parent.calls.prompt.length = 0; // ignore the spawn prompt to the child; focus on the parent notification

      child.session.isStreaming = true;
      child.emit({ type: "agent_start" }); // arm the notification
      child.session.isStreaming = false;
      child.emit({ type: "agent_end" }); // fire once
      child.emit({ type: "turn_end" }); // must not re-notify
      await new Promise((resolve) => setTimeout(resolve, 20)); // the parent notification is delivered via the async custom-message path

      expect(parent.calls.sendCustomMessage).toHaveLength(1);
      expect(parent.calls.sendCustomMessage[0]?.message.content).toContain("Subsession child-1 stopped working");
      expect(parent.calls.sendCustomMessage[0]?.message.customType).toBe("subsession.completion");
      expect(parent.calls.sendCustomMessage[0]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
      expect(parent.calls.prompt).toHaveLength(0); // not a user-authored message
      await service.dispose();
    });

    it("notifies via the heartbeat when the child settles without a further event", async () => {
      const { parent, child, service } = subsessionService({ allowed: true, cwd: "/workspace" }, 10);
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace" });
      parent.calls.prompt.length = 0;

      // The child works, then settles silently: agent_end arrives while it still
      // reports active work, so the event-driven latch does not fire here.
      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.emit({ type: "agent_end" });
      expect(parent.calls.sendCustomMessage).toHaveLength(0);

      // Once the session settles, the periodic heartbeat re-check notifies.
      child.session.isStreaming = false;
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(parent.calls.sendCustomMessage).toHaveLength(1);
      expect(parent.calls.sendCustomMessage[0]?.message.content).toContain("Subsession child-1 stopped working");
      await service.dispose();
    });

    it("does not notify the parent when a tracked child is archived", async () => {
      const { parent, child, service } = subsessionService({ allowed: true, cwd: "/workspace" });
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace" });
      // Arm the notification, as a real working child would.
      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.session.isStreaming = false;
      parent.calls.sendCustomMessage.length = 0;

      await service.archive("child-1");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(parent.calls.sendCustomMessage).toHaveLength(0);
      await service.dispose();
    });

    it("reports a missing tracked child file as unknown in the subsession list", async () => {
      const { service } = subsessionService({ allowed: true, cwd: "/workspace" });
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace" });

      await service.archive("child-1");

      await expect(service.listSubsessions("parent-1")).resolves.toEqual([
        { sessionId: "child-1", cwd: "/workspace", status: "unknown" },
      ]);
      await service.dispose();
    });

    it("check_subsession and read_subsession refuse sessions that are not the caller's children", async () => {
      const { service } = subsessionService({ allowed: true, cwd: "/workspace" });
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace" });

      await expect(service.checkSubsession("someone-else", "child-1")).rejects.toThrow("not one of your subsessions");
      await expect(service.readSubsession("someone-else", "child-1", {})).rejects.toThrow("not one of your subsessions");
      await service.dispose();
    });

    it("is disabled when no spawn target resolver is configured", async () => {
      const fake = fakeRuntime("nope");
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([]),
        heartbeatIntervalMs: 60_000,
      });
      await expect(service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "p", parentSessionFile: undefined, prompt: "go" }))
        .rejects.toThrow("派生会话已禁用");
      await service.dispose();
    });
  });
});
