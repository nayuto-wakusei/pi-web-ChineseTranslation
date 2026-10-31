// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { SettingsPackagesPanel } from "./SettingsPackagesPanel";
import { SettingsPanelFrame } from "./SettingsPanelFrame";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

it("withholds install controls and trust notices until package data has loaded", async () => {
  const panel = new SettingsPackagesPanel();
  document.body.append(panel);
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelector("form")).toBeNull();
  expect(frame(panel).notices).toEqual([]);

  panel.packagesResponse = { packages: [] };
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelector("form")).not.toBeNull();
  expect(frame(panel).notices.map(({ type }) => type)).toEqual(["security"]);
});

it("keeps loaded packages and trust guidance after a refresh failure, with errors first", async () => {
  const panel = new SettingsPackagesPanel();
  panel.packagesResponse = { packages: [{ source: "npm:tools", scope: "user", filtered: false, installedPath: "/packages/tools" }] };
  panel.error = "Refresh failed";
  document.body.append(panel);
  await panel.updateComplete;

  expect(panel.shadowRoot?.querySelector(".package-card")?.textContent).toContain("npm:tools");
  expect(frame(panel).notices).toEqual([
    { type: "error", content: "Refresh failed" },
    expect.objectContaining({ type: "security" }),
  ]);
});

function frame(panel: SettingsPackagesPanel): SettingsPanelFrame {
  const element = panel.shadowRoot?.querySelector("settings-panel-frame");
  if (!(element instanceof SettingsPanelFrame)) throw new Error("Missing settings frame");
  return element;
}
