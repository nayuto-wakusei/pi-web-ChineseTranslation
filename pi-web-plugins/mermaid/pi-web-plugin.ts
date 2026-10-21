import { t, setTranslator } from "./i18n.js";
import type { ContentRendererInput, PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { loadMermaidEngine, MermaidPreview } from "./MermaidPreview.js";

const plugin: Extract<PiWebPlugin, { apiVersion: 4 }> = {
  apiVersion: 4,
  name: t("ui.main.a66b71e29e45", "Mermaid diagram"),
  requires: [{ pluginId: "pi-web", id: "content-rendering", version: 1, parse: () => undefined }],
  activate: ({ html, translate }) => {
    setTranslator(translate);
    // Portable machine copies share one tag, but use the active package's loader.
    if (customElements.get("pi-web-mermaid-preview") === undefined) customElements.define("pi-web-mermaid-preview", MermaidPreview);
    return {
      contributions: {
        contentRenderers: [{
          id: "diagram",
          languages: ["mermaid"],
          fileExtensions: ["mmd", "mermaid"],
          render: (input: ContentRendererInput) => html`<pi-web-mermaid-preview .input=${input} .loadEngine=${loadMermaidEngine}></pi-web-mermaid-preview>`,
        }],
      },
    };
  },
};

export default plugin;
