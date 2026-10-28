import type { ContentRenderingCapability, FilePreviewerContribution, PluginActivationContext, StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import type { FilesContent } from "./filesLocalization";

export function createDocumentPreviewers(options: {
  html: PluginActivationContext["html"];
  content: FilesContent;
  getContentRendering: () => ContentRenderingCapability | undefined;
  getStylesheetIntegration: () => StylesheetIntegrationCapabilityV1 | undefined;
}): FilePreviewerContribution[] {
  return [
    { id: "image", mediaType: "image", binary: true, renderMode: "automatic" },
    { id: "svg", mediaType: "image", binary: false, renderMode: "manual" },
    { id: "pdf", mediaType: "pdf", renderMode: "automatic" },
    { id: "html", mediaType: "html", renderMode: "manual" },
    { id: "markdown", mediaType: "markdown", renderMode: "manual" },
  ].map(({ id, mediaType, binary, renderMode }): FilePreviewerContribution => ({
    id,
    get title() { return options.content.messages.t("preview"); },
    renderMode: renderMode === "automatic" ? "automatic" : "manual",
    supports: ({ file }) => file.mediaType === mediaType && (binary === undefined || file.binary === binary),
    render: (input) => options.html`<pi-web-files-document-preview .input=${input} .content=${options.content} .contentRendering=${options.getContentRendering()} .stylesheetIntegration=${options.getStylesheetIntegration()}></pi-web-files-document-preview>`,
  }));
}
