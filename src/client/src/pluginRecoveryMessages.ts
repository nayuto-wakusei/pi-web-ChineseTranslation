import { localization } from "./localization/browser";
import definitions from "./pluginRecovery.messages";

export const pluginRecoveryMessages = localization.registerMessages("core.pluginRecovery", definitions);

/** Browser-owned guidance, kept separate from verbatim plugin/runtime diagnostics. */
export class PluginRecoveryError extends Error {
  constructor(private readonly displayMessage: () => string) { super(); }
  override get message(): string { return this.displayMessage(); }
}
