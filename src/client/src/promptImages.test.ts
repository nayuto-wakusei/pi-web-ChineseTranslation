import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_PROMPT_TEXT, modelSupportsImageInput, promptImageFromFile, promptImagesFromClipboardItems, promptInputFromDraft } from "./promptImages";

describe("prompt image helpers", () => {
  it("detects image-capable session models", () => {
    expect(modelSupportsImageInput({ input: ["text", "image"] })).toBe(true);
    expect(modelSupportsImageInput({ input: ["text"] })).toBe(false);
    expect(modelSupportsImageInput(undefined)).toBe(false);
  });

  it("converts image files to SDK prompt images", async () => {
    await expect(promptImageFromFile(new File(["hello"], "clip.png", { type: "image/png" }))).resolves.toEqual({
      type: "image",
      data: Buffer.from("hello", "utf8").toString("base64"),
      mimeType: "image/png",
    });
  });

  it("keeps only supported clipboard image files", async () => {
    const image = new File(["webp"], "clip.webp", { type: "image/webp" });
    const text = new File(["text"], "note.txt", { type: "text/plain" });

    await expect(promptImagesFromClipboardItems([
      clipboardItem("file", "image/webp", image),
      clipboardItem("file", "text/plain", text),
      clipboardItem("string", "image/png", null),
    ])).resolves.toEqual([{ type: "image", data: Buffer.from("webp", "utf8").toString("base64"), mimeType: "image/webp" }]);
  });

  it("builds pure image prompts with default text", () => {
    const images = [{ type: "image" as const, data: "abc", mimeType: "image/png" }];

    expect(promptInputFromDraft("", images)).toEqual({ text: DEFAULT_IMAGE_PROMPT_TEXT, images });
    expect(promptInputFromDraft("  看这个  ", images)).toEqual({ text: "看这个", images });
    expect(promptInputFromDraft("  hello  ", [])).toBe("hello");
  });
});

function clipboardItem(kind: DataTransferItem["kind"], type: string, file: File | null): Pick<DataTransferItem, "kind" | "type" | "getAsFile"> {
  return { kind, type, getAsFile: () => file };
}
