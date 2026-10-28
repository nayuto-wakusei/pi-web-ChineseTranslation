// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it } from "vitest";
import type { ApplicationPanelContext, PiWebComponentStatus } from "@chainingintention/pi-web-cn/plugin-api";
import { LocalizationService } from "../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../src/client/src/plugins/localization.js";
import plugin from "./pi-web-plugin.js";

const lifetimes: AbortController[] = [];
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
  document.body.replaceChildren();
  localStorage.clear();
});

function fixture(development = false) {
  const service = new LocalizationService({ development, preferences: { language: "en", formatLocale: "de-DE", timeZone: "UTC", hourCycle: "h23" } });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "info", "info", lifetime.signal);
  const result = plugin.activate({ apiVersion: 4, pluginId: "info", runtimePluginId: "info", html, svg, signal: lifetime.signal, lifetimeSignal: lifetime.signal, localization });
  const panel = result.contributions.applicationPanels[0];
  const action = result.contributions.actions[0];
  if (panel === undefined || action === undefined) throw new Error("Info contributions missing");
  const root = document.createElement("main");
  document.body.append(root);
  const component: PiWebComponentStatus = { component: "web", label: "Untranslated backend label", available: true, stale: false, runtimeVersion: "1.2.3", piVersion: "0.9.0", installation: { kind: "docker", path: "/srv/<img>" } };
  const context: ApplicationPanelContext = {
    machine: { id: "local", name: "<script>user machine</script>", kind: "local" },
    state: { piWebStatus: { packageName: "@example/app", generatedAt: "2026-01-02T15:04:05Z", components: { web: component, sessiond: { ...component, component: "sessiond", available: false, error: "<img src=x>" } }, release: { packageName: "@example/app", updateAvailable: false, checkedAt: "2026-01-02T15:00:00Z" }, commands: {}, messages: [] } },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    navigate: () => Promise.resolve(),
    host: { requestRender: () => { render(panel.render(context), root); } },
  };
  localization.subscribe(() => { context.host.requestRender(); });
  context.host.requestRender();
  return { service, panel, action, root, context };
}

it("renders translated panel states and action metadata live while preserving regional formatting and user text", async () => {
  const { service, action, root, context } = fixture();
  expect(root.textContent).toContain("Web/UI");
  expect(root.textContent).not.toContain("Untranslated backend label");
  expect(root.textContent).toContain(service.date(new Date("2026-01-02T15:04:05Z"), { dateStyle: "medium", timeStyle: "medium" }));
  expect(root.querySelector("script, img")).toBeNull();
  service.registerCatalog({ id: "test-fr", namespace: "plugin:info:panel", locale: "fr", load: () => Promise.resolve({ info: "Informations", machine: "Machine traduite", unavailable: "indisponible", copyDiagnostics: "Copier les diagnostics", statusPending: "État en cours de chargement." }) });
  await service.setPreferences({ ...service.preferences, language: "fr" });
  expect(action.title).toBe("Copier les diagnostics");
  expect(root.textContent).toContain("Informations");
  expect(root.textContent).toContain("indisponible");
  expect(root.textContent).toContain("<script>user machine</script>");
  expect(service.preferences.formatLocale).toBe("de-DE");
  delete context.state.piWebStatus;
  context.host.requestRender();
  expect(root.textContent).toContain("État en cours de chargement.");
});

it("pseudo-localizes messages and plural counts without altering versions, paths or user content", async () => {
  const { service, root, context } = fixture(true);
  const status = context.state.piWebStatus;
  if (status === undefined) throw new Error("Info status fixture missing");
  // Only the count is relevant here; detailed notice content is rendered by Updates.
  status.messages.push({ id: "notice", severity: "info", title: "Notice", body: "backend notice" });
  context.host.requestRender();
  expect(root.textContent).toContain("1 status message — open the Updates tab for details.");
  status.messages.push({ id: "second", severity: "info", title: "Notice", body: "backend notice" });
  context.host.requestRender();
  expect(root.textContent).toContain("2 status messages — open the Updates tab for details.");
  await service.setPreferences({ ...service.preferences, language: "en-XA" });
  expect(root.textContent).not.toContain("2 status messages — open the Updates tab for details.");
  expect(root.textContent).toContain("1.2.3");
  expect(root.textContent).toContain("/srv/<img>");
  expect(root.textContent).toContain("<script>user machine</script>");
  await service.setPreferences({ ...service.preferences, language: "ar-XB" });
  expect(service.direction).toBe("rtl");
  expect(root.querySelector("script, img")).toBeNull();
});
