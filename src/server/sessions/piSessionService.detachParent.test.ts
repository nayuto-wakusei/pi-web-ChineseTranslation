import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("detaches an active session without losing SDK appends or retaining its in-memory parent", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-detach-parent-"));
  roots.push(cwd);
  const sessionFile = join(cwd, "child.jsonl");
  await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd, parentSession: join(cwd, "parent.jsonl") })}\n`);
  const manager = SessionManager.open(sessionFile);
  const runtime = fakeRuntime("child", { sessionFile, sessionManager: manager, isStreaming: true });
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: join(cwd, "agent"), modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime.runtime), sessionManager: sessionGateway([]), archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000,
  });
  try {
    await service.start(cwd);
    manager.appendMessage({ role: "user", content: "before detach", timestamp: 1 });
    const detach = service.detachParent(sessionRef("child", cwd));
    manager.appendMessage({ role: "user", content: "during detach", timestamp: 2 });
    await detach;
    manager.appendMessage({ role: "user", content: "after detach", timestamp: 3 });

    expect(manager.getHeader()?.parentSession).toBeUndefined();
    const entries = (await readFile(sessionFile, "utf8")).trim().split("\n").map((line) => { const entry: unknown = JSON.parse(line); return entry; });
    expect(entries[0]).not.toHaveProperty("parentSession");
    expect(entries.slice(1)).toMatchObject([
      { message: { content: "before detach" } },
      { message: { content: "during detach" } },
      { message: { content: "after detach" } },
    ]);
  } finally {
    await service.dispose();
  }
});
