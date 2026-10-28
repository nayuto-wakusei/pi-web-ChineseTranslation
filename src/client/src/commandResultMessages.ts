import type { CommandResultPresentation } from "../../shared/commandResultPresentation";
import { localization } from "./localization/browser";
import definitions from "./commandResults.messages";

export const commandResultMessages = localization.registerMessages("core.commandResults", definitions);

export function localizedCommandResult(presentation: CommandResultPresentation): string {
  const feedback = presentation.feedback;
  switch (feedback.code) {
    case "unknown":
    case "notImplemented": return commandResultMessages.t(feedback.code, { command: feedback.command });
    case "named": return commandResultMessages.t("named", { name: feedback.name });
    case "reloadFailed":
    case "treeFailed": return commandResultMessages.t(feedback.code, { detail: feedback.detail });
    case "replacementActive": return commandResultMessages.t("replacementActive", { command: feedback.command });
    case "stats": {
      const stats = feedback.stats;
      return commandResultMessages.t("stats", {
        sessionId: stats.sessionId, totalMessages: stats.totalMessages, userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages, toolCalls: stats.toolCalls,
        input: stats.tokens.input, output: stats.tokens.output, total: stats.tokens.total,
        cost: localization.number(stats.cost, { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }),
      });
    }
    case "forkCancelled":
    case "forked":
    case "nameUsage":
    case "requestExpired":
    case "reloadActive":
    case "reloadUnavailable":
    case "reloaded":
    case "cloneEmpty":
    case "cloneCancelled":
    case "cloned":
    case "forkEmpty":
    case "forkSelect":
    case "treeActive":
    case "treeEmpty":
    case "treeUnavailable":
    case "navigationActive":
      return commandResultMessages.t(feedback.code);
  }
}

/** History-action banners retain presentation instead of freezing the current language. */
export class CommandResultError extends Error {
  constructor(private readonly presentation: CommandResultPresentation) { super(); }
  override get message(): string { return localizedCommandResult(this.presentation); }
  override toString(): string { return this.message; }
}
