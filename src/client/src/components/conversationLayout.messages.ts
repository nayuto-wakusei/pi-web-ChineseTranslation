import { message } from "../../../shared/localization";

export default {
  sending: message("Sending your message…", "Conversation activity while a prompt is being sent"),
  compacting: message("compacting", "Conversation status while compacting history"),
  bash: message("bash", "Conversation status while running a shell command"),
  running: message("running", "Conversation status while the agent is working"),
  queued: message("queued", "Conversation status while messages are queued"),
  startup: message<{ intent: "create" | "open"; stage: "runtime" | "extensions"; refreshing: "yes" | "no" }>(
    "{intent, select, create {Creating session} other {Opening session}}: {stage, select, runtime {Starting the Pi session} other {Loading session extensions}}{refreshing, select, yes { · provider model lists are refreshing} other {}}",
    "Complete startup progress. A provider catalog refresh is concurrent, not necessarily the cause of waiting. Intent selects creating/opening; stage selects runtime construction/extension loading.",
  ),
  summary: message<{ label: string; detail: string }>("{label}: {detail}", "Conversation activity summary; label and detail can be raw runtime-provided text"),
};
