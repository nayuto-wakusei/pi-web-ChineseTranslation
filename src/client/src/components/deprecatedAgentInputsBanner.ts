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
    const label = input.source === "config" ? `配置项 ${input.name}` : `环境变量 ${input.name}`;
    return input.replacement === undefined
      ? `${label} 已弃用；没有替代项，请手动移除（本地兼容行为暂时保留）`
      : `${label} 已弃用；请改用 ${input.replacement}`;
  }).join("；");
  return `${warning.machineName}：${inputs}。对弃用代理配置输入的支持将在未来版本中移除。`;
}

export function deprecatedAgentInputsBanner(warnings: readonly DeprecatedAgentInputsWarning[]): TemplateResult | null {
  if (warnings.length === 0) return null;
  return html`<div class="deprecation-notice" role="alert">
    ${warnings.map((warning) => html`<p class="deprecation-notice-text">${deprecatedAgentInputsWarningText(warning)}</p>`)}
  </div>`;
}
