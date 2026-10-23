import { describe, expect, it } from "vitest";
import type { TemplateResult } from "lit";
import type { PiWebPluginInfo, PiWebPluginsResponse } from "../../api";
import { configResponse } from "../SettingsDialog.testSupport";
import { SettingsPluginsPanel, settingsPluginRows, type SettingsPluginRow } from "./SettingsPluginsPanel";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";

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

  it("uses conservative restart guidance after a save when active lifecycle state is unknown", () => {
    const panel = new SettingsPluginsPanel();
    panel.configResponse = configResponse({ plugins: { provider: { enabled: false } } });
    panel.savedMessage = "Config saved.";

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("Config saved. 重启会话守护进程以应用服务端插件更改");
    expect(rendered).not.toContain("Config saved. 重新加载浏览器标签页以应用仅浏览器插件的更改。");
  });

  it("does not show a false empty state when the plugin response is missing", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("Lab Mac (remote machine) 的 PI WEB 插件列表不可用，请重新加载。");
    expect(rendered).not.toContain("未发现 PI WEB 浏览器插件");
    expect(rendered).not.toContain("受信代码警告");
  });

  it("keeps exact offline recovery available when lifecycle loading failed before discovering plugins", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "local (local gateway)";
    panel.configResponse = configResponse({});
    panel.recoveryCommandsSupported = true;
    panel.error = "Failed to load PI WEB plugin lifecycle state.";

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("插件列表不可用");
    expect(rendered).toContain("local (local gateway) 的离线恢复");
    expect(rendered).toContain("pi-web plugins safe-start show");
    expect(rendered).toContain("pi-web plugins safe-start set none --restart");
  });

  it("does not claim local recovery commands are exact for an incompatible remote", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Old host (remote machine)";
    panel.configResponse = configResponse({});
    const response = pluginsResponse([]);
    response.serverRuntime.status = "incompatible";
    panel.pluginsResponse = response;

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("插件生命周期版本不匹配");
    expect(rendered).not.toContain("Old host 的离线恢复");
    expect(rendered).not.toContain("pi-web plugins safe-start show");
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

  it.each([
    ["bundled-only", "仅导入了内置服务端插件。"],
    ["none", "未导入任何服务端插件；终端不可用，核心目录工作区仍可用于诊断。"],
  ] as const)("renders active %s safe-start recovery", (safeStart, message) => {
    const panel = new SettingsPluginsPanel();
    const response = pluginsResponse([]);
    response.serverRuntime.safeStart = safeStart;
    response.serverRuntime.desiredSafeStart = safeStart;
    panel.pluginsResponse = response;

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("服务端插件安全启动模式已生效");
    expect(rendered).toContain(message);
    expect(rendered).toContain("pi-web plugins safe-start clear --restart");
  });

  it("renders every neutral server lifecycle state distinctly", () => {
    const states = ["active", "failed", "incompatible", "disabled", "missing", "unknown"] as const;
    const plugins = states.map((state) => {
      const value = pluginInfo(`state-${state}`, true);
      value.server = {
        state,
        desiredRevision: "1",
        ...(state === "active" ? { activeRevision: "1", health: { status: "healthy" as const } } : {}),
        staleRevision: false,
        restartRequired: state !== "active",
        disableCommand: `pi-web plugins disable state-${state} --restart`,
      };
      return value;
    });
    const panel = new SettingsPluginsPanel();
    panel.pluginsResponse = pluginsResponse(plugins);
    panel.configResponse = configResponse({});

    const rendered = flattenTemplateContent(panel.render());

    for (const label of ["已激活", "失败", "不兼容", "已禁用", "未激活", "活动状态不可用", "健康状态 正常"]) {
      expect(rendered).toContain(label);
    }
  });

  it("surfaces lifecycle failure, conflict, stale revision, safe mode, restart, and exact offline commands", () => {
    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    const failed = pluginInfo("broken-provider", true);
    failed.conflict = true;
    failed.server = {
      state: "failed",
      desiredRevision: "2",
      activeRevision: "1",
      phase: "start",
      message: "startup failed",
      health: { status: "unhealthy", message: "probe failed" },
      staleRevision: true,
      restartRequired: true,
      disableCommand: "pi-web plugins disable broken-provider --restart",
    };
    const response = pluginsResponse([failed]);
    response.serverRuntime.safeStart = "none";
    response.serverRuntime.desiredSafeStart = "off";
    response.serverRuntime.restartRequired = true;
    response.diagnostics = [{ kind: "conflict", snapshot: "active", source: "fixture", message: "Duplicate PI WEB plugin id: broken-provider", pluginId: "broken-provider" }];
    panel.pluginsResponse = response;
    panel.configResponse = configResponse({ plugins: { "broken-provider": { enabled: true } } });

    const rendered = flattenTemplateContent(panel.render());

    for (const label of [
      "服务端插件安全启动模式已生效",
      "未导入任何服务端插件",
      "安全启动模式等待重启",
      "离线配置已清除安全启动模式，但在 sessiond 重启前仍保持生效。",
      "需要重启会话守护进程",
      "插件 ID 冲突",
      "失败",
      "冲突",
      "版本过期",
      "需要重启",
      "健康状态 异常",
      "pi-web plugins disable broken-provider --restart",
      "pi-web plugins safe-start show",
      "pi-web plugins safe-start set bundled-only --restart",
      "pi-web plugins safe-start set none --restart",
      "pi-web plugins safe-start clear --restart",
      "命令中不包含机器凭据。",
    ]) expect(rendered).toContain(label);
  });

  it("uses saved config as desired truth and keeps configured-only ids editable when lifecycle data is unavailable", () => {
    const stalePlugin = pluginInfo("stale-ui", true);
    const config = configResponse({
      plugins: {
        "stale-ui": { enabled: false },
        "configured-only": { enabled: true, settings: { retained: true } },
      },
    });

    const rows = settingsPluginRows(pluginsResponse([stalePlugin]), config);
    expect(rows).toEqual([
      expect.objectContaining({ id: "configured-only", enabled: true, configOnly: true, editable: true }),
      expect.objectContaining({ id: "stale-ui", enabled: false, configOnly: false, editable: true }),
    ]);

    const panel = new SettingsPluginsPanel();
    panel.targetLabel = "local (local gateway)";
    panel.configResponse = config;
    const renderedWithoutLifecycle = flattenTemplateContent(panel.render());
    expect(renderedWithoutLifecycle).toContain("configured-only");
    expect(renderedWithoutLifecycle).toContain("仅有配置 · 未发现插件包");
    expect(renderedWithoutLifecycle).toContain("仅有配置");
    const configuredOnly = rows.find(({ id }) => id === "configured-only");
    if (configuredOnly === undefined) throw new Error("Expected configured-only settings row");
    expect(configuredOnly.editable).toBe(true);
  });

  it("renders required Terminal enabled and non-editable despite ordinary disable config", () => {
    const terminal = { ...pluginInfo("pi-web.terminal", true), required: true as const };
    const config = configResponse({ plugins: { "pi-web.terminal": { enabled: false } } });
    const [row] = settingsPluginRows(pluginsResponse([terminal]), config);
    if (row === undefined) throw new Error("Expected Terminal settings row");

    expect(row).toMatchObject({ id: "pi-web.terminal", enabled: true, editable: false, required: true });
    const panel = new SettingsPluginsPanel();
    panel.pluginsResponse = pluginsResponse([terminal]);
    panel.configResponse = config;
    const rendered = flattenTemplateContent(panel.render());
    expect(rendered).toContain("必需插件 · 普通配置无法禁用");
    expect(rendered).not.toContain("离线禁用：");
    expect(templateValues(renderPluginTemplate(panel, row)).filter(isBoolean)).toEqual([true]);
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
    expect(templateValues(renderPluginTemplate(panel, pluginInfo("remote-disabled", false))).filter(isBoolean)).toEqual([true]);
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

function renderPluginTemplate(panel: SettingsPluginsPanel, plugin: PiWebPluginInfo | SettingsPluginRow): TemplateResult {
  const renderPlugin: unknown = Reflect.get(panel, "renderPlugin");
  if (!isPanelRenderPlugin(renderPlugin)) throw new Error("SettingsPluginsPanel.renderPlugin is not callable");
  const row = "configOnly" in plugin ? plugin : settingsPluginRows(pluginsResponse([plugin]), panel.configResponse)[0];
  if (row === undefined) throw new Error("Expected a settings plugin row");
  return renderPlugin.call(panel, row);
}

function isPanelRenderPlugin(value: unknown): value is (this: SettingsPluginsPanel, plugin: SettingsPluginRow) => TemplateResult {
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
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isSettingsNotice(value: unknown): value is SettingsNotice {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string" && Reflect.has(value, "content");
}

function pluginsResponse(plugins: PiWebPluginInfo[]): PiWebPluginsResponse {
  return {
    lifecycleVersion: 2,
    plugins,
    diagnostics: [],
    serverRuntime: {
      status: "available",
      terminalMode: "recovery-disabled",
      restartRequired: false,
      recovery: {
        showSafeStart: "pi-web plugins safe-start show",
        bundledOnly: "pi-web plugins safe-start set bundled-only --restart",
        noServerPlugins: "pi-web plugins safe-start set none --restart",
        clearSafeStart: "pi-web plugins safe-start clear --restart",
      },
    },
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
    discovered: true,
    conflict: false,
  };
}
