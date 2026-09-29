import type { ContentRendererInput, PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { mountMermaidPreview } from "./mermaidPreviewElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "图表",
  requires: [{ pluginId: "pi-web", id: "content-rendering", version: 1, parse: () => undefined }],
  activate: () => ({
    contributions: {
      contentRenderers: [{
        id: "diagram",
        languages: ["mermaid"],
        fileExtensions: ["mmd", "mermaid"],
        render: (input: ContentRendererInput) => mountMermaidPreview(input),
      }],
    },
  }),
};

export default plugin;
