// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./localizationBootstrap", async (importOriginal) => {
  const original = await importOriginal<typeof import("./localizationBootstrap")>();
  return { ...original, initializeClientLocalization: vi.fn() };
});
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, configApi: { ...original.configApi, config: vi.fn().mockResolvedValue({ effectiveConfig: {} }) } };
});
import "./main";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

it("registers and renders the session tree navigator through the browser entrypoint", async () => {
  expect(customElements.get("session-tree-navigator")).toBeDefined();
  const navigator = document.createElement("session-tree-navigator");
  if (!(navigator instanceof LitElement)) throw new Error("Session tree navigator was not registered");
  document.body.append(navigator);
  await navigator.updateComplete;
  expect(navigator.shadowRoot?.querySelector("h1")?.textContent).toBe("Navigate session tree");
  expect(navigator.shadowRoot?.querySelector("modal-surface")).not.toBeNull();
});
