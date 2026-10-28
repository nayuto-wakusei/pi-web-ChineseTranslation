import type { MessageDefinition } from "@chainingintention/pi-web-cn/plugin-api";

function text<Values extends Record<string, string | number> = Record<string, never>>(message: string, description: string): MessageDefinition<Values> {
  return { message, description };
}

export default {
  action: text("Create Worktree", "Action palette command to open the worktree creation dialog"),
  actionDescription: text("Choose a base branch and purpose, then start a new conversation in the main workspace", "Description of the worktree creation action"),
  group: text("Workflows", "Action palette group for the Workflows plugin"),
  disabled: text("Select a project with the Workflows backend available first.", "Why worktree creation is unavailable"),
  title: text("Create worktree", "Dialog heading and submit action"),
  target: text<{ project: string }>("Project: {project}. Starts a new conversation in its main workspace; your current conversation and draft stay unchanged.", "Explain where worktree creation starts; project name is unmodified user data"),
  loading: text("Loading branches…", "Status while reading available base branches"),
  base: text("Base branch", "Worktree base branch field label"),
  baseHelp: text("Choose a local or remote branch. HEAD uses the main workspace’s current commit.", "Base branch help; HEAD is a literal Git identifier"),
  description: text("Purpose or description", "Worktree purpose field label"),
  descriptionHelp: text("The agent uses this to name the branch and worktree.", "Worktree purpose field help"),
  cancel: text("Cancel", "Dismiss the dialog before dispatch"),
  close: text("Close", "Dismiss the dialog after a failed or uncertain dispatch"),
  required: text("Enter a base branch and a purpose or description.", "Inline validation for empty or whitespace-only fields"),
  starting: text("Starting a new conversation…", "Dispatch in progress"),
  opening: text("Conversation started. Opening it…", "Navigation to newly created conversation in progress"),
  started: text("Conversation started.", "Dispatch succeeded but navigation failed"),
  uncertain: text("Dispatch could not be confirmed.", "Dispatch outcome unknown; no automatic retry"),
  openSession: text<{ error: string; session: string }>("{error} Open conversation {session} in Sessions.", "Navigation failure recovery; error and session ID remain unchanged"),
  checkSessions: text<{ error: string }>("{error} Check Sessions before trying again; a conversation may already have started.", "Uncertain dispatch recovery; backend error remains unchanged"),
  workspace: text<{ path: string }>("Main workspace: {path}", "Prepared workspace location; path remains unchanged"),
  loadFailed: text("Could not load worktree options.", "Status after preparing the dialog fails"),
  invalidBranches: text("Invalid branch list from Workflows.", "Malformed backend branch list detected by the browser"),
  invalidResponse: text("Invalid response from Workflows.", "Malformed backend response detected by the browser"),
  noProject: text("Select a project first.", "Dialog cannot open without a selected project"),
  noRequests: text("Workflows backend does not support requests.", "Dialog cannot open without backend request support"),
};
