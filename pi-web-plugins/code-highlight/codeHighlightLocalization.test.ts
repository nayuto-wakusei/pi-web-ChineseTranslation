// @vitest-environment happy-dom
import { html, svg, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import plugin from "./pi-web-plugin";

const source = 'const value = "مرحبا <b>user text</b>";';
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("translates the view title live while leaving both highlighting paths' source unchanged", async () => {
  const service = new LocalizationService({ development: true });
  const lifetime = new AbortController();
  const localization = createPluginLocalization(service, "code-highlight", "code-highlight", lifetime.signal);
  const result = plugin.activate({ apiVersion: 5, pluginId: "code-highlight", runtimePluginId: "code-highlight", html, svg, localization,
    signal: lifetime.signal, lifetimeSignal: lifetime.signal });
  let semanticTokens = false;
  result.start({ signal: lifetime.signal, capabilities: { resolve: (token) => token.parse(token.id === "stylesheet-integration"
    ? { registerRoot: () => () => undefined, createController: () => undefined, subscribe: () => () => undefined }
    : { supports: () => semanticTokens, highlight: () => Promise.resolve([{ from: 0, to: 5, kind: "keyword" }]) }) } });
  const renderer = result.contributions.contentRenderers[0];
  expect(renderer?.title).toBe("Highlighted");
  await service.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(renderer?.title).toContain("Hïghlïghtëd");
  for (const tokens of [false, true]) {
    semanticTokens = tokens;
    const container = document.createElement("div");
    document.body.append(container);
    render(renderer?.render({ text: source, language: "javascript", signal: lifetime.signal, fail: vi.fn() }), container);
    await vi.waitFor(() => { expect(container.firstElementChild?.shadowRoot?.querySelector("code")?.textContent).toBe(source); });
    expect(container.firstElementChild?.shadowRoot?.querySelector("b")).toBeNull();
    container.remove();
  }
  localization.registerCatalog({ id: "fr", namespace: "plugin:code-highlight:renderer", locale: "fr",
    load: () => Promise.resolve({ highlighted: "Coloration" }) });
  await service.setPreferences({ language: "fr", formatLocale: "en" });
  expect(renderer?.title).toBe("Coloration");
  lifetime.abort();
});
