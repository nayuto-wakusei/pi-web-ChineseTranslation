// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { pickerMessages as messages } from "../pickerMessages";
import { ActionPalette } from "./ActionPalette";
import { CommandPicker } from "./CommandPicker";
import { ModelPicker } from "./ModelPicker";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  vi.restoreAllMocks();
});

it("refreshes action search and empty states without replacing user search, focus or invoking actions", async () => {
  const palette = new ActionPalette();
  palette.actions = [{ id: "user.action", title: "User <b>action</b>", run: vi.fn() }];
  palette.onRun = vi.fn();
  document.body.append(palette);
  await settleRenderedDialog(palette);
  const input = requiredElement(palette.shadowRoot?.querySelector("input"), "search");
  input.value = "not found";
  input.dispatchEvent(new Event("input"));
  input.focus();
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    await settleRenderedDialog(palette);
    expect(input.placeholder).toBe(messages.t("searchActionsPlaceholder"));
    expect(palette.shadowRoot?.querySelector(".empty")?.textContent).toBe(messages.t("noActions"));
    expect(input.value).toBe("not found");
    expect(deepActiveElement()).toBe(input);
    expect(palette.onRun).not.toHaveBeenCalled();
  }
  input.value = "User";
  input.dispatchEvent(new Event("input"));
  await settleRenderedDialog(palette);
  expect(palette.shadowRoot?.textContent).toContain("User <b>action</b>");
  expect(palette.shadowRoot?.querySelector("strong b")).toBeNull();
  pressKey(input, "Enter");
  expect(palette.onRun).toHaveBeenCalledExactlyOnceWith(palette.actions[0]);
});

for (const Picker of [CommandPicker, ModelPicker]) {
  it(`${Picker.name} updates pin and search copy while preserving query, selection and a pending default save`, async () => {
    let finish: (() => void) | undefined;
    const picker = new Picker();
    picker.options = [{ value: "user/alpha", label: "Alpha <b>user</b>" }, { value: "user/beta", label: "Beta user" }];
    picker.onPick = vi.fn();
    picker.onSetDefault = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    if (picker instanceof CommandPicker) picker.searchable = true;
    document.body.append(picker);
    await settleRenderedDialog(picker);
    const input = requiredElement(picker.shadowRoot?.querySelector("input"), "search");
    const pin = requiredElement(picker.shadowRoot?.querySelector<HTMLButtonElement>(".default-pin"), "pin");
    pin.click();
    input.value = "user";
    input.dispatchEvent(new Event("input"));
    input.focus();
    release = localization.registerCatalog({ id: "picker-test", namespace: "core.pickers", locale: "de", load: () => Promise.resolve({
      close: "Schließen", defaultHelp: "Standard für neue Sitzungen", useDefault: "{label} für neue Sitzungen verwenden", search: "Suchen",
    }) });
    for (const language of ["de", "en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "de-DE" });
      await settleRenderedDialog(picker);
      expect(input.placeholder).toBe(messages.t("search"));
      expect(input.value).toBe("user");
      expect(deepActiveElement()).toBe(input);
      expect(picker.shadowRoot?.querySelector(".default-help")?.textContent).toBe(messages.t("defaultHelp"));
      expect(pin.title).toBe(messages.t("useDefault", { label: "Alpha <b>user</b>" }));
      expect(pin.disabled).toBe(true);
      expect(picker.shadowRoot?.textContent).toContain("Alpha <b>user</b>");
      expect(picker.shadowRoot?.querySelector("b")).toBeNull();
      expect(picker.onSetDefault).toHaveBeenCalledExactlyOnceWith("user/alpha");
      expect(picker.onPick).not.toHaveBeenCalled();
    }
    finish?.();
    await settleRenderedDialog(picker);
    expect(pin.disabled).toBe(false);
    pressKey(input, "Enter");
    expect(picker.onPick).toHaveBeenCalledExactlyOnceWith("user/alpha");
  });
}

it("keeps model mode, membership and in-flight controls stable through live pseudo locales", async () => {
  let finish: (() => void) | undefined;
  const picker = new ModelPicker();
  picker.catalog = [
    { provider: "user-provider", id: "alpha", enabled: true },
    { provider: "user-provider", id: "beta", enabled: false },
  ];
  picker.selectedValue = "user-provider/alpha";
  picker.onToggleEnabled = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  document.body.append(picker);
  await settleRenderedDialog(picker);
  requiredElement(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>(".scope-toggle button")[1], "all models").click();
  await settleRenderedDialog(picker);
  const beta = requiredElement(picker.shadowRoot?.querySelector<HTMLInputElement>('[data-model-value="user-provider/beta"] input'), "beta");
  beta.click();
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    await settleRenderedDialog(picker);
    expect(picker.shadowRoot?.querySelector('.scope-toggle button[aria-pressed="true"]')?.textContent).toBe(messages.t("allModels"));
    expect(beta.getAttribute("aria-label")).toBe(messages.t("enableModel", { model: "user-provider/beta" }));
    expect(beta.disabled).toBe(true);
    expect(beta.checked).toBe(false);
    expect(picker.shadowRoot?.querySelector("#model-scope-status")?.textContent).toBe(messages.t("updating"));
    expect(picker.onToggleEnabled).toHaveBeenCalledExactlyOnceWith("user-provider", "beta", true);
  }
  finish?.();
  await settleRenderedDialog(picker);
  picker.catalog = picker.catalog.map((entry) => ({ ...entry, editable: false }));
  await settleRenderedDialog(picker);
  expect(picker.shadowRoot?.querySelector(".scope-notice code")?.textContent).toBe(".pi/settings.json");
  expect(picker.shadowRoot?.querySelector(".scope-notice code")?.getAttribute("dir")).toBe("ltr");
  expect(beta.getAttribute("aria-label")).toBe(messages.t("controlledModel", { model: "user-provider/beta" }));
});
