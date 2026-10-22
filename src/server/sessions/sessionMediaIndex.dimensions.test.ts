import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SessionMediaIndex } from "./sessionMediaIndex.js";
import { readSessionImageDimensions } from "./sessionImageDimensions.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const scope = { id: "session-1", cwd: "/workspace" };

describe("session media geometry metadata", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])("preserves MIME and omits mismatched metadata (%s)", (mimeType) => {
    const index = new SessionMediaIndex();
    expect(index.reference(scope, { type: "image", mimeType, data: png })).toEqual({
      type: "image", mediaId: createHash("sha256").update(`${mimeType}\0${png}`).digest("hex"), mimeType,
      byteSize: Buffer.from(png, "base64").byteLength, ...(mimeType === "image/png" ? { width: 1, height: 1 } : {}),
    });
  });

  it.each(["AQID", "iVBORw0KGgo="])("memoizes missing metadata without full-payload decoding (%s)", (data) => {
    const readDimensions = vi.fn(readSessionImageDimensions);
    const decode = vi.fn((source: string) => Buffer.from(source, "base64"));
    const index = new SessionMediaIndex({ readDimensions, decode });
    const block = { type: "image", mimeType: "image/png", data };
    const reference = index.reference(scope, block);
    expect(reference).toEqual({ type: "image", mediaId: createHash("sha256").update(`image/png\0${data}`).digest("hex"), mimeType: "image/png", byteSize: Buffer.from(data, "base64").byteLength });
    expect(index.reference(scope, block)).toBe(reference);
    expect(index.reference(scope, { ...block })).toBe(reference);
    expect(readDimensions).toHaveBeenCalledExactlyOnceWith(data, "image/png");
    expect(decode).not.toHaveBeenCalled();
    expect(index.get({ ...scope, eventScope: "management:other" }, reference?.mediaId ?? "")).toBeUndefined();
    expect(index.get({ ...scope, cwd: "/other" }, reference?.mediaId ?? "")).toBeUndefined();
    expect(index.get(scope, reference?.mediaId ?? "")?.data).toEqual(Buffer.from(data, "base64"));
    expect(decode).toHaveBeenCalledExactlyOnceWith(data);
  });
});
