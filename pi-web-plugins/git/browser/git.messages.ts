import type { MessageDefinition, RichMessageTag } from "@chainingintention/pi-web-cn/plugin-api";

const git: MessageDefinition<Record<string, never>> = {"message":"Git","description":"Git panel title; product name"};
const goToGit: MessageDefinition<Record<string, never>> = {"message":"Go to Git","description":"Navigate to the Git panel"};
const refreshGit: MessageDefinition<Record<string, never>> = {"message":"Refresh Git","description":"Action to refresh repository status"};
const navigation: MessageDefinition<Record<string, never>> = {"message":"Navigation","description":"Action palette group for navigation"};
const workspace: MessageDefinition<Record<string, never>> = {"message":"Workspace","description":"Action palette group for workspace actions"};
const stale: MessageDefinition<Record<string, never>> = {"message":"stale","description":"Repository status is out of date"};
const refresh: MessageDefinition<Record<string, never>> = {"message":"Refresh","description":"Reload Git status"};
const changedFilesView: MessageDefinition<Record<string, never>> = {"message":"Changed files view","description":"Accessible name of list/tree view controls"};
const list: MessageDefinition<Record<string, never>> = {"message":"List","description":"Flat changed-file view"};
const tree: MessageDefinition<Record<string, never>> = {"message":"Tree","description":"Hierarchical changed-file view"};
const collapseAll: MessageDefinition<Record<string, never>> = {"message":"Collapse all","description":"Collapse all directories and submodules"};
const expandAll: MessageDefinition<Record<string, never>> = {"message":"Expand all","description":"Expand all directories and submodules"};
const loadingStatus: MessageDefinition<Record<string, never>> = {"message":"Loading status…","description":"Repository status request is pending"};
const statusUnavailable: MessageDefinition<Record<string, never>> = {"message":"Status unavailable.","description":"Repository status could not be loaded"};
const notRepository: MessageDefinition<Record<string, never>> = {"message":"Not a git repository.","description":"Selected workspace is not in a Git repository"};
const noChanges: MessageDefinition<Record<string, never>> = {"message":"No changes.","description":"Repository has no changed files"};
const selectFile: MessageDefinition<Record<string, never>> = {"message":"Select a changed file.","description":"Diff viewer before file selection"};
const loadingDiff: MessageDefinition<Record<string, never>> = {"message":"Loading diff…","description":"Diff request is pending"};
const noStagedDiff: MessageDefinition<Record<string, never>> = {"message":"No staged or unstaged diff.","description":"Selected file has no diff to display"};
const diff: MessageDefinition<Record<string, never>> = {"message":"diff","description":"Fallback title for a diff with no path"};
const noDiff: MessageDefinition<Record<string, never>> = {"message":"No diff.","description":"Diff response has no lines"};
const unifiedDiff: MessageDefinition<Record<string, never>> = {"message":"Unified diff","description":"Accessible name for the diff table"};
const submodule: MessageDefinition<Record<string, never>> = {"message":"submodule","description":"Badge identifying a Git submodule"};
const detached: MessageDefinition<Record<string, never>> = {"message":"detached","description":"Repository is not on a named branch"};
const backendUnavailable: MessageDefinition<Record<string, never>> = {"message":"Git workspace backend is unavailable. Update and restart PI WEB on this machine, then reload the browser.","description":"Recovery instructions when the paired Git backend is missing"};
const requestFailed: MessageDefinition<Record<string, never>> = {"message":"Could not refresh Git. Try refreshing again.","description":"Repository status or diff request failed; technical details are logged"};
const diffState: MessageDefinition<{ staged: string; truncated: string }> = {
  message: "{staged, select, yes {{truncated, select, yes {staged · truncated} other {staged}}} other {{truncated, select, yes {unstaged · truncated} other {unstaged}}}}",
  description: "Diff staging state, with optional truncation warning; translate each complete alternative",
};
const branchSummary: MessageDefinition<{ branch: string; ahead: number; behind: number; name: RichMessageTag }> = {
  message: "<name>{branch}</name> · ↑{ahead, number} ↓{behind, number}",
  description: "Branch name with commits ahead and behind upstream; arrows indicate ahead and behind",
};
const fileState: MessageDefinition<{ state: string }> = {
  message: "{state, select, modified {Modified} added {Added} deleted {Deleted} renamed {Renamed} copied {Copied} untracked {Untracked} ignored {Ignored} conflicted {Conflicted} other {Unmodified}}",
  description: "Full accessible description of the changed file state; visible letters are Git notation",
};
const stagedChanges: MessageDefinition<Record<string, never>> = { message: "Staged", description: "File has staged changes only" };
const unstagedChanges: MessageDefinition<Record<string, never>> = { message: "Unstaged", description: "File has unstaged changes only" };
const bothChanges: MessageDefinition<Record<string, never>> = { message: "Both", description: "File has both staged and unstaged changes" };
const stagingDetail: MessageDefinition<{ index: string; workingTree: string }> = {
  message: "Staged: {index} · Unstaged: {workingTree}",
  description: "File status in the index and working tree; values are localized file states",
};
export default { stagedChanges, unstagedChanges, bothChanges, stagingDetail, git, goToGit, refreshGit, navigation, workspace, stale, refresh, changedFilesView, list, tree, collapseAll, expandAll, loadingStatus, statusUnavailable, notRepository, noChanges, selectFile, loadingDiff, noStagedDiff, diff, noDiff, unifiedDiff, submodule, detached, backendUnavailable, requestFailed, diffState, branchSummary, fileState };
