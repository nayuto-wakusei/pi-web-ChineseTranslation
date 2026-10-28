
import { html, type TemplateResult } from "lit";
import type { Machine, MachineRuntime, PiWebDeprecatedAgentInput } from "../api";
import { localization } from "../localization/browser";
import definitions from "./deprecatedAgentInputs.messages";

const messages = localization.registerMessages("core.deprecatedAgentInputs", definitions);

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
  const inputs = localization.list(warning.inputs.map(describeDeprecatedAgentInput), { type: "unit" });
  return messages.t("warning", { machine: warning.machineName, inputs });
}

function describeDeprecatedAgentInput(input: PiWebDeprecatedAgentInput): string {
  if (input.replacement === undefined && ((input.source === "config" && input.name === "agent.command") || (input.source === "environment" && input.name === "PI_WEB_AGENT_COMMAND"))) {
    return messages.t(input.source === "config" ? "configCompatibility" : "environmentCompatibility", { name: input.name });
  }
  if (input.replacement === undefined) return messages.t(input.source === "config" ? "configIgnored" : "environmentIgnored", { name: input.name });
  return messages.t(input.source === "config" ? "configReplacement" : "environmentReplacement", { name: input.name, replacement: input.replacement });
}

/**
 * The non-dismissable deprecation banner: it renders no dismiss control and
 * stays up until every machine's runtime report comes back clean, which only
 * happens once the deprecated input is actually removed.
 */
export function deprecatedAgentInputsBanner(warnings: readonly DeprecatedAgentInputsWarning[]): TemplateResult | null {
  if (warnings.length === 0) return null;
  return html`<div class="deprecation-notice" role="alert">
    ${warnings.map((warning) => html`<p class="deprecation-notice-text">${deprecatedAgentInputsWarningText(warning)}</p>`)}
  </div>`;
}
