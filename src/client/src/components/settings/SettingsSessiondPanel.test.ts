import { describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import type { ActiveAgentProfileDescriptor, PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { SettingsSessiondPanel } from "./SettingsSessiondPanel";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";

describe("settings-sessiond-panel layout", () => {
  it("names the selected machine in the scope and restart notice when config is available", () => {
    const panel = new SettingsSessiondPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    setPanelConfig(panel, configResponse({
      agent: { command: "agent-lab", dir: "/srv/agent-lab" },
      spawnSessions: true,
      subsessions: false,
    }));
    panel.activeAgentProfile = activeProfile("pi", "/srv/pi");

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "会话守护进程",
      "这些设置会影响 Lab Mac (remote machine) 上长生命周期的会话运行时。",
      "重新加载",
      "Lab Mac (remote machine) 需要重启",
      "在该机器上运行 <code>pi-web restart</code>",
      "配置文件",
      "允许代理启动会话",
    ]);
  });

  it("orders save/load notices before the restart notice and settings content", () => {
    const panel = new SettingsSessiondPanel();
    setPanelConfig(panel, configResponse({ agent: { command: "agent-lab", dir: "/srv/agent-lab" }, spawnSessions: false }));
    panel.activeAgentProfile = activeProfile("pi", "/srv/pi");
    panel.error = "Failed to save session-daemon config.";
    panel.savedMessage = "Session daemon settings saved.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Failed to save session-daemon config.",
      "Session daemon settings saved.",
      "local (local gateway) 需要重启",
      "配置文件",
    ]);
  });

  it("shows the profile as active without restart guidance when desired and active match", () => {
    const panel = new SettingsSessiondPanel();
    setPanelConfig(panel, configResponse({ agent: { command: "agent-lab", dir: "/srv/agent-lab" } }));
    panel.activeAgentProfile = activeProfile("agent-lab", "/srv/agent-lab");

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain("Profile 状态");
    expect(rendered).toContain("已生效");
    expect(rendered).not.toContain("需要重启");
  });

  it("submits command and directory together as one profile save", async () => {
    const panel = new SettingsSessiondPanel();
    const onSave = vi.fn();
    setPanelConfig(panel, configResponse({ agent: { command: "pi", dir: "/srv/pi" } }));
    setPanelProperty(panel, "agentDraft", { command: " alternate-agent ", dir: " /srv/alternate " });
    panel.onSave = onSave;
    const event = new Event("submit", { cancelable: true });

    await callPanelPromise(panel, "saveAgentProfile", event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSave.mock.calls).toEqual([[{ agent: { command: "alternate-agent", dir: "/srv/alternate" } }]]);
  });

  it("preserves a dirty profile draft when an unrelated daemon setting is saved", () => {
    const panel = new SettingsSessiondPanel();
    const initial = configResponse({ agent: { command: "pi", dir: "/srv/pi" }, spawnSessions: false });
    setPanelConfig(panel, initial);
    callPanelMethod(panel, "updateAgentDraft", { command: "alternate-agent", dir: "/srv/alternate" });

    const toggled = configResponse({ agent: { command: "pi", dir: "/srv/pi" }, spawnSessions: true });
    panel.configResponse = toggled;
    callPanelMethod(panel, "willUpdate", new Map([["configResponse", initial]]));

    expect(Reflect.get(panel, "agentDraft")).toEqual({ command: "alternate-agent", dir: "/srv/alternate" });

    const saved = configResponse({ agent: { command: "alternate-agent", dir: "/srv/alternate" }, spawnSessions: true });
    panel.configResponse = saved;
    callPanelMethod(panel, "willUpdate", new Map([["configResponse", toggled]]));
    expect(Reflect.get(panel, "agentDraftDirty")).toBe(false);
  });

  it("shows one blocked content state without restart guidance or toggles when config is unavailable", () => {
    const panel = new SettingsSessiondPanel();
    panel.targetLabel = "Lab Mac (remote machine)";
    panel.error = "Selected-machine settings are not available on Lab Mac.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Selected-machine settings are not available on Lab Mac.",
      "配置不可用，请重新加载。",
    ]);
    expect(countOccurrences(rendered, "配置不可用，请重新加载。")).toBe(1);
    expect(rendered).not.toContain("需要重启");
    expect(rendered).not.toContain("允许代理启动会话");
    expect(rendered).not.toContain("环境变量覆盖后的生效配置");
  });
});

function activeProfile(command: string, dir: string): ActiveAgentProfileDescriptor {
  return {
    schemaVersion: 1,
    revision: `sha256:${"a".repeat(64)}`,
    command,
    dir,
    sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"],
  };
}

function setPanelConfig(panel: SettingsSessiondPanel, config: PiWebConfigResponse): void {
  panel.configResponse = config;
  callPanelMethod(panel, "willUpdate", new Map([["configResponse", undefined]]));
}

function setPanelProperty(panel: SettingsSessiondPanel, property: string, value: unknown): void {
  if (!Reflect.set(panel, property, value)) throw new Error(`Failed to set SettingsSessiondPanel property ${property}`);
}

async function callPanelPromise(panel: SettingsSessiondPanel, methodName: string, ...args: readonly unknown[]): Promise<void> {
  const result = callPanelMethod(panel, methodName, ...args);
  if (!(result instanceof Promise)) throw new Error(`SettingsSessiondPanel.${methodName} did not return a promise`);
  await result;
}

function callPanelMethod(panel: SettingsSessiondPanel, methodName: string, ...args: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(panel, methodName);
  if (typeof method !== "function") throw new Error(`SettingsSessiondPanel.${methodName} is not callable`);
  return Reflect.apply(method, panel, args);
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


function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
