import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { audioMimeTypes } from "./audioFormats.js";
import { registerAudioPreviewElement, type AudioModel } from "./audioElement.js";

const plugin = {
  apiVersion: 5,
  name: "Audio",
  activate: ({ html, localization }) => {
    if (localization === undefined) throw new Error("Audio requires localization support");
    const messages = localization.registerMessages("preview", {
      audio: localization.message("Audio", "Audio file preview title and player accessible name"),
      failed: localization.message("Audio could not play. Download the file or open it externally.", "Audio decoding or network failure with fallback actions in the Files toolbar"),
    });
    registerAudioPreviewElement();
    return { contributions: { filePreviewers: [{
      id: "audio",
      get title() { return messages.t("audio"); },
      fileExtensions: Object.keys(audioMimeTypes),
      renderMode: "automatic",
      render: ({ backend, projectId, workspaceId, file, signal, fail }) => {
        try {
          const peer = backend?.forScope({ kind: "workspace", projectId, workspaceId });
          if (peer?.resourceUrl === undefined) throw new Error(messages.t("failed"));
          const model: AudioModel = {
            url: peer.resourceUrl("audio.read", { path: file.path }),
            signal, fail, label: messages.t("audio"), errorMessage: messages.t("failed"),
          };
          return html`<pi-web-audio-preview .model=${model}></pi-web-audio-preview>`;
        } catch {
          fail(new Error(messages.t("failed")));
          return html`<p role="alert">${messages.t("failed")}</p>`;
        }
      },
    }] } };
  },
} satisfies PiWebPlugin;

export default plugin;
