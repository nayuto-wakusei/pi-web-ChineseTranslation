// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../../i18n";
import { configResponse } from "../SettingsDialog.testSupport";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";

beforeEach(() => { setClientTranslations("en", {}); });
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); setClientTranslations("en", {}); });

describe("settings-shortcuts-panel send behavior", () => {
  it("defaults to steer and saves either behavior without dropping other config", async () => {
    const onSave = vi.fn();
    const panel = new SettingsShortcutsPanel();
    panel.onSave = onSave;
    panel.configResponse = configResponse({ shortcuts: { "core:other": "mod+o" } });
    document.body.append(panel);
    await panel.updateComplete;
    const select = panel.renderRoot.querySelector<HTMLSelectElement>('select[aria-label="Send while agent is running"]');
    if (select === null) throw new Error("Missing send behavior setting");
    expect(select.value).toBe("steer");
    select.value = "followUp";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSave).toHaveBeenLastCalledWith({ shortcuts: { "core:other": "mod+o" }, defaultStreamingBehavior: "followUp" });
    panel.configResponse = configResponse({ defaultStreamingBehavior: "followUp" });
    await panel.updateComplete;
    expect(select.value).toBe("followUp");
    select.value = "steer";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSave).toHaveBeenLastCalledWith({ defaultStreamingBehavior: "steer" });
  });

  it.each(["loading", "saving", "unavailable"] as const)("does not save while %s", async (condition) => {
    const panel = new SettingsShortcutsPanel();
    panel.configResponse = condition === "unavailable" ? undefined : configResponse({});
    panel.loading = condition === "loading";
    panel.saving = condition === "saving";
    panel.onSave = vi.fn();
    document.body.append(panel);
    await panel.updateComplete;
    // Loading without a snapshot has no setting; other locked states keep it disabled.
    const select = panel.renderRoot.querySelector<HTMLSelectElement>("select");
    expect(select?.disabled).toBe(true);
    if (select === null) throw new Error("Missing disabled send behavior setting");
    select.value = "followUp";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(panel.onSave).not.toHaveBeenCalled();
  });
});
