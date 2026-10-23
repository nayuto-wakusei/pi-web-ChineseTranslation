// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../../i18n";
import type { AppAction } from "../../actions";
import type { PiWebConfigValues } from "../../api";
import { configResponse } from "../SettingsDialog.testSupport";
import { COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE } from "../../composerShortcuts";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";

beforeEach(() => { setClientTranslations("en", {}); });

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("settings-shortcuts-panel draft preservation", () => {
  it("preserves multiple drafts through recording, one-row save acknowledgement, and refresh", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: {} }, onSave);
    await editShortcut(panel, COMPOSER_SEND_DESKTOP, "mod+enter");
    await editShortcut(panel, "core:open-palette", "mod+p");
    await clickRow(panel, COMPOSER_SEND_MOBILE, "Record");
    pressKey("Enter", { shiftKey: true });
    await settle(panel);
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
    expect(input(panel, "core:open-palette").value).toBe("mod+p");
    await clickRow(panel, "core:open-palette", "Save");
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ shortcuts: { "core:open-palette": "mod+p" } });
    expect(row(panel, "core:open-palette").textContent).toContain("Unsaved");
    panel.configResponse = configResponse(onSave.mock.lastCall?.[0] ?? {});
    await settle(panel);
    expect(row(panel, "core:open-palette").textContent).not.toContain("Unsaved");
    expect(button(row(panel, "core:open-palette"), "Save").disabled).toBe(true);
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
    expect(input(panel, COMPOSER_SEND_MOBILE).value).toBe("shift+enter");

    panel.onReload = vi.fn(() => {
      panel.configResponse = configResponse({ shortcuts: { "core:open-palette": "mod+o" } });
    });
    await settle(panel);
    button(frameRoot(panel), "Refresh shortcuts").click();
    await settle(panel);
    expect(panel.onReload).toHaveBeenCalledOnce();
    expect(input(panel, "core:open-palette").value).toBe("mod+o");
    for (const actionId of [COMPOSER_SEND_DESKTOP, COMPOSER_SEND_MOBILE]) {
      expect(row(panel, actionId).textContent).toContain("Unsaved");
      expect(button(row(panel, actionId), "Save").disabled).toBe(false);
    }
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
    expect(input(panel, COMPOSER_SEND_MOBILE).value).toBe("shift+enter");
  });

  it("retains failed saves when the owner handles the error or the callback rejects", async () => {
    const panel = await panelWithShortcuts({}, vi.fn(() => { panel.error = "Save failed. Try again."; }));
    await editShortcut(panel, "core:open-palette", "mod+p");
    await editShortcut(panel, COMPOSER_SEND_DESKTOP, "mod+enter");
    await clickRow(panel, "core:open-palette", "Save");
    panel.configResponse = configResponse({ shortcuts: { "core:open-palette": "mod+o" } });
    await settle(panel);
    expect(input(panel, "core:open-palette").value).toBe("mod+p");
    expect(row(panel, "core:open-palette").textContent).toContain("Unsaved");
    expect(frameRoot(panel).querySelector('[role="alert"]')?.textContent).toContain("Save failed");
    panel.onSave = vi.fn().mockRejectedValue(new Error("Connection lost"));
    await clickRow(panel, "core:open-palette", "Save");
    expect(frameRoot(panel).querySelector('[role="alert"]')?.textContent).toContain("Could not save shortcut. Connection lost");
    expect(input(panel, "core:open-palette").value).toBe("mod+p");
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
  });

  it.each(["Disable shortcut", "Restore default"])("clears only the acknowledged row draft after %s", async (operation) => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({ shortcuts: { "core:open-palette": "mod+o" } }, onSave);
    await editShortcut(panel, "core:open-palette", "mod+p");
    await editShortcut(panel, COMPOSER_SEND_DESKTOP, "mod+enter");
    await clickRow(panel, "core:open-palette", operation);
    panel.configResponse = configResponse(onSave.mock.lastCall?.[0] ?? {});
    await settle(panel);
    expect(input(panel, "core:open-palette").value).toBe(operation === "Disable shortcut" ? "" : "mod+k");
    expect(row(panel, "core:open-palette").textContent).not.toContain("Unsaved");
    expect(input(panel, COMPOSER_SEND_DESKTOP).value).toBe("mod+enter");
  });

  it("does not erase a newer draft when an earlier save is acknowledged", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await panelWithShortcuts({}, onSave);
    await editShortcut(panel, "core:open-palette", "mod+p");
    await clickRow(panel, "core:open-palette", "Save");
    await editShortcut(panel, "core:open-palette", "mod+o");
    panel.configResponse = configResponse(onSave.mock.lastCall?.[0] ?? {});
    await settle(panel);
    expect(input(panel, "core:open-palette").value).toBe("mod+o");
    expect(row(panel, "core:open-palette").textContent).toContain("Unsaved");
  });
});

describe("settings-shortcuts-panel accessibility", () => {
  it("names row controls by action and describes recording and conflicts clearly", async () => {
    const panel = await panelWithShortcuts({}, vi.fn());
    const actionId = "core:open-palette";
    expect(input(panel, actionId).getAttribute("aria-label")).toBe("Shortcut for Open palette");
    for (const [text, name] of [
      ["Save", "Save shortcut for Open palette"],
      ["Record", "Record shortcut for Open palette"],
      ["Disable shortcut", "Disable shortcut for Open palette"],
      ["Restore default", "Restore default shortcut for Open palette"],
    ] as const) expect(button(row(panel, actionId), text).getAttribute("aria-label")).toBe(name);
    expect(frameRoot(panel).querySelector(".description")?.textContent).toContain("Composer send bindings accept one key combination");
    await clickRow(panel, actionId, "Record");
    const hint = row(panel, actionId).querySelector(".recording-hint");
    expect(hint?.getAttribute("role")).toBe("status");
    expect(hint?.id).toBe(input(panel, actionId).getAttribute("aria-describedby"));
    expect(hint?.textContent).toContain("Recording:");
    expect(button(row(panel, actionId), "Cancel recording").getAttribute("aria-label")).toBe("Cancel recording for Open palette");
    await clickRow(panel, actionId, "Cancel recording");
    panel.actions = [shortcutAction(), shortcutAction({ id: "core:other", title: "Other action", shortcut: "mod+p" })];
    await settle(panel);
    await editShortcut(panel, actionId, "mod+p");
    expect(row(panel, actionId).querySelector(".conflict")?.textContent).toContain("Shadows 1 actions: Other action");
    expect(row(panel, "core:other").querySelector(".conflict")?.textContent).toContain('Shadowed by "Open palette"');
  });

  it("disables editing when config is unavailable while allowing refresh", async () => {
    const panel = new SettingsShortcutsPanel();
    panel.onSave = vi.fn();
    panel.onReload = vi.fn();
    await mount(panel);
    expect(panel.renderRoot.textContent).toContain("Shortcut settings are unavailable. Reload settings to try again.");
    for (const control of panel.renderRoot.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(".shortcut-row input, .shortcut-row button, .shortcut-group select")) {
      expect(control.disabled).toBe(true);
      if (control instanceof HTMLButtonElement) control.click();
    }
    expect(panel.onSave).not.toHaveBeenCalled();
    expect(button(frameRoot(panel), "Refresh shortcuts").disabled).toBe(false);
    button(frameRoot(panel), "Refresh shortcuts").click();
    expect(panel.onReload).toHaveBeenCalledOnce();
    panel.configResponse = configResponse({});
    panel.loading = true;
    await settle(panel);
    expect(input(panel, COMPOSER_SEND_DESKTOP).disabled).toBe(true);
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
  const actual = label === "Refresh shortcuts" ? "Reload" : label === "Disable shortcut" ? "None" : label === "Restore default" ? "Reset" : label;
  const result = [...root.querySelectorAll("button")].find((element) => element.textContent.trim() === actual);
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
