import { api, configApi, piPackagesApi, pluginsApi, workspacesApi, trustApi, type Machine, type PiWebConfigResponse, type PiWebConfigValues, type SessionInfo } from "../../src/client/src/api";
import { AppNavigationPanel } from "../../src/client/src/components/appShell/AppNavigationPanel";
import { AppContextBar } from "../../src/client/src/components/appShell/AppContextBar";
import { ChatView } from "../../src/client/src/components/ChatView";
import { PromptEditor } from "../../src/client/src/components/PromptEditor";
import { ConversationLayout } from "../../src/client/src/components/ConversationLayout";
import { StatusBar } from "../../src/client/src/components/StatusBar";
import { SettingsDialog } from "../../src/client/src/components/SettingsDialog";
import { ActionPalette } from "../../src/client/src/components/ActionPalette";
import { NavigationSectionsController, type NavigationSection } from "../../src/client/src/appShell/navigationState";
import type { ThemePreference } from "../../src/client/src/theme";
import { PluginRegistry } from "../../src/client/src/plugins/registry";
import { pluginStyles } from "../../src/client/src/plugins/styles";
import { setClientTranslations, t } from "../../src/client/src/i18n";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS } from "../../src/shared/pluginRecoveryCommands";
import type { UiPresentationContextV1 } from "../../src/plugin-api";
import chinesePlugin from "../../pi-web-plugins/zh-cn/pi-web-plugin";
import plugin from "../../pi-web-plugins/custom-ui-codex/pi-web-plugin";

const [catalog] = chinesePlugin.activate().contributions.localizations;
if (catalog === undefined) throw new Error("Missing Chinese catalog");
setClientTranslations(catalog.locale, catalog.messages);
api.commands = () => Promise.resolve([]);
api.files = () => Promise.resolve([]);
api.models = () => Promise.resolve({ models: [] });
const configResponse = (config: PiWebConfigValues): PiWebConfigResponse => ({
  path: "/fixture/config.json", exists: true, config, effectiveConfig: config,
  envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
});
const legacyTheme = new URLSearchParams(location.search).get("legacy-theme");
const legacyPreference: ThemePreference | undefined = legacyTheme === "paper" || legacyTheme === "graphite"
  ? { themeId: legacyTheme === "paper" ? "themes:paper" : "themes:graphite", auto: true } : undefined;
configApi.config = () => Promise.resolve(configResponse(legacyPreference === undefined ? {} : { defaultTheme: legacyPreference }));
configApi.namingModels = () => Promise.resolve({ models: [] });
piPackagesApi.packages = () => Promise.resolve({ packages: [] });
pluginsApi.plugins = () => Promise.resolve({ lifecycleVersion: 2, plugins: [], diagnostics: [], serverRuntime: { status: "available", terminalMode: "required", restartRequired: false, recovery: { ...PI_WEB_PLUGIN_RECOVERY_COMMANDS } } });

const style = document.createElement("style");
style.textContent = `
  html, body { height: 100%; margin: 0; }
  body { color: var(--pi-text); background: var(--pi-bg); font: 14px var(--pi-font); }
  main { display: grid; grid-template-columns: 260px minmax(0,1fr); height: 100%; min-height: 0; }
  app-navigation-panel { min-width: 0; min-height: 0; border-right: 1px solid var(--pi-border-muted); }
  .conversation { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  app-context-bar { flex: 0 0 auto; }
  conversation-layout { flex: 1 1 0; min-width: 0; min-height: 0; }
  .composer-area { min-width: 0; }
  @media (max-width: 760px) {
    main { display: block; }
    app-navigation-panel { height: 100%; border-right: 0; }
    .conversation { display: none; height: 100%; }
    main[data-view="chat"] app-navigation-panel { display: none; }
    main[data-view="chat"] .conversation { display: flex; }
  }
`;
document.head.append(style);
const project = { id: "plain", name: "示例项目", path: "/fixture/plain", createdAt: "2026-10-26T00:00:00Z" };
const workspace = { id: "workspace", projectId: project.id, path: project.path, label: project.name, isMain: true, effectiveConfig: {} };
const machine: Machine = { id: "local", name: "本地网关", kind: "local", createdAt: project.createdAt, updatedAt: project.createdAt };
workspacesApi.workspaceResolution = () => Promise.resolve({ status: "folder", projectId: project.id, workspaces: [workspace], diagnostics: [] });
let trusted = false;
trustApi.workspaceTrust = () => Promise.resolve({ path: project.path, decision: trusted, trusted });
trustApi.setWorkspaceTrust = (_projectId, _workspaceId, value) => { trusted = value; return Promise.resolve({ path: project.path, decision: value, trusted: value }); };
const sessionNames = new URLSearchParams(location.search).has("large")
  ? Array.from({ length: 1000 }, (_, index) => `会话 ${String(index + 1)}`)
  : ["当前会话", "历史会话", "另一个会话"];
const sessions: SessionInfo[] = sessionNames.map((name, index) => ({
  id: `session-${String(index)}`, name, cwd: workspace.path, path: `/fixture/session-${String(index)}.jsonl`, created: project.createdAt, modified: project.createdAt, messageCount: 3, firstMessage: name,
}));
const session = sessions[0];
if (session === undefined) throw new Error("Missing session fixture");
let enabled = true;
let scheme: "light" | "dark" = "light";
const registry = new PluginRegistry({ isContributionEnabled: () => enabled, onUiPresentationError: () => { void apply(); } });
await registry.register({ id: "pi-web.custom-ui-codex", plugin });
const navigation = new AppNavigationPanel();
navigation.projects = [project];
navigation.selectedProject = project;
const worktrees = new URLSearchParams(location.search).has("worktrees");
navigation.workspaces = worktrees ? [workspace, { ...workspace, id: "feature", path: "/fixture/feature", label: "feature", branch: "feature", isMain: false }] : [workspace];
navigation.selectedWorkspace = workspace;
navigation.workspaceSelectionVisible = worktrees;
navigation.machines = [machine];
navigation.selectedMachine = machine;
navigation.sessions = sessions;
navigation.selectedSession = session;
navigation.pinnedSessionIds = [session.id];
navigation.pinnedRootIds = [session.id];
navigation.unreadSessionIds = new Set([session.id]);
navigation.canReloadSessions = true;
navigation.canStartSession = true;
navigation.onStartSession = () => undefined;
navigation.onSearchSessions = () => undefined;
navigation.onAddProject = () => undefined;
navigation.onShowSettings = () => { void window.customUiFixture.openSettings(); };
navigation.onMoveSessionPin = () => undefined;
navigation.onToggleSessionPin = () => undefined;
navigation.onRenameSession = () => undefined;
navigation.onArchiveSession = () => undefined;
navigation.onMarkSessionRead = () => undefined;
navigation.onReloadSession = () => undefined;
navigation.onTogglePanel = () => undefined;
const sections = new NavigationSectionsController({
  addController: (controller) => { navigation.addController(controller); },
  removeController: (controller) => { navigation.removeController(controller); },
  requestUpdate: () => { syncNavigationSections(); navigation.requestUpdate(); },
  get updateComplete() { return navigation.updateComplete; },
}, () => ({ selectedProject: navigation.selectedProject, selectedWorkspace: navigation.selectedWorkspace, workspaceSelectionVisible: navigation.workspaceSelectionVisible }), () => innerWidth <= 760);
function syncNavigationSections(): void {
  navigation.compact = innerWidth <= 760;
  navigation.collapsible = true;
  navigation.projectsCollapsed = sections.isCollapsed("projects");
  navigation.workspacesCollapsed = sections.isCollapsed("workspaces");
  navigation.sessionsCollapsed = sections.isCollapsed("sessions");
}
navigation.onToggleProjects = () => { sections.toggle("projects"); };
navigation.onToggleWorkspaces = () => { sections.toggle("workspaces"); };
navigation.onToggleSessions = () => { sections.toggle("sessions"); };
syncNavigationSections();
if (!new URLSearchParams(location.search).has("management")) navigation.onShowActions = () => {
  const palette = new ActionPalette();
  palette.actions = [{ id: "settings", title: t("ui.settingsDialog.settings", "Settings"), run: () => window.customUiFixture.openSettings() }];
  palette.onCancel = () => { palette.remove(); };
  palette.onRun = (action) => { palette.remove(); void action.run(); };
  document.body.append(palette);
};
const contextBar = new AppContextBar();
contextBar.machine = machine;
contextBar.machines = [machine];
contextBar.project = project;
contextBar.workspace = workspace;
contextBar.workspaceSelectionVisible = false;
contextBar.session = session;
const layout = new ConversationLayout();
const chat = new ChatView();
chat.sessionId = session.id;
chat.sessionCwd = workspace.path;
chat.messages = [
  { role: "user", entryId: "q1", parts: [{ type: "text", text: "这个工作区现在可以直接设置信任了吗？" }] },
  { role: "assistant", entryId: "a1", parts: [{ type: "text", text: "可以。在项目菜单中开启已信任，然后新建会话即可。\n\n界面切换不会丢失当前草稿和附件。" }] },
];
chat.messageEnd = 2;
chat.messageTotal = 2;
const editor = new PromptEditor();
editor.sessionId = session.id;
editor.cwd = workspace.path;
editor.status = {
  sessionId: session.id, model: { provider: "fixture", id: "coding-model" }, thinkingLevel: "high",
  isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [],
  tokens: { input: 32000, output: 4000, cacheRead: 0, cacheWrite: 0, total: 36000 }, cost: 0.1234,
  contextUsage: { tokens: 32000, contextWindow: 128000, percent: 25 },
};
editor.shortcuts = { "composer.send.desktop": "enter", "composer.send.mobile": "enter" };
let stopCalls = 0;
let sendCalls = 0;
let lastSendText = "";
let lastSendBehavior: "steer" | "followUp" | undefined;
editor.onStop = () => { stopCalls += 1; };
editor.onSend = (text, behavior) => {
  sendCalls += 1;
  lastSendText = text;
  lastSendBehavior = behavior;
  return Promise.resolve(true);
};
const composer = document.createElement("div");
composer.slot = "composer";
composer.className = "composer-area";
composer.append(editor);
const statusBar = new StatusBar();
statusBar.slot = "status";
statusBar.status = editor.status;
statusBar.warningCount = 2;
statusBar.onToggleWarnings = () => {
  statusBar.warningsExpanded = !statusBar.warningsExpanded;
};
layout.append(chat, composer, statusBar);
const conversation = document.createElement("div");
conversation.className = "conversation";
conversation.append(contextBar, layout);
const main = document.createElement("main");
main.append(navigation, conversation);
document.body.append(main);
const release = pluginStyles.registerRoot(document);
let settings: SettingsDialog | undefined;
let savedTheme: ThemePreference | undefined;
const context = (): UiPresentationContextV1 => ({ mode: new URLSearchParams(location.search).has("management") ? "management" : "normal", machine, project, workspace, session: { id: session.id, label: session.name ?? session.id }, compact: innerWidth <= 760 });

async function settle(): Promise<void> {
  await Promise.all([navigation.updateComplete, contextBar.updateComplete, layout.updateComplete, chat.updateComplete, editor.updateComplete, statusBar.updateComplete]);
  for (let index = 0; index < 3; index++) await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
}
async function apply(): Promise<void> {
  syncNavigationSections();
  const snapshot = context();
  navigation.managementMode = snapshot.mode === "management";
  for (const control of [navigation, contextBar, layout, ...(settings === undefined ? [] : [settings])]) {
    control.presentationRuntime = registry.uiPresentation;
    control.presentationContext = snapshot;
  }
  const base = scheme === "light" ? new URL("../../src/client/src/plugins/themes/pi-web-light.css?no-inline", import.meta.url).href : new URL("../../src/client/src/plugins/themes/pi-web-dark.css?no-inline", import.meta.url).href;
  const palette = registry.getThemes().find(({ localId }) => localId === (scheme === "light" ? "paper" : "graphite"));
  document.documentElement.style.colorScheme = scheme;
  await pluginStyles.setContributions([{ id: "base", url: base }, ...registry.getStylesheets("local"), ...(palette?.stylesheets ?? [])]);
  await settle();
}
await apply();
editor.replaceText("未发送的草稿");
await settle();
const originalView = editor.view;
declare global {
  interface Window {
    customUiFixture: {
      setEnabled: (value: boolean) => Promise<void>;
      setScheme: (value: "light" | "dark") => Promise<void>;
      fail: () => Promise<void>;
      openSettings: () => Promise<void>;
      setView: (value: "navigation" | "chat") => Promise<void>;
      setActivity: (value: "idle" | "streaming" | "bash" | "compacting" | "queued") => Promise<void>;
      setDraft: (value: string) => Promise<void>;
      setDisabled: (value: boolean) => Promise<void>;
      calls: () => { stop: number; send: number; lastSendText: string; lastSendBehavior: "steer" | "followUp" | undefined };
      focusSection: (section: NavigationSection) => Promise<boolean>;
      savedTheme: () => ThemePreference | undefined;
      identity: () => { editor: boolean; chat: boolean; draft: string };
    };
  }
}
window.customUiFixture = {
  setEnabled: async (value) => { enabled = value; await apply(); },
  setScheme: async (value) => { scheme = value; await apply(); },
  setView: async (value) => { main.dataset["view"] = value; await settle(); },
  setActivity: async (value) => {
    if (editor.status === undefined) throw new Error("Missing fixture session status");
    editor.status = {
      ...editor.status,
      isStreaming: value === "streaming", isBashRunning: value === "bash", isCompacting: value === "compacting",
      pendingMessageCount: value === "queued" ? 1 : 0,
    };
    editor.canSteer = editor.status.isStreaming;
    editor.isCompacting = editor.status.isCompacting;
    editor.canStop = editor.status.isStreaming || editor.status.isBashRunning || editor.status.isCompacting || editor.status.pendingMessageCount > 0;
    layout.status = editor.status;
    statusBar.status = editor.status;
    await settle();
  },
  setDraft: async (value) => { editor.replaceText(value); await settle(); },
  setDisabled: async (value) => { editor.disabled = value; await settle(); },
  calls: () => ({ stop: stopCalls, send: sendCalls, lastSendText, lastSendBehavior }),
  focusSection: async (section) => {
    sections.expand(section);
    await settle();
    return await navigation.focusSection(section);
  },
  savedTheme: () => savedTheme,
  fail: async () => { registry.uiPresentation.fail("navigation", new Error("Intentional fixture failure")); await apply(); },
  openSettings: async () => {
    settings = new SettingsDialog();
    settings.machine = machine;
    settings.machines = [machine];
    settings.themes = registry.getThemes();
    settings.themePreference = legacyPreference ?? { themeId: "pi-web.custom-ui-codex:paper", auto: true };
    settings.activeThemeId = `pi-web.custom-ui-codex:${scheme === "light" ? "paper" : "graphite"}`;
    settings.onUseLocalTheme = (preference) => { savedTheme = preference; };
    settings.onClose = () => { settings?.remove(); settings = undefined; };
    settings.onNavigate = (section) => { if (settings !== undefined) settings.section = section; };
    document.body.append(settings);
    await apply();
  },
  identity: () => ({ editor: editor.view === originalView, chat: layout.querySelector("chat-view") === chat, draft: editor.view?.state.doc.toString() ?? "" }),
};
window.addEventListener("pagehide", () => { release(); void registry.dispose(); });
document.body.dataset["ready"] = "true";
