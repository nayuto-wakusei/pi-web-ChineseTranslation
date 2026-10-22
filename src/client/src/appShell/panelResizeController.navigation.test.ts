import { expect, it } from "vitest";
import { clampPanelWidth, panelResizeConstraints } from "./panelResizeController";

it("keeps the navigation minimum wide enough for narrow machine and order controls", () => {
  expect(panelResizeConstraints("navigation").minWidth).toBe(260);
  expect(clampPanelWidth("navigation", 180)).toBe(260);
  expect(panelResizeConstraints("workspace").minWidth).toBe(240);
});
