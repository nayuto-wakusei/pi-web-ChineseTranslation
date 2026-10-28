// @vitest-environment happy-dom

import type { ContentRenderingCapability, FileContentResponse, FilePreviewerInput, WorkspaceFilesCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesDocumentPreview } from "./FilesDocumentPreview";
import { filesLocalizationFixture } from "./filesLocalization.testSupport";

customElements.define("test-files-document-preview", FilesDocumentPreview);

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

function fixture(mediaType: FileContentResponse["mediaType"] = "image", overrides: Partial<FileContentResponse> = {}) {
  const abort = new AbortController();
  const files = {
    capabilityVersion: 1, maxInlinePreviewBytes: 1024 * 1024, defaultUploadFolder: ".uploads",
    readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(), uploadFile: vi.fn(),
    previewUrl: vi.fn(() => "about:blank#preview-revision"), downloadUrl: vi.fn(() => "about:blank#download-revision"),
  } satisfies WorkspaceFilesCapabilityV1;
  const input: FilePreviewerInput = {
    machineId: "remote", projectId: "p", workspaceId: "w", files, signal: abort.signal, fail: vi.fn(),
    file: { path: "docs/example", content: "", encoding: "utf8", binary: true, mediaType, modifiedAt: "revision", truncated: false, size: 100, ...overrides },
  };
  const element = new FilesDocumentPreview();
  element.content = filesLocalizationFixture().content;
  element.input = input;
  return { element, input, files, abort };
}

async function mount(element: FilesDocumentPreview) {
  document.body.append(element);
  await element.updateComplete;
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing preview control");
  return value;
}

describe("Files document preview", () => {
  it.each(["html", "pdf"] as const)("preserves %s frame isolation and versioned workspace URLs", async (kind) => {
    const { element, files, input } = fixture(kind);
    await mount(element);
    const frame = required(element.shadowRoot?.querySelector("iframe"));
    expect(vi.mocked(files).previewUrl).toHaveBeenCalledWith(input.file.path, { version: "revision" });
    expect(frame.getAttribute("sandbox")).toBe(kind === "html" ? "" : null);
    expect(frame.getAttribute("allow")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    if (kind === "pdf") expect(element.shadowRoot?.querySelector(".preview-note")).not.toBeNull();
  });

  it.each(["image", "html", "pdf"] as const)("shows recovery actions and retries a failed %s", async (kind) => {
    const { element, input, files } = fixture(kind);
    await mount(element);
    const media = required(element.shadowRoot?.querySelector("img, iframe"));
    media.dispatchEvent(new Event("error"));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain(input.file.path);
    expect(element.shadowRoot?.querySelector('a[target="_blank"]')?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(element.shadowRoot?.querySelector("a[download]")?.getAttribute("href")).toContain("download");
    expect(vi.mocked(files).downloadUrl).toHaveBeenCalledWith(input.file.path, { version: "revision" });
    required(element.shadowRoot?.querySelector("button")).click();
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("img, iframe")).not.toBe(media);
    expect(element.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    media.dispatchEvent(new Event("error"));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    expect(input.fail).not.toHaveBeenCalled();
  });

  it("ignores detached selection errors and aborts active rendering", async () => {
    const { element, input, abort } = fixture();
    await mount(element);
    const oldImage = required(element.shadowRoot?.querySelector("img"));
    element.input = { ...input, file: { ...input.file, path: "another.png" } };
    await element.updateComplete;
    oldImage.dispatchEvent(new Event("error"));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    abort.abort();
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
    oldImage.dispatchEvent(new Event("error"));
    expect(input.fail).not.toHaveBeenCalled();
  });

  it("honors the capability limit and the legacy 1 MiB fallback", async () => {
    const { element, files, input } = fixture("image", { size: 200 });
    element.input = { ...input, files: { ...files, maxInlinePreviewBytes: 100 } };
    await mount(element);
    expect(element.shadowRoot?.textContent).toContain("too large");
    expect(vi.mocked(files).previewUrl).not.toHaveBeenCalled();
    element.input = { ...input, file: { ...input.file, size: 2 * 1024 * 1024 }, files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() } };
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain("1.0 MB");
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
  });

  it("sanitizes Markdown and shows truncation without executing source", async () => {
    const { element } = fixture("markdown", { binary: false, truncated: true, content: '# Heading\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))' });
    await mount(element);
    expect(element.shadowRoot?.querySelector("h1")?.textContent).toBe("Heading");
    expect(element.shadowRoot?.querySelector("script")).toBeNull();
    expect(element.shadowRoot?.querySelector('[href^="javascript:"]')).toBeNull();
    expect(element.shadowRoot?.querySelector(".preview-note")?.textContent).toContain("truncated");
  });

  it("passes Markdown through the host renderer for fenced plugin previews", async () => {
    const { element, input } = fixture("markdown", { binary: false, content: '```diagram\nA-->B\n```' });
    const renderMarkdown = vi.fn<ContentRenderingCapability["renderMarkdown"]>(() => html`<b>Diagram preview</b>`);
    element.contentRendering = { listRenderers: vi.fn(), renderText: vi.fn(), renderMarkdown };
    await mount(element);
    expect(renderMarkdown).toHaveBeenCalledWith(expect.objectContaining({ machineId: "remote", text: input.file.content, truncated: false, allowManualPreview: true }));
    const request = required(renderMarkdown.mock.calls[0]?.[0]);
    expect(request.toSafeHtml("<script>bad()</script>")).not.toContain("<script>");
    expect(element.shadowRoot?.querySelector("b")?.textContent).toBe("Diagram preview");
  });

  it("keeps Markdown renderer failures recoverable inside the preview", async () => {
    const { element, input } = fixture("markdown", { binary: false });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => { /* Failure logging is asserted below. */ });
    const renderMarkdown = vi.fn<ContentRenderingCapability["renderMarkdown"]>()
      .mockImplementationOnce(() => { throw new Error("Renderer failed"); })
      .mockReturnValue(html`<b>Recovered</b>`);
    element.contentRendering = { listRenderers: vi.fn(), renderText: vi.fn(), renderMarkdown };
    await mount(element);
    expect(element.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.shadowRoot?.querySelector("a[download]")).not.toBeNull();
    expect(element.shadowRoot?.querySelector('a[target="_blank"]')).toBeNull();
    expect(warning).toHaveBeenCalledWith("Markdown preview failed", input.file.path, expect.objectContaining({ message: "Renderer failed" }));
    required(element.shadowRoot?.querySelector("button")).click();
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("b")?.textContent).toBe("Recovered");
    expect(input.fail).not.toHaveBeenCalled();
  });

  it("does not restart rendering from a queued update after disconnect", async () => {
    const { element } = fixture("markdown", { binary: false });
    const renderMarkdown = vi.fn<ContentRenderingCapability["renderMarkdown"]>(() => html`<b>Preview</b>`);
    element.contentRendering = { listRenderers: vi.fn(), renderText: vi.fn(), renderMarkdown };
    await mount(element);
    element.requestUpdate();
    element.remove();
    await element.updateComplete;
    expect(renderMarkdown).toHaveBeenCalledOnce();
  });

  it("reports capability or URL failures to the host", async () => {
    const { element, input, files } = fixture();
    vi.mocked(files).previewUrl.mockImplementation(() => { throw new Error("URL failed"); });
    await mount(element);
    expect(input.fail).toHaveBeenCalledWith(expect.objectContaining({ message: "URL failed" }));
  });

  it("registers nested-root styles and releases them on abort and disconnect", async () => {
    const { element, abort } = fixture();
    const release = vi.fn();
    const registerRoot = vi.fn(() => release);
    element.stylesheetIntegration = { registerRoot, createController: vi.fn(), subscribe: vi.fn() };
    await mount(element);
    expect(registerRoot).toHaveBeenCalledWith(element.shadowRoot, { sharedUi: true });
    abort.abort();
    await element.updateComplete;
    expect(release).toHaveBeenCalledOnce();
    element.remove();
    expect(release).toHaveBeenCalledOnce();
  });
});
