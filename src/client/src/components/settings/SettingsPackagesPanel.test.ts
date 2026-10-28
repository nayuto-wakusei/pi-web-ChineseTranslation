import { describe, expect, it } from "vitest";
import type { PiPackageInfo } from "../../api";
import { SettingsPackagesPanel } from "./SettingsPackagesPanel";
import type { PiPackageManagementSupport, PiPackageTargetContext } from "./piPackageSettings";
import { expectTextOrder, flattenTemplateContent } from "../SettingsDialog.testSupport";

const remoteTarget: PiPackageTargetContext = { id: "lab-mac", name: "Lab Mac", kind: "remote" };
const unsupportedMessage = "Lab Mac 不支持 Pi 包管理。请更新并重启该机器上的 PI WEB，然后重试。";

describe("settings-packages-panel layout", () => {
  it("suppresses package controls and trust warnings when package management is unsupported", () => {
    const panel = new SettingsPackagesPanel();
    panel.targetMachine = remoteTarget;
    panel.managementSupport = unsupportedPackageManagement();
    panel.error = unsupportedMessage;

    const rendered = flattenTemplateContent(panel.render());

    expect(rendered).toContain(unsupportedMessage);
    expect(rendered).not.toContain("受信代码警告");
    expect(rendered).not.toContain("Pi package source");
    expect(rendered).not.toContain("Configured Pi packages");
    expect(rendered).not.toContain("尚未配置 Pi 包");
  });

  it("shows a load-unavailable state instead of an empty package state when no response loaded", () => {
    const panel = new SettingsPackagesPanel();
    panel.targetMachine = remoteTarget;
    panel.error = "Failed to load Pi packages from Lab Mac (remote machine): Could not reach Lab Mac.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Failed to load Pi packages from Lab Mac (remote machine): Could not reach Lab Mac.",
      "Pi package list unavailable for Lab Mac (remote machine). Choose Refresh package list to try again.",
    ]);
    expect(rendered).not.toContain("No Pi packages configured");
    expect(rendered).not.toContain("Trusted code warning");
    expect(rendered).not.toContain("Pi package source");
    expect(rendered).not.toContain("Configured Pi packages");
  });

  it("shows trust guidance, install controls, and empty state only after a package response loaded", () => {
    const panel = new SettingsPackagesPanel();
    panel.packagesResponse = { packages: [] };

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Pi packages",
      "Managing Pi packages on ",
      "本机 (local gateway)",
      "Trusted code warning:",
      "Pi package source",
      "Configured Pi packages",
      "No Pi packages configured in Pi settings on 本机 (local gateway) yet.",
    ]);
    expect(rendered).not.toContain("Pi package list unavailable");
  });

  it("orders package errors before the trusted-code warning while preserving loaded data", () => {
    const panel = new SettingsPackagesPanel();
    panel.targetMachine = remoteTarget;
    panel.packagesResponse = { packages: [packageInfo("npm:@acme/tools")] };
    panel.error = "Failed to refresh gateway PI WEB plugins after updating packages.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Failed to refresh gateway PI WEB plugins after updating packages.",
      "Trusted code warning:",
      "Pi package source",
      "Configured Pi packages",
      "npm:@acme/tools",
    ]);
  });
});

function unsupportedPackageManagement(): PiPackageManagementSupport {
  return { state: "unsupported", message: unsupportedMessage };
}

function packageInfo(source: string): PiPackageInfo {
  return { source, scope: "user", filtered: false, installedPath: `/pi/packages/${source}` };
}
