import { message } from "../localization/service";

export default {
  session: message("Copy session ID", "Session action menu clipboard action"),
  workspace: message("Copy workspace ID", "Workspace action menu clipboard action"),
  project: message("Copy project ID", "Project action menu clipboard action"),
  machine: message("Copy machine ID", "Machine action menu clipboard action"),
  failed: message("Unable to copy ID. Try again.", "Clipboard failure alert"),
};
