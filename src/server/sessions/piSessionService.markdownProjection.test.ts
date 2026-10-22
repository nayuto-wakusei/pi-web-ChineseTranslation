import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagementAuditEvent } from "../audit/managementAuditStore.js";
import { projectBrowserMessageResponse } from "../browserMessageProjection.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, ScopeCapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";

const services: PiSessionService[] = [];
const ref = sessionRef("session-1");
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});

function fixture(branch: unknown[] = [], patch: Parameters<typeof fakeRuntime>[1] = {}) {
  const fake = fakeRuntime(ref.id, { sessionManager: fakeSessionManager(ref.cwd, { getBranch: () => branch }), ...patch });
  const events = new CapturingSessionEventHub();
  const logger = { info: vi.fn() };
  const service = new PiSessionService(events, {
    agentDir: "/tmp/pi-web-markdown-test", modelRuntime: testModelRuntime, logger,
    archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(ref.id)]), heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  return { fake, events, logger, service };
}

describe("browser-only transcript Markdown transformation", () => {
  it("projects history and completed events, but leaves streaming deltas and reconnect partials original", async () => {
    const message = { role: "assistant", content: [{ type: "text", text: "<think></think>answer" }] };
    const { fake, service, events } = fixture([{ type: "message", message }], { state: { streamingMessage: message } });
    fake.session.extensionRunner.getMarkdownTransformers = () => [(text) => text.replace("<think></think>", "")];
    const projected = { role: "assistant", content: [{ type: "text", text: "<think></think>answer", displayText: "answer" }] };
    expect((await service.messages(ref)).messages).toEqual([projected]);
    fake.emit({ type: "message_end", message });
    fake.emit({ type: "entry_appended", entry: { type: "message", message } });
    fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "<think>" } });
    expect(events.sessionEvents.map(({ event }) => event)).toEqual(expect.arrayContaining([
      { type: "message.end", message: projected }, { type: "message.append", message: projected },
      { type: "assistant.delta", text: "<think>" },
    ]));
    expect((await service.streamSnapshot(ref)).partial).toEqual(message);
    expect(message.content[0]).toEqual({ type: "text", text: "<think></think>answer" });
    fake.session.extensionRunner.getMarkdownTransformers = () => [];
    expect((await service.messages(ref)).messages).toEqual([message]);
  });

  it("transforms atomic snapshot history and pending echoes without rewriting their source or the published partial", async () => {
    const assistant = { role: "assistant", content: [{ type: "text", text: "answer" }] };
    const branch = [{ type: "message", id: "entry-assistant", message: assistant }];
    const { fake, service, events } = fixture(branch);
    let finish!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    fake.session.prompt = prompt;
    fake.session.extensionRunner.getMarkdownTransformers = () => [(text) => `[${text}]`];
    await service.prompt(ref, "hello");
    expect(prompt).toHaveBeenCalledWith("hello", undefined);
    try {
      fake.session.isStreaming = true;
      const partial = { role: "assistant", content: [{ type: "thinking", thinking: "working" }] };
      fake.emit({ type: "message_start", message: partial });
      const snapshot = await service.transcriptSnapshot(ref);
      expect(snapshot.page).toEqual({ leafId: "leaf-1", start: 0, total: 2, messages: [
        { ...assistant, entryId: "entry-assistant", content: [{ type: "text", text: "answer", displayText: "[answer]" }] },
        { role: "user", content: "hello", displayText: "[hello]" },
      ] });
      expect(snapshot.partial).toMatchObject(partial);
      expect(snapshot.partial).not.toHaveProperty("displayText");
      expect(snapshot.seq).toBe(events.currentSeq(ref.id));
      expect(snapshot.status.messageCount).toBe(2);
      expect(assistant.content[0]).toEqual({ type: "text", text: "answer" });
      expect((await service.transcriptSnapshot(ref)).page).toEqual(snapshot.page);
      expect(events.sessionEvents.map(({ event }) => event)).toContainEqual({ type: "message.append", message: { role: "user", content: "hello", displayText: "[hello]" } });
    } finally { finish(); }
  });

  it("supports older SDK runners without a transformer getter", async () => {
    const message = { role: "user", content: "unchanged" };
    const { fake, service } = fixture([{ type: "message", message }]);
    expect(typeof fake.session.extensionRunner.getMarkdownTransformers).toBe("undefined");
    expect((await service.messages(ref)).messages).toEqual([message]);
    expect((await service.transcriptSnapshot(ref)).page.messages).toEqual([message]);
  });

  it("continues after a failed transformer and logs only fixed metadata, never extension errors or message content", async () => {
    const message = { role: "assistant", content: "PRIVATE_CONTENT" };
    const { fake, service, logger } = fixture([{ type: "message", message }]);
    const error = new Error("PRIVATE_ERROR");
    error.name = "PRIVATE_NAME";
    fake.session.extensionRunner.getMarkdownTransformers = () => [
      (text) => `${text} first`, () => { throw error; }, (text) => `${text} last`,
    ];
    expect((await service.messages(ref)).messages).toEqual([{ ...message, displayText: "PRIVATE_CONTENT first last" }]);
    expect(logger.info).toHaveBeenCalledWith({ sessionId: ref.id, transformerIndex: 1, category: "markdown-transformer-failed" }, "Transcript Markdown transformer failed");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("PRIVATE_");
    expect(message).toEqual({ role: "assistant", content: "PRIVATE_CONTENT" });
  });

  it("keeps media reference projection opt-in and does not transform tool output", async () => {
    const image = { type: "image", data: "AQID", mimeType: "image/png" };
    const message = { role: "assistant", content: [{ type: "text", text: "answer" }, image] };
    const tool = { role: "toolResult", content: [{ type: "text", text: "tool" }] };
    const { fake, service, events } = fixture([{ type: "message", message }, { type: "message", message: tool }]);
    fake.session.extensionRunner.getMarkdownTransformers = () => [(text) => `[${text}]`];
    const page = await service.messages(ref);
    expect(page.messages).toEqual([{ ...message, content: [{ type: "text", text: "answer", displayText: "[answer]" }, image] }, tool]);
    const browser = projectBrowserMessageResponse(page, (part) => events.mediaIndex.reference(ref, part));
    const mediaIdMatcher: unknown = expect.any(String);
    expect(browser.messages[0]).toMatchObject({ content: [{ type: "text", text: "answer", displayText: "[answer]" }, { type: "image", mediaId: mediaIdMatcher }] });
    expect(message.content[1]).toBe(image);
    expect(tool.content[0]).toEqual({ type: "text", text: "tool" });
  });

  it("selects transformers by runtime scope and keeps management audit canonical", async () => {
    const message = { role: "assistant", content: [{ type: "text", text: "canonical" }, { type: "thinking", thinking: "private reasoning" }] };
    const branch = [{ type: "message", message }];
    const normal = fakeRuntime(ref.id, { sessionManager: fakeSessionManager(ref.cwd, { getBranch: () => branch }) });
    const managed = fakeRuntime(ref.id, { sessionManager: fakeSessionManager(ref.cwd, { getBranch: () => branch }) });
    normal.session.extensionRunner.getMarkdownTransformers = () => [(text) => `normal:${text}`];
    managed.session.extensionRunner.getMarkdownTransformers = () => [(text) => `managed:${text}`];
    const events = new ScopeCapturingSessionEventHub();
    const audit: ManagementAuditEvent[] = [];
    const service = new PiSessionService(events, {
      agentDir: "/tmp/pi-web-markdown-test", modelRuntime: testModelRuntime, archiveStore: emptyArchiveStore(),
      createAgentRuntime: (_create, options) => Promise.resolve(options.managementContext === undefined ? normal.runtime : managed.runtime),
      sessionManager: sessionGateway([sessionRecord(ref.id)]), heartbeatIntervalMs: 60_000,
      managementAudit: { record: (event) => { audit.push(event); } },
    });
    services.push(service);
    const context = testManagementContext();
    expect((await service.messages(ref)).messages[0]).toMatchObject({ content: [{ displayText: "normal:canonical" }, { displayText: "normal:private reasoning" }] });
    expect((await service.messages(ref, undefined, context)).messages[0]).toMatchObject({ content: [{ displayText: "managed:canonical" }, { displayText: "managed:private reasoning" }] });
    managed.emit({ type: "message_end", message });
    expect(events.sessionEvents.find(({ event }) => event.type === "message.end")).toMatchObject({ scope: eventScopeFromManagementContext(context), event: { message: { content: [{ displayText: "managed:canonical" }, { displayText: "managed:private reasoning" }] } } });
    expect(audit.find(({ action }) => action === "assistant_response")?.content).toEqual({ role: "assistant", content: [{ type: "text", text: "canonical" }] });
    expect(message.content[0]).toEqual({ type: "text", text: "canonical" });
  });
});
