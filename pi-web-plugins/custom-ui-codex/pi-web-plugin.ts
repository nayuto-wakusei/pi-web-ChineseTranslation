import type { PiWebPluginV5, PluginCapability, UiPresentationCapabilityV1, UiPresentationRenderContextV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { renderNewFileIcon, renderNewFolderIcon, renderUploadIcon, renderDownloadIcon, renderRenameIcon, renderDeleteIcon, renderRefreshIcon } from "./fileIcons";

const presentationCapability: PluginCapability<UiPresentationCapabilityV1> = {
  pluginId: "pi-web", id: "ui-presentation", version: 1,
  parse: (value) => {
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 || !("regions" in value) || !Array.isArray(value.regions)) throw new Error("UI presentation capability v1 is unavailable");
    return { version: 1, regions: ["navigation", "context-bar", "chat-chrome", "settings-navigation"] };
  },
};

/** PI WEB-native presentation inspired by DSH Codex UI; no DSH runtime or stores. */
export default {
  apiVersion: 5,
  name: "Custom UI Codex",
  requires: [presentationCapability],
  activate: ({ html, svg, translate }) => {
    const t = (key: string, fallback: string): string => translate?.(key, fallback) ?? fallback;
    const slot = (name: string) => html`<slot name=${name}></slot>`;
    // Lucide icons, ISC/MIT. Attribution is bundled in LICENSE-icons.
    const icon = (id: string) => svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
      id === "new-task" ? svg`<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>`
        : id === "search" ? svg`<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>`
          : id === "add-project" ? svg`<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`
            : svg`<path d="M14 17H5M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>`
    }</svg>`;
    const actions = (context: UiPresentationRenderContextV1, footer: boolean) => (context.actions ?? []).filter((action) => (action.id === "settings") === footer).map((action) => html`
      <button type="button" class="ui-button codex-command" title=${action.label} ?disabled=${action.disabled === true} @click=${action.run}>${icon(action.id)}<span>${action.label}</span></button>
    `);
    return {
      contributions: {
        stylesheets: [
          { id: "codex", url: new URL("./codex.css?no-inline", import.meta.url).href, order: 1100 },
          { id: "chat-settings", url: new URL("./chat-settings.css?no-inline", import.meta.url).href, order: 1101 },
        ],
        themes: [
          { id: "paper", name: "Paper", description: t("client.themes.paper.description", "White and neutral grays with restrained status colors."), order: 40, colorScheme: "light", stylesheets: [{ id: "palette", url: new URL("./paper.css?no-inline", import.meta.url).href }] },
          { id: "graphite", name: "Graphite", description: t("client.themes.graphite.description", "Charcoal and neutral grays with restrained status colors."), order: 50, colorScheme: "dark", stylesheets: [{ id: "palette", url: new URL("./graphite.css?no-inline", import.meta.url).href }] },
        ],
        themePairs: [{ id: "paper-graphite", name: "Paper / Graphite", description: t("client.themes.neutralPair.description", "Follow the system light/dark preference with neutral gray themes."), order: 20, light: "paper", dark: "graphite" }],
        uiPresentations: [
          { id: "files-toolbar", region: "files-toolbar", render: (context) => html`<span class="codex-files-toolbar ui-toolbar-group">${(context.actions ?? []).map((action) => {
            const icons = new Map([["new-file", renderNewFileIcon], ["new-folder", renderNewFolderIcon], ["upload", renderUploadIcon], ["download", renderDownloadIcon], ["rename", renderRenameIcon], ["delete", renderDeleteIcon], ["refresh", renderRefreshIcon]]);
            const renderIcon = icons.get(action.id);
            return html`<button type="button" class="ui-button" title=${action.label} aria-label=${action.label} ?disabled=${action.disabled === true} @click=${action.run}>${renderIcon === undefined ? action.label : renderIcon()}</button>`;
          })}</span>` },
          { id: "navigation", region: "navigation", navigationLayout: "tree", render: (context) => html`
            <div class="codex-navigation" data-mode=${context.mode}>
              <div class="codex-header">${slot("header")}</div>
              <div class="codex-commands">${actions(context, false)}</div>
              <div class="codex-machines">${slot("machines")}</div>
              <div class="codex-project-tree">
                ${slot("projects")}${slot("workspaces")}${slot("sessions")}
              </div>
              <footer class="codex-footer">${actions(context, true)}</footer>
            </div>
          ` },
          { id: "context-bar", region: "context-bar", render: () => html`<div class="codex-context-bar"><div class="codex-context-content">${slot("content")}</div><div class="codex-context-actions">${slot("actions")}</div></div>` },
          { id: "chat-chrome", region: "chat-chrome", render: () => html`<div class="codex-chat-shell"><div class="codex-transcript">${slot("transcript")}</div><div class="codex-composer">${slot("composer")}</div></div>` },
          { id: "settings-navigation", region: "settings-navigation", render: () => html`<div class="codex-settings-navigation">${slot("navigation")}</div>` },
        ],
      },
    };
  },
} satisfies PiWebPluginV5;
