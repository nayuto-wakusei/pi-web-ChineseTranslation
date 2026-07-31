import { describe, expect, it } from "vitest";
import type { TemplateResult } from "lit";
import type { PiWebConfigResponse, PiWebConfigValues, PiWebPluginInfo } from "../../api";
import { SettingsPluginsPanel } from "./SettingsPluginsPanel";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";

describe("settings-plugins-panel layout", () => {
  it("orders load and save notices before the trusted-code warning and plugin content", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.configResponse = configResponse({ plugins: { "remote-enabled": { enabled: true } } });
    panel.pluginsResponse = { plugins: [pluginInfo("remote-enabled", true)] };
    panel.error = "Failed to load PI WEB plugin settings from Lab Mac: PI WEB plugins: timed out.";
    panel.savedMessage = "Config saved.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "PI WEB 插件",
      "启用或禁用 ",
      "Lab Mac (remote machine)",
      "Failed to load PI WEB plugin settings from Lab Mac: PI WEB plugins: timed out.",
      "Config saved. 重新加载浏览器标签页以应用插件更改。",
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
    panel.pluginsResponse = { plugins: [] };

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("在 Lab Mac (remote machine) 上未发现 PI WEB 浏览器插件。");
    expect(rendered).not.toContain("插件列表不可用");
    expect(rendered).not.toContain("受信代码警告");
  });

  it("keeps loaded plugins visible but disabled when selected-machine config is unavailable", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.pluginsResponse = { plugins: [pluginInfo("remote-disabled", false)] };

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
  return renderPlugin.call(panel, plugin);
}

function isPanelRenderPlugin(value: unknown): value is (this: SettingsPluginsPanel, plugin: PiWebPluginInfo) => TemplateResult {
  return typeof value === "function";
}

function flattenTemplateContent(template: TemplateResult): string {
  const chunks: string[] = [];
  visitTemplate(template);
  return chunks.join("");

  function visitTemplate(current: TemplateResult): void {
    const strings = templateStrings(current);
    const values = templateValues(current);
    for (let index = 0; index < values.length; index += 1) {
      const staticChunk = strings[index];
      if (staticChunk !== undefined) chunks.push(staticChunk);
      visitValue(values[index]);
    }
    const finalChunk = strings[values.length];
    if (finalChunk !== undefined) chunks.push(finalChunk);
  }

  function visitValue(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visitValue(item);
      return;
    }
    if (isSettingsNotice(value)) {
      visitValue(value.title);
      visitValue(value.content);
      return;
    }
    if (isTemplateResult(value)) {
      visitTemplate(value);
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      chunks.push(String(value));
    }
  }
}

function expectTextOrder(content: string, labels: readonly string[]): void {
  let previousIndex = -1;
  for (const label of labels) {
    const currentIndex = content.indexOf(label, previousIndex + 1);
    if (currentIndex === -1) throw new Error(`Expected rendered content to include ${label}`);
    expect(currentIndex).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}




function isSettingsNotice(value: unknown): value is SettingsNotice {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string" && Reflect.has(value, "content");
}


function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

function pluginInfo(id: string, enabled: boolean): PiWebPluginInfo {
  return {
    id,
    module: `/pi-web-plugins/${id}/plugin.js`,
    source: "test",
    scope: "local",
    machineSpecific: false,
    enabled,
  };
}
