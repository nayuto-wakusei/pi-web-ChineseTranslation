import { describe, expect, it } from "vitest";
import type { Machine, MachineRuntime } from "../../api";
import { agentProfileSettingsSupport, friendlySelectedMachineSettingsErrorMessage, isAgentProfileSettingsSupported, isSelectedMachineSettingsUnsupported, selectedMachineSettingsSupport, selectedMachineSettingsSupportKey, selectedMachineSettingsUnavailableMessage, settingsMachineTarget, settingsMachineTargetLabel } from "./settingsMachineTarget";

const remoteMachine: Machine = {
  id: "remote-a",
  name: "Lab Mac",
  kind: "remote",
  baseUrl: "https://lab.example.test",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("selected-machine settings target helpers", () => {
  it("uses the selected machine when present and falls back to the local gateway", () => {
    expect(settingsMachineTarget(undefined)).toEqual({ id: "local", name: "本机", kind: "local" });
    expect(settingsMachineTarget(remoteMachine)).toEqual({ id: "remote-a", name: "Lab Mac", kind: "remote" });
  });

  it("labels local and remote settings targets factually", () => {
    expect(settingsMachineTargetLabel({ id: "local", name: "local", kind: "local" })).toBe("local（本地网关）");
    expect(settingsMachineTargetLabel(settingsMachineTarget(remoteMachine))).toBe("Lab Mac（远程机器）");
  });

  it("treats selected-machine settings as fixed on a healthy remote runtime", () => {
    const target = settingsMachineTarget(remoteMachine);
    const runtime: MachineRuntime = { machineId: "remote-a", ok: true, checkedAt: "now", capabilities: [] };

    expect(selectedMachineSettingsSupport({ id: "local", name: "local", kind: "local" }, undefined)).toEqual({ state: "supported" });
    expect(selectedMachineSettingsSupport(target, undefined)).toEqual({ state: "unknown" });
    expect(selectedMachineSettingsSupport(target, { ok: false })).toEqual({ state: "unknown" });
    const supported = selectedMachineSettingsSupport(target, runtime);
    expect(supported).toEqual({ state: "supported" });
    expect(isSelectedMachineSettingsUnsupported(supported)).toBe(false);
    expect(selectedMachineSettingsSupportKey(supported)).toBe("supported:");
  });

  it("treats remote agent profile edits as fixed on a healthy runtime", () => {
    const target = settingsMachineTarget(remoteMachine);

    expect(agentProfileSettingsSupport({ id: "local", name: "local", kind: "local" }, undefined)).toEqual({ state: "supported" });
    expect(agentProfileSettingsSupport(target, undefined)).toEqual({
      state: "unknown",
      message: "无法确认 Lab Mac 是否支持 Pi 兼容代理配置档案。更改配置档案前请重新加载机器状态。",
    });
    const supported = agentProfileSettingsSupport(target, { ok: true, capabilities: [] });
    expect(isAgentProfileSettingsSupported(supported)).toBe(true);
    expect(supported).toEqual({ state: "supported" });
  });

  it("turns older remote config route failures into selected-machine compatibility guidance", () => {
    const target = settingsMachineTarget(remoteMachine);

    expect(selectedMachineSettingsUnavailableMessage(target)).toBe("Lab Mac 不支持所选机器设置。请更新并重启该机器上的 PI WEB，然后重试。");
    expect(friendlySelectedMachineSettingsErrorMessage("Not Found", target)).toBe(selectedMachineSettingsUnavailableMessage(target));
    expect(friendlySelectedMachineSettingsErrorMessage("route GET:/api/config not found", target)).toBe(selectedMachineSettingsUnavailableMessage(target));
    expect(friendlySelectedMachineSettingsErrorMessage("Cannot PUT /api/config", target)).toBe(selectedMachineSettingsUnavailableMessage(target));
    expect(friendlySelectedMachineSettingsErrorMessage("route GET:/api/plugins not found", target)).toBe(selectedMachineSettingsUnavailableMessage(target));
    expect(friendlySelectedMachineSettingsErrorMessage("Cannot GET /api/plugins", target)).toBe(selectedMachineSettingsUnavailableMessage(target));
  });

  it("scopes remote reachability errors to selected-machine settings", () => {
    const target = settingsMachineTarget(remoteMachine);

    expect(friendlySelectedMachineSettingsErrorMessage("Remote machine unavailable", target)).toBe("无法连接 Lab Mac 以获取所选机器设置。请检查机器连接后重试。");
    expect(friendlySelectedMachineSettingsErrorMessage("Remote machine timeout", target)).toBe("联系 Lab Mac 获取所选机器设置时超时。操作可能仍在远端运行；请重新加载后再重试。");
    expect(friendlySelectedMachineSettingsErrorMessage("Not Found", { id: "local", name: "local", kind: "local" })).toBe("Not Found");
  });
});
