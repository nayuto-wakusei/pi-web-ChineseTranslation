import { message } from "../../../shared/localization";

export default {
  workspaceNotFound: message<{ id: string }>("Workspace not found: {id}", "Requested workspace identifier is unavailable during navigation"),
  sessionNotFound: message<{ id: string }>("Session not found: {id}", "Requested session identifier is unavailable during workspace navigation"),
  projectNotFound: message("Project not found", "Workspace refresh cannot find the requested project"),
  degraded: message("Workspace authority is degraded", "Workspace provider is unavailable and supplied no diagnostic detail"),
  trustUnavailable: message<{ id: string }>("Cannot save trust choice for project {id}: main workspace unavailable", "The newly added project's trust choice cannot be saved without its main workspace"),
};
