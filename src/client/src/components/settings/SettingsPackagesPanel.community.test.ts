// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { SettingsPackagesPanel } from "./SettingsPackagesPanel";

afterEach(() => { document.body.replaceChildren(); });

it.each([undefined, { state: "unsupported" as const }])("links to community plugins without enabling unavailable package controls: %j", async (support) => {
  const panel = new SettingsPackagesPanel();
  panel.managementSupport = support;
  document.body.append(panel);
  await panel.updateComplete;
  const link = panel.shadowRoot?.querySelector<HTMLAnchorElement>('a[href="https://pi-web.dev/community-plugins"]');
  expect(link?.textContent.trim()).not.toBe("");
  expect(link?.target).toBe("_blank");
  expect(link?.rel).toContain("noopener");
  expect(link?.rel).toContain("noreferrer");
  expect(panel.shadowRoot?.querySelector("#package-source")).toBeNull();
});
