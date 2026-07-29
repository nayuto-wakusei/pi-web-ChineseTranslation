import { describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { SettingsGeneralPanel } from "./SettingsGeneralPanel";
import type { GatewayServerConfigDraft, MachineAccessConfigDraft } from "./settingsConfigDraft";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";

describe("settings-general-panel copy", () => {
  it("uses factual scope copy for gateway and selected-machine settings", () => {
    const panel = new SettingsGeneralPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.configResponse = configResponse({ host: "127.0.0.1" });
    panel.machineConfigResponse = configResponse({ pathAccess: { allowedPaths: ["/mnt/share"] }, uploads: { defaultFolder: "manual/uploads" } });

    const template = panel.render();
    const strings = collectTemplateStrings(template).join("");
    const values = collectTemplateValues(template);

    expect(strings).toContain("<settings-panel-frame");
    expect(strings).toContain("网关服务器字段用于编辑当前本地网关；文件访问和上传默认值用于编辑 ");
    expect(strings).toContain("主机地址、端口和允许的主机名会保存到网关配置中。");
    expect(strings).toContain("外部文件系统根目录和上传默认值会保存到 ");
    expect(values.filter((value) => value === "Lab Mac (remote machine)")).toHaveLength(4);
  });

  it("shows reload copy when selected-machine access config is unavailable", () => {
    const panel = new SettingsGeneralPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.configResponse = configResponse({ host: "127.0.0.1" });
    panel.machineError = "Failed to load file access/upload config from Lab Mac (remote machine): unsupported";

    const template = panel.render();
    const values = collectTemplateValues(template);

    expect(values).toContain("保存网关服务器配置");
    expect(values).not.toContain("保存文件/上传配置");
    expect(values).toContain("所选机器的文件访问配置不可用。保存文件/上传设置前请重新加载。");
    expect(values).toContain("Failed to load file access/upload config from Lab Mac (remote machine): unsupported");
  });

  it("uses frame notices for saved and gateway messages while keeping selected-machine errors scoped", () => {
    const panel = new SettingsGeneralPanel();
    panel.error = "Gateway failed";
    panel.machineError = "Selected-machine failed";
    panel.savedMessage = "Config saved.";

    const values = collectTemplateValues(panel.render());
    const notices = values.find(isSettingsNoticeArray);

    expect(notices).toEqual([
      { type: "error", title: "网关服务器", content: "Gateway failed" },
      { type: "success", content: "Config saved." },
    ]);
    expect(values).toContain("Selected-machine failed");
  });
});

describe("settings-general-panel save payloads", () => {
  it("saves gateway server fields through the gateway save callback only", async () => {
    const panel = new SettingsGeneralPanel();
    const onSave = vi.fn();
    const onSaveMachineConfig = vi.fn();
    const event = new Event("submit", { cancelable: true });
    panel.configResponse = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["old.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: false } },
      pathAccess: { allowedPaths: ["/gateway"] },
      uploads: { defaultFolder: "gateway/uploads" },
      spawnSessions: true,
    });
    panel.onSave = onSave;
    panel.onSaveMachineConfig = onSaveMachineConfig;
    setPanelProperty(panel, "gatewayDraft", {
      host: " 0.0.0.0 ",
      port: "9000",
      allowedHostsMode: "all",
      allowedHostsText: "ignored.local",
    } satisfies GatewayServerConfigDraft);

    await callPanelPromise(panel, "saveGatewayConfig", event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSave.mock.calls).toEqual([[
      {
        host: "0.0.0.0",
        port: 9000,
        allowedHosts: true,
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: false } },
        pathAccess: { allowedPaths: ["/gateway"] },
        uploads: { defaultFolder: "gateway/uploads" },
        spawnSessions: true,
      },
    ]]);
    expect(onSaveMachineConfig).not.toHaveBeenCalled();
    expect(getPanelProperty(panel, "gatewayLocalError")).toBe("");
  });

  it("saves external roots and upload defaults through the selected-machine save callback only", async () => {
    const panel = new SettingsGeneralPanel();
    const onSave = vi.fn();
    const onSaveMachineConfig = vi.fn();
    const event = new Event("submit", { cancelable: true });
    panel.onSave = onSave;
    panel.onSaveMachineConfig = onSaveMachineConfig;
    setPanelProperty(panel, "machineDraft", {
      allowedPathsText: "/tmp\n~/SDKs\n",
      uploadDefaultFolder: " manual\\uploads/. ",
    } satisfies MachineAccessConfigDraft);

    await callPanelPromise(panel, "saveMachineAccessConfig", event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSaveMachineConfig.mock.calls).toEqual([[
      {
        pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] },
        uploads: { defaultFolder: "manual/uploads" },
      },
    ]]);
    expect(onSave).not.toHaveBeenCalled();
    expect(getPanelProperty(panel, "machineLocalError")).toBe("");
  });

  it("keeps invalid upload folders local and does not save selected-machine config", async () => {
    const panel = new SettingsGeneralPanel();
    const onSaveMachineConfig = vi.fn();
    panel.onSaveMachineConfig = onSaveMachineConfig;
    setPanelProperty(panel, "machineDraft", {
      allowedPathsText: "",
      uploadDefaultFolder: "/tmp/uploads",
    } satisfies MachineAccessConfigDraft);

    await callPanelPromise(panel, "saveMachineAccessConfig", new Event("submit", { cancelable: true }));

    expect(onSaveMachineConfig).not.toHaveBeenCalled();
    expect(getPanelProperty(panel, "machineLocalError")).toBe("Upload default folder must be workspace-relative.");
  });
});

function collectTemplateStrings(template: TemplateResult): string[] {
  const strings: string[] = [];
  visitTemplate(template);
  return strings;

  function visitTemplate(current: TemplateResult): void {
    strings.push(...templateStrings(current));
    for (const value of templateValues(current)) {
      if (Array.isArray(value)) {
        for (const item of value) if (isTemplateResult(item)) visitTemplate(item);
      } else if (isTemplateResult(value)) {
        visitTemplate(value);
      }
    }
  }
}

function collectTemplateValues(template: TemplateResult): unknown[] {
  const values: unknown[] = [];
  visit(template);
  return values;

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isTemplateResult(current)) return;
    for (const value of templateValues(current)) {
      values.push(value);
      visit(value);
    }
  }
}




function isSettingsNoticeArray(value: unknown): value is readonly { type: string; content: unknown; title?: string }[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item: unknown) => typeof item === "object" && item !== null && typeof Reflect.get(item, "type") === "string" && Reflect.has(item, "content"));
}


function setPanelProperty(panel: SettingsGeneralPanel, property: string, value: unknown): void {
  if (!Reflect.set(panel, property, value)) throw new Error(`Failed to set SettingsGeneralPanel property ${property}`);
}

function getPanelProperty(panel: SettingsGeneralPanel, property: string): unknown {
  return Reflect.get(panel, property);
}

async function callPanelPromise(panel: SettingsGeneralPanel, methodName: string, ...args: readonly unknown[]): Promise<void> {
  const result = callPanelMethod(panel, methodName, ...args);
  if (!(result instanceof Promise)) throw new Error(`SettingsGeneralPanel.${methodName} did not return a promise`);
  await result;
}

function callPanelMethod(panel: SettingsGeneralPanel, methodName: string, ...args: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(panel, methodName);
  if (!isPanelMethod(method)) throw new Error(`SettingsGeneralPanel.${methodName} is not callable`);
  return method.call(panel, ...args);
}

function isPanelMethod(value: unknown): value is (this: SettingsGeneralPanel, ...args: readonly unknown[]) => unknown {
  return typeof value === "function";
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
