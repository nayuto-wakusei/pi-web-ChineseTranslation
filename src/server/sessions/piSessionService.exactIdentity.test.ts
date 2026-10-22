import { createTranslator } from "../../shared/i18n.js";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";
const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
describe("exact session identities", () => {
  it("rejects abbreviated ids after warming an active session without mutating its runtime", async () => {
    const sessionId = "warmed-active-session";
    const fake = fakeRuntime(sessionId, {
      sessionManager: fakeSessionManager("/workspace", { getSessionId: () => sessionId }),
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      translator: createTranslator("en", {}),
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord(sessionId)]),
      heartbeatIntervalMs: 60_000,
    });
    try {
      const exact = sessionRef(sessionId);
      const abbreviated = sessionRef("warmed-active");
      await expect(service.status(exact)).resolves.toMatchObject({ sessionId });
      await expect(service.status(abbreviated)).rejects.toThrow("Session not found");
      await expect(service.messages(abbreviated)).rejects.toThrow("Session not found");
      await expect(service.prompt(abbreviated, "must not be delivered")).rejects.toThrow("Session not found");
      await expect(service.archive(abbreviated)).rejects.toThrow("Session not found");
      await expect(service.status(sessionRef(sessionId, "/other"))).rejects.toThrow("Session not found");
      await service.abort(abbreviated);
      await service.stop(abbreviated);
      expect(fake.calls.prompt).toEqual([]);
      expect(fake.calls.abort).toBe(0);
      expect(fake.calls.dispose).toBe(0);
      expect(service.activeCount()).toBe(1);
      await expect(service.status(exact)).resolves.toMatchObject({ sessionId });
    } finally {
      await service.dispose();
    }
  });


  it("bulk archive requires exact listed and archived ids within the requested cwd", async () => {
    const records = [sessionRecord("listed-extended"), sessionRecord("listed"), sessionRecord("listed-only-full")];
    const archivedRecords = ["archived-extended", "archived", "archived-only-full"].map((sessionId) => ({
      sessionId, cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z",
    }));
    const archiveMany = vi.fn((inputs: readonly { sessionId: string; cwd: string }[]) => Promise.resolve(inputs.map((input) => ({
      ...input, archivedAt: "2026-01-03T00:00:00.000Z",
    }))));
    const gateway = sessionGateway(records);
    gateway.list = (cwd) => Promise.resolve(records.filter((record) => record.cwd === cwd));
    const open = vi.spyOn(gateway, "open");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      translator: createTranslator("en", {}),
      modelRuntime: testModelRuntime,
      archiveStore: {
        list: () => Promise.resolve(archivedRecords),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("bulk archive should use archiveMany")),
        archiveMany,
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      sessionManager: gateway,
      heartbeatIntervalMs: 60_000,
    });
    try {
      const result = await service.archiveMany([
        { id: "listed-only", cwd: "/workspace" },
        { id: "archived-only", cwd: "/workspace" },
        { id: "listed", cwd: "/workspace" },
        { id: "archived", cwd: "/workspace" },
        { id: "listed", cwd: "/other" },
        { id: "archived", cwd: "/other" },
      ]);

      expect(result.archivedSessionIds).toEqual(["archived", "listed"]);
      expect(result.failures).toEqual([
        { sessionId: "listed-only", error: "Session not found" },
        { sessionId: "archived-only", error: "Session not found" },
        { sessionId: "listed", error: "Session not found" },
        { sessionId: "archived", error: "Session not found" },
      ]);
      expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["listed"]);
      expect(open).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

});
