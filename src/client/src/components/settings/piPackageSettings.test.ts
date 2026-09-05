import { describe, expect, it } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../../shared/capabilities";
import type { MachineRuntime, PiPackageInfo } from "../../api";
import { canUpdateAllPiPackages, friendlyPiPackageErrorMessage, isPiPackageManagementUnsupported, isPiPackageOperationPending, normalizePiPackageSource, piPackageFilteredLabel, piPackageManagementSupport, piPackageMutationFollowUpMessage, piPackagesResponseAfterMutation, piPackageScopeLabel, piPackageSourceValidationMessage, piPackageTargetContext, piPackageTargetLabel, piPackageUpdateDisabledReason, shouldRefreshGatewayPluginsAfterPiPackageMutation, updateAllPiPackagesDisabledReason, type PiPackageTargetContext } from "./piPackageSettings";

const userPackage: PiPackageInfo = { source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/tools" };
const projectPackage: PiPackageInfo = { source: "../project-tools", scope: "project", filtered: true };
const localTarget: PiPackageTargetContext = { id: "local", name: "本机", kind: "local" };
const remoteTarget: PiPackageTargetContext = { id: "remote-a", name: "Lab Mac", kind: "remote" };
const runtimeWithPackageManagement: MachineRuntime = { machineId: "remote-a", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.piPackagesManage] };
const runtimeWithoutPackageManagement: MachineRuntime = { machineId: "remote-a", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsReload] };
const unavailableRuntime: MachineRuntime = { machineId: "remote-a", ok: false, checkedAt: "now", error: "Remote runtime returned HTTP 404" };

describe("Pi package settings helpers", () => {
  it("normalizes and validates install sources without adding location choices", () => {
    expect(normalizePiPackageSource("  npm:@acme/tools  ")).toBe("npm:@acme/tools");
    expect(piPackageSourceValidationMessage("  npm:@acme/tools  ")).toBeUndefined();
    expect(piPackageSourceValidationMessage("   ")).toContain("请输入 Pi 支持的包来源");
  });

  it("formats package metadata with Pi package terminology", () => {
    expect(piPackageScopeLabel(userPackage)).toBe("用户范围");
    expect(piPackageScopeLabel(projectPackage)).toBe("项目范围");
    expect(piPackageFilteredLabel(userPackage)).toBe("可用于此 PI WEB 进程");
    expect(piPackageFilteredLabel(projectPackage)).toBe("已被当前 Pi 包设置过滤");
  });

  it("allows updates for user-scope packages and explains project-scope limits", () => {
    expect(piPackageUpdateDisabledReason(userPackage)).toBeUndefined();
    expect(piPackageUpdateDisabledReason(projectPackage)).toContain("用户范围的 Pi 包");
    expect(canUpdateAllPiPackages([userPackage])).toBe(true);
    expect(canUpdateAllPiPackages([userPackage, projectPackage])).toBe(false);
    expect(updateAllPiPackagesDisabledReason([])).toBe("尚未配置 Pi 包。");
    expect(updateAllPiPackagesDisabledReason([userPackage, projectPackage])).toContain("项目范围的 Pi 包");
  });

  it("matches pending operations by action and source", () => {
    expect(isPiPackageOperationPending({ kind: "remove", source: "npm:@acme/tools" }, "remove", "npm:@acme/tools")).toBe(true);
    expect(isPiPackageOperationPending({ kind: "remove", source: "npm:@acme/tools" }, "remove", "npm:@acme/other")).toBe(false);
    expect(isPiPackageOperationPending({ kind: "update-all" }, "update-all")).toBe(true);
  });

  it("labels package targets and gateway plugin refresh scope", () => {
    expect(piPackageTargetContext(undefined)).toEqual(localTarget);
    expect(piPackageTargetLabel(localTarget)).toBe("本机（本地网关）");
    expect(piPackageTargetLabel(remoteTarget)).toBe("Lab Mac（远程机器）");
    expect(shouldRefreshGatewayPluginsAfterPiPackageMutation(localTarget)).toBe(true);
    expect(shouldRefreshGatewayPluginsAfterPiPackageMutation(remoteTarget)).toBe(false);
  });

  it("treats package management as fixed on a healthy remote runtime", () => {
    expect(piPackageManagementSupport(localTarget, undefined)).toEqual({ state: "supported" });
    expect(piPackageManagementSupport(remoteTarget, runtimeWithPackageManagement)).toEqual({ state: "supported" });

    const supportedWithoutMetadata = piPackageManagementSupport(remoteTarget, runtimeWithoutPackageManagement);
    expect(isPiPackageManagementUnsupported(supportedWithoutMetadata)).toBe(false);
    expect(supportedWithoutMetadata).toEqual({ state: "supported" });

    expect(piPackageManagementSupport(remoteTarget, undefined)).toEqual({ state: "unknown" });
    expect(piPackageManagementSupport(remoteTarget, unavailableRuntime)).toEqual({ state: "unknown" });
  });

  it("describes the browser and session reload follow-up without requiring sessiond restarts", () => {
    const message = piPackageMutationFollowUpMessage("install");

    expect(message).toContain("每个空闲的 PI WEB 会话 中输入 /reload");
    expect(message).toContain("扩展、技能、提示词模板、主题以及上下文/系统提示文件");
    expect(message).toContain("PI WEB 浏览器插件变更");
    expect(message).not.toContain("会话守护进程");
    expect(message).not.toContain("sessiond");
  });

  it("scopes remote package mutation follow-up copy to the selected machine", () => {
    const message = piPackageMutationFollowUpMessage("update", remoteTarget);

    expect(message).toContain("Pi 包已更新（Lab Mac）");
    expect(message).toContain("Lab Mac 上每个空闲的 PI WEB 会话");
    expect(message).toContain("Lab Mac 提供的 PI WEB 浏览器插件变更");
  });

  it("carries refreshed installable-known-package suggestions through mutations", () => {
    const suggestion = { id: "@jmfederico/pi-relay", label: "中继", description: "Relay 方法提示词和技能。", source: "/pi-web/dist/pi-packages/relays" };

    expect(piPackagesResponseAfterMutation({ packages: [userPackage], installableKnownPackages: [suggestion] })).toEqual({
      packages: [userPackage],
      installableKnownPackages: [suggestion],
    });
    expect(piPackagesResponseAfterMutation({ packages: [userPackage] })).toEqual({ packages: [userPackage] });
  });

  it("turns older remote route failures into package-management compatibility guidance", () => {
    expect(friendlyPiPackageErrorMessage("Not Found", remoteTarget)).toBe("Lab Mac 不支持 Pi 包管理。请更新并重启该机器上的 PI WEB，然后重试。");
    expect(friendlyPiPackageErrorMessage("Remote machine unavailable", remoteTarget)).toBe("无法连接 Lab Mac 进行 Pi 包管理。请检查机器连接后重试。");
    expect(friendlyPiPackageErrorMessage("Remote machine timeout", remoteTarget)).toContain("可能仍在远端运行");
    expect(friendlyPiPackageErrorMessage("Not Found", localTarget)).toBe("Not Found");
  });
});
