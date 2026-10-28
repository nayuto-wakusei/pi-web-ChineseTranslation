// @vitest-environment happy-dom
import { html, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import { MermaidPreview } from "./MermaidPreview";
import { createMermaidContent } from "./mermaidLocalization";
import plugin from "./pi-web-plugin";

customElements.define("pi-web-mermaid-preview", MermaidPreview);
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

function owner(service: LocalizationService, id = "mermaid") {
  const lifetime = new AbortController();
  const localization = createPluginLocalization(service, "mermaid", id, lifetime.signal);
  return { localization, lifetime };
}

it("updates pending status and iframe names without reloading the engine or modifying diagram source", async () => {
  const service = new LocalizationService({ development: true });
  const { localization, lifetime } = owner(service);
  const element = new MermaidPreview();
  element.content = createMermaidContent(localization);
  let resolve: (engine: string) => void = () => { throw new Error("Missing resolver"); };
  element.loadEngine = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
  const input = { text: "graph TD; A[User text]-->B[مرحبا]", signal: new AbortController().signal, fail: vi.fn() };
  element.input = input;
  document.body.append(element);
  await element.updateComplete;
  expect(element.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("Rendering diagram…");
  await service.setPreferences({ language: "en-XA", formatLocale: "en" });
  await element.updateComplete;
  expect(element.shadowRoot?.querySelector('[role="status"]')?.textContent).toContain("Rëndërïng");
  resolve("/* trusted engine */");
  await vi.waitFor(() => { expect(element.shadowRoot?.querySelector("iframe")).not.toBeNull(); });
  const frame = element.shadowRoot?.querySelector("iframe");
  if (frame?.contentWindow === undefined || frame.contentWindow === null) throw new Error("Missing frame");
  const originalDocument = frame.srcdoc;
  expect(frame.title).toContain("Mërmáïd");
  await service.setPreferences({ language: "ar-XB", formatLocale: "en" });
  await element.updateComplete;
  expect(frame.title).toContain("\u202e");
  expect(element.shadowRoot?.querySelector("iframe")).toBe(frame);
  expect(frame.srcdoc).toBe(originalDocument);
  expect(element.loadEngine).toHaveBeenCalledOnce();
  const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => undefined);
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "mermaid-ready" } }));
  expect(post).toHaveBeenCalledWith({ type: "mermaid-render", text: input.text }, "*");
  expect(input.fail).not.toHaveBeenCalled();
  element.remove();
  lifetime.abort();
  await element.updateComplete;
});

it("releases the previous portable activation and observes only the connected current owner", async () => {
  const firstService = new LocalizationService({ development: true });
  const first = owner(firstService);
  const element = new MermaidPreview();
  element.content = createMermaidContent(first.localization);
  document.body.append(element);
  await element.updateComplete;
  const secondService = new LocalizationService({ development: true });
  const second = owner(secondService, "remote-mermaid");
  element.content = createMermaidContent(second.localization);
  await element.updateComplete;
  first.lifetime.abort();
  const update = vi.spyOn(element, "requestUpdate");
  await firstService.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(update).not.toHaveBeenCalled();
  await secondService.setPreferences({ language: "en-XA", formatLocale: "en" });
  await element.updateComplete;
  expect(element.shadowRoot?.textContent).toContain("Rëndërïng");
  element.remove();
  await element.updateComplete;
  update.mockClear();
  await secondService.setPreferences({ language: "en", formatLocale: "en" });
  expect(update).not.toHaveBeenCalled();
  document.body.append(element);
  await element.updateComplete;
  expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("Rendering diagram…");
  element.remove();
  second.lifetime.abort();
});

it("exposes a live translated renderer title and passes activation content to the preview", async () => {
  const service = new LocalizationService({ development: true });
  const { localization, lifetime } = owner(service);
  const result = plugin.activate({ apiVersion: 5, pluginId: "mermaid", runtimePluginId: "mermaid", html, svg, localization,
    signal: lifetime.signal, lifetimeSignal: lifetime.signal });
  const renderer = result.contributions.contentRenderers[0];
  expect(renderer?.title).toBe("Diagram");
  const remove = localization.registerCatalog({ id: "fr", namespace: "plugin:mermaid:preview", locale: "fr",
    load: () => Promise.resolve({ diagram: "Schéma", rendering: "Création du schéma…", frameTitle: "Schéma Mermaid" }) });
  await service.setPreferences({ language: "fr", formatLocale: "en" });
  expect(renderer?.title).toBe("Schéma");
  const container = document.createElement("div");
  const { render } = await import("lit");
  render(renderer?.render({ text: "source", signal: new AbortController().signal, fail: vi.fn() }), container);
  const preview = container.querySelector<MermaidPreview>("pi-web-mermaid-preview");
  expect(preview?.content?.messages.t("rendering")).toBe("Création du schéma…");
  remove();
  lifetime.abort();
});
