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
    expect(rendered).not.toContain("Pi 包来源");
    expect(rendered).not.toContain("已配置的 Pi 包");
    expect(rendered).not.toContain("尚未配置 Pi 包");
  });

  it("shows a load-unavailable state instead of an empty package state when no response loaded", () => {
    const panel = new SettingsPackagesPanel();
    panel.targetMachine = remoteTarget;
    panel.error = "Failed to load Pi packages from Lab Mac (remote machine): Could not reach Lab Mac.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Failed to load Pi packages from Lab Mac (remote machine): Could not reach Lab Mac.",
      "Lab Mac（远程机器） 的 Pi 包列表不可用，请重新加载。",
    ]);
    expect(rendered).not.toContain("尚未配置 Pi 包");
    expect(rendered).not.toContain("受信代码警告");
    expect(rendered).not.toContain("Pi 包来源");
    expect(rendered).not.toContain("已配置的 Pi 包");
  });

  it("shows trust guidance, install controls, and empty state only after a package response loaded", () => {
    const panel = new SettingsPackagesPanel();
    panel.packagesResponse = { packages: [] };

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Pi 包",
      "管理 ",
      "本机（本地网关）",
      "受信代码警告：",
      "Pi 包来源",
      "已配置的 Pi 包",
      "本机（本地网关） 的 Pi 设置中尚未配置 Pi 包。",
    ]);
    expect(rendered).not.toContain("Pi 包列表不可用");
  });

  it("orders package errors before the trusted-code warning while preserving loaded data", () => {
    const panel = new SettingsPackagesPanel();
    panel.targetMachine = remoteTarget;
    panel.packagesResponse = { packages: [packageInfo("npm:@acme/tools")] };
    panel.error = "Failed to refresh gateway PI WEB plugins after updating packages.";

    const rendered = flattenTemplateContent(panel.render());

    expectTextOrder(rendered, [
      "Failed to refresh gateway PI WEB plugins after updating packages.",
      "受信代码警告：",
      "Pi 包来源",
      "已配置的 Pi 包",
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
