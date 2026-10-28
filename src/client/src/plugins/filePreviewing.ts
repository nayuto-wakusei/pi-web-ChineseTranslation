import { html } from "lit";
import type { FilePreviewingCapability, FilePreviewRequest, PluginCapability } from "../../../plugin-api";
import { snapshotDisplayMetadata } from "./displayMetadata";
import { snapshotFilePreviewRequest, type RegisteredFilePreviewer } from "./filePreviewers";
import "../components/FilePreviewerHost";

function isFilePreviewingCapability(value: unknown): value is FilePreviewingCapability {
  return typeof value === "object" && value !== null
    && "listPreviewers" in value && typeof value.listPreviewers === "function"
    && "renderPreview" in value && typeof value.renderPreview === "function";
}

export const filePreviewingCapabilityToken: PluginCapability<FilePreviewingCapability> = {
  pluginId: "pi-web", id: "file-previewing", version: 1,
  parse(value) {
    if (!isFilePreviewingCapability(value)) throw new Error("File previewing capability v1 is unavailable");
    return value;
  },
};

export function createFilePreviewingCapability(select: (request: FilePreviewRequest) => readonly RegisteredFilePreviewer[]): FilePreviewingCapability {
  return Object.freeze({
    listPreviewers(request) {
      return select(snapshotFilePreviewRequest(request)).map((previewer) => Object.freeze(snapshotDisplayMetadata(previewer, {
        id: previewer.id, get label() { return previewer.title; }, title: previewer.title, renderMode: previewer.renderMode ?? "manual",
      })));
    },
    renderPreview(request) {
      const snapshot = snapshotFilePreviewRequest(request);
      const previewer = select(snapshot).find(({ id }) => id === request.previewerId);
      if (previewer === undefined) return undefined;
      const input = { ...snapshot, previewerId: request.previewerId, files: request.files, fail: request.fail };
      return html`<pi-web-file-previewer .request=${input} .previewer=${previewer}
        .eligible=${() => select(snapshot).includes(previewer)}></pi-web-file-previewer>`;
    },
  } satisfies FilePreviewingCapability);
}
