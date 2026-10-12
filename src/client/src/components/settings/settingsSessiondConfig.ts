import type { ActiveAgentProfileDescriptor, PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues } from "../../api";

export type AgentProfileActivationState = "active" | "restart-required" | "unavailable";

export function spawnSessionsConfigPatch(enabled: boolean): PiWebConfigValues {
  return { spawnSessions: enabled };
}

export function subsessionsConfigPatch(enabled: boolean): PiWebConfigValues {
  return { subsessions: enabled };
}

export function askUserConfigPatch(enabled: boolean): PiWebConfigValues {
  return { askUser: enabled };
}

export function agentProfileActivationState(
  config: PiWebConfigResponse | undefined,
  activeProfile: ActiveAgentProfileDescriptor | undefined,
): AgentProfileActivationState {
  const desiredProfile = config?.effectiveConfig.agent;
  if (desiredProfile?.dir === undefined || activeProfile === undefined) return "unavailable";
  return desiredProfile.dir === activeProfile.dir ? "active" : "restart-required";
}

export function agentDirFieldOverridden(envOverrides: PiWebConfigEnvOverrides | undefined, _draftCommand: string): boolean {
  void _draftCommand;
  if (envOverrides?.agentDirSource === "pi-web") return true;
  if (envOverrides?.agentDirSource === "pi-compatibility") return true;
  // Older remote responses do not identify the source. Keep their override
  // read-only rather than incorrectly treating a PI_WEB_AGENT_DIR as conditional.
  return envOverrides?.agentDir === true;
}

export function mergeSelectedMachineSessiondConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  const envOverrides: PiWebConfigEnvOverrides = {
    ...base.envOverrides,
    spawnSessions: selectedMachine.envOverrides.spawnSessions,
    subsessions: selectedMachine.envOverrides.subsessions,
    askUser: selectedMachine.envOverrides.askUser,
    agentCommand: selectedMachine.envOverrides.agentCommand,
    agentDir: selectedMachine.envOverrides.agentDir,
    agentSessionDir: selectedMachine.envOverrides.agentSessionDir,
  };
  if (selectedMachine.envOverrides.agentDirSource === undefined) delete envOverrides.agentDirSource;
  else envOverrides.agentDirSource = selectedMachine.envOverrides.agentDirSource;
  return {
    ...base,
    config: { ...base.config, ...selectedMachine.config },
    effectiveConfig: { ...base.effectiveConfig, ...selectedMachine.effectiveConfig },
    envOverrides,
  };
}
