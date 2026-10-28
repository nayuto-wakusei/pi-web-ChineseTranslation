/// <reference types="vite/client" />
import { html, svg } from "lit";
import { describe, expect, it, vi } from "vitest";
import { runtimeContext } from "../../src/client/src/plugins/pluginRuntime.testSupport.js";
import { chinesePluginLocalization } from "../localization.testSupport.js";
import plugin from "./pi-web-plugin.js";
import { LocalizationService } from "../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../src/client/src/plugins/localization.js";

describe("Updates plugin actions", () => {
  it("keeps contribution labels live across language changes", async () => {
    const service = new LocalizationService({ development: true, preferences: { language: "en", formatLocale: "en-US" } });
    const contributions = plugin.activate({ ...activationContext(), localization: createPluginLocalization(service, "updates", "updates", new AbortController().signal) }).contributions;
    const action = contributions.actions[0];
    const panel = contributions.applicationPanels[0];
    if (action === undefined || panel === undefined) throw new Error("Missing Updates contributions");
    expect(panel.title).toBe("Updates");
    await service.setPreferences({ language: "en-XA", formatLocale: "en-US" });
    expect(panel.title).not.toBe("Updates");
    expect(action.title).not.toBe("Check for PI WEB Updates");
    expect(action.group).toBe(panel.title);
  });
  it("forces an update check through the host runtime context", async () => {
    const action = (await activatePlugin()).contributions.actions.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const checkForPiWebUpdates = vi.fn(() => Promise.resolve());
    const context = runtimeContext({ checkForPiWebUpdates });

    expect(action.title).toBe("检查 PI WEB 更新");
    expect(action.enabled(context)).toBe(true);
    await action.run(context);

    expect(checkForPiWebUpdates).toHaveBeenCalledOnce();
  });

  it("disables the action on older hosts without the update-check helper", async () => {
    const action = (await activatePlugin()).contributions.actions.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const context = runtimeContext();

    expect(action.enabled(context)).toBe(false);
    expect(action.disabledReason()).toContain("较新版本的 PI WEB 网关");
  });
});

function activationContext() {
  return {
    localization: createPluginLocalization(new LocalizationService({ preferences: { language: "en", formatLocale: "en-US", timeZone: "UTC" } }), "updates", "updates", new AbortController().signal),
    apiVersion: 4 as const,
    pluginId: "updates",
    runtimePluginId: "updates",
    html,
    svg,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  };
}

async function activatePlugin() {
  return plugin.activate({ ...activationContext(), localization: await chinesePluginLocalization("updates") });
}
