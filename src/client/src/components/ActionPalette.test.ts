import { describe, expect, it } from "vitest";
import type { AppAction } from "../actions";
import { filterActionPaletteActions } from "./ActionPalette";

describe("filterActionPaletteActions", () => {
  it("keeps disabled actions visible when they have an explanation", () => {
    const actions: AppAction[] = [
      action("enabled", "Enabled action"),
      action("hidden", "Disabled without reason", { enabled: false }),
      action("explained", "Disabled with reason", { enabled: false, disabledReason: "Update and restart the selected machine." }),
    ];

    expect(filterActionPaletteActions(actions, "").map((item) => item.id)).toEqual(["enabled", "explained"]);
  });

  it("matches disabled reasons in search", () => {
    const actions: AppAction[] = [
      action("cleanup", "清理会话", { enabled: false, disabledReason: "所选服务器不支持清理。" }),
    ];

    expect(filterActionPaletteActions(actions, "不支持清理").map((item) => item.id)).toEqual(["cleanup"]);
  });
});

function action(id: string, title: string, patch: Partial<AppAction> = {}): AppAction {
  return { id, title, run: () => undefined, ...patch };
}
