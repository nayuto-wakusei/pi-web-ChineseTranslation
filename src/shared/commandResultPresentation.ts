/** Explicit provenance for PI WEB built-in command results, never extension output. */
const staticCodes = ["forkCancelled","forked","nameUsage","requestExpired","reloadActive","reloadUnavailable","reloaded","cloneEmpty","cloneCancelled","cloned","forkEmpty","forkSelect","treeActive","treeEmpty","treeUnavailable","navigationActive"] as const;
export type StaticCommandFeedbackCode = typeof staticCodes[number];

export interface CommandSessionStats {
  sessionId: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokens: { input: number; output: number; total: number };
  /** Pi SDK costs are denominated in USD, independent of locale. */
  cost: number;
}

export type CommandFeedback =
  | { code: StaticCommandFeedbackCode }
  | { code: "unknown" | "notImplemented"; command: string }
  | { code: "named"; name: string }
  | { code: "reloadFailed" | "treeFailed"; detail: string }
  | { code: "replacementActive"; command: "fork" | "clone" }
  | { code: "stats"; stats: CommandSessionStats };

export interface CommandResultPresentation { kind: "commandResult"; feedback: CommandFeedback }

/** Cosmetic metadata is optional: malformed/future data falls back to wire text. */
export function parseCommandResultPresentation(value: unknown): CommandResultPresentation | undefined {
  if (!isRecord(value) || value["kind"] !== "commandResult" || !isRecord(value["feedback"])) return undefined;
  const data = value["feedback"];
  const code = data["code"];
  if (typeof code !== "string") return undefined;
  const staticCode = staticCodes.find((candidate) => candidate === code);
  if (staticCode !== undefined) return { kind: "commandResult", feedback: { code: staticCode } };
  switch (code) {
    case "unknown":
    case "notImplemented":
      if (typeof data["command"] === "string") return { kind: "commandResult", feedback: { code, command: data["command"] } };
      break;
    case "named":
      if (typeof data["name"] === "string") return { kind: "commandResult", feedback: { code, name: data["name"] } };
      break;
    case "reloadFailed":
    case "treeFailed":
      if (typeof data["detail"] === "string") return { kind: "commandResult", feedback: { code, detail: data["detail"] } };
      break;
    case "replacementActive":
      if (data["command"] === "fork" || data["command"] === "clone") return { kind: "commandResult", feedback: { code, command: data["command"] } };
      break;
    case "stats": {
      const stats = data["stats"];
      if (!isRecord(stats) || typeof stats["sessionId"] !== "string" || !isRecord(stats["tokens"])) break;
      const { totalMessages, userMessages, assistantMessages, toolCalls, cost } = stats;
      const { input, output, total } = stats["tokens"];
      if (!finite(totalMessages) || !finite(userMessages) || !finite(assistantMessages) || !finite(toolCalls)
        || !finite(cost) || !finite(input) || !finite(output) || !finite(total)) break;
      return { kind: "commandResult", feedback: { code, stats: { sessionId: stats["sessionId"], totalMessages, userMessages, assistantMessages, toolCalls, cost, tokens: { input, output, total } } } };
    }
  }
  return undefined;
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
