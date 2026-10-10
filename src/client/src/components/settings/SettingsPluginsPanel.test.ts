import { describe, expect, it } from "vitest";
import type { TemplateResult } from "lit";
import type { PiWebPluginInfo } from "../../api";
import { SettingsPluginsPanel, settingsPluginRows, type SettingsPluginRow } from "./SettingsPluginsPanel";
import { flattenTemplateContent, configResponse, expectTextOrder, pluginInfo, pluginsResponse } from "../SettingsDialog.testSupport";
import { templateValues } from "../../templateInspection.testSupport";

describe("settings-plugins-panel layout", () => {
  it("orders load and save notices before the trusted-code warning and plugin content", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.configResponse = configResponse({ plugins: { "remote-enabled": { enabled: true } } });
    panel.pluginsResponse = pluginsResponse([pluginInfo("remote-enabled", true)]);
    panel.error = "Failed to load PI WEB plugin settings from Lab Mac: PI WEB plugins: timed out.";
    panel.savedMessage = "Config saved.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "PI WEB 插件",
      "比较期望插件配置与以下机器的 sessiond 活动启动快照：",
      "Lab Mac (remote machine)",
      "Failed to load PI WEB plugin settings from Lab Mac: PI WEB plugins: timed out.",
      "Config saved. 重新加载浏览器标签页以应用仅浏览器插件的更改。",
      "受信代码警告：",
      "Lab Mac (remote machine) 上的配置键：",
      "remote-enabled",
    ]);
  });

  it("does not show a false empty state when the plugin response is missing", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("Lab Mac (remote machine) 的 PI WEB 插件列表不可用，请重新加载。");
    expect(rendered).not.toContain("未发现 PI WEB 浏览器插件");
    expect(rendered).not.toContain("受信代码警告");
  });

  it("shows the empty plugin state only after a plugin response has loaded", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.pluginsResponse = pluginsResponse([]);

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("在 Lab Mac (remote machine) 上未发现或启用任何 PI WEB 插件。");
    expect(rendered).not.toContain("插件列表不可用");
    expect(rendered).not.toContain("受信代码警告");
  });

  it("keeps loaded plugins visible but disabled when selected-machine config is unavailable", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.pluginsResponse = pluginsResponse([pluginInfo("remote-disabled", false)]);

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "配置不可用。更改插件启用状态前请重新加载。",
      "受信代码警告：",
      "remote-disabled",
    ]);
    expect(countOccurrences(rendered, "配置不可用。更改插件启用状态前请重新加载。")).toBe(1);
    expect(templateValues(renderPluginTemplate(panel, pluginInfo("remote-disabled", false))).filter(isBoolean)).toEqual([false, true]);
  });

  it("maps plugin source, scope, and machine-specific metadata for display", () => {
    const panel = new SettingsPluginsPanel();
    const rendered = flattenTemplateContent(renderPluginTemplate(panel, {
      ...pluginInfo("bundled-user-plugin", true),
      source: "bundled",
      scope: "user",
      machineSpecific: true,
    }));

    expect(rendered).toContain("内置 · 用户范围 · 机器专属");
    expect(rendered).not.toContain("bundled · user");
    expect(rendered).not.toContain("machine-specific");
  });
});

function renderPluginTemplate(panel: SettingsPluginsPanel, plugin: PiWebPluginInfo): TemplateResult {
  const renderPlugin: unknown = Reflect.get(panel, "renderPlugin");
  if (!isPanelRenderPlugin(renderPlugin)) throw new Error("SettingsPluginsPanel.renderPlugin is not callable");
  const row = settingsPluginRows(pluginsResponse([plugin]), panel.configResponse)[0];
  if (row === undefined) throw new Error("Missing settings plugin row");
  return renderPlugin.call(panel, row);
}

function isPanelRenderPlugin(value: unknown): value is (this: SettingsPluginsPanel, plugin: SettingsPluginRow) => TemplateResult {
  return typeof value === "function";
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
