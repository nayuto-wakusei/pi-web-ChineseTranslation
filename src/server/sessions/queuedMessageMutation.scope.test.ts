import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, expect, it, vi } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import type { ManagementAuditRecorder } from "../audit/managementAuditStore.js";
import { createTranslator } from "../../shared/i18n.js";
import { PiSessionService } from "./piSessionService.js";
import { ScopeCapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";
import { snapshotAgentQueues } from "./queuedMessageMutation.js";

const services: PiSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });

function queuedRuntime() {
  const fake = fakeRuntime("same-id");
  const agent = new Agent({ streamFn: () => { throw new Error("Must not run a model"); } });
  const steering: string[] = [];
  const followUp: string[] = [];
  fake.session.agent = agent;
  fake.session.getSteeringMessages = () => steering;
  fake.session.getFollowUpMessages = () => followUp;
  Object.defineProperty(fake.session, "pendingMessageCount", { get: () => steering.length + followUp.length });
  function enqueue(kind: "steer" | "followUp", text: string) {
    const message: AgentMessage = { role: "user", content: text, timestamp: 1 };
    (kind === "steer" ? steering : followUp).push(text);
    agent[kind](message);
    return message;
  }
  return { fake, agent, enqueue };
}

it("isolates identical session IDs and cwd across ordinary and two management owners, including held prompts", async () => {
  const first = testManagementContext();
  const second = { ...first, user: { ...first.user, id: "other-account" } };
  const contexts = [undefined, first, second];
  const queues = contexts.map(() => queuedRuntime());
  const events = new ScopeCapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: "/tmp/pi-web-queue-scope", modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
    translator: createTranslator("en", {}), sessionManager: sessionGateway([sessionRecord("same-id")]), archiveStore: emptyArchiveStore(),
    createAgentRuntime: (_factory, options: { managementContext?: ManagementEmbedContext }) => {
      const queue = queues[contexts.findIndex((context) => context?.user.id === options.managementContext?.user.id)];
      if (queue === undefined) throw new Error("Unexpected scope");
      return Promise.resolve(queue.fake.runtime);
    }, heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  for (const [index, context] of contexts.entries()) {
    const queue = queues[index];
    if (queue === undefined) throw new Error("Missing fixture queue");
    await service.status(sessionRef("same-id"), context);
    queue.enqueue("steer", `sdk-${String(index)}`);
    queue.fake.session.isCompacting = true;
    await service.prompt(sessionRef("same-id"), `held-${String(index)}`, "followUp", undefined, context === undefined ? undefined : { managementContext: context });
  }
  const ref = sessionRef("same-id", "/workspace/./nested/..");
  const before = await service.status(ref, first);
  const result = await service.mutateQueueMessage(ref, { action: "edit", index: 0, expectedQueue: before.queuedMessages }, first);
  expect(result.queuedMessages).toEqual([]);
  expect((await service.status(sessionRef("same-id"))).queuedMessages.map((entry) => entry.text)).toEqual(["sdk-0", "held-0"]);
  expect((await service.status(sessionRef("same-id"), second)).queuedMessages.map((entry) => entry.text)).toEqual(["sdk-2", "held-2"]);
  await expect(service.mutateQueueMessage(sessionRef("same-id", "/other"), { action: "remove", index: 0, expectedQueue: before.queuedMessages }, first)).rejects.toThrow("Session not found");
  await expect(service.mutateQueueMessage(ref, { action: "remove", index: 0, expectedQueue: before.queuedMessages }, second)).rejects.toThrow("changed");
  expect(events.globalEvents.filter((entry) => entry.event.type === "status.update" && entry.scope?.startsWith("management:") === true).length).toBeGreaterThan(0);
});

it("rejects a captured runtime closed during writable revalidation before touching SDK queues", async () => {
  const queue = queuedRuntime();
  const archiveStore = emptyArchiveStore();
  let pause = false;
  let reads = 0;
  let release!: () => void;
  archiveStore.get = async () => {
    if (pause && ++reads === 2) await new Promise<void>((resolve) => { release = resolve; });
    return undefined;
  };
  const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-queue-race", modelRuntime: testModelRuntime, translator: createTranslator("en", {}),
    sessionManager: sessionGateway([sessionRecord("same-id")]), archiveStore, createAgentRuntime: runtimeCreator(queue.fake.runtime), heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  await service.status(sessionRef("same-id"));
  queue.enqueue("steer", "preserve");
  const before = await service.status(sessionRef("same-id"));
  pause = true;
  const mutate = service.mutateQueueMessage(sessionRef("same-id"), { action: "remove", index: 0, expectedQueue: before.queuedMessages });
  const failure = expect(mutate).rejects.toThrow("Session not found");
  await vi.waitFor(() => { expect(release).toBeDefined(); });
  await service.stop(sessionRef("same-id"));
  const clear = vi.spyOn(queue.agent, "clearAllQueues");
  release();
  await failure;
  expect(clear).not.toHaveBeenCalled();
});

it("does not re-audit an SDK prompt moved through held storage, but audits an original held prompt on delivery", async () => {
  const queue = queuedRuntime();
  const context = testManagementContext();
  const record = vi.fn<ManagementAuditRecorder["record"]>();
  const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-queue-audit", modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
    translator: createTranslator("en", {}), sessionManager: sessionGateway([sessionRecord("same-id")]), archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(queue.fake.runtime), managementAudit: { record }, heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const ref = sessionRef("same-id");
  await service.status(ref, context);
  queue.fake.session.isStreaming = true;
  queue.fake.session.prompt = (text, options) => {
    queue.fake.calls.prompt.push({ text, options });
    if (queue.fake.session.isStreaming) queue.enqueue(options?.streamingBehavior ?? "followUp", text);
    return Promise.resolve();
  };
  await service.prompt(ref, "already audited", "steer", undefined, { managementContext: context });
  queue.fake.session.isCompacting = true;
  await service.prompt(ref, "held original", "followUp", undefined, { managementContext: context });
  const before = await service.status(ref, context);
  await service.mutateQueueMessage(ref, { action: "toggle", index: 0, expectedQueue: before.queuedMessages }, context);
  expect(snapshotAgentQueues(queue.agent).steer).toEqual([]);
  queue.fake.session.isStreaming = false;
  queue.fake.session.isCompacting = false;
  queue.fake.emit({ type: "compaction_end" });
  await vi.waitFor(() => { expect(queue.fake.calls.prompt.map((call) => call.text)).toEqual(["already audited", "held original", "already audited"]); });
  expect(record.mock.calls.map(([event]) => event).filter((event) => event.action === "user_prompt").map((event) => event.content)).toEqual(["already audited", "held original"]);
  expect(queue.fake.calls.prompt.at(-1)?.options).toEqual({ expandPromptTemplates: false });
});

it("keeps queue mutation behind the active MCP authentication gate", async () => {
  const queue = queuedRuntime();
  queue.fake.session.settingsManager.isProjectTrusted = () => true;
  queue.fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "mcp", sourceInfo: { path: "builtin:mcp" }, getArgumentCompletions: () => [{ value: "login isolated", label: "isolated" }] }];
  const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-queue-mcp", modelRuntime: testModelRuntime, translator: createTranslator("en", {}),
    sessionManager: sessionGateway([sessionRecord("same-id")]), archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(queue.fake.runtime), heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const ref = sessionRef("same-id");
  const flow = await service.startMcpAuth(ref, "login");
  const original = queue.enqueue("steer", "untouched");
  await expect(service.mutateQueueMessage(ref, { action: "remove", index: 0, expectedQueue: [{ kind: "steer", text: "untouched" }] })).rejects.toThrow("authentication");
  expect(snapshotAgentQueues(queue.agent).steer).toEqual([original]);
  await service.cancelMcpAuthFlow(flow.flowId);
});

it("reports SDK incompatibility without placing private queue content or raw errors into logs or status", async () => {
  const queue = queuedRuntime();
  const info = vi.fn();
  const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-queue-diagnostic", modelRuntime: testModelRuntime, translator: createTranslator("en", {}),
    sessionManager: sessionGateway([sessionRecord("same-id")]), archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(queue.fake.runtime), logger: { info }, heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const ref = sessionRef("same-id");
  await service.status(ref);
  queue.enqueue("steer", "PRIVATE_QUEUE_CONTENT_SENTINEL");
  vi.spyOn(queue.agent, "peekQueuedMessages").mockImplementation(() => { throw new Error("PRIVATE_SDK_ERROR_SENTINEL"); });
  const status = await service.status(ref);
  expect(status.queuedMessages).toEqual([{ kind: "steer", text: "PRIVATE_QUEUE_CONTENT_SENTINEL" }]);
  expect(status.queueMessageActionsUnavailable).toContain("incompatible");
  expect(status.queueMessageActionsUnavailable).not.toContain("PRIVATE_");
  expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_");
  expect(info).toHaveBeenCalledExactlyOnceWith({ sessionId: "same-id", category: "incompatible-queue-interface" }, "Disabled SDK-dependent queue controls after an incompatible queue interface");
  await expect(service.mutateQueueMessage(ref, { action: "remove", index: 0, expectedQueue: status.queuedMessages })).rejects.toThrow("incompatible");
});
