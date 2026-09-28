import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import type { PluginActivationContext } from "@chainingintention/pi-web-cn/plugin-api";
import plugin, { activateFilesPlugin } from "./pi-web-plugin.js";

describe("bundled Files plugin", () => {
  it("activates browser API v4 with the Chinese files panel", () => {
    expect(plugin.apiVersion).toBe(4);
    const activation = activateFilesPlugin(activationContext());
    const panel = activation.contributions.workspacePanels?.[0];
    expect(panel).toEqual(expect.objectContaining({
      id: "workspace.files",
      title: "文件",
      order: 10,
      routeAliases: ["files", "core:workspace.files"],
    }));
    expect(activation.contributions.actions?.map((action) => action.title)).toEqual(["转到文件", "刷新文件"]);
  });

  it("rejects a mismatched plugin id before contributing a panel", () => {
    expect(() => activateFilesPlugin(activationContext("other"))).toThrow("Files browser entry must activate as plugin id files");
  });
});

function activationContext(pluginId = "files"): PluginActivationContext {
  return {
    apiVersion: 4,
    pluginId,
    runtimePluginId: pluginId,
    html,
    svg,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  };
}
