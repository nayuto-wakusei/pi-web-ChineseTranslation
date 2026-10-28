/** English wire fallbacks. Structured kinds, never these strings, select translations. */
export const runtimeActivityLabels = {
  compacting: "compacting",
  duplicateQueuedMessage: "duplicate queued message ignored",
  steeringQueued: "steering queued",
  messageQueued: "message queued",
  promptAccepted: "prompt accepted",
  error: "error",
  queuedDuringCompaction: "message queued during compaction",
  runningBash: "running bash",
  bashComplete: "bash complete",
  bashFailed: "bash failed",
  summarizingBranch: "summarizing branch",
  navigatingTree: "navigating session tree",
  branchSummaryAborted: "branch summary aborted",
  treeNavigationCancelled: "tree navigation cancelled",
  treeNavigated: "session tree navigated",
  treeNavigationFailed: "tree navigation failed",
  forking: "forking session from entry",
  forkCancelled: "fork cancelled",
  forked: "session forked",
  forkFailed: "fork failed",
  reloading: "reloading resources",
  reloaded: "resources reloaded",
  reloadFailed: "reload failed",
  stopped: "stopped",
  stopFailed: "stop failed",
  extensionError: "extension error",
  extensionCallbackFailed: "extension callback failed",
  compactionCancelled: "compaction cancelled",
  compactionComplete: "compaction complete",
  compactionFailed: "compaction failed",
  updatingSession: "updating session",
  agentRunning: "agent running",
  queued: "queued",
  active: "active",
  idle: "idle",
  turnComplete: "turn complete",
  messageStarted: "message started",
  messageComplete: "message complete",
  receivingResponse: "receiving response",
  runningTool: "running tool",
  toolFailed: "tool failed",
  toolComplete: "tool complete",
} as const;

export type RuntimeActivityKind = keyof typeof runtimeActivityLabels;
export type RuntimeActivityPresentation =
  | { kind: RuntimeActivityKind; detailKind?: "compactionCancelled" | "automaticCompactionCancelled" | "compactionFailed" }
  | { kind: "model" | "thinking" | "event"; value: string };

function isRuntimeActivityKind(value: string): value is RuntimeActivityKind {
  return Object.hasOwn(runtimeActivityLabels, value);
}

/** Ignore unfamiliar cosmetic metadata so old browsers retain the server's raw fallback. */
export function parseRuntimeActivityPresentation(value: unknown): RuntimeActivityPresentation | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value)) return undefined;
  const { kind } = value;
  if (kind === "model" || kind === "thinking" || kind === "event") {
    return "value" in value && typeof value.value === "string" ? { kind, value: value.value } : undefined;
  }
  if (typeof kind !== "string" || !isRuntimeActivityKind(kind)) return undefined;
  const detailKind = "detailKind" in value ? value.detailKind : undefined;
  if (detailKind !== undefined && detailKind !== "compactionCancelled" && detailKind !== "automaticCompactionCancelled" && detailKind !== "compactionFailed") return undefined;
  return { kind, ...(detailKind === undefined ? {} : { detailKind }) };
}

export function runtimeActivityFallbackLabel(presentation: RuntimeActivityPresentation): string {
  if (presentation.kind === "model") return `model: ${presentation.value}`;
  if (presentation.kind === "thinking") return `thinking: ${presentation.value}`;
  if (presentation.kind === "event") return presentation.value.replaceAll("_", " ");
  return runtimeActivityLabels[presentation.kind];
}
