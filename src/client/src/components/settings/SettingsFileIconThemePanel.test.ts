// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFileIconThemePanel } from "./SettingsFileIconThemePanel";
import { NO_FILE_ICONS } from "../../fileIconPreferences";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

async function mount(preference?: string): Promise<SettingsFileIconThemePanel> {
  const panel = new SettingsFileIconThemePanel();
  panel.themes = [{ id: "themes:material", pluginId: "themes", localId: "material", name: "Material", file: { url: "https://icons.test/file.svg" } }];
  panel.preference = preference;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function select(panel: SettingsFileIconThemePanel): HTMLSelectElement {
  const element = panel.shadowRoot?.querySelector("select");
  if (element == null) throw new Error("Expected file icon selector");
  return element;
}

describe("file icon Appearance settings", () => {
  it("uses a labeled native selector with immediate browser-local choice and reset", async () => {
    const panel = await mount();
    panel.onSelect = vi.fn();
    panel.onReset = vi.fn();
    expect(select(panel).value).toBe("themes:material");
    expect(select(panel).closest("label")?.textContent).toContain("File icons");
    expect(panel.shadowRoot?.textContent).toContain("Applies only in this browser, independently of the color theme.");
    expect(panel.shadowRoot?.querySelector("button")?.disabled).toBe(true);
    select(panel).value = NO_FILE_ICONS;
    select(panel).dispatchEvent(new Event("change", { bubbles: true }));
    expect(panel.onSelect).toHaveBeenCalledWith(NO_FILE_ICONS);
    panel.preference = NO_FILE_ICONS;
    await panel.updateComplete;
    panel.shadowRoot?.querySelector("button")?.click();
    expect(panel.onReset).toHaveBeenCalledOnce();
  });

  it("preserves and explains an unavailable selection and updates after registry changes", async () => {
    const panel = await mount("custom:icons");
    expect(select(panel).value).toBe("custom:icons");
    expect(select(panel).getAttribute("aria-describedby")).toContain("file-icons-unavailable");
    expect(panel.shadowRoot?.querySelector('[role="status"]')?.textContent).toContain("Using Material until it returns");
    panel.themes = [...panel.themes, { id: "custom:icons", pluginId: "custom", localId: "icons", name: "Custom icons", file: { url: "https://icons.test/custom.svg" } }];
    await panel.updateComplete;
    expect(select(panel).value).toBe("custom:icons");
    expect(panel.shadowRoot?.querySelector('[role="status"]')).toBeNull();
  });
});
