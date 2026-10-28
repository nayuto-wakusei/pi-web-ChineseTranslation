import type { ContentRenderingCapability, FileContentResponse, FilePreviewerInput, StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { createDocumentPreviewers } from "./documentPreviewers";
import { filesLocalizationFixture } from "./filesLocalization.testSupport";

const file: FileContentResponse = { path: "misleading.txt", content: "", encoding: "utf8", binary: false, size: 20, modifiedAt: "revision", truncated: false };

describe("document preview contributions", () => {
  it("uses authoritative media classification and preserves safe defaults", () => {
    const previewers = createDocumentPreviewers({ html, content: filesLocalizationFixture().content, getContentRendering: () => undefined, getStylesheetIntegration: () => undefined });
    for (const [mediaType, binary, id, mode] of [
      ["image", true, "image", "automatic"], ["image", false, "svg", "manual"],
      ["pdf", true, "pdf", "automatic"], ["html", false, "html", "manual"], ["markdown", false, "markdown", "manual"],
    ] as const) {
      const matches = previewers.filter((previewer) => previewer.supports?.({ machineId: "local", projectId: "p", workspaceId: "w", file: { ...file, mediaType, binary } }) === true);
      expect(matches.map(({ id, title, renderMode }) => ({ id, title, renderMode }))).toEqual([{ id, title: "Preview", renderMode: mode }]);
    }
    expect(previewers.every(({ fileExtensions, mimeTypes }) => fileExtensions === undefined && mimeTypes === undefined)).toBe(true);
    expect(previewers.filter((previewer) => previewer.supports?.({ machineId: "local", projectId: "p", workspaceId: "w", file: { ...file, path: "fake.html", mimeType: "text/html" } }) === true)).toEqual([]);
  });

  it("reads dependencies at render time and keeps titles localized", async () => {
    const { content, service } = filesLocalizationFixture();
    const dependencies: { rendering?: ContentRenderingCapability; styles?: StylesheetIntegrationCapabilityV1 } = {};
    const previewer = createDocumentPreviewers({ html, content, getContentRendering: () => dependencies.rendering, getStylesheetIntegration: () => dependencies.styles })[0];
    if (previewer === undefined) throw new Error("Missing previewer");
    dependencies.rendering = { listRenderers: vi.fn(), renderText: vi.fn(), renderMarkdown: vi.fn() };
    dependencies.styles = { registerRoot: vi.fn(), createController: vi.fn(), subscribe: vi.fn() };
    const input: FilePreviewerInput = { machineId: "local", projectId: "p", workspaceId: "w", file, files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() }, signal: new AbortController().signal, fail: vi.fn() };
    expect(previewer.render(input).values).toEqual([input, content, dependencies.rendering, dependencies.styles]);
    service.registerCatalog({ id: "files-test", namespace: "plugin:files:files", locale: "fr", load: () => Promise.resolve({ preview: "Aperçu" }) });
    await service.setPreferences({ ...service.preferences, language: "fr" });
    expect(previewer.title).toBe("Aperçu");
  });
});
