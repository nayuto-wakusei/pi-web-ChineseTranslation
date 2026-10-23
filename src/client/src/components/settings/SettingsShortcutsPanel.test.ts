// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "../../actions";
import type { PiWebConfigValues } from "../../api";
import { configResponse } from "../SettingsDialog.testSupport";
import { COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE } from "../../composerShortcuts";
import { shortcutSequenceTimeoutMs } from "../../keyboardShortcuts";
import { readPromptEnterPreference } from "../../promptEnterBehavior";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("settings-shortcuts-panel layout", () => {
  it("renders the shared frame, ordered notices, and composer actions without registered app actions", async () => {
    const panel = new SettingsShortcutsPanel();
    panel.configResponse = configResponse({ shortcuts: {} });
    panel.error = "Failed to load shortcut settings.";
    panel.savedMessage = "Shortcut settings saved.";
    panel.onReload = vi.fn();
    await mount(panel);

    const frame = frameRoot(panel);
    expect(frame.querySelector("h2")?.textContent).toBe("键盘快捷键");
    expect(frame.querySelector(".description")?.textContent).toContain("按操作编辑应用快捷键。");
    expect(frame.querySelector("code")?.textContent).toBe("mod+k");
    expect([...frame.querySelectorAll(".notice")].map((notice) => ({
      role: notice.getAttribute("role"),
      text: notice.textContent.trim(),
    }))).toEqual([
      { role: "alert", text: "Failed to load shortcut settings." },
      { role: "status", text: "Shortcut settings saved." },
    ]);
    button(frame, "重新加载").click();
    expect(panel.onReload).toHaveBeenCalledOnce();
    expect(panel.renderRoot.querySelector(".config-path-card")?.textContent).toContain("/tmp/pi-web/config.json");
    expect([...panel.renderRoot.querySelectorAll(".shortcut-group h3")].map((heading) => heading.textContent)).toEqual(["发送行为", "聊天输入框"]);
    expect(row(panel, COMPOSER_SEND_DESKTOP).textContent).toContain("发送消息 — 桌面");
    expect(row(panel, COMPOSER_SEND_MOBILE).textContent).toContain("发送消息 — 窄屏");
    expect(panel.renderRoot.querySelectorAll("article")).toHaveLength(2);
    expect(panel.renderRoot.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(panel.renderRoot.textContent).not.toContain("没有已注册操作。");
  });

  it("preserves browser Enter defaults alongside the loading state", async () => {
    const panel = new SettingsShortcutsPanel();
    panel.loading = true;
    await mount(panel);

    expect(frameRoot(panel).querySelector("h2")?.textContent).toBe("键盘快捷键");
    expect(button(frameRoot(panel), "重新加载").disabled).toBe(true);
    expect(panel.renderRoot.querySelector(".loading-card")?.textContent).toBe("正在加载快捷键…");
    expect(panel.renderRoot.querySelector(".config-path-card")).toBeNull();
    expect(panel.renderRoot.querySelector(".prompt-enter-card")).not.toBeNull();
  });
});

describe("settings-shortcuts-panel shortcut row actions", () => {
  it("saves edited shortcuts, disables them with None, and resets overrides", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: { "core:other": "mod+o" } }, onSave);
    await editShortcut(panel, "core:open-palette", " control + shift + p ");

    expect(row(panel, "core:open-palette").querySelector(".shortcut-status")?.textContent).toContain("Ctrl+Shift+P");
    expect(row(panel, "core:open-palette").textContent).toContain("配置覆盖 · 未保存");
    await clickRow(panel, "core:open-palette", "保存");
    expect(onSave).toHaveBeenLastCalledWith({ shortcuts: { "core:other": "mod+o", "core:open-palette": "mod+shift+p" } });

    panel.configResponse = configResponse({ shortcuts: { "core:open-palette": "mod+shift+p", "core:other": "mod+o" } });
    await settle(panel);
    await clickRow(panel, "core:open-palette", "无");
    expect(onSave).toHaveBeenLastCalledWith({ shortcuts: { "core:open-palette": null, "core:other": "mod+o" } });

    panel.configResponse = configResponse({ shortcuts: { "core:open-palette": null, "core:other": "mod+o" } });
    await settle(panel);
    expect(row(panel, "core:open-palette").textContent).toContain("配置禁用");
    await clickRow(panel, "core:open-palette", "重置");
    expect(onSave).toHaveBeenLastCalledWith({ shortcuts: { "core:other": "mod+o" } });
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it.each(["保存", "无", "重置"] as const)("migrates former action ids when using %s", async (operation) => {
    const onSave = vi.fn<SaveHandler>();
    const action = shortcutAction({ id: "git:view.git", shortcutAliases: ["core:view.git"], shortcut: "mod+3" });
    const panel = await panelWithShortcuts({ shortcuts: { "core:view.git": "mod+8", "core:other": "mod+o" } }, onSave, action);

    expect(input(panel, action.id).value).toBe("mod+8");
    expect(row(panel, action.id).querySelector(".shortcut-status")?.textContent).toContain("Ctrl+8");
    expect(row(panel, action.id).textContent).toContain("配置覆盖");
    if (operation === "保存") await editShortcut(panel, action.id, "mod+9");
    await clickRow(panel, action.id, operation);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      shortcuts: {
        "core:other": "mod+o",
        ...(operation === "重置" ? {} : { "git:view.git": operation === "无" ? null : "mod+9" }),
      },
    });
  });
});

describe("settings-shortcuts-panel composer shortcuts", () => {
  it("keeps browser Enter defaults while preserving an explicit desktop send binding", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: { [COMPOSER_SEND_DESKTOP]: "mod+enter" } }, onSave);
    const newline = panel.renderRoot.querySelector<HTMLInputElement>('input[type="radio"][value="newline"]');
    if (newline === null) throw new Error("Expected browser Enter preference");
    newline.click();
    await settle(panel);
    expect(readPromptEnterPreference()).toBe("newline");
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
    expect(input(panel, COMPOSER_SEND_MOBILE).value).toBe("shift+enter");
    expect(onSave).not.toHaveBeenCalled();
  });
  it("saves desktop and mobile independently even when both share an app shortcut", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: {} }, onSave);
    for (const actionId of [COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE]) {
      const otherId = actionId === COMPOSER_SEND_DESKTOP ? COMPOSER_SEND_MOBILE : COMPOSER_SEND_DESKTOP;
      const otherBinding = input(panel, otherId).value;
      await editShortcut(panel, actionId, "mod+k");
      expect(input(panel, otherId).value).toBe(otherBinding);
      expect(panel.renderRoot.querySelector(".conflict")).toBeNull();
      await clickRow(panel, actionId, "保存");
      const savedConfig = onSave.mock.lastCall?.[0];
      expect(savedConfig).toEqual({ shortcuts: {
        ...(actionId === COMPOSER_SEND_MOBILE ? { [COMPOSER_SEND_DESKTOP]: "mod+k" } : {}),
        [actionId]: "mod+k",
      } });
      panel.configResponse = configResponse(savedConfig ?? {});
      await settle(panel);
    }
    for (const actionId of [COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE, "core:open-palette"]) {
      expect(input(panel, actionId).value).toBe("mod+k");
    }
    expect(panel.renderRoot.querySelector(".conflict")).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it.each([COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE])("rejects a multi-key sequence for %s on save", async (actionId) => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: {} }, onSave);
    await editShortcut(panel, actionId, "g p");
    await clickRow(panel, actionId, "保存");

    expect(onSave).not.toHaveBeenCalled();
    expect(frameRoot(panel).querySelector('[role="alert"]')?.textContent).toContain(
      "发送快捷键只能使用一个组合键，不能使用按键序列。",
    );
    expect(input(panel, actionId).value).toBe("g p");
  });

  it.each([COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE])("records one combination and stops immediately for %s", async (actionId) => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: {} }, onSave);
    await clickRow(panel, actionId, "录制");
    expect(panel.shadowRoot?.activeElement).toBe(input(panel, actionId));
    pressKey("Enter", { shiftKey: true });
    await settle(panel);

    expect(input(panel, actionId).value).toBe("shift+enter");
    expect(row(panel, actionId).querySelector(".recording-hint")).toBeNull();
    expect(button(row(panel, actionId), "录制")).toBeDefined();
    pressKey("p");
    await settle(panel);
    expect(input(panel, actionId).value).toBe("shift+enter");
    expect(onSave).not.toHaveBeenCalled();
    await clickRow(panel, actionId, "保存");
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ shortcuts: { [actionId]: "shift+enter" } });
  });

  it("records an unmodified global g p sequence and finishes after the sequence timeout", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: {} }, onSave);
    await clickRow(panel, "core:open-palette", "录制");
    pressKey("g");
    await settle(panel);
    expect(input(panel, "core:open-palette").value).toBe("g");
    pressKey("p");
    await settle(panel);
    expect(input(panel, "core:open-palette").value).toBe("g p");
    expect(button(row(panel, "core:open-palette"), "取消录制")).toBeDefined();

    await vi.advanceTimersByTimeAsync(shortcutSequenceTimeoutMs);
    await settle(panel);
    expect(row(panel, "core:open-palette").querySelector(".recording-hint")).toBeNull();
    expect(button(row(panel, "core:open-palette"), "录制")).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
    await clickRow(panel, "core:open-palette", "保存");
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ shortcuts: { "core:open-palette": "g p" } });
  });
});

type SaveHandler = (config: PiWebConfigValues) => void | Promise<void>;

async function settle(panel: SettingsShortcutsPanel): Promise<void> {
  await panel.updateComplete;
  const frame = panel.renderRoot.querySelector("settings-panel-frame");
  if (frame === null) throw new Error("Expected settings panel frame");
  await frame.updateComplete;
}

async function mount(panel: SettingsShortcutsPanel): Promise<void> {
  document.body.append(panel);
  await settle(panel);
}

function frameRoot(panel: SettingsShortcutsPanel): ShadowRoot {
  const root = panel.renderRoot.querySelector("settings-panel-frame")?.shadowRoot;
  if (root == null) throw new Error("Expected settings panel frame shadow root");
  return root;
}

function input(panel: SettingsShortcutsPanel, actionId: string): HTMLInputElement {
  const result = [...panel.renderRoot.querySelectorAll("input")].find((element) => element.dataset["actionId"] === actionId);
  if (result === undefined) throw new Error(`Expected shortcut input for ${actionId}`);
  return result;
}

function row(panel: SettingsShortcutsPanel, actionId: string): HTMLElement {
  const result = input(panel, actionId).closest("article");
  if (result === null) throw new Error(`Expected shortcut row for ${actionId}`);
  return result;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const result = [...root.querySelectorAll("button")].find((element) => element.textContent.trim() === label);
  if (result === undefined) throw new Error(`Expected button: ${label}`);
  return result;
}

async function clickRow(panel: SettingsShortcutsPanel, actionId: string, label: string): Promise<void> {
  const control = button(row(panel, actionId), label);
  expect(control.disabled).toBe(false);
  control.click();
  await settle(panel);
}

async function editShortcut(panel: SettingsShortcutsPanel, actionId: string, value: string): Promise<void> {
  const control = input(panel, actionId);
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(panel);
}

function pressKey(key: string, modifiers: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
}

async function panelWithShortcuts(config: PiWebConfigValues, onSave: SaveHandler, action = shortcutAction()): Promise<SettingsShortcutsPanel> {
  const panel = new SettingsShortcutsPanel();
  panel.actions = [action];
  panel.configResponse = configResponse(config);
  panel.onSave = onSave;
  await mount(panel);
  return panel;
}

function shortcutAction(patch: Partial<AppAction> = {}): AppAction {
  return {
    id: "core:open-palette",
    title: "Open palette",
    description: "Open the command palette.",
    shortcut: "mod+k",
    group: "Navigation",
    run: vi.fn(),
    ...patch,
  };
}
