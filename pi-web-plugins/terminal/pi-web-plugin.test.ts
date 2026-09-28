import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import plugin, { activateTerminalPlugin, TERMINAL_PANEL_ROUTE_ALIASES } from "./pi-web-plugin";

function activationContext(search = "") {
  const signal = new AbortController().signal;
  return {
    apiVersion: 4 as const,
    pluginId: "pi-web.terminal",
    runtimePluginId: "pi-web.terminal",
    html,
    svg,
    signal,
    lifetimeSignal: signal,
    search,
  };
}

describe("bundled terminal plugin", () => {
  it("activates at apiVersion 4 and contributes 终端 in normal mode", () => {
    expect(plugin.apiVersion).toBe(4);
    expect(plugin.name).toBe("终端");

    const activation = activateTerminalPlugin(activationContext());
    const panel = activation.contributions.workspacePanels?.[0];
    const action = activation.contributions.actions?.[0];

    expect(panel).toMatchObject({
      id: "workspace.terminal",
      title: "终端",
      order: 30,
      routeAliases: [...TERMINAL_PANEL_ROUTE_ALIASES],
    });
    expect(action).toMatchObject({
      id: "view.terminal",
      title: "转到终端",
      shortcut: "mod+4",
      shortcutAliases: ["core:view.terminal"],
      group: "导航",
    });
    expect(action?.run).toEqual(expect.any(Function));
    expect(panel?.render).toEqual(expect.any(Function));
    expect(panel?.badge).toEqual(expect.any(Function));
  });

  it("does not register an interactive terminal panel in management embed", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "?embed=management&token=secret" } },
    });
    try {
      const activation = plugin.activate(activationContext("?embed=management"));
      expect(activation.contributions.workspacePanels ?? []).toEqual([]);
      expect(activation.contributions.actions ?? []).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });
});
