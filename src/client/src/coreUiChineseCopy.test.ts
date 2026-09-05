import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));

interface CopyCase {
  name: string;
  paths: readonly string[];
  expected: readonly string[];
  forbidden: readonly string[];
}

const copyCases: readonly CopyCase[] = [
  {
    name: "localizes the navigation/sidebar labels shown in the main shell",
    paths: ["components/appShell/AppNavigationPanel.ts", "components/ProjectList.ts", "components/WorkspaceList.ts", "components/SessionList.ts"],
    expected: ["操作", "项目", "工作区", "会话", "启动新会话", "再启动一个会话", "正在启动会话", "正在等待", "新会话", "创建完成"],
    forbidden: [">Actions<", "▾ Projects", "▾ Workspaces", "▾ Sessions", "No project selected", "No workspace selected", "No session selected", "Start a new session", "Start another session", "Starting session", "Waiting for", " messages"],
  },
  {
    name: "localizes the prompt editor controls and placeholder",
    paths: ["components/PromptEditor.ts", "components/ProjectDialog.ts"],
    expected: ["给 pi 发送消息", "使用 / 输入命令", "发送", "停止", "return \"文件\"", "/path/to/project 或 ~/code/project"],
    forbidden: ["Message pi...", "Use / for commands", ">Send<", ">Stop<", "return \"FILE\"", "/path/to/project or ~/code/project"],
  },
  {
    name: "localizes the chat event labels and history boundary copy",
    paths: ["components/ChatView.ts", "chatGroups.ts"],
    expected: ["会话开始", "事件", "显示消息"],
    forbidden: ["Beginning of session", "Showing messages", "live events"],
  },
  {
    name: "localizes the terminal panel controls visible above the shell",
    paths: ["components/TerminalPanel.ts"],
    expected: ["按键", "+ 终端", "终端复制控件", "全部复制"],
    forbidden: [">Keys<", "+ Shell", "Terminal copy controls", "Copy all", "No terminal output to copy"],
  },
  {
    name: "localizes the empty states shown before project and workspace selection",
    paths: ["components/PiWebApp.ts", "components/WorkspacePanel.ts"],
    expected: ["选择项目和工作区以开始会话。", "选择项目", "从侧边栏选择一个项目，然后选择工作区来查看文件、Git 或终端。"],
    forbidden: ["Select a project and workspace to start a session.", "Select a project", "Choose a project from the sidebar", "Choose a workspace to inspect files, Git, or terminals."],
  },
  {
    name: "localizes the command palette navigation and panel layout actions",
    paths: ["components/PiWebApp.ts"],
    expected: [
      "聚焦机器", "将键盘焦点移到机器选择器", "聚焦项目", "将键盘焦点移到项目列表",
      "聚焦工作区", "将键盘焦点移到工作区列表", "聚焦会话", "将键盘焦点移到会话列表",
      "重置导航面板宽度", "将导航面板恢复为默认宽度", "重置工作区面板宽度", "将工作区面板恢复为默认宽度",
      "重置面板宽度", "将所有侧边面板恢复为默认宽度", "导航", "视图",
      "调整导航面板大小", "展开导航面板", "折叠导航面板",
      "调整工作区面板大小", "展开工作区面板", "折叠工作区面板",
    ],
    forbidden: [
      "Focus Machines", "Move keyboard focus to the machine selector", "Reset Navigation Panel Size", "Restore the navigation panel to its default width",
      "Resize navigation panel", "Expand navigation panel", "Collapse navigation panel",
      "Resize workspace panel", "Expand workspace panel", "Collapse workspace panel",
    ],
  },
  {
    name: "localizes the live activity dock state labels",
    paths: ["components/ChatView.ts", "controllers/sessionController.ts"],
    expected: ["activityStateLabel(activity.label, activity.phase)", "return activityStateLabel(state);", "空闲", "正在接收回复", "正在运行工具", "工具执行完成", "正在重新加载资源", "running: \"运行中\"", "正在创建会话", "会话创建失败", "启动会话失败"],
    forbidden: [
      "if (activity === undefined) return state;",
      "return activity.detail !== undefined && activity.detail !== \"\" ? `${activity.label}: ${activity.detail}` : activity.label;",
      "label: \"Creating session\"",
      "label: \"Session creation failed\"",
      "Failed to start session",
      "return activityLabelTranslations[state] ?? state;",
    ],
  },
  {
    name: "localizes settings, machine actions, tool targets, and diff empty states",
    paths: [
      "components/settings/SettingsPackagesPanel.ts", "components/settings/piPackageSettings.ts", "components/settings/settingsMachineTarget.ts",
      "components/settings/SettingsPanelFrame.ts", "components/settings/SettingsShortcutsPanel.ts", "components/settings/SettingsPluginsPanel.ts",
      "components/SettingsDialog.ts", "components/MachineSwitcher.ts", "components/ToolExecutionView.ts", "components/UnifiedDiffViewer.ts",
      "components/settings/SettingsGeneralPanel.ts", "components/settings/SettingsSessiondPanel.ts",
    ],
    expected: ["Pi 包来源", "受信代码警告", "本地网关", "远程机器", "用户范围", "机器专属", "设置通知", "无默认快捷键", "机器操作", "没有差异", "\"命令\" | \"文件\" | \"输入\"", "主机地址", "允许的主机名", "配套 CLI 命令", "代理配置档案", "配置档案状态", "允许代理启动受跟踪的子会话"],
    forbidden: [
      "Trusted code warning", "Pi package source", "Configured Pi packages", "No Pi packages configured",
      "(local gateway)", "(remote machine)", "Settings notices", "No default shortcut",
      "Machine actions", ">Remove<", "No diff.", "Unified diff", "\"Command\" | \"File\" | \"Input\"",
      ">Host<", ">Port<", "允许的 hosts", "Companion CLI", "Agent Profile", "Profile 状态", ">beta<", "测试版", " · machine-specific",
    ],
  },
  {
    name: "localizes model picker and session bulk action copy",
    paths: ["components/PiWebApp.ts", "components/ModelPicker.ts", "components/SessionList.ts"],
    expected: ["选择模型", "已启用", "全部模型", "全选", "除当前模型外全部取消", "没有匹配选项", "当前", "选择可见", "清除所选", "已选", ">归档<", ">删除<", "重命名", "搜索会话内容", "置顶", "取消置顶"],
    forbidden: ["Select Model", "All models", "Other models", "No matching options", "✓ current", "Select visible", "Clear selected", "} selected", "Archive selected", "Delete selected", ">Done<", ">Archive<"],
  },
  {
    name: "localizes session content search dialog copy",
    paths: ["components/SessionSearchDialog.ts"],
    expected: ["搜索会话内容", "用户提问", "AI 回答", "未找到匹配内容"],
    forbidden: ["Search session content", "User question", "AI answer", "No matches", "输入用户提问或 AI 回答中的文字", "输入文字后将显示匹配的用户提问和 AI 回答。", "occurrenceCount} 处", "另有 ${match.occurrenceCount"],
  },
  {
    name: "labels provider auth as project-scoped",
    paths: ["components/AuthDialog.ts", "plugins/core/actions.ts"],
    expected: ["credentialScope", "配置当前项目的提供商认证", "移除当前项目的提供商认证", "搜索提供商", "没有匹配的提供商"],
    forbidden: ["pi auth.json", "运行 /login，但不将认证绑定到某个会话", "针对已保存的 pi 凭据运行 /logout", "Search providers", "No matching providers"],
  },
  {
    name: "localizes session cleanup actions and dialog copy",
    paths: ["components/PiWebApp.ts", "components/SessionList.ts", "components/SessionCleanupDialog.ts", "sessionCleanupUi.ts"],
    expected: ["清理", "清理会话", "预览会话清理", "预览并手动清理所选机器上的空闲或已归档会话", "归档空闲超过", "删除是永久操作", "运行清理"],
    forbidden: ["Clean up", "Clean up sessions", "Clean Up Sessions", "Preview session cleanup", "Preview manual cleanup", "Archive non-archived sessions", "Deletion is permanent", "Run cleanup"],
  },
  {
    name: "localizes the bundled info and shipped relays plugin surfaces",
    paths: [
      "../../../pi-web-plugins/info/pi-web-plugin.ts",
      "../../../pi-web-plugins/info/infoInternals.ts",
      "../../../pi-packages/relays/pi-web-plugin.ts",
      "../../../pi-packages/relays/relaysPanelElement.ts",
      "../../../pi-packages/relays/markdownDocument.ts",
    ],
    expected: ["复制 PI WEB 诊断信息", "<strong>信息</strong>", "会话守护进程正在运行", "中继", "请选择工作区。", "无法扫描工作区中继。", "中继文档", "用户范围", "setAttribute(\"aria-label\", \"表格\")"],
    forbidden: ["title: \"Info\"", "<strong>Info</strong>", "session daemon running", "title: \"Relays\"", "<strong>Relays</strong>", "Select a workspace.", "Could not scan workspace relays.", "aria-label=\"Relay documents\"", "setAttribute(\"aria-label\", \"Table\")", " · ${installation.scope}"],
  },
  {
    name: "localizes the bundled Git plugin surfaces",
    paths: [
      "../../../pi-web-plugins/git/browser/git-panel.ts",
      "../../../pi-web-plugins/git/server-plugin.ts",
    ],
    expected: ["转到 Git", "刷新 Git", "全部折叠", "全部展开", "正在加载状态…", "没有更改。", "删除工作区", "不会删除对应的 Git 分支。"],
    forbidden: ["Go to Git", "Refresh Git", ">Refresh<", "Collapse all", "Expand all", "Loading status…", "No changes.", "Delete workspace"],
  },
  {
    name: "localizes questions, session-tree navigation, chat queues, and notifications",
    paths: ["components/AskUserCard.ts", "components/SessionTreeNavigator.ts", "components/ChatView.ts", "controllers/sessionController.ts", "sessionNotifications.ts", "sessionTreeModel.ts"],
    expected: ["发送回答", "自定义回答", "全部问题均已回答", "浏览会话树", "从此处继续", "分叉为新会话", "bash: { label: \"命令\"", "排队中的消息", "清除队列", "已排队", "个附件", "通知（", "关闭通知", "assistant: \"助手\"", "chatMessageRoleLabel(message.role)"],
    forbidden: ["Send answers", "Custom answer", ": outcome.summary", "Navigate session tree", "Summarize and navigate", "Fork into a new session", "case \"bash\": return \"Shell\"", "Queued messages", "Clear queue", " attachment queued", " attachments queued", "Notifications (", "Dismiss notification", "label: string = message.role"],
  },
  {
    name: "localizes extension dialog controls and outcomes",
    paths: ["components/ExtensionDialogCard.ts", "components/ChatView.ts"],
    expected: ["已回答", "已取消", "已超时", "你的回答", ">取消<", '"发送中…" : "发送"', "扩展对话框正在排队"],
    forbidden: [">Cancel<", ">Yes<", ">No<", ">Send<", ">Dismiss<", "Your answer", "Auto-cancels in", "more extension dialog"],
  },
  {
    name: "localizes workspace files, git, machine, project, and workspace controls",
    paths: ["components/WorkspaceFilesPanel.ts", "components/WorkspaceGitPanel.ts", "components/MachineSwitcher.ts", "components/MachineList.ts", "components/ProjectList.ts", "components/WorkspaceList.ts", "plugins/core/panels.ts"],
    expected: ["拖放文件以上传", "工作区上传", "没有更改。", "全部展开", "机器活动中", "项目活动中", "工作区活动中", "复制路径", "title: \"文件\"", "title: \"终端\""],
    forbidden: ["Drop files to upload", "Workspace uploads", "No changes.", "Expand all", "Machine active", "Project active", "Workspace active", "Copy path", "title: \"Files\"", "title: \"Terminal\""],
  },
  {
    name: "localizes shortcut guidance, status copy, and core session actions",
    paths: ["components/settings/SettingsShortcutsPanel.ts", "components/settings/SettingsSessiondPanel.ts", "components/StatusBar.ts", "plugins/core/actions.ts", "terminalKeys.ts", "formatting/markdown.ts"],
    expected: ["正在录制", "需要重启", "代理可以启动自己持续关联的子会话", "~/.pi/agent 或 ~/agent-profiles/work", "尚无会话状态", "选择模型", "选择思考级别", "ariaLabel: \"删除键\"", "setAttribute(\"aria-label\", \"表格\")"],
    forbidden: ["Recording:", "Beta：", "测试版：", "~/.pi/agent or ~/agent-profiles/work", "Pi-compatible agent profile restart required", "No session status yet", "Select Model", "Select Thinking Level", "ariaLabel: \"Delete\"", "setAttribute(\"aria-label\", \"Table\")"],
  },
  {
    name: "keeps the file upload control as one visible Chinese button",
    paths: ["components/WorkspaceFilesPanel.ts"],
    expected: ["aria-label=\"上传文件\"", "type=\"file\" multiple hidden"],
    forbidden: [">选择文件<", "Choose file", "未选择文件"],
  },
  {
    name: "localizes the document and installable app metadata",
    paths: ["../index.html", "../public/manifest.webmanifest"],
    expected: ["lang=\"zh-CN\"", "用于管理持久 Pi Coding Agent 会话的远程 Web 界面和浏览器控制平面。"],
    forbidden: ["lang=\"en\"", "Remote web UI and browser control plane for persistent Pi Coding Agent sessions."],
  },
];

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("core UI Chinese display copy", () => {
  it.each(copyCases)("$name", ({ paths, expected, forbidden }) => {
    const text = paths.map(source).join("\n");

    for (const copy of expected) expect(text).toContain(copy);
    for (const copy of forbidden) expect(text).not.toContain(copy);
  });
});
