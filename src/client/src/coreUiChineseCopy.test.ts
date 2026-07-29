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
    paths: ["components/PromptEditor.ts"],
    expected: ["给 pi 发送消息", "使用 / 输入命令", "发送", "停止"],
    forbidden: ["Message pi...", "Use / for commands", ">Send<", ">Stop<"],
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
    expected: ["activityStateLabel(activity.label, activity.phase)", "return activityStateLabel(state);", "空闲", "正在重新加载资源", "正在创建会话", "会话创建失败", "启动会话失败"],
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
      "components/settings/SettingsPanelFrame.ts", "components/settings/SettingsShortcutsPanel.ts",
      "components/MachineSwitcher.ts", "components/ToolExecutionView.ts", "components/UnifiedDiffViewer.ts",
      "components/settings/SettingsGeneralPanel.ts", "components/settings/SettingsSessiondPanel.ts",
    ],
    expected: ["Pi 包来源", "受信代码警告", "本地网关", "远程机器", "设置通知", "无默认快捷键", "机器操作", "没有差异", "\"命令\" | \"文件\" | \"输入\"", "主机地址", "允许的主机名", "配套 CLI 命令", "配置档案状态", "测试版"],
    forbidden: [
      "Trusted code warning", "Pi package source", "Configured Pi packages", "No Pi packages configured",
      "(local gateway)", "(remote machine)", "Settings notices", "No default shortcut",
      "Machine actions", ">Remove<", "No diff.", "Unified diff", "\"Command\" | \"File\" | \"Input\"",
      ">Host<", ">Port<", "允许的 hosts", "Companion CLI", "Profile 状态", ">beta<",
    ],
  },
  {
    name: "localizes model picker and session bulk action copy",
    paths: ["components/PiWebApp.ts", "components/SessionList.ts"],
    expected: ["选择模型", "当前", "选择可见", "已选", "归档所选", "重命名", "完成", "搜索会话内容", "置顶", "取消置顶"],
    forbidden: ["Select Model", "✓ current", "Select visible", "} selected", "Archive selected", ">Done<", ">Archive<"],
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
    expected: ["credentialScope", "配置当前项目的提供商认证", "移除当前项目的提供商认证"],
    forbidden: ["pi auth.json", "运行 /login，但不将认证绑定到某个会话", "针对已保存的 pi 凭据运行 /logout"],
  },
  {
    name: "localizes session cleanup actions and dialog copy",
    paths: ["components/PiWebApp.ts", "components/SessionList.ts", "components/SessionCleanupDialog.ts", "sessionCleanupUi.ts"],
    expected: ["清理会话", "预览并手动清理所选机器上的空闲或已归档会话", "归档空闲超过", "删除是永久操作", "运行清理"],
    forbidden: ["Clean up sessions", "Clean Up Sessions", "Preview manual cleanup", "Archive non-archived sessions", "Deletion is permanent", "Run cleanup"],
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
