import { html, render } from "lit";
import { ActionPalette } from "../../src/client/src/components/ActionPalette";
import { AppNavigationPanel } from "../../src/client/src/components/appShell/AppNavigationPanel";
import { WorkspacePanel } from "../../src/client/src/components/WorkspacePanel";
import { CommandPicker } from "../../src/client/src/components/CommandPicker";
import { ModelPicker } from "../../src/client/src/components/ModelPicker";
import { AuthDialog } from "../../src/client/src/components/AuthDialog";
import { NavigationDialog } from "../../src/client/src/components/appShell/NavigationDialog";
import { setClientTranslations } from "../../src/client/src/i18n";
import chinesePlugin from "../../pi-web-plugins/zh-cn/pi-web-plugin";
import "../../src/client/src/plugins/themes/pi-web-light.css";

const [catalog] = chinesePlugin.activate().contributions.localizations;
if (catalog === undefined) throw new Error("Missing Chinese catalog");
setClientTranslations(catalog.locale, catalog.messages);
const style = document.createElement("style");
style.textContent = `
  body { margin: 0; background: var(--pi-bg); color: var(--pi-text); font-family: var(--pi-font); }
  main { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); height: 100vh; }
  app-navigation-panel { border-right: 1px solid var(--pi-border); }
  @media (max-width: 600px) { main { grid-template-columns: minmax(0, 1fr); } workspace-panel { display: none; } }
`;
document.head.append(style);
const navigation = new AppNavigationPanel();
if (new URLSearchParams(location.search).has("folder-trust")) {
  const project = { id: "folder", name: "普通文件夹项目", path: "/fixture/plain", createdAt: "2026-10-26T00:00:00Z" };
  navigation.projects = [project];
  navigation.selectedProject = project;
  navigation.workspaceSelectionVisible = false;
}
navigation.collapsible = true;
navigation.unreadSessionIds = new Set(["session"]);
navigation.onTogglePanel = () => undefined;
navigation.sessions = [{
  id: "session", cwd: "/fixture", path: "/fixture/session.jsonl",
  created: "2026-10-23T00:00:00Z", modified: "2026-10-23T00:00:00Z",
  messageCount: 12, firstMessage: "中文会话",
}];
navigation.onShowActions = () => {
  const palette = new ActionPalette();
  palette.actions = [
    { id: "actions", title: "显示操作", description: "打开命令面板", group: "通用", shortcut: "Ctrl+K", run: () => undefined },
    { id: "project", title: "添加项目", group: "项目", run: () => undefined },
    { id: "auth", title: "配置当前项目的提供商认证", description: "为当前项目运行 /login", group: "通用", run: () => undefined },
  ];
  palette.onCancel = () => { palette.remove(); };
  document.body.append(palette);
};
const workspace = new WorkspacePanel();
workspace.panels = [{ id: "fixture:files", title: "文件", render: () => html`<p>工作区内容</p>` }];
workspace.pinnedIds = ["fixture:files"];
workspace.tool = "fixture:files";
workspace.onShowNavigation = () => undefined;
const main = document.createElement("main");
render(html`${navigation}${workspace}`, main);
document.body.append(main);
await Promise.all([navigation.updateComplete, workspace.updateComplete]);
document.body.dataset["ready"] = "true";

function openModels(): void {
  const picker = new ModelPicker();
  picker.title = "模型选择";
  picker.options = [{ value: "fixture/model", label: "中文模型名称与较长的说明用于验证窄屏布局", description: "fixture" }];
  picker.catalog = [{ provider: "fixture", id: "model", enabled: true }, { provider: "fixture", id: "another-model", enabled: false }];
  picker.selectedValue = "fixture/model";
  picker.defaultValue = "fixture/model";
  picker.onSetDefault = () => Promise.resolve();
  picker.onCancel = () => { picker.remove(); };
  document.body.append(picker);
}
const menuTools = document.createElement("div");
render(html`
  <button @click=${() => {
    const picker = new CommandPicker();
    picker.title = "会话选项";
    picker.searchable = true;
    picker.options = [{ value: "models", label: "选择模型", description: "打开下一级模型选择菜单，保留当前菜单" }];
    picker.onPick = openModels;
    picker.onSetDefault = () => Promise.resolve();
    picker.onCancel = () => { picker.remove(); };
    document.body.append(picker);
  }}>Picker fixture</button>
  <button @click=${() => {
    const dialog = new NavigationDialog();
    dialog.tabs = [{ id: "chat", label: "聊天" }, { id: "fixture:files", label: "工作区文件与更多工具导航" }];
    dialog.onPreferencesChange = (preferences) => { dialog.preferences = preferences; };
    dialog.onClose = () => { dialog.remove(); };
    document.body.append(dialog);
  }}>Navigation fixture</button>
  <button @click=${() => {
    const dialog = new AuthDialog();
    dialog.state = { step: "method", target: { machineId: "local", projectId: "fixture" } };
    dialog.onCancel = () => { dialog.remove(); };
    document.body.append(dialog);
  }}>Auth fixture</button>
`, menuTools);
document.body.prepend(menuTools);
