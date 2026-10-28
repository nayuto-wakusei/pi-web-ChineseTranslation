import { message } from "./localization/service";

export default {
  source: message("PI WEB plugins", "Name of the gateway plugin source"),
  remoteSource: message<{ name: string }>("PI WEB plugins from {name}", "Remote plugin source; machine name stays unchanged"),
  lifecycleRequired: message<{ name: string }>("PI WEB plugins from {name} require a matching plugin lifecycle capability; update and restart PI WEB on that machine", "Remote plugin loading is blocked by an incompatible runtime"),
  loadFailed: message<{ source: string; detail: string }>("Failed to load {source}: {detail}", "Plugin source loading failed; diagnostic stays unchanged"),
  terminalLoadFailed: message<{ detail: string }>("Required Terminal plugin failed to load: {detail}. Open Settings for recovery guidance.", "Required plugin import failed; diagnostic stays unchanged"),
  terminalActivationFailed: message<{ phase: string; detail: string }>("Required Terminal plugin failed during browser {phase, select, import {import} validate {validation} activate {activation} start {startup} dispose {disposal} other {activation}}: {detail}. Open Settings for recovery guidance.", "Required plugin lifecycle failed; phase is a protocol enum and diagnostic stays unchanged"),
  terminalMissingAfterActivation: message("Required Terminal plugin is unavailable after plugin activation. Open Settings for recovery guidance.", "Required plugin activation did not provide a usable Terminal"),
  terminalUnavailable: message("Required Terminal plugin is unavailable. Open Settings for recovery guidance.", "A local Terminal action cannot run"),
  remoteTerminalUnavailable: message<{ id: string }>("Required Terminal plugin is unavailable on machine {id}. Open Settings for recovery guidance.", "A remote Terminal action cannot run; machine identifier stays unchanged"),
  capabilityLost: message("Required Terminal browser capability was not retained after activation", "Browser activation did not retain its required capability"),
  revisionChanged: message("Required Terminal revision changed after browser activation; reload PI WEB to activate the new paired revision", "Required Terminal needs a browser reload after a revision change"),
  registrationMissing: message("Required Terminal browser registration is unavailable", "Required Terminal registration is missing"),
  declarationMissing: message("Required Terminal browser declaration is unavailable", "Required Terminal declaration is missing"),
};
