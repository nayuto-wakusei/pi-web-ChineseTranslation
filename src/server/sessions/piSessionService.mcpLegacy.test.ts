import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

vi.mock("../../piSdk.js", async (importOriginal) => ({ ...await importOriginal<typeof import("../../piSdk.js")>(), VERSION: "0.87.0" }));

it("rejects the dedicated MCP flow on a legacy host before creating a session runtime", async () => {
  const fake = fakeRuntime("legacy");
  const createRuntime = vi.fn(runtimeCreator(fake.runtime));
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    modelRuntime: testModelRuntime, archiveStore: emptyArchiveStore(), sessionManager: sessionGateway([sessionRecord("legacy")]), createAgentRuntime: createRuntime,
  });
  try {
    await expect(service.mcpAuthServers(sessionRef("legacy"))).rejects.toThrow("requires Pi 1.3.0");
    await expect(service.startMcpAuth(sessionRef("legacy"), "login")).rejects.toThrow("requires Pi 1.3.0");
    expect(createRuntime).not.toHaveBeenCalled();
  } finally { await service.dispose(); }
});
