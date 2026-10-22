import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type Model, type Api } from "../../piAi.js";
import { ModelRuntime } from "../../piSdk.js";
import { expect, it, vi } from "vitest";
import type { PiWebConfigResponse } from "../../shared/apiTypes.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModel } from "./piSessionService.testSupport.js";

function config(): PiWebConfigResponse {
  const value = { sessionNaming: { model: "naming-isolation/title" } };
  return { path: "/config.json", exists: true, config: value, effectiveConfig: value, envOverrides: { host: false, port: false, allowedHosts: false, agentCommand: false, agentDir: false, agentSessionDir: false, spawnSessions: false, subsessions: false, askUser: false } };
}

function completed(model: Model<Api>, title: string) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant", content: [{ type: "text", text: title }], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now(),
  };
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

async function namingRuntime(name: string, apiKey?: string) {
  const calls: { key: string | undefined }[] = [];
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  runtime.registerProvider("naming-isolation", {
    api: "anthropic-messages", baseUrl: "https://naming.invalid", models: [{ ...testModel(), id: "title", name: "Naming title" }],
    streamSimple: (model, _context, options) => { calls.push({ key: options?.apiKey }); return completed(model, name); },
  });
  if (apiKey !== undefined) await runtime.setRuntimeApiKey("naming-isolation", apiKey);
  return { runtime, calls };
}

it.each([false, true])("uses only the session's project or management ModelRuntime credentials (management configured: %s)", async (managedKey) => {
  const first = await namingRuntime("Project A title", "project-a-private-key");
  const second = await namingRuntime("Project B title", "project-b-private-key");
  const management = await namingRuntime("Management title", managedKey ? "management-private-key" : undefined);
  const contexts = testManagementContext();
  const fake = (id: string, cwd: string, modelRuntime: ModelRuntime) => fakeRuntime(id, {
    model: testModel(), modelRuntime, sessionManager: fakeSessionManager(cwd),
    agent: { streamFunction: (model, context, options) => modelRuntime.streamSimple(model, context, options) },
  });
  const a = fake("first", "/project-a", first.runtime);
  const b = fake("second", "/project-b", second.runtime);
  const managed = fake("first", "/project-a", management.runtime);
  const logger = vi.fn();
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    normalModelRuntimeForCwd: (cwd) => Promise.resolve(cwd === "/project-a" ? first.runtime : second.runtime), managementModelRuntime: management.runtime,
    sessionManager: {
      ...sessionGateway([sessionRecord("first", "/project-a"), sessionRecord("second", "/project-b")]),
      open: (file) => fakeSessionManager(file.includes("first") ? "/project-a" : "/project-b"),
    }, archiveStore: emptyArchiveStore(),
    config: { read: config }, logger: { info: logger },
    createAgentRuntime: (_factory, options) => Promise.resolve(options.managementContext === undefined ? (options.sessionManager.getCwd() === "/project-a" ? a.runtime : b.runtime) : managed.runtime),
  });
  try {
    await service.prompt(sessionRef("first", "/project-a"), "First project request");
    await service.prompt(sessionRef("second", "/project-b"), "Second project request");
    await service.prompt(sessionRef("first", "/project-a"), "Managed request fallback", undefined, undefined, { managementContext: contexts });
    await vi.waitFor(() => {
      expect(a.session.sessionName).toBe("Project A title");
      expect(b.session.sessionName).toBe("Project B title");
      expect(managed.session.sessionName).toBe(managedKey ? "Management title" : "Managed request fallback");
    });
    expect(first.calls).toEqual([{ key: "project-a-private-key" }]);
    expect(second.calls).toEqual([{ key: "project-b-private-key" }]);
    expect(management.calls).toEqual(managedKey ? [{ key: "management-private-key" }] : []);
    expect(managed.calls.prompt).toHaveLength(1);
    for (const runtime of [a, b, managed]) expect(runtime.session.model).toEqual(testModel());
    expect(JSON.stringify(logger.mock.calls)).not.toContain("private-key");
  } finally { await service.dispose(); }
});

it("logs fixed failure metadata rather than provider errors, credentials, URLs or prompt contents", async () => {
  const error = new Error("Bearer PRIVATE_TOKEN https://issuer.invalid/?code=SECRET USER_PROMPT_BODY");
  const fake = fakeRuntime("private-error", { model: testModel(), agent: { streamFunction: () => { throw error; } } });
  const info = vi.fn();
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    modelRuntime: await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false }),
    sessionManager: sessionGateway([sessionRecord("private-error")]), archiveStore: emptyArchiveStore(), logger: { info }, createAgentRuntime: () => Promise.resolve(fake.runtime),
  });
  try {
    await service.prompt(sessionRef("private-error"), "USER_PROMPT_BODY");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("USER PROMPT BODY"); });
    expect(info).toHaveBeenCalledWith({ sessionId: "private-error", errorCategory: "generation" }, "Session naming failed; using the first-message fallback");
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE_TOKEN|issuer\.invalid|SECRET|USER_PROMPT_BODY/u);
    expect(fake.calls.prompt).toHaveLength(1);
  } finally { await service.dispose(); }
});
