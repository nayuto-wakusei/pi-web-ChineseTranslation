// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiPackagesResponse } from "../../api";
import { SettingsPackagesPanel } from "./SettingsPackagesPanel";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("settings-packages-panel installable known packages", () => {
  it("does not render the known-package section when there are no suggestions", async () => {
    const panel = await mountPanel({ packages: [] });

    expect(panel.shadowRoot?.querySelector(".known-package-section")).toBeNull();
  });

  it("offers a one-click install for a known package that is not currently configured", async () => {
    const onInstallPackage = vi.fn();
    const panel = await mountPanel(
      { packages: [], installableKnownPackages: [{ id: "@jmfederico/pi-relay", label: "中继", description: "Relay 方法提示词和技能。", source: "/pi-web/dist/pi-packages/relays" }] },
      { onInstallPackage },
    );

    const section = panel.shadowRoot?.querySelector(".known-package-section");
    expect(section?.textContent).toContain("中继");
    expect(section?.textContent).toContain("Relay 方法提示词和技能。");

    knownPackageInstallButton(panel, "中继").click();
    await panel.updateComplete;

    expect(onInstallPackage).toHaveBeenCalledWith("/pi-web/dist/pi-packages/relays");
  });

  it("disables the known-package install button while any package operation is pending", async () => {
    const panel = await mountPanel({
      packages: [],
      installableKnownPackages: [{ id: "@jmfederico/pi-relay", label: "中继", description: "Relay 方法提示词和技能。", source: "/pi-web/dist/pi-packages/relays" }],
    });
    panel.operation = { kind: "update-all" };
    await panel.updateComplete;

    expect(knownPackageInstallButton(panel, "中继").disabled).toBe(true);
  });
});

interface PanelCallbacks {
  onInstallPackage?: (source: string) => void | Promise<void>;
}

async function mountPanel(packagesResponse: PiPackagesResponse, callbacks: PanelCallbacks = {}): Promise<SettingsPackagesPanel> {
  const panel = new SettingsPackagesPanel();
  panel.packagesResponse = packagesResponse;
  Object.assign(panel, callbacks);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function knownPackageInstallButton(panel: SettingsPackagesPanel, label: string): HTMLButtonElement {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>(`button[title="安装 ${label}"]`);
  if (button === undefined || button === null) throw new Error(`Install button for ${label} was not rendered`);
  return button;
}
