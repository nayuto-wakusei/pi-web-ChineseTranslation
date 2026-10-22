// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView, chatImagePartSource, chatMessageAnchorKey, chatToolOutputLabel } from "./ChatView";
import { ImageGalleryDialog } from "./ImageGalleryDialog";
import { TranscriptImage } from "./TranscriptImage";
import { imageButton, nativeImage, settleImage } from "./imagePresentation.testSupport";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe("ChatView image content derivation", () => {
  // Content/attribute derivation (image src/alt, the tool-output header label,
  // and the scroll-anchor key) lives in pure exported seams rather than being
  // scraped from rendered `TemplateResult` markup, per the testing-guide rule
  // that TemplateResult inspection is not for general content assertions.
  it("derives the image data URL and alt text from an image part", () => {
    expect(chatImagePartSource({ type: "image", mimeType: "image/png", data: "QUJD" })).toEqual({
      src: "data:image/png;base64,QUJD",
      alt: "附件图片",
    });
  });

  it("labels tool image output by tool name and falls back to a generic label", () => {
    expect(chatToolOutputLabel("read")).toBe("read 输出");
    expect(chatToolOutputLabel(undefined)).toBe("工具输出");
    expect(chatToolOutputLabel("")).toBe("工具输出");
  });

  it("keys a tool image message to its stable scroll anchor", () => {
    const message = { entryId: "image-entry", role: "tool" as const, parts: [] };
    expect(chatMessageAnchorKey(7, message)).toBe('m:["image-entry","tool","message"]');
    expect(chatMessageAnchorKey(8, message)).toBe(chatMessageAnchorKey(7, message));
    expect(chatMessageAnchorKey(7)).toBeUndefined();
  });
});

describe("ChatView image event wiring", () => {
  async function mountImage() {
    const view = new ChatView();
    view.messages = [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] }];
    document.body.append(view);
    await view.updateComplete;
    const image = view.renderRoot.querySelector<TranscriptImage>(".chat-image");
    if (image === null) throw new Error("Expected image");
    const presentation = await settleImage(image);
    return { view, presentation, image: nativeImage(presentation) };
  }

  it("leaves native image loading to the browser rather than issuing load-event scroll corrections", async () => {
    const { view, presentation, image } = await mountImage();
    const chat = view.renderRoot.querySelector<HTMLElement>(".chat");
    if (chat === null) throw new Error("Expected chat viewport");
    const scroll = vi.fn();
    Object.defineProperty(chat, "scrollTop", { get: () => 200, set: scroll });
    expect(image.loading).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    await presentation.updateComplete;
    expect(scroll).not.toHaveBeenCalled();
    expect(nativeImage(presentation)).toBe(image);
  });

  it("opens and closes the image zoom target on click and close", async () => {
    const { view, presentation } = await mountImage();
    imageButton(presentation).click();
    await view.updateComplete;
    const gallery = view.renderRoot.querySelector<ImageGalleryDialog>("pi-web-image-gallery-dialog");
    if (gallery === null) throw new Error("Expected image gallery");
    await gallery.updateComplete;
    expect(gallery.renderRoot.querySelector(".image-zoom-full")).not.toBeNull();
    gallery.renderRoot.querySelector<HTMLButtonElement>(".image-zoom-close")?.click();
    await gallery.updateComplete;
    expect(gallery.renderRoot.querySelector(".image-zoom-full")).toBeNull();
  });
});
