import { describe, expect, it } from "vitest";
import { captureImageAttachments, READ_FAILURE_MESSAGE, UNSUPPORTED_IMAGE_MESSAGE, type CapturableFile } from "./promptAttachmentCapture";

function file(name: string, type: string, size = 10): CapturableFile {
  return { name, type, size };
}

describe("captureImageAttachments", () => {
  it("reads supported images as base64 attachments", async () => {
    const result = await captureImageAttachments(
      [file("shot.png", "image/png"), file("pic.webp", "image/webp")],
      (f) => Promise.resolve(`data-for-${f.name}`),
    );

    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      { name: "shot.png", mimeType: "image/png", data: "data-for-shot.png", size: 10 },
      { name: "pic.webp", mimeType: "image/webp", data: "data-for-pic.webp", size: 10 },
    ]);
  });

  it("derives a name from the mime type when the file is unnamed", async () => {
    const result = await captureImageAttachments([file("", "image/jpeg")], () => Promise.resolve("x"));
    expect(result.attachments[0]?.name).toBe("pasted-image.jpg");
  });

  it("skips unsupported types and reports a single error while keeping valid ones", async () => {
    const result = await captureImageAttachments(
      [file("doc.pdf", "application/pdf"), file("ok.gif", "image/gif")],
      () => Promise.resolve("x"),
    );

    expect(result.error).toBe(UNSUPPORTED_IMAGE_MESSAGE);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual(["ok.gif"]);
  });

  it("reports a read failure without dropping other attachments", async () => {
    const result = await captureImageAttachments(
      [file("bad.png", "image/png"), file("good.png", "image/png")],
      (f) => f.name === "bad.png" ? Promise.reject(new Error("boom")) : Promise.resolve("ok"),
    );

    expect(result.error).toBe(READ_FAILURE_MESSAGE);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual(["good.png"]);
  });

  it("returns no attachments and no error for an empty batch", async () => {
    const result = await captureImageAttachments([], () => Promise.resolve("x"));
    expect(result).toEqual({ attachments: [] });
  });
});
