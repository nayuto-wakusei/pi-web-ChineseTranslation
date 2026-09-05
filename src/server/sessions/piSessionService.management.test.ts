import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, sessionGateway, sessionRecord, sessionRef, testManagementContext, type RuntimeCreator } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService management runtime scope", () => {
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
      agentDir: TEST_AGENT_DIR,
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
      agentDir: TEST_AGENT_DIR,
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
      agentDir: TEST_AGENT_DIR,
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
      agentDir: TEST_AGENT_DIR,
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
      agentDir: TEST_AGENT_DIR,
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
});
