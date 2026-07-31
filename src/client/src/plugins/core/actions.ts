import { isSessionActive } from "../../../../shared/activity";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability, type PiWebCapability } from "../../../../shared/capabilities";
import type { AppState } from "../../appState";
import { selectedMachineId } from "../../controllers/types";
import { isArchivableSessionInfo, isTransientNewSessionInfo, sessionPersistenceOptionsForRuntime } from "../../sessionPersistence";
import { isWorkspaceDeletionPending } from "../../workspaceDeletion";
import type { PluginAction } from "../types";

export function createCoreActions(): PluginAction[] {
  return [
    {
      id: "actions.show",
      title: "显示操作",
      description: "打开命令面板",
      shortcut: "mod+k",
      group: "通用",
      run: (context) => { context.openActionPalette(); },
    },
    {
      id: "prompt.focus",
      title: "聚焦提示词输入框",
      description: "将键盘焦点移动到消息编辑器",
      shortcut: "mod+g c",
      group: "通用",
      enabled: (context) => context.state.selectedSession !== undefined,
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "machine.add",
      title: "添加机器",
      description: "注册另一个可从当前网关访问的 PI WEB 运行时",
      group: "机器",
      run: (context) => context.addMachine(),
    },
    {
      id: "machine.refresh",
      title: "刷新所选机器",
      description: "检查所选 PI WEB 运行时是否在线",
      group: "机器",
      run: (context) => context.refreshSelectedMachine(),
    },
    {
      id: "machine.open",
      title: "打开所选机器的 PI WEB",
      description: "在新标签页中直接打开所选远程 PI WEB",
      group: "机器",
      enabled: (context) => context.state.selectedMachine?.kind === "remote" && context.state.selectedMachine.baseUrl !== undefined,
      run: (context) => context.openSelectedMachine(),
    },
    {
      id: "machine.remove",
      title: "移除所选机器",
      description: "从当前网关移除所选远程机器",
      group: "机器",
      enabled: (context) => context.state.selectedMachine?.kind === "remote",
      run: (context) => context.removeSelectedMachine(),
    },
    {
      id: "project.add",
      title: "添加项目",
      group: "项目",
      run: (context) => context.addProject(),
    },
    {
      id: "auth.login",
      title: "配置当前项目的提供商认证",
      description: "为当前项目运行 /login",
      group: "通用",
      run: (context) => context.configureAuth(),
    },
    {
      id: "auth.logout",
      title: "移除当前项目的提供商认证",
      description: "移除当前项目已保存的凭据",
      group: "通用",
      run: (context) => context.logoutAuth(),
    },
    {
      id: "theme.select",
      title: "选择主题",
      description: "选择 PI WEB 颜色主题",
      group: "偏好设置",
      run: (context) => { context.openThemePicker(); },
    },
    {
      id: "settings.open",
      title: "打开设置",
      description: "管理 PI WEB 配置和键盘快捷键",
      shortcut: "mod+,",
      group: "偏好设置",
      run: (context) => { context.piWebUnstable?.openSettings?.(); },
    },
    {
      id: "app.reload-page",
      title: "完整重载页面",
      description: "重新加载 PI WEB 浏览器页面",
      group: "通用",
      run: (context) => { context.reloadPage(); },
    },
    {
      id: "view.chat",
      title: "转到聊天",
      shortcut: "mod+1",
      group: "导航",
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "view.files",
      title: "转到文件",
      shortcut: "mod+2",
      group: "导航",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.files"); },
    },
    {
      id: "view.git",
      title: "转到 Git",
      shortcut: "mod+3",
      group: "导航",
      enabled: hasGitWorkspace,
      run: (context) => { context.selectMainView("core:workspace.git"); },
    },
    {
      id: "view.terminal",
      title: "转到终端",
      shortcut: "mod+4",
      group: "导航",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.terminal"); },
    },
    {
      id: "workspace.refresh-files",
      title: "刷新文件",
      shortcut: "mod+shift+f",
      group: "工作区",
      enabled: hasWorkspace,
      run: (context) => context.refreshFiles(),
    },
    {
      id: "workspace.refresh-git",
      title: "刷新 Git",
      shortcut: "mod+shift+g",
      group: "工作区",
      enabled: hasGitWorkspace,
      run: (context) => context.refreshGit(),
    },
    {
      id: "workspace.refresh-current",
      title: "刷新当前面板",
      shortcut: "mod+shift+r",
      group: "工作区",
      enabled: hasWorkspace,
      run: (context) => context.state.workspaceTool === "core:workspace.git" && context.state.selectedWorkspace?.isGitRepo === true ? context.refreshGit() : context.refreshFiles(),
    },
    {
      id: "workspace.delete",
      title: "删除工作区",
      description: "移除所选 Git worktree",
      group: "工作区",
      enabled: hasDeletableWorkspace,
      run: (context) => context.deleteWorkspace(),
    },
    {
      id: "session.start",
      title: "启动会话",
      shortcut: "mod+enter",
      group: "会话",
      enabled: hasWorkspace,
      run: (context) => context.startSession(),
    },
    {
      id: "model.select",
      title: "选择模型",
      description: "为所选会话选择模型",
      group: "会话",
      enabled: hasSelectableSession,
      run: (context) => context.openModelPicker(),
    },
    {
      id: "thinking.select",
      title: "选择思考级别",
      description: "为所选会话选择思考级别",
      group: "会话",
      enabled: hasSelectableSession,
      run: (context) => context.openThinkingLevelPicker(),
    },
    {
      id: "session.archive",
      title: "归档会话",
      description: "归档所选会话",
      group: "会话",
      enabled: hasArchivableSession,
      run: (context) => context.archiveSession(),
    },
    {
      id: "session.reload",
      title: "重新加载会话",
      description: "关闭并从会话文件重新打开所选会话；如需重载 Pi 运行时资源，请在提示词中使用 /reload",
      group: "会话",
      enabled: hasReloadableSession,
      disabledReason: reloadSessionDisabledReason,
      run: (context) => context.reloadSession(),
    },
    {
      id: "session.delete",
      title: "删除新会话",
      description: "删除所选的临时新会话",
      group: "会话",
      enabled: hasTransientNewSession,
      run: (context) => context.deleteCachedNewSession(),
    },
    {
      id: "session.stop",
      title: "停止活动工作",
      shortcut: "mod+.",
      group: "会话",
      enabled: (context) => context.state.selectedSession !== undefined && isSessionActive(context.state.status, context.state.activity),
      run: (context) => context.stopActiveWork(),
    },
  ];
}

function hasWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace !== undefined;
}

function hasGitWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace?.isGitRepo === true;
}

function hasDeletableWorkspace(context: { state: AppState }): boolean {
  const workspace = context.state.selectedWorkspace;
  return workspace !== undefined && workspace.isGitWorktree && !workspace.isMain && !isWorkspaceDeletionPending(context.state, workspace);
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
  return missingCapabilityReason(context.state, PI_WEB_CAPABILITIES.sessionsReload, "从磁盘重新加载会话");
}

function sessionPersistenceOptions(state: AppState) {
  return sessionPersistenceOptionsForRuntime(state.machineRuntimes[selectedMachineId(state)]);
}

function missingCapabilityReason(state: AppState, capability: PiWebCapability, action: string): string | undefined {
  const runtime = state.machineRuntimes[selectedMachineId(state)];
  if (runtime?.ok === true && supportsPiWebCapability(runtime, capability)) return undefined;
  const machineName = state.selectedMachine?.name;
  return machineName !== undefined && machineName !== ""
    ? `请更新并重启 ${machineName} 上的 Pi-Web，以便${action}。`
    : `请更新并重启此机器上的 Pi-Web，以便${action}。`;
}
