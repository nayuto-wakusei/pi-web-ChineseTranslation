import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SessionMediaIndex } from "../sessions/sessionMediaIndex.js";
import { SessionEventHub, type RealtimeSocket } from "./sessionEventHub.js";

const mediaScope = { id: "s1", cwd: "/workspace" };

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  send = vi.fn();
  terminate = vi.fn();
}

describe("SessionEventHub session media", () => {
  it("keeps identical session and workspace media isolated across management identities", () => {
    const hub = new SessionEventHub();
    const ordinary = new FakeSocket();
    const managed = new FakeSocket();
    const otherManaged = new FakeSocket();
    hub.add("s1", ordinary, "normal", "reference");
    hub.add("s1", managed, "management:one", "reference");
    hub.add("s1", otherManaged, "management:two", "reference");
    const image = { type: "image", data: "AQID", mimeType: "image/png" };
    hub.publish("s1", { type: "message.append", message: { role: "user", content: [image] } }, "management:one", mediaScope);
    const projected = hub.mediaIndex.reference(undefined, image);
    if (projected === undefined) throw new Error("Expected image reference");
    expect(hub.mediaIndex.get(mediaScope, projected.mediaId)).toBeUndefined();
    expect(hub.mediaIndex.get({ ...mediaScope, eventScope: "management:two" }, projected.mediaId)).toBeUndefined();
    expect(hub.mediaIndex.get({ ...mediaScope, eventScope: "management:one" }, projected.mediaId)?.data).toEqual(Buffer.from([1, 2, 3]));
    expect(ordinary.send).not.toHaveBeenCalled();
    expect(otherManaged.send).not.toHaveBeenCalled();
    expect(managed.send).toHaveBeenCalledOnce();
    expect(hub.currentSeq("s1")).toBe(0);
    expect(hub.currentSeq("s1", "management:one")).toBe(1);
    hub.mediaIndex.forgetSession(mediaScope);
    expect(hub.mediaIndex.get({ ...mediaScope, eventScope: "management:one" }, projected.mediaId)).toBeDefined();
    hub.mediaIndex.forgetSession({ ...mediaScope, eventScope: "management:one" });
    expect(hub.mediaIndex.get({ ...mediaScope, eventScope: "management:one" }, projected.mediaId)).toBeUndefined();
  });
  it("negotiates image references independently per subscriber with one shared watermark", () => {
    const hub = new SessionEventHub();
    const inline = new FakeSocket();
    const reference = new FakeSocket();
    hub.add("s1", inline);
    hub.add("s1", reference, "normal", "reference");
    const image = { type: "image", data: "AQID", mimeType: "image/png" };
    const thinking = { type: "thinking", thinking: "working", thinkingSignature: "secret" };
    const source = { role: "assistant", content: [thinking, image] };
    const imageReference = hub.mediaIndex.reference(mediaScope, image);
    hub.publish("s1", { type: "message.end", message: source }, "normal", mediaScope);
    expect(JSON.parse(String(inline.send.mock.calls[0]?.[0]))).toEqual({ type: "message.end", message: { ...source, content: [{ type: "thinking", thinking: "working" }, image] }, seq: 1 });
    expect(JSON.parse(String(reference.send.mock.calls[0]?.[0]))).toEqual({ type: "message.end", message: { ...source, content: [{ type: "thinking", thinking: "working" }, imageReference] }, seq: 1 });
    const tool = { type: "tool.update" as const, toolName: "read", toolCallId: "call", text: "[image]", content: [image] };
    hub.publish("s1", tool, "normal", mediaScope);
    expect(inline.send).toHaveBeenLastCalledWith(JSON.stringify({ ...tool, seq: 2 }));
    expect(reference.send).toHaveBeenLastCalledWith(JSON.stringify({ ...tool, content: [imageReference], seq: 2 }));
    reference.emit("close");
    hub.publish("s1", { ...tool, type: "tool.end", isError: false }, "normal", mediaScope);
    expect(reference.send).toHaveBeenCalledTimes(2);
    expect(hub.currentSeq("s1")).toBe(3);
    expect(source.content).toEqual([thinking, image]);
    expect(thinking.thinkingSignature).toBe("secret");
  });

  it("binds transient live images to the explicit workspace without decoding, even with no subscribers", () => {
    const decode = vi.fn((source: string) => Buffer.from(source, "base64"));
    const hub = new SessionEventHub(new SessionMediaIndex({ decode }));
    const image = { type: "image", data: "AQID", mimeType: "image/png" };
    hub.publish("s1", { type: "tool.end", toolName: "read", toolCallId: "call", text: "[image]", content: [image], isError: false }, "normal", mediaScope);
    const projected = hub.mediaIndex.reference(undefined, image);
    if (projected === undefined) throw new Error("Expected image reference");
    const id = projected.mediaId;
    expect(hub.mediaIndex.get({ ...mediaScope, cwd: "/other" }, id)).toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
    expect(hub.mediaIndex.get(mediaScope, id)).toEqual({ data: Buffer.from([1, 2, 3]), mimeType: "image/png" });
    expect(decode).toHaveBeenCalledExactlyOnceWith(image.data);
    hub.mediaIndex.clear();
    hub.publish("s1", { type: "message.append", message: { role: "user", content: [image] } });
    expect(hub.mediaIndex.get(mediaScope, id)).toBeUndefined(); // No implicit id-only binding.
  });

});
