import { t } from "../i18n";
import type { SessionActivity } from "../api";

export function chatActivityText(state: string, activity?: SessionActivity): string {
  if (activity === undefined) return activityStateLabel(state);
  if (state !== "idle" && activity.phase === "idle") return activityStateLabel(state);
  const label = activity.label;
  return activity.detail !== undefined && activity.detail !== "" ? t("ui.chatView.activityDetail", "{label}: {detail}", { label, detail: activity.detail }) : label;
}

function activityStateLabel(state: string, phase?: SessionActivity["phase"]): string {
  if (phase === "idle") return t("activity.idle", "Idle");
  if (phase !== undefined) return activityStateLabel(state);
  const labels: Record<string, string> = {
    "agent running": t("ui.chatView.agentRunning", "Agent running"),
    "bash complete": t("ui.chatView.commandCompleted", "Command completed"),
    "bash failed": t("ui.chatView.commandFailed", "Command failed"),
    "branch summary aborted": t("ui.chatView.branchSummaryAborted", "Branch summary aborted"),
    "compacting": t("ui.chatView.compactingContext", "Compacting context"),
    "compaction complete": t("ui.chatView.contextCompactionCompleted", "Context compaction completed"),
    "compaction failed": t("ui.chatView.contextCompactionFailed", "Context compaction failed"),
    "duplicate queued message ignored": t("ui.chatView.duplicateQueuedMessageIgnored", "Duplicate queued message ignored"),
    "error": t("ui.chatView.anErrorOccurred", "An error occurred"),
    "extension error": t("ui.chatView.extensionError", "Extension error"),
    "idle": t("ui.chatView.idle", "Idle"),
    "message complete": t("ui.chatView.messageCompleted", "Message completed"),
    "message queued": t("ui.chatView.messageQueued", "Message queued"),
    "message queued during compaction": t("ui.chatView.messageQueuedDuringCompaction", "Message queued during compaction"),
    "message started": t("ui.chatView.messageStarted", "Message started"),
    "navigating session tree": t("ui.chatView.navigatingSessionTree", "Navigating session tree"),
    "prompt accepted": t("ui.chatView.messageReceived", "Message received"),
    "receiving response": t("ui.chatView.receivingResponse", "Receiving response"),
    "reload failed": t("ui.chatView.reloadFailed", "Reload failed"),
    "reloading resources": t("ui.chatView.reloadingResources", "Reloading resources"),
    "resources reloaded": t("ui.chatView.resourcesReloaded", "Resources reloaded"),
    running: t("ui.chatView.running", "Running"),
    "running bash": t("ui.chatView.runningCommand", "Running command"),
    "running tool": t("ui.chatView.runningTool", "Running tool"),
    "session tree navigated": t("ui.chatView.sessionTreeUpdated", "Session tree updated"),
    "steering queued": t("ui.chatView.steeringMessageQueued", "Steering message queued"),
    "stop failed": t("ui.chatView.stopFailed", "Stop failed"),
    "stopped": t("ui.chatView.stopped", "Stopped"),
    "summarizing branch": t("ui.chatView.summarizingBranch", "Summarizing branch"),
    "tool complete": t("ui.chatView.toolCompleted", "Tool completed"),
    "tool failed": t("ui.chatView.toolFailed", "Tool failed"),
    "tree navigation cancelled": t("ui.chatView.sessionTreeNavigationCancelled", "Session tree navigation cancelled"),
    "turn complete": t("ui.chatView.turnCompleted", "Turn completed"),
    "updating session": t("ui.chatView.updatingSession", "Updating session"),
    queued: t("ui.chatView.queueing", "Queueing"),
  };
  return labels[state] ?? state;
}
