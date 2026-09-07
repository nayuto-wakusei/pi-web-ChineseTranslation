// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, expect, it } from "vitest";
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
  expect(navigator.shadowRoot?.querySelector("h1")?.textContent).toBe("浏览会话树");
  expect(navigator.shadowRoot?.querySelector("modal-surface")).not.toBeNull();
});
