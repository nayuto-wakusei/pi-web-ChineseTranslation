// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { AppPanelEdgeControl } from "./AppPanelEdgeControl";

afterEach(() => { document.body.replaceChildren(); });

it("keeps keyboard resizing and reset independent from the collapse action", async () => {
  const edge = new AppPanelEdgeControl();
  edge.resizable = true;
  edge.controls = "navigation-panel";
  edge.panelWidth = 340;
  edge.minWidth = 220;
  edge.maxWidth = 600;
  edge.onResize = vi.fn();
  edge.onResizeEnd = vi.fn();
  edge.onReset = vi.fn();
  edge.onToggle = vi.fn();
  document.body.append(edge);
  await edge.updateComplete;
  const separator = edge.renderRoot.querySelector<HTMLElement>('[role="separator"]');
  if (separator === null) throw new Error("Expected resize separator");
  const toggle = edge.renderRoot.querySelector<HTMLButtonElement>("button");
  expect(toggle).not.toBeNull();
  toggle?.click();
  expect(edge.onToggle).toHaveBeenCalledOnce();
  expect(edge.onResize).not.toHaveBeenCalled();
  expect(separator.getAttribute("aria-controls")).toBe("navigation-panel");
  expect(separator.getAttribute("aria-valuenow")).toBe("340");
  separator.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(edge.onResize).toHaveBeenCalledWith(600);
  expect(edge.onResizeEnd).toHaveBeenCalledOnce();
  separator.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(edge.onReset).toHaveBeenCalledOnce();

  edge.resizable = false;
  await edge.updateComplete;
  expect(edge.renderRoot.querySelector('[role="separator"]')).toBeNull();
});
