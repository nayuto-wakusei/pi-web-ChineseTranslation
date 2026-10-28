import { html, svg } from "lit";
import { describe, expect, it } from "vitest";
import plugin from "./pi-web-plugin";
import metadata from "./package.json" with { type: "json" };

describe("custom UI Codex", () => {
  it("declares gateway presentation regions including the file toolbar and neutral themes", () => {
    const controller = new AbortController();
    const activation = plugin.activate({ apiVersion: 5, pluginId: "pi-web.custom-ui-codex", runtimePluginId: "pi-web.custom-ui-codex", html, svg, signal: controller.signal, lifetimeSignal: controller.signal });
    expect(metadata.piWeb.plugins[0]).toMatchObject({ id: "pi-web.custom-ui-codex", defaultEnabled: true });
    expect(plugin.requires.map(({ id, version }) => [id, version])).toEqual([["ui-presentation", 1]]);
    expect(activation.contributions.uiPresentations.map(({ region }) => region)).toEqual(["files-toolbar", "navigation", "context-bar", "chat-chrome", "settings-navigation"]);
    expect(activation.contributions.themes.map(({ id }) => id)).toEqual(["paper", "graphite"]);
    expect(activation.contributions.themePairs[0]).toMatchObject({ id: "paper-graphite", light: "paper", dark: "graphite" });
    expect(activation.contributions.uiPresentations[1]).toMatchObject({ region: "navigation", navigationLayout: "tree" });
    expect(activation.contributions.stylesheets.map(({ id }) => id)).toEqual(["codex", "chat-settings"]);
    for (const presentation of activation.contributions.uiPresentations) {
      const result = presentation.render({ region: presentation.region, mode: "management", slots: [] });
      expect(result.strings.join("")).toContain("codex-");
    }
  });
});
