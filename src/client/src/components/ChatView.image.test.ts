// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView, chatImagePartSource, chatToolOutputLabel } from "./ChatView";
import { TranscriptImage } from "./TranscriptImage";
import { ImageGalleryDialog } from "./ImageGalleryDialog";
import { imageButton, nativeImage, settleImage } from "./imagePresentation.testSupport";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ChatView image content derivation", () => {
  it("derives the legacy image data URL and alt text", () => {
    expect(chatImagePartSource({ type: "image", mimeType: "image/png", data: "QUJD" })).toEqual({
      src: "data:image/png;base64,QUJD",
      alt: "attached image",
    });
  });

  it("derives reference URLs from selected machine/session context, not a server-provided URL", () => {
    vi.stubEnv("BASE_URL", "/nested/pi-web/");
    const part = { type: "image" as const, mimeType: "image/png", mediaId: "a".repeat(64), byteSize: 3 };
    expect(chatImagePartSource(part)).toBeUndefined();
    const source = chatImagePartSource(part, { id: "session /?#%", cwd: "/repo /?#%" }, "remote /?#%");
    if (source === undefined) throw new Error("Expected reference source");
    const url = new URL(source.src);
    expect(url.pathname).toBe(`/nested/pi-web/api/machines/remote%20%2F%3F%23%25/sessions/session%20%2F%3F%23%25/media/${part.mediaId}`);
    expect(url.searchParams.get("cwd")).toBe("/repo /?#%");
  });

  it("labels tool image output by tool name and falls back to a generic label", () => {
    expect(chatToolOutputLabel("read")).toBe("read output");
    expect(chatToolOutputLabel(undefined)).toBe("tool output");
    expect(chatToolOutputLabel("")).toBe("tool output");
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

  it("presents tool images as conversation while keeping their technical context in collapsed activity", async () => {
    const view = new ChatView();
    view.messages = [
      { role: "tool", entryId: "tool-image", parts: [
        { type: "toolResult", toolName: "read", text: "Read image file", isError: false },
        { type: "image", mimeType: "image/png", data: "QUJD" },
      ] },
      { role: "assistant", entryId: "reply", parts: [{ type: "text", text: "Here is the image." }] },
    ];
    document.body.append(view);
    await view.updateComplete;

    const activity = view.renderRoot.querySelector<HTMLDetailsElement>(".event-group");
    const imageMessage = view.renderRoot.querySelector("article.tool-image-output");
    expect(activity?.open).toBe(false);
    expect(imageMessage?.classList.contains("conversation-message")).toBe(true);
    expect(imageMessage?.closest(".event-group")).toBeNull();
    expect(imageMessage?.querySelector(".label")?.textContent).toBe("read output");
    expect(imageMessage?.querySelector("pi-web-transcript-image")).not.toBeNull();
    expect(view.renderRoot.querySelector("article.assistant")?.classList.contains("conversation-message")).toBe(true);
    expect(activity?.querySelector(".conversation-message")).toBeNull();
  });

  it("opens and closes the image zoom target without waiting for native loading", async () => {
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
