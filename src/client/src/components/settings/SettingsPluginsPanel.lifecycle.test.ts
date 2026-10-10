// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPluginsPanel, settingsPluginRows } from "./SettingsPluginsPanel";
import { configResponse, pluginInfo, pluginsResponse } from "../SettingsDialog.testSupport";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

describe("plugin lifecycle settings interactions", () => {
  it("keeps required Terminal enabled and non-editable, including dispatched change events", async () => {
    const panel = new SettingsPluginsPanel();
    panel.configResponse = configResponse({ plugins: { "pi-web.terminal": { enabled: false } } });
    panel.pluginsResponse = pluginsResponse([{ ...pluginInfo("pi-web.terminal", true), required: true }]);
    panel.onTogglePlugin = vi.fn();
    document.body.append(panel);
    await panel.updateComplete;
    const checkbox = panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox === null || checkbox === undefined) throw new Error("Missing Terminal checkbox");
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(panel.onTogglePlugin).not.toHaveBeenCalled();
    expect(panel.shadowRoot?.textContent).toContain("必需插件 · 普通配置无法禁用");
    expect(panel.shadowRoot?.textContent).not.toContain("离线禁用：");
  });

  it("keeps config-only Terminal locked even when the runtime catalog failed", () => {
    const config = configResponse({ plugins: { "pi-web.terminal": { enabled: false }, ordinary: { enabled: true } } });
    expect(settingsPluginRows(undefined, config)).toEqual([
      expect.objectContaining({ id: "ordinary", editable: true }),
      expect.objectContaining({ id: "pi-web.terminal", required: true, enabled: true, editable: false }),
    ]);
  });

  it("renders exact safe-start recovery and stale failure diagnostics without runtime secrets", async () => {
    const panel = new SettingsPluginsPanel();
    const response = pluginsResponse([]);
    response.serverRuntime = { ...response.serverRuntime, terminalMode: "recovery-disabled", safeStart: "none", desiredSafeStart: "off", restartRequired: true };
    response.diagnostics = [{ kind: "conflict", snapshot: "active", source: "fixture", message: "Duplicate plugin" }];
    panel.pluginsResponse = response;
    document.body.append(panel);
    await panel.updateComplete;
    const frame = panel.shadowRoot?.querySelector("settings-panel-frame");
    if (frame === null || frame === undefined) throw new Error("Missing panel frame");
    await frame.updateComplete;
    expect(frame.shadowRoot?.textContent).toContain("终端不可用");
    expect(frame.shadowRoot?.textContent).toContain("安全启动模式等待重启");
    expect(frame.shadowRoot?.textContent).toContain("需要重启会话守护进程");
    expect(frame.shadowRoot?.textContent).toContain("插件 ID 冲突");
    expect(panel.shadowRoot?.textContent).toContain("pi-web plugins safe-start set none --restart");
    expect(panel.shadowRoot?.textContent).toContain("命令中不包含机器凭据");
  });
});
