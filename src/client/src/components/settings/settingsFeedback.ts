import type { PiPackageMutationAction } from "../../api";
import { localization as browserLocalization } from "../../localization/browser";
import type { PiPackageTargetContext } from "./piPackageSettings";
import type { SettingsMachineTarget } from "./settingsMachineTarget";
import source from "./settingsFeedback.messages";

export const settingsFeedbackMessages = browserLocalization.registerMessages("core.settingsFeedback", source);

export function settingsFeedbackTargetLabel(target: SettingsMachineTarget): string {
  return settingsFeedbackMessages.t("target", { kind: target.kind, name: target.name });
}

export function settingsFeedbackLifecycleUnavailable(target: SettingsMachineTarget): string {
  return settingsFeedbackMessages.t("lifecycleUnavailable", { name: target.name });
}

// Backend diagnostics are values, not English message keys.
export function settingsFeedbackSelectedError(message: string, target: SettingsMachineTarget): string {
  void target;
  return message.trim();
}

export function settingsFeedbackPackageError(message: string, target: PiPackageTargetContext): string {
  void target;
  return message.trim();
}

export function settingsFeedbackPackageFollowUp(action: PiPackageMutationAction, target: PiPackageTargetContext): string {
  return settingsFeedbackMessages.t("packageFollowUp", { action, kind: target.kind, name: target.name, reload: "/reload" });
}
