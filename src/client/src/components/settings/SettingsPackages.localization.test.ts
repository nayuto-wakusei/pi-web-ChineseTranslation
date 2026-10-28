// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../../localization/browser";
import { deferred } from "../SettingsDialog.testSupport";
import { SettingsPackagesPanel, packagesMessages as messages } from "./SettingsPackagesPanel";
import type { SettingsPanelFrame } from "./SettingsPanelFrame";

const releases: (() => void)[] = [];
const raw = "raw <img> العربية";
const packages = [
  { source: raw, scope: "user" as const, filtered: false, installedPath: "/raw/<img>/path" },
  { source: "project-source", scope: "project" as const, filtered: true },
];
const suggestions = [
  { id: "@jmfederico/pi-relay", label: "server label", description: "server description", source: "/raw/relay" },
  { id: "@jmfederico/pi-web-workflows", label: "server label", description: "server description", source: "/raw/workflows" },
  { id: "external", label: raw, description: raw, source: "/raw/external" },
];
afterEach(async () => {
  document.body.replaceChildren();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing package settings control");
  return value;
}
function frame(panel: SettingsPackagesPanel): SettingsPanelFrame {
  return required(panel.renderRoot.querySelector("settings-panel-frame"));
}
async function settle(panel: SettingsPackagesPanel): Promise<void> {
  await panel.updateComplete;
  await frame(panel).updateComplete;
}
async function language(panel: SettingsPackagesPanel, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG" });
  await settle(panel);
}
async function mount(): Promise<SettingsPackagesPanel> {
  const panel = new SettingsPackagesPanel();
  panel.packagesResponse = { packages, installableKnownPackages: suggestions };
  panel.targetMachine = { id: "raw-id", name: raw, kind: "remote" };
  panel.onInstallPackage = vi.fn();
  panel.onUpdatePackage = vi.fn();
  panel.onRemovePackage = vi.fn();
  panel.onReload = vi.fn();
  document.body.append(panel);
  await settle(panel);
  return panel;
}
function input(panel: SettingsPackagesPanel): HTMLInputElement {
  return required(panel.renderRoot.querySelector("input"));
}
function submit(panel: SettingsPackagesPanel): void {
  required(panel.renderRoot.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
function type(panel: SettingsPackagesPanel, value: string): void {
  input(panel).value = value;
  input(panel).dispatchEvent(new Event("input", { bubbles: true }));
}

it("keeps draft, focus, rows and provider values while every panel-owned surface changes live", async () => {
  releases.push(localization.registerCatalog({ id: "packages-test", namespace: "core.settingsPackages", locale: "de", load: () => Promise.resolve({ heading: "Pakete", refresh: "Aktualisieren", install: "Installieren", source: "Paketquelle" }) }));
  const panel = await mount();
  type(panel, " draft source ");
  await settle(panel);
  const field = input(panel);
  const row = panel.renderRoot.querySelector(".package-card");
  field.focus();
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(panel, locale);
    expect(input(panel)).toBe(field);
    expect(panel.shadowRoot?.activeElement).toBe(field);
    expect(field.value).toBe(" draft source ");
    expect(panel.renderRoot.querySelector(".package-card")).toBe(row);
    expect(frame(panel).heading).toBe(messages.t("heading"));
    expect(frame(panel).actionLabel).toBe(messages.t("refresh"));
    expect(field.placeholder).toBe(messages.t("placeholder"));
    expect(panel.renderRoot.querySelector("label")?.textContent).toBe(messages.t("source"));
    const text = panel.renderRoot.textContent;
    for (const key of ["available", "configured", "community", "projectUpdate", "mixedUpdates", "pathUnknown", "relayDescription", "workflowsDescription"] as const) expect(text).toContain(messages.t(key));
    expect(text).toContain(messages.t("metadata", { scope: "project", filtered: "yes" }));
    for (const value of [raw, required(packages[0]).installedPath, "pi install <source>"]) expect(text).toContain(value);
    expect(panel.renderRoot.querySelector("img")).toBeNull();
    expect(frame(panel).shadowRoot?.querySelector("img")).toBeNull();
    expect(panel.onInstallPackage).not.toHaveBeenCalled();
    expect(panel.onReload).not.toHaveBeenCalled();
  }
  submit(panel);
  await settle(panel);
  expect(panel.onInstallPackage).toHaveBeenCalledExactlyOnceWith("draft source");
  required(panel.renderRoot.querySelector<HTMLButtonElement>(".package-card button")).click();
  required(panel.renderRoot.querySelector<HTMLButtonElement>(".package-card button.danger")).click();
  expect(panel.onUpdatePackage).toHaveBeenCalledExactlyOnceWith(raw);
  expect(panel.onRemovePackage).toHaveBeenCalledExactlyOnceWith(raw, "user");
});

it("retains semantic validation and a failed install draft across languages", async () => {
  const panel = await mount();
  submit(panel);
  await settle(panel);
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(panel, locale);
    expect(panel.renderRoot.querySelector('[role="alert"]')?.textContent).toBe(messages.t("validation"));
    expect(input(panel).getAttribute("aria-invalid")).toBe("true");
  }
  const pending = deferred<undefined>();
  panel.onInstallPackage = vi.fn(() => pending.promise);
  type(panel, raw);
  submit(panel);
  await language(panel, "en-XA");
  pending.reject(new Error("raw failure"));
  await settle(panel);
  expect(input(panel).value).toBe(raw);
  expect(input(panel).getAttribute("aria-invalid")).toBe("false");
  expect(panel.onInstallPackage).toHaveBeenCalledExactlyOnceWith(raw);
});

it("localizes absent, loading, empty and refreshing states and fallback machine target", async () => {
  const panel = await mount();
  panel.targetMachine = undefined;
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(panel, locale);
    const target = messages.t("target", { name: "本机", kind: "local" });
    panel.packagesResponse = undefined;
    panel.loading = false;
    await settle(panel);
    expect(panel.renderRoot.textContent).toContain(messages.t("unavailable", { target }));
    panel.loading = true;
    await settle(panel);
    expect(panel.renderRoot.textContent).toContain(messages.t("loading", { target }));
    panel.packagesResponse = { packages: [] };
    await settle(panel);
    expect(panel.renderRoot.textContent).toContain(messages.t("loading", { target }));
    panel.loading = false;
    await settle(panel);
    expect(panel.renderRoot.textContent).toContain(messages.t("empty", { target }));
    expect(panel.renderRoot.querySelector(".package-toolbar button")?.getAttribute("title")).toBe(messages.t("noUpdates"));
    panel.packagesResponse = { packages: [required(packages[0])] };
    panel.loading = true;
    await settle(panel);
    expect(panel.renderRoot.textContent).toContain(messages.t("refreshing", { target }));
  }
});

it("localizes pending operations without replay and retains parent feedback on reconnect", async () => {
  const panel = await mount();
  panel.error = raw;
  panel.operationMessage = "raw saved";
  for (const [kind, key] of [["install", "installing"], ["update", "updating"], ["update-all", "updating"], ["remove", "removing"]] as const) {
    panel.operation = { kind, source: raw };
    for (const locale of ["en-XA", "ar-XB"]) {
      await language(panel, locale);
      expect(frame(panel).actionDisabled).toBe(true);
      expect(panel.renderRoot.textContent).toContain(messages.t(key));
      expect([...panel.renderRoot.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    }
  }
  panel.remove();
  await language(panel, "en-XA");
  document.body.append(panel);
  await settle(panel);
  expect(frame(panel).heading).toBe(messages.t("heading"));
  expect(frame(panel).notices).toContainEqual({ type: "error", content: raw });
  expect(frame(panel).notices).toContainEqual({ type: "success", content: "raw saved" });
  expect(panel.onInstallPackage).not.toHaveBeenCalled();
  expect(panel.onUpdatePackage).not.toHaveBeenCalled();
  expect(panel.onRemovePackage).not.toHaveBeenCalled();
  expect(panel.onReload).not.toHaveBeenCalled();
});
