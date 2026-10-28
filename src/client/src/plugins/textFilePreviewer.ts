import type { ContentRenderingCapability, FilePreviewRequest } from "../../../plugin-api";
import type { RegisteredContentRenderer } from "./contentRenderers";
import type { RegisteredFilePreviewer } from "./filePreviewers";
import type { WorkspacePluginBinding } from "./types";

function textRequest(request: FilePreviewRequest) {
  return { machineId: request.machineId, text: request.file.content, filePath: request.file.path,
    truncated: request.file.truncated,
    ...(request.file.language === undefined ? {} : { language: request.file.language }) };
}

/** Reuse the text-rendering host, including its guards and chat-compatible API. */
export function textFilePreviewer(renderer: RegisteredContentRenderer, contentRendering: ContentRenderingCapability,
  binding: WorkspacePluginBinding, lifetime: AbortSignal): RegisteredFilePreviewer {
  return Object.freeze({
    id: renderer.id, pluginId: renderer.pluginId,
    get title() { return renderer.title ?? renderer.label; },
    renderMode: renderer.renderMode ?? "manual", binding, lifetime,
    ...(renderer.machineId === undefined ? {} : { machineId: renderer.machineId }),
    ...(renderer.sourcePluginId === undefined ? {} : { sourcePluginId: renderer.sourcePluginId }),
    supports: (request: Readonly<FilePreviewRequest>) => !lifetime.aborted && !request.file.binary
      && request.file.mediaType === undefined
      && contentRendering.listRenderers(textRequest(request)).some(({ id }) => id === renderer.id),
    render: (input) => {
      const preview = contentRendering.renderText({ ...textRequest(input), controls: "external",
        rendererId: renderer.id, allowManualPreview: true });
      if (preview === undefined) throw new Error(`Text renderer ${renderer.id} is unavailable`);
      return preview;
    },
  } satisfies RegisteredFilePreviewer);
}
