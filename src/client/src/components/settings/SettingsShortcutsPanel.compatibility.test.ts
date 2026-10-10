// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";
import { configResponse } from "../SettingsDialog.testSupport";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

describe("shortcut ownership compatibility", () => {
  it("displays and resets a legacy action id without changing unrelated preferences", async () => {
    const panel = new SettingsShortcutsPanel();
    panel.actions = [{ id: "new:action", shortcutAliases: ["old:action"], title: "Action", shortcut: "mod+k", run: () => undefined }];
    panel.configResponse = configResponse({ shortcuts: { "old:action": "mod+p", unrelated: "alt+x" } });
    const onSave = vi.fn();
    panel.onSave = onSave;
    document.body.append(panel);
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector<HTMLInputElement>(".shortcut-input")?.value).toBe("mod+p");
    const reset = [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((button) => button.textContent === "重置");
    expect(reset?.disabled).toBe(false);
    reset?.click();
    expect(onSave).toHaveBeenCalledWith({ shortcuts: { unrelated: "alt+x" } });
  });
});
