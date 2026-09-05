import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import type { AppAction } from "../../actions";
import type { PiWebConfigValues } from "../../api";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isTemplateResult, templateStrings, templateValues } from "../../templateInspection.testSupport";
import { collectTemplateValues, configResponse, expectTextOrder, flattenTemplateContent } from "../SettingsDialog.testSupport";

afterEach(() => {
  vi.unstubAllGlobals();
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
    vi.stubGlobal("HTMLInputElement", FakeHTMLInputElement);
    const onSave = vi.fn<SaveHandler>();
    const savePanel = panelWithShortcuts({ shortcuts: { "core:other": "mod+o" } }, onSave);

    findTemplateEventHandler<Event>(savePanel.render(), "@input=")(
      new EventWithTarget("input", new FakeHTMLInputElement(" control + shift + p ")),
    );

    expectTextOrder(flattenTemplateContent(savePanel.render()), ["Open palette", "Ctrl+Shift+P", "配置覆盖 · 未保存"]);

    findTemplateEventHandler<Event>(savePanel.render(), ">保存</button>")(new Event("click"));

    const nonePanel = panelWithShortcuts({ shortcuts: { "core:open-palette": "mod+shift+p", "core:other": "mod+o" } }, onSave);
    findTemplateEventHandler<Event>(nonePanel.render(), ">无</button>")(new Event("click"));

    const resetPanel = panelWithShortcuts({ shortcuts: { "core:open-palette": null, "core:other": "mod+o" } }, onSave);
    findTemplateEventHandler<Event>(resetPanel.render(), ">重置</button>")(new Event("click"));

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

function isSettingsNotice(value: unknown): value is SettingsNotice {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string" && Reflect.has(value, "content");
}

function isSettingsNoticeArray(value: unknown): value is readonly SettingsNotice[] {
  return Array.isArray(value) && value.every(isSettingsNotice);
}


type SaveHandler = (config: PiWebConfigValues) => void | Promise<void>;
type TemplateEventHandler<E extends Event> = (event: E) => void;

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

function findTemplateEventHandler<E extends Event>(template: TemplateResult, marker: string): TemplateEventHandler<E> {
  const handler = findOptionalTemplateEventHandler<E>(template, marker);
  if (handler === undefined) throw new Error(`Expected template event handler near ${marker}`);
  return handler;
}

function findOptionalTemplateEventHandler<E extends Event>(template: TemplateResult, marker: string): TemplateEventHandler<E> | undefined {
  return findInTemplate(template);

  function findInTemplate(current: TemplateResult): TemplateEventHandler<E> | undefined {
    const strings = templateStrings(current);
    const values = templateValues(current);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (isTemplateEventHandler<E>(value) && templateEventHandlerMatches(strings, index, marker)) return value;
      const nestedHandler = findInValue(value);
      if (nestedHandler !== undefined) return nestedHandler;
    }
    return undefined;
  }

  function findInValue(value: unknown): TemplateEventHandler<E> | undefined {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nestedHandler = findInValue(item);
        if (nestedHandler !== undefined) return nestedHandler;
      }
      return undefined;
    }
    if (isTemplateResult(value)) return findInTemplate(value);
    return undefined;
  }
}

function templateEventHandlerMatches(strings: readonly string[], valueIndex: number, marker: string): boolean {
  return (strings[valueIndex] ?? "").includes(marker) || (strings[valueIndex + 1] ?? "").includes(marker);
}

function isTemplateEventHandler<E extends Event>(value: unknown): value is TemplateEventHandler<E> {
  return typeof value === "function";
}

class FakeHTMLInputElement extends EventTarget {
  constructor(readonly value: string) {
    super();
  }
}

class EventWithTarget extends Event {
  constructor(type: string, private readonly eventTarget: EventTarget) {
    super(type);
  }

  override get target(): EventTarget {
    return this.eventTarget;
  }
}
