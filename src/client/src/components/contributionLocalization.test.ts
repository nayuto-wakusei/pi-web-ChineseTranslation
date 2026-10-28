// @vitest-environment happy-dom
import { html, LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { localization } from "../localization/browser";
import { PluginRegistry } from "../plugins/registry";
import { adaptPublicPlugin } from "../plugins/publicContext";
import { useDeferredContent } from "../formatting/deferredContent.testSupport";
import { ContentRendererHost } from "./ContentRendererHost";
import { PiWebApp } from "./PiWebApp";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

useDeferredContent();

// Keep the real shell/controller/guards, without session and socket startup.
class LocalizedContributionsApp extends PiWebApp {
  override connectedCallback(): void { LitElement.prototype.connectedCallback.call(this); }
}
customElements.define("localized-contributions-app", LocalizedContributionsApp);

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function registerLabels(registry: PluginRegistry): Promise<void> {
  await registry.register({ id: "localized", plugin: adaptPublicPlugin({
    apiVersion: 5, name: "Localized", activate(context) {
      const api = context.localization;
      if (api === undefined) throw new Error("Expected localization");
      const messages = api.registerMessages("ui", { title: api.message("Preview", "Contribution title") });
      api.registerCatalog({ id: "fr", namespace: "plugin:localized:ui", locale: "fr", load: () => Promise.resolve({ title: "Aperçu" }) });
      return { contributions: {
        actions: [{ id: "action", get title() { return messages.t("title"); }, run: () => undefined }],
        applicationPanels: [{ id: "panel", get title() { return messages.t("title"); }, render: () => html`<p>Panel body</p>` }],
        contentRenderers: [{ id: "renderer", languages: ["test"], get title() { return messages.t("title"); }, render: () => html`<b>Preview body</b>` }],
      } };
    },
  }) });
}

async function settle(host: LitElement): Promise<void> {
  await host.updateComplete;
  for (const child of host.shadowRoot?.querySelectorAll("*") ?? []) {
    if (child instanceof LitElement) await settle(child);
  }
  await host.updateComplete;
}

it("refreshes guarded shell panel navigation and open actions on localization changes", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("fetch", themeStylesheetFetch(vi.fn(() => Promise.reject(new Error("Unexpected request")))));
  window.history.replaceState(null, "", "/");
  const app = new LocalizedContributionsApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Expected shell registry");
  await registerLabels(registry);
  Reflect.set(app, "state", { ...initialAppState(), workspaceTool: "localized:panel", actionPaletteOpen: true });
  document.body.append(app);
  await settle(app);
  const tabs = () => app.shadowRoot?.querySelector("app-mobile-main-tabs")?.shadowRoot;
  const actions = () => app.shadowRoot?.querySelector("action-palette")?.shadowRoot;
  expect(tabs()?.querySelector('[aria-label="Preview"]')).not.toBeNull();
  expect(actions()?.textContent).toContain("Preview");
  await localization.setPreferences({ language: "fr", formatLocale: "en" });
  await settle(app);
  expect(tabs()?.querySelector('[aria-label="Aperçu"]')).not.toBeNull();
  expect(tabs()?.querySelector('[aria-label="Preview"]')).toBeNull();
  expect(actions()?.textContent).toContain("Aperçu");
  app.remove();
  const update = vi.spyOn(app, "requestUpdate");
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(update).not.toHaveBeenCalled();
  await registry.dispose();
});

it("refreshes retained renderer headers without replacing the rendering snapshot or activating manual content", async () => {
  const registry = new PluginRegistry();
  await registerLabels(registry);
  const rendering = registry.getChatContentRendering("local");
  const host = new ContentRendererHost();
  host.text = "source";
  host.choices = registry.matchContentRenderers({ machineId: "local", language: "test", text: "source" });
  document.body.append(host);
  await host.updateComplete;
  expect(host.shadowRoot?.textContent).toContain("Preview");
  await localization.setPreferences({ language: "fr", formatLocale: "en" });
  await host.updateComplete;
  expect(host.shadowRoot?.textContent).toContain("Aperçu");
  expect(host.shadowRoot?.querySelector(".preview")).toBeNull();
  expect(registry.getChatContentRendering("local")).toBe(rendering);
  host.remove();
  const update = vi.spyOn(host, "requestUpdate");
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(update).not.toHaveBeenCalled();
  document.body.append(host);
  await host.updateComplete;
  expect(host.shadowRoot?.textContent).toContain("Preview");
  host.remove();
  await registry.dispose();
});
