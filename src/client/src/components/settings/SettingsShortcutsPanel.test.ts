// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("settings-shortcuts-panel layout", () => {
  it("renders header, ordered notices, and shortcut settings through the shared frame", () => {
    const panel = new SettingsShortcutsPanel();
    panel.configResponse = configResponse({ shortcuts: {} });
    panel.error = "Failed to load shortcut settings.";
    panel.savedMessage = "Shortcut settings saved.";

    const template = panel.render();
    const rendered = flattenTemplateContent(template);

    expect(rendered).toContain("<settings-panel-frame");
    expect(frameNotices(template).map((notice) => notice.type)).toEqual(["error", "success"]);
    expectTextOrder(rendered, [
      "键盘快捷键",
      "按操作编辑应用快捷键。",
      "<code>mod+k</code>",
      "重新加载",
      "Failed to load shortcut settings.",
      "Shortcut settings saved.",
      "聊天输入框",
      "配置文件",
      "没有已注册操作。",
    ]);
  });

  it("keeps the prompt-enter card before the loading shortcuts state", () => {
    const panel = new SettingsShortcutsPanel();
    panel.loading = true;

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, ["键盘快捷键", "聊天输入框", "正在加载快捷键…"]);
    expect(rendered).not.toContain("配置文件");
  });
});

describe("settings-shortcuts-panel shortcut row actions", () => {
  it("saves edited shortcuts, disables them with None, and resets overrides", () => {
    const onSave = vi.fn<SaveHandler>();
    const savePanel = panelWithShortcuts({ shortcuts: { "core:other": "mod+o" } }, onSave);

    const input = renderPanel(savePanel).querySelector<HTMLInputElement>(".shortcut-input");
    if (input === null) throw new Error("Shortcut input is unavailable");
    input.value = " control + shift + p ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expectTextOrder(flattenTemplateContent(savePanel.render()), ["Open palette", "Ctrl+Shift+P", "配置覆盖 · 未保存"]);

    clickButton(savePanel, "保存");

    const nonePanel = panelWithShortcuts({ shortcuts: { "core:open-palette": "mod+shift+p", "core:other": "mod+o" } }, onSave);
    clickButton(nonePanel, "无");

    const resetPanel = panelWithShortcuts({ shortcuts: { "core:open-palette": null, "core:other": "mod+o" } }, onSave);
    clickButton(resetPanel, "重置");

    expect(onSave.mock.calls).toEqual([
      [{ shortcuts: { "core:other": "mod+o", "core:open-palette": "mod+shift+p" } }],
      [{ shortcuts: { "core:open-palette": null, "core:other": "mod+o" } }],
      [{ shortcuts: { "core:other": "mod+o" } }],
    ]);
  });
});

function frameNotices(template: TemplateResult): readonly SettingsNotice[] {
  const notices = collectTemplateValues(template).find(isSettingsNoticeArray);
  if (notices === undefined) throw new Error("Expected settings-panel-frame notices to be rendered");
  return notices;
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

function expectTextOrder(content: string, labels: readonly string[]): void {
  let previousIndex = -1;
  for (const label of labels) {
    const currentIndex = content.indexOf(label, previousIndex + 1);
    if (currentIndex === -1) throw new Error(`Expected rendered content to include ${label}`);
    expect(currentIndex).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
}




function isSettingsNotice(value: unknown): value is SettingsNotice {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string" && Reflect.has(value, "content");
}

function isSettingsNoticeArray(value: unknown): value is readonly SettingsNotice[] {
  return Array.isArray(value) && value.every(isSettingsNotice);
}


type SaveHandler = (config: PiWebConfigValues) => void | Promise<void>;

function panelWithShortcuts(config: PiWebConfigValues, onSave: SaveHandler): SettingsShortcutsPanel {
  const panel = new SettingsShortcutsPanel();
  panel.actions = [shortcutAction()];
  panel.configResponse = configResponse(config);
  panel.onSave = onSave;
  return panel;
}

function shortcutAction(): AppAction {
  return {
    id: "core:open-palette",
    title: "Open palette",
    description: "Open the command palette.",
    shortcut: "mod+k",
    group: "Navigation",
    run: vi.fn(),
  };
}

function renderPanel(panel: SettingsShortcutsPanel): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(panel.render(), container);
  return container;
}

function clickButton(panel: SettingsShortcutsPanel, label: string): void {
  const button = [...renderPanel(panel).querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  if (button === undefined) throw new Error(`Missing ${label} button`);
  button.click();
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
