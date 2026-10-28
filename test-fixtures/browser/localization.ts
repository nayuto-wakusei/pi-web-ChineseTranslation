import { html, render, svg } from "lit";
import { initializeLocalization, localization } from "../../src/client/src/localization/browser";
import { SettingsGeneralPanel } from "../../src/client/src/components/settings/SettingsGeneralPanel";
import { ModalSurface } from "../../src/client/src/components/ModalSurface";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import spanish from "../../pi-web-plugins/language-spanish/pi-web-plugin";
import swedish from "../../pi-web-plugins/language-swedish/pi-web-plugin";

// Exercise the shipped packs through the same activation-scoped API as the app.
for (const [pluginId, plugin] of [["language-spanish", spanish], ["language-swedish", swedish]] as const) {
  const lifetime = new AbortController();
  plugin.activate({
    apiVersion: 5, pluginId, runtimePluginId: pluginId, html, svg,
    signal: lifetime.signal, lifetimeSignal: lifetime.signal,
    localization: createPluginLocalization(localization, pluginId, pluginId, lifetime.signal),
  });
}

// Test-only long/RTL catalog; it is not a shipped additional language.
localization.registerCatalog({ id: "fixture-ar", namespace: "core.settingsLocalization", locale: "ar", load: () => Promise.resolve({
  heading: "إعدادات اللغة والمنطقة في هذا المتصفح لجميع المشاريع والأجهزة",
  apply: "تطبيق إعدادات اللغة والمنطقة في هذا المتصفح",
  reset: "نسخ الإعدادات الافتراضية الحالية من المتصفح",
}) });
await initializeLocalization();
const style = document.createElement("style");
style.textContent = `
  :root { --pi-bg: #161616; --pi-surface: #252525; --pi-text: #eee; --pi-text-secondary: #ccc; --pi-border: #555; --pi-muted: #aaa; --pi-error: #faa; --pi-accent: #aaf; --pi-overlay: #0008; }
  body { margin: 0; background: var(--pi-bg); color: var(--pi-text); font-family: system-ui; }
  modal-surface { --modal-surface-width: min(800px, 94vw); --modal-surface-max-height: 90dvh; }
`;
document.head.append(style);
const modal = new ModalSurface();
modal.label = "General settings fixture";
const general = new SettingsGeneralPanel();
render(html`${general}`, modal);
document.body.append(modal);
await modal.updateComplete;
await general.updateComplete;
document.body.dataset["ready"] = "true";
