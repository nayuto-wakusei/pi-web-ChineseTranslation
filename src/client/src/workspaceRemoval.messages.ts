import { message } from "../../shared/localization";

export default {
  gitAction: message("Delete workspace", "Host workspace-removal action for a linked Git worktree"),
  gitConfirmation: message<{ label: string; path: string; command: string }>(
    "Delete workspace {label}?\n\nThis will run {command} and delete:\n{path}\n\nThe Git branch will not be deleted.",
    "Destructive linked-worktree confirmation; label, path and Git command remain unchanged",
  ),
};
