import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "../../piAi.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { expect, it, vi } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../shared/apiTypes.js";
import { PiSessionService } from "./piSessionService.js";
import { createFilePiWebConfigService } from "../configRoutes.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModel, testModelRuntime } from "./piSessionService.testSupport.js";
const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
function namingConfigResponse(sessionNaming?: PiWebConfigValues["sessionNaming"]): PiWebConfigResponse {
  const config = sessionNaming === undefined ? {} : { sessionNaming };
  return {
    path: "/tmp/pi-web/config.json", exists: true, config, effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, agentCommand: false, agentDir: false, agentSessionDir: false, spawnSessions: false, subsessions: false, askUser: false },
  };
}

  it.each([false, true])("generates a name without changing the session model (configured: %s)", async (configured) => {
    const model = testModel();
    const namingModel = testModelRuntime.getModels().find((candidate) => candidate.id !== model.id);
    if (namingModel === undefined) throw new Error("A second catalog model is required");
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
    const fake = fakeRuntime("name-session", { model, modelRuntime: testModelRuntime, agent: { streamFunction: streamFn } });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("name-session")]),
      ...(configured ? { config: { read: () => namingConfigResponse({ model: `${namingModel.provider}/${namingModel.id}`, maxTokens: 2048 }) } } : {}),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("name-session"), "Please fix the login bug");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Fix login bug"); });

    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]).toMatchObject({ streamModel: configured ? namingModel : model, options: { maxTokens: configured ? 2048 : 24 } });
    expect(fake.session.model).toBe(model);
    expect(hub.sessionEvents.some(({ event }) => event.type === "session.name" && event.name === "Fix login bug")).toBe(true);
    await service.dispose();
  });

  it("reads the config file fresh for each new title without changing in-progress calls or existing titles", async () => {
    const sessionModel = testModel();
    const alternate = testModelRuntime.getModels().find((model) => model.id !== sessionModel.id);
    if (alternate === undefined) throw new Error("A second model is required");
    const configDir = await mkdtemp(join(tmpdir(), "pi-web-naming-config-"));
    const configPath = join(configDir, "config.json");
    const config = createFilePiWebConfigService({ env: { PI_WEB_CONFIG: configPath }, cwd: configDir });
    const read = vi.fn(config.read);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const calls: { model: string; maxTokens: number | undefined; reasoning: string | undefined; timeoutMs: number | undefined; finish: () => void }[] = [];
    const streamFn: StreamFn = (model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "Generated title" }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      calls.push({
        model: `${model.provider}/${model.id}`, maxTokens: options?.maxTokens, reasoning: options?.reasoning, timeoutMs: timeout.mock.lastCall?.[0],
        finish: () => { stream.push({ type: "done", reason: "stop", message }); stream.end(message); },
      });
      return stream;
    };
    const fakes = ["live-first", "live-second", "live-third"].map((id) => fakeRuntime(id, { model: sessionModel, thinkingLevel: "high", modelRuntime: testModelRuntime, agent: { streamFunction: streamFn } }));
    const remaining = [...fakes];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR, modelRuntime: testModelRuntime,
      sessionManager: sessionGateway(fakes.map((fake) => sessionRecord(fake.session.sessionId))),
      createAgentRuntime: () => {
        const next = remaining.shift();
        if (next === undefined) throw new Error("Unexpected runtime open");
        return Promise.resolve(next.runtime);
      },
      config: { read }, heartbeatIntervalMs: 60_000,
    });
    try {
      await service.prompt(sessionRef("live-first"), "First request");
      await vi.waitFor(() => { expect(calls).toHaveLength(1); });
      await config.write({ sessionNaming: { model: `${alternate.provider}/${alternate.id}`, maxTokens: 2048, thinkingLevel: "off", timeoutMs: 90_000 } });
      expect(calls[0]).toMatchObject({ model: `${sessionModel.provider}/${sessionModel.id}`, maxTokens: 24, reasoning: "minimal", timeoutMs: 10_000 });
      calls[0]?.finish();
      await vi.waitFor(() => { expect(fakes[0]?.session.sessionName).toBe("Generated title"); });

      await service.prompt(sessionRef("live-second"), "Second request");
      await vi.waitFor(() => { expect(calls).toHaveLength(2); });
      expect(calls[1]).toMatchObject({ model: `${alternate.provider}/${alternate.id}`, maxTokens: 2048, reasoning: undefined, timeoutMs: 90_000 });
      // Direct file edits must work too, without a save notification or reload.
      await writeFile(configPath, "{}\n", "utf8");
      calls[1]?.finish();
      await vi.waitFor(() => { expect(fakes[1]?.session.sessionName).toBe("Generated title"); });

      await service.prompt(sessionRef("live-third"), "Third request");
      await vi.waitFor(() => { expect(calls).toHaveLength(3); });
      expect(calls[2]).toMatchObject({ model: `${sessionModel.provider}/${sessionModel.id}`, maxTokens: 24, reasoning: "minimal", timeoutMs: 10_000 });
      calls[2]?.finish();
      await vi.waitFor(() => { expect(fakes[2]?.session.sessionName).toBe("Generated title"); });
      await service.prompt(sessionRef("live-first"), "Another request");
      expect(calls).toHaveLength(3);
      expect(read).toHaveBeenCalledTimes(3);
      expect(fakes.every((fake) => fake.session.model === sessionModel && fake.session.thinkingLevel === "high")).toBe(true);
    } finally {
      timeout.mockRestore();
      for (const call of calls) call.finish();
      await service.dispose();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it.each([false, true])("falls back without blocking the prompt on naming config/model failure (config read fails: %s)", async (readFails) => {
    const expectedError = new Error(readFails ? "Config unavailable" : "Session naming model is unavailable: missing-provider/missing-model");
    const fake = fakeRuntime("missing-naming-model", { model: testModel() });
    const info = vi.fn();
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("missing-naming-model")]),
      config: { read: () => {
        if (readFails) throw expectedError;
        return namingConfigResponse({ model: "missing-provider/missing-model" });
      } },
      logger: { info },
      heartbeatIntervalMs: 60_000,
    });
    try {
      await service.prompt(sessionRef("missing-naming-model"), "Please fix the login bug");
      await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Please fix the login bug"); });
      expect(fake.calls.prompt).toHaveLength(1);
      expect(info).toHaveBeenCalledWith({ sessionId: "missing-naming-model", errorCategory: "generation" }, "Session naming failed; using the first-message fallback");
    } finally {
      await service.dispose();
    }
  });
