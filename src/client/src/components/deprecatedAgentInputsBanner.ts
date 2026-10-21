import { t } from "../i18n";
import { html, type TemplateResult } from "lit";
import type { Machine, MachineRuntime } from "../api";
import type { PiWebDeprecatedAgentInput } from "../../../shared/apiTypes";

export interface DeprecatedAgentInputsWarning {
  readonly machineId: string;
  readonly machineName: string;
  readonly inputs: readonly PiWebDeprecatedAgentInput[];
}

export function deprecatedAgentInputsWarnings(machines: readonly Machine[], machineRuntimes: Readonly<Record<string, MachineRuntime>>): DeprecatedAgentInputsWarning[] {
  const warnings: DeprecatedAgentInputsWarning[] = [];
  for (const machine of machines) {
    const inputs = machineRuntimes[machine.id]?.deprecatedAgentInputs;
    if (inputs === undefined || inputs.length === 0) continue;
    warnings.push({ machineId: machine.id, machineName: machine.name, inputs });
  }
  return warnings;
}

export function deprecatedAgentInputsWarningText(warning: DeprecatedAgentInputsWarning): string {
  const inputs = warning.inputs.map((input) => {
    const label = input.source === "config" ? t("ui.main.cfe35469e36d", "Config setting {arg0}", { arg0: input.name }) : t("ui.main.0d4a3f015cec", "Environment variable {arg0}", { arg0: input.name });
    return input.replacement === undefined
      ? t("ui.main.ccb652119f1a", "{arg0} is deprecated with no replacement; remove it manually (local compatibility remains temporarily)", { arg0: label })
      : t("ui.main.22fa6c3b8983", "{arg0} is deprecated; use {arg1} instead", { arg0: label, arg1: input.replacement });
  }).join("；");
  return t("ui.main.92bd6d097e1f", "{arg0}: {arg1}. Support for deprecated agent configuration inputs will be removed in a future release.", { arg0: warning.machineName, arg1: inputs });
}

export function deprecatedAgentInputsBanner(warnings: readonly DeprecatedAgentInputsWarning[]): TemplateResult | null {
  if (warnings.length === 0) return null;
  return html`<div class="deprecation-notice" role="alert">
    ${warnings.map((warning) => html`<p class="deprecation-notice-text">${deprecatedAgentInputsWarningText(warning)}</p>`)}
  </div>`;
}
