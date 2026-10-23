import { configApi, piPackagesApi, pluginsApi, type Machine, type PiWebConfigResponse, type PiWebConfigValues } from "../../src/client/src/api";
import { SettingsDialog } from "../../src/client/src/components/SettingsDialog";
import { setClientTranslations } from "../../src/client/src/i18n";
import chinesePlugin from "../../pi-web-plugins/zh-cn/pi-web-plugin";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS } from "../../src/shared/pluginRecoveryCommands";

const [catalog] = chinesePlugin.activate().contributions.localizations;
if (catalog === undefined) throw new Error("Bundled Chinese catalog is missing");
setClientTranslations(catalog.locale, catalog.messages);

const style = document.createElement("style");
style.textContent = `
  :root { --pi-bg: #17191b; --pi-surface: #23272a; --pi-border: #52585a; --pi-border-muted: #3c4144; --pi-text: #f0f1f2; --pi-muted: #b6bec1; --pi-accent: #4ec9a5; --pi-warning: #f4d47c; --pi-warning-surface: #3a321c; --pi-warning-border: #ad8d39; --pi-overlay: #0008; --pi-font: system-ui, sans-serif; }
  body { margin: 0; background: var(--pi-bg); color: var(--pi-text); font-family: var(--pi-font); }
`;
document.head.append(style);

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/fixture/config.json", exists: true, config, effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

configApi.config = (id) => Promise.resolve(configResponse({
  host: "127.0.0.1", port: 8504, uploads: { defaultFolder: `${id ?? "gateway"}/uploads` },
}));
configApi.namingModels = () => Promise.resolve({ models: [] });
configApi.saveConfig = (config) => Promise.resolve(configResponse(config));
piPackagesApi.packages = () => Promise.resolve({ packages: [] });
pluginsApi.plugins = () => Promise.resolve({
  lifecycleVersion: 2, plugins: [], diagnostics: [],
  serverRuntime: { status: "available", terminalMode: "required", restartRequired: false, recovery: { ...PI_WEB_PLUGIN_RECOVERY_COMMANDS } },
});

const machine = (id: string, name: string, kind: Machine["kind"]): Machine => ({
  id, name, kind, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z",
});
const local = machine("local", "本地网关", "local");
const first = machine("remote-a", "项目开发工作机", "remote");
const second = machine("remote-b", "持续集成与构建服务器", "remote");
const dialog = new SettingsDialog();
dialog.actions = [{ id: "fixture", title: "打开导航", description: "选择应用中的其他页面", group: "通用", shortcut: "Ctrl+K", run: () => undefined }];
dialog.machine = first;
dialog.machines = [local, first, second];
dialog.namingModelsTarget = { machineId: first.id, projectId: "fixture-project" };
dialog.onNavigate = (section) => { dialog.section = section; };
dialog.onClose = () => { dialog.remove(); };
document.body.append(dialog);
await dialog.updateComplete;
document.body.dataset["ready"] = "true";
