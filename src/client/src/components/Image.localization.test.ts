// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { imageMessages } from "../imageMessages";
import { ImageGalleryDialog } from "./ImageGalleryDialog";
import { ImagePresentation, type ImageOpenDetail } from "./ImagePresentation";
import { MarkdownImage } from "./MarkdownImage";
import { TranscriptImage } from "./TranscriptImage";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  vi.restoreAllMocks();
});

function isImageOpenEvent(event: Event): event is CustomEvent<ImageOpenDetail> {
  return event instanceof CustomEvent && event.type === "image-open";
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected image control");
  return value;
}

async function mount<T extends ImageGalleryDialog | ImagePresentation | MarkdownImage | TranscriptImage>(element: T): Promise<T> {
  document.body.append(element);
  await element.updateComplete;
  return element;
}

async function settle(...elements: (ImageGalleryDialog | ImagePresentation | MarkdownImage | TranscriptImage)[]): Promise<void> {
  for (const element of elements) {
    await element.updateComplete;
    await element.shadowRoot?.querySelector<ImagePresentation>("pi-web-image-presentation")?.updateComplete;
  }
}

it("refreshes gallery labels and regional position in place without reopening, changing images, or losing focus", async () => {
  release = localization.registerCatalog({ id: "image-test", namespace: "core.images", locale: "de", load: () => Promise.resolve({
    preview: "Bildvorschau", close: "Bild schließen", next: "Weiter", nextImage: "Nächstes Bild", previous: "Zurück", previousImage: "Vorheriges Bild",
    position: "{index, number} / {count, number} Bilder",
  }) });
  const gallery = await mount(new ImageGalleryDialog());
  const images = Array.from({ length: 1234 }, (_, index) => ({ src: `data:image/png;base64,${String(index)}`, alt: "User <b>description</b>" }));
  gallery.show(images, 999);
  await gallery.updateComplete;
  const dialog = required(gallery.shadowRoot?.querySelector("dialog"));
  const image = required(gallery.shadowRoot?.querySelector("img"));
  const next = required(gallery.shadowRoot?.querySelector<HTMLButtonElement>('[data-navigation="next"]'));
  next.focus();
  const show = vi.spyOn(dialog, "showModal").mockClear();
  await localization.setPreferences({ language: "de", formatLocale: "de-DE" });
  await gallery.updateComplete;
  expect(dialog.getAttribute("aria-label")).toBe("Bildvorschau");
  expect(gallery.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("1.000 / 1.234 Bilder");
  expect(gallery.shadowRoot?.activeElement).toBe(next);
  expect(next.textContent).toBe("Weiter");
  expect(next.getAttribute("aria-label")).toBe("Nächstes Bild");
  expect(gallery.shadowRoot?.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).toBe(images[999]?.src);
  expect(image.alt).toBe("User <b>description</b>");
  expect(dialog.open).toBe(true);
  expect(show).not.toHaveBeenCalled();
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    await gallery.updateComplete;
    expect(dialog.getAttribute("aria-label")).toBe(imageMessages.t("preview"));
    expect(gallery.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe(imageMessages.t("position", { index: 1000, count: 1234 }));
    expect(gallery.shadowRoot?.activeElement).toBe(next);
    expect(image.alt).toBe("User <b>description</b>");
  }
});

it("uses semantic controls for focus handoff and reverses horizontal keyboard and touch navigation in RTL", async () => {
  const gallery = await mount(new ImageGalleryDialog());
  gallery.show(["one", "two", "three"].map((alt) => ({ src: `data:image/png;base64,${alt}`, alt })), 1);
  await gallery.updateComplete;
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  await gallery.updateComplete;
  const previous = required(gallery.shadowRoot?.querySelector<HTMLButtonElement>('[data-navigation="previous"]'));
  const next = required(gallery.shadowRoot?.querySelector<HTMLButtonElement>('[data-navigation="next"]'));
  next.focus();
  next.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  await gallery.updateComplete;
  expect(gallery.shadowRoot?.querySelector("img")?.alt).toBe("three");
  expect(next.disabled).toBe(true);
  expect(gallery.shadowRoot?.activeElement).toBe(previous);
  previous.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  await gallery.updateComplete;
  expect(gallery.shadowRoot?.querySelector("img")?.alt).toBe("two");
  const stage = required(gallery.shadowRoot?.querySelector<HTMLElement>(".image-gallery-stage"));
  const pointer = { pointerType: "touch", isPrimary: true, pointerId: 1, bubbles: true, clientY: 100 };
  stage.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: 100 }));
  stage.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: 160 }));
  await gallery.updateComplete;
  expect(gallery.shadowRoot?.querySelector("img")?.alt).toBe("three");
  previous.click();
  await gallery.updateComplete;
  previous.click();
  await gallery.updateComplete;
  expect(gallery.shadowRoot?.querySelector("img")?.alt).toBe("one");
  expect(gallery.shadowRoot?.activeElement).toBe(next);
});

it("updates enlargement and pending controls without translating caller content or replacing native images", async () => {
  const presentation = new ImagePresentation();
  presentation.source = "https://example.test/image.png";
  presentation.description = "User <b>caption</b>";
  presentation.label = "/private/صورة.png";
  await mount(presentation);
  const button = required(presentation.shadowRoot?.querySelector<HTMLButtonElement>(".image-button"));
  const image = required(presentation.shadowRoot?.querySelector("img"));
  const open = vi.fn();
  presentation.addEventListener("image-open", open);
  button.focus();
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await presentation.updateComplete;
  expect(button.getAttribute("aria-label")).toBe(imageMessages.t("enlarge", { description: presentation.description }));
  expect(button.title).toBe(imageMessages.t("enlargeHint"));
  expect(presentation.shadowRoot?.querySelector("img")).toBe(image);
  expect(image.alt).toBe(presentation.description);
  expect(presentation.shadowRoot?.activeElement).toBe(button);
  expect(presentation.shadowRoot?.querySelector("code")?.textContent).toBe(presentation.label);
  expect(presentation.shadowRoot?.querySelector("code")?.dir).toBe("auto");
  expect(open).not.toHaveBeenCalled();
  presentation.description = "";
  presentation.source = undefined;
  await presentation.updateComplete;
  expect(button.getAttribute("aria-label")).toBe(imageMessages.t("enlargeImage"));
  expect(presentation.shadowRoot?.querySelector(".placeholder span")?.textContent).toBe(imageMessages.t("show"));
  expect(image.hasAttribute("src")).toBe(false);
});

it("keeps Markdown image approval and loading policy across locale changes without making a source request", async () => {
  const markdown = new MarkdownImage();
  markdown.previewUrl = "https://outside.test/private.png";
  markdown.description = "User alt";
  markdown.path = "unchanged/path";
  markdown.outside = true;
  const transcript = new TranscriptImage();
  await mount(markdown);
  await mount(transcript);
  await settle(markdown, transcript);
  const presentation = required(markdown.shadowRoot?.querySelector<ImagePresentation>("pi-web-image-presentation"));
  const attached = required(transcript.shadowRoot?.querySelector<ImagePresentation>("pi-web-image-presentation"));
  const request = required(presentation.shadowRoot?.querySelector<HTMLButtonElement>(".placeholder"));
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    await settle(markdown, transcript);
    expect(presentation.source).toBeUndefined();
    expect(presentation.pendingLabel).toBe(imageMessages.t("show"));
    expect(attached.pendingLabel).toBe(imageMessages.t("unavailable"));
  }
  request.click();
  await settle(markdown);
  expect(presentation.source).toBe(markdown.previewUrl);
  const image = required(presentation.shadowRoot?.querySelector("img"));
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  await settle(markdown);
  expect(presentation.source).toBe(markdown.previewUrl);
  expect(presentation.shadowRoot?.querySelector("img")).toBe(image);
  expect(image.alt).toBe("User alt");
  markdown.loadingDisabled = true;
  transcript.loadingDisabled = true;
  await settle(markdown, transcript);
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  await settle(markdown, transcript);
  expect(presentation.source).toBeUndefined();
  expect(presentation.requestDisabled).toBe(true);
  expect(presentation.pendingLabel).toBe(imageMessages.t("loadingDisabled"));
  expect(attached.pendingLabel).toBe(imageMessages.t("loadingDisabled"));
});

it("keeps generated attachment descriptions live in an already-open gallery", async () => {
  const transcript = new TranscriptImage();
  transcript.imagePart = { type: "image", mimeType: "image/png", data: "QUJD" };
  await mount(transcript);
  await settle(transcript);
  const gallery = await mount(new ImageGalleryDialog());
  transcript.addEventListener("image-open", (event) => {
    if (isImageOpenEvent(event)) gallery.show([event.detail]);
  });
  const presentation = required(transcript.shadowRoot?.querySelector<ImagePresentation>("pi-web-image-presentation"));
  required(presentation.shadowRoot?.querySelector<HTMLButtonElement>(".image-button")).click();
  await gallery.updateComplete;
  const image = required(gallery.shadowRoot?.querySelector("img"));
  expect(image.alt).toBe("attached image");
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  await settle(transcript, gallery);
  expect(image.alt).toBe(imageMessages.t("attachedImage"));
  expect(image.getAttribute("src")).toBe("data:image/png;base64,QUJD");
});

it("unsubscribes detached image hosts and refreshes them on reconnection", async () => {
  const presentation = await mount(new ImagePresentation());
  presentation.remove();
  const update = vi.spyOn(presentation, "requestUpdate");
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  expect(update).not.toHaveBeenCalled();
  document.body.append(presentation);
  await presentation.updateComplete;
  expect(presentation.shadowRoot?.querySelector(".placeholder span")?.textContent).toBe(imageMessages.t("show"));
});
