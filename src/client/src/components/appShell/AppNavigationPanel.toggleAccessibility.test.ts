// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { AppNavigationPanel } from "./AppNavigationPanel";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("exposes the header collapse control as a native expanded navigation-panel toggle", async () => {
  const panel = new AppNavigationPanel();
  panel.onTogglePanel = vi.fn();
  document.body.append(panel);
  await panel.updateComplete;
  const toggle = panel.shadowRoot?.querySelector<HTMLButtonElement>(".panel-toggle");
  expect(toggle?.getAttribute("type")).toBe("button");
  expect(toggle?.getAttribute("aria-controls")).toBe("navigation-panel");
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  toggle?.click();
  expect(panel.onTogglePanel).toHaveBeenCalledOnce();
});

it("omits the header toggle when its owner provides no action", async () => {
  const panel = new AppNavigationPanel();
  document.body.append(panel);
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelector(".panel-toggle")).toBeNull();
});
