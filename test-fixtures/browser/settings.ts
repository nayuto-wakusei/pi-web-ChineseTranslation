import { initializeClientLocalization } from "../../src/client/src/localizationBootstrap";
import { localization } from "../../src/client/src/localization/browser";
import { configApi, piPackagesApi, pluginsApi, type Machine, type PiWebConfigResponse, type PiWebConfigValues } from "../../src/client/src/api";
import { SettingsDialog } from "../../src/client/src/components/SettingsDialog";
import { parseSettingsSection } from "../../src/client/src/settingsRoute";
import chinesePlugin from "../../pi-web-plugins/zh-cn/pi-web-plugin";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS } from "../../src/shared/pluginRecoveryCommands";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") === "en" ? "en" : "zh-CN";

await initializeClientLocalization(() => Promise.resolve([{ id: "zh-cn", plugin: chinesePlugin }]));
await localization.setPreferences({ language, formatLocale: language });

const style = document.createElement("style");
style.textContent = `
  :root { --pi-bg: #17191b; --pi-surface: #23272a; --pi-border: #52585a; --pi-border-muted: #3c4144; --pi-text: #f0f1f2; --pi-muted: #b6bec1; --pi-accent: #4ec9a5; --pi-warning: #f4d47c; --pi-warning-surface: #3a321c; --pi-warning-border: #ad8d39; --pi-overlay: #0008; --pi-font: system-ui, sans-serif; }
  body { margin: 0; background: var(--pi-bg); color: var(--pi-text); font-family: var(--pi-font); }
`;
document.head.append(style);

// Long values exercise wrapping in the config-path card and the speech fields.
const longSpeech: PiWebConfigValues["speech"] = params.get("speech") === "long" ? {
  endpoint: "http://speech-service.internal.example.test:18080/openai-compatible/v1",
  api: "transcriptions",
  model: "qwen3-asr-0.6b-instruct-quantized-long-name",
  language: "zh-CN",
  apiKeyEnv: "PI_WEB_SPEECH_BEARER_TOKEN",
} : undefined;
const enforced = params.get("enforced") === "1";
// The real server never returns the key value; the fixture mirrors that with
// presence metadata only, so the panel's saved/clear states are exercised.
let speechKeySaved = longSpeech !== undefined;
const configPath = params.get("speech") === "long"
  ? "/srv/organizations/north-region/deployments/pi-web-production/config.json"
  : "/fixture/config.json";

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: configPath, exists: true, config, effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, sessionMessages: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
    ...(enforced ? { enforcedSettings: { "/speech/endpoint": "PI_WEB_SPEECH" } } : {}),
    ...(speechKeySaved ? { speechApiKeyPresence: { config: true, effectiveConfig: true, defaultsConfig: false } } : {}),
  };
}

function seededConfig(id?: string): PiWebConfigValues {
  return {
    host: "127.0.0.1", port: 8504, uploads: { defaultFolder: `${id ?? "gateway"}/uploads` },
    ...(longSpeech === undefined ? {} : { speech: longSpeech }),
  };
}

function patchedConfig(base: PiWebConfigValues, set: PiWebConfigValues): PiWebConfigValues {
  // PATCH semantics: declared namespaces merge leaf-by-leaf, everything else replaces.
  const next: PiWebConfigValues = { ...base, ...set };
  if (set.speech !== undefined) next.speech = { ...base.speech, ...set.speech };
  return next;
}

configApi.config = (id) => Promise.resolve(configResponse(seededConfig(id)));
configApi.namingModels = () => Promise.resolve({ models: [] });
configApi.speechApiKey = () => Promise.resolve({ apiKey: speechKeySaved ? "fixture-speech-key" : "" });
configApi.saveConfig = (config) => Promise.resolve(configResponse(config));
configApi.updateConfig = (update, id) => {
  if (update.unset?.includes("/speech/apiKey") === true) speechKeySaved = false;
  if (update.set?.speech?.apiKey !== undefined) speechKeySaved = true;
  return Promise.resolve(configResponse(patchedConfig(seededConfig(id), update.set ?? {})));
};
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
dialog.section = parseSettingsSection(params.get("settings")) ?? "general";
dialog.onNavigate = (section) => { dialog.section = section; };
dialog.onClose = () => { dialog.remove(); };
document.body.append(dialog);
await dialog.updateComplete;
document.body.dataset["ready"] = "true";
