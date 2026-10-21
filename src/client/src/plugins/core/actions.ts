import { t } from "../../i18n";
import { isSessionActive } from "../../../../shared/activity";
import type { AppState } from "../../appState";
import { selectedMachineId } from "../../controllers/types";
import { isArchivableSessionInfo, isTransientNewSessionInfo, sessionPersistenceOptionsForRuntime } from "../../sessionPersistence";
import { canDeleteWorkspace, isWorkspaceDeletionPending } from "../../workspaceDeletion";
import type { PluginAction } from "../types";

export function createCoreActions(): PluginAction[] {
  return [
    {
      id: "actions.show",
      title: t("client.actions.show.actions.a514ad", "Show actions"),
      description: t("client.actions.open.the.command.palette.36dd5f", "Open the command palette"),
      shortcut: "mod+k",
      group: t("client.actions.general.835b70", "General"),
      run: (context) => { context.openActionPalette(); },
    },
    {
      id: "prompt.focus",
      title: t("client.actions.focus.prompt.e171a7", "Focus prompt"),
      description: t("client.actions.move.keyboard.focus.to.the.message.editor.74d2ce", "Move keyboard focus to the message editor"),
      shortcut: "mod+g c",
      group: t("client.actions.general.835b70", "General"),
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "machine.add",
      title: t("client.actions.add.machine.e4ad1b", "Add machine"),
      description: t("client.actions.register.another.pi.web.runtime.reachable.from.this.gateway.d20488", "Register another PI WEB runtime reachable from this gateway"),
      group: t("bundled.info.machine.ece969", "Machine"),
      run: (context) => context.addMachine(),
    },
    {
      id: "machine.refresh",
      title: t("client.actions.refresh.selected.machine.b85d96", "Refresh selected machine"),
      description: t("client.actions.check.whether.the.selected.pi.web.runtime.is.online.a856dd", "Check whether the selected PI WEB runtime is online"),
      group: t("bundled.info.machine.ece969", "Machine"),
      run: (context) => context.refreshSelectedMachine(),
    },
    {
      id: "machine.open",
      title: t("client.actions.open.selected.machine.s.pi.web.15ce06", "Open selected machine's PI WEB"),
      description: t("client.actions.open.the.selected.remote.pi.web.directly.in.a.new.tab.a27228", "Open the selected remote PI WEB directly in a new tab"),
      group: t("bundled.info.machine.ece969", "Machine"),
      enabled: (context) => context.state.selectedMachine?.kind === "remote" && context.state.selectedMachine.baseUrl !== undefined,
      run: (context) => context.openSelectedMachine(),
    },
    {
      id: "machine.remove",
      title: t("client.actions.remove.selected.machine.ca967c", "Remove selected machine"),
      description: t("client.actions.remove.the.selected.remote.machine.from.this.gateway.51ce12", "Remove the selected remote machine from this gateway"),
      group: t("bundled.info.machine.ece969", "Machine"),
      enabled: (context) => context.state.selectedMachine?.kind === "remote",
      run: (context) => context.removeSelectedMachine(),
    },
    {
      id: "project.add",
      title: t("client.actions.add.project.8964f5", "Add project"),
      group: t("client.actions.project.79f326", "Project"),
      run: (context) => context.addProject(),
    },
    {
      id: "auth.login",
      title: t("client.actions.configure.provider.authentication.for.this.project.3e0f43", "Configure provider authentication for this project"),
      description: t("client.actions.run.login.for.this.project.bab71f", "Run /login for this project"),
      group: t("client.actions.general.835b70", "General"),
      run: (context) => context.configureAuth(),
    },
    {
      id: "auth.logout",
      title: t("client.actions.remove.provider.authentication.for.this.project.d527aa", "Remove provider authentication for this project"),
      description: t("client.actions.remove.saved.credentials.for.this.project.1a3567", "Remove saved credentials for this project"),
      group: t("client.actions.general.835b70", "General"),
      run: (context) => context.logoutAuth(),
    },
    {
      id: "theme.select",
      title: t("client.actions.choose.theme.07a79a", "Choose theme"),
      description: t("client.actions.choose.a.pi.web.color.theme.fdc708", "Choose a PI WEB color theme"),
      group: t("client.actions.preferences.57907a", "Preferences"),
      run: (context) => { context.openThemePicker(); },
    },
    {
      id: "settings.open",
      title: t("client.actions.open.settings.37aa6a", "Open settings"),
      description: t("client.actions.manage.pi.web.configuration.and.keyboard.shortcuts.cb1723", "Manage PI WEB configuration and keyboard shortcuts"),
      shortcut: "mod+,",
      group: t("client.actions.preferences.57907a", "Preferences"),
      run: (context) => { context.piWebUnstable?.openSettings?.(); },
    },
    {
      id: "app.reload-page",
      title: t("ui.appRefreshControl.reloadEntirePage", "Reload entire page"),
      description: t("client.actions.reload.the.pi.web.browser.page.cc27a2", "Reload the PI WEB browser page"),
      group: t("client.actions.general.835b70", "General"),
      run: (context) => { context.reloadPage(); },
    },
    {
      id: "view.chat",
      title: t("client.actions.go.to.chat.6ba944", "Go to chat"),
      shortcut: "mod+1",
      group: t("client.actions.navigation.e72622", "Navigation"),
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "workspace.delete",
      title: t("client.actions.delete.workspace.1bca7e", "Delete workspace"),
      description: t("ui.main.c3e7f4dcb44f", "Run the owning provider's workspace removal operation"),
      group: t("bundled.workspace-tasks.workspace.379798", "Workspace"),
      enabled: hasDeletableWorkspace,
      run: (context) => context.deleteWorkspace(),
    },
    {
      id: "session.start",
      title: t("client.actions.start.session.21780f", "Start session"),
      shortcut: "mod+enter",
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasWorkspace,
      run: (context) => context.startSession(),
    },
    {
      id: "model.select",
      title: t("client.actions.choose.model.1afed6", "Choose model"),
      description: t("client.actions.choose.a.model.for.the.selected.session.60aa76", "Choose a model for the selected session"),
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasSelectableSession,
      run: (context) => context.openModelPicker(),
    },
    {
      id: "thinking.select",
      title: t("client.actions.choose.thinking.level.77e3b8", "Choose thinking level"),
      description: t("client.actions.choose.a.thinking.level.for.the.selected.session.403bab", "Choose a thinking level for the selected session"),
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasSelectableSession,
      run: (context) => context.openThinkingLevelPicker(),
    },
    {
      id: "session.archive",
      title: t("client.actions.archive.session.0a3885", "Archive session"),
      description: t("client.actions.archive.the.selected.session.6d7088", "Archive the selected session"),
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasArchivableSession,
      run: (context) => context.archiveSession(),
    },
    {
      id: "session.reload",
      title: t("client.actions.reload.session.05361c", "Reload session"),
      description: t("client.actions.close.and.reopen.the.selected.session.from.its.file.use.reload.in.the..869a6b", "Close and reopen the selected session from its file; use /reload in the prompt to reload Pi runtime resources"),
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasReloadableSession,
      disabledReason: reloadSessionDisabledReason,
      run: (context) => context.reloadSession(),
    },
    {
      id: "session.delete",
      title: t("client.actions.delete.new.session.4c6f58", "Delete new session"),
      description: t("client.actions.delete.the.selected.temporary.new.session.480813", "Delete the selected temporary new session"),
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: hasTransientNewSession,
      run: (context) => context.deleteCachedNewSession(),
    },
    {
      id: "session.stop",
      title: t("client.actions.stop.active.work.95304d", "Stop active work"),
      shortcut: "mod+.",
      group: t("ui.sessionSearchDialog.sessions", "Sessions"),
      enabled: (context) => context.state.selectedSession !== undefined && isSessionActive(context.state.status, context.state.activity),
      run: (context) => context.stopActiveWork(),
    },
  ];
}

function hasWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace !== undefined;
}

function hasDeletableWorkspace(context: { state: AppState }): boolean {
  const workspace = context.state.selectedWorkspace;
  return canDeleteWorkspace(workspace) && !isWorkspaceDeletionPending(context.state, workspace);
}

function hasSelectableSession(context: { state: AppState }): boolean {
  const session = context.state.selectedSession;
  return session !== undefined && session.archived !== true;
}

function hasArchivableSession(context: { state: AppState }): boolean {
  return isArchivableSessionInfo(context.state.selectedSession, context.state.status, sessionPersistenceOptions(context.state));
}

function hasTransientNewSession(context: { state: AppState }): boolean {
  return isTransientNewSessionInfo(context.state.selectedSession, context.state.status, sessionPersistenceOptions(context.state));
}

function hasReloadableSession(context: { state: AppState }): boolean {
  if (!isArchivableSessionInfo(context.state.selectedSession, context.state.status, sessionPersistenceOptions(context.state))) return false;
  if (reloadSessionDisabledReason(context) !== undefined) return false;
  return !isSessionActive(context.state.status, context.state.activity);
}

function reloadSessionDisabledReason(context: { state: AppState }): string | undefined {
  if (!isArchivableSessionInfo(context.state.selectedSession, context.state.status, sessionPersistenceOptions(context.state))) return undefined;
  if (isSessionActive(context.state.status, context.state.activity)) return undefined;
  return unavailableRuntimeReason(context.state, t("client.actions.reload.the.session.from.disk.45d1dc", "reload the session from disk"));
}

function sessionPersistenceOptions(state: AppState) {
  return sessionPersistenceOptionsForRuntime(state.machineRuntimes[selectedMachineId(state)]);
}

function unavailableRuntimeReason(state: AppState, action: string): string | undefined {
  const runtime = state.machineRuntimes[selectedMachineId(state)];
  if (runtime?.ok === true) return undefined;
  const machineName = state.selectedMachine?.name;
  return machineName !== undefined && machineName !== ""
    ? t("client.actions.update.and.restart.pi.web.on.to.aa2e7e", "Update and restart Pi-Web on {value1} to {value2}.", { value1: machineName, value2: action })
    : t("client.actions.update.and.restart.pi.web.on.this.machine.to.da2f57", "Update and restart Pi-Web on this machine to {value1}.", { value1: action });
}
