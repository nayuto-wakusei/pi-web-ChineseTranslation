import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi, type PiPackageMutationResponse, type PiWebConfigResponse, type PiWebPluginsResponse } from "../api";
import { SettingsDialog } from "./SettingsDialog";
import { callDialogPromise, callDialogUpdated, collectTemplateStrings, configResponse, deferred, getDialogProperty, packageInfo, packageMutationResponse, pluginInfo, pluginsResponse, remoteMachine, runtimeWithPackageManagement, secondRemoteMachine, setDialogProperty, stubWindowTimers } from "./SettingsDialog.testSupport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings-dialog session daemon machine targeting", () => {
  it("keeps gateway settings loads on the gateway config/plugin endpoints", async () => {
    const config = configResponse({ host: "127.0.0.1" });
    const plugins: PiWebPluginsResponse = { plugins: [] };
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(config);
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(plugins);
    const dialog = new SettingsDialog();

    await callDialogPromise(dialog, "loadConfig");

    expect(configSpy.mock.calls).toEqual([[]]);
    expect(pluginsSpy.mock.calls).toEqual([[]]);
    expect(getDialogProperty(dialog, "configResponse")).toBe(config);
    expect(getDialogProperty(dialog, "pluginsResponse")).toBe(plugins);
    expect(getDialogProperty(dialog, "error")).toBe("");
    expect(getDialogProperty(dialog, "loading")).toBe(false);
  });

  it("loads session-daemon config from the selected machine", async () => {
    const config = configResponse({ spawnSessions: false, subsessions: true });
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(config);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadSessiondConfigForTarget");

    expect(configSpy.mock.calls).toEqual([["remote-a"]]);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(config);
    expect(getDialogProperty(dialog, "sessiondError")).toBe("");
    expect(getDialogProperty(dialog, "sessiondLoading")).toBe(false);
  });

  it("saves local session-daemon config through the local machine alias and updates local daemon state", async () => {
    stubWindowTimers();
    const gatewayConfig = configResponse({ host: "127.0.0.1", spawnSessions: false, subsessions: false });
    const savedConfig = configResponse({ spawnSessions: true });
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    const dialog = new SettingsDialog();
    setDialogProperty(dialog, "configResponse", gatewayConfig);

    await callDialogPromise(dialog, "saveSessiondConfig", { spawnSessions: true });

    expect(saveSpy.mock.calls).toEqual([[{ spawnSessions: true }, "local"]]);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "configResponse")).toMatchObject({ config: { host: "127.0.0.1", spawnSessions: true, subsessions: false } });
    expect(getDialogProperty(dialog, "savedMessage")).toBe("配置已保存。");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("ignores stale session-daemon load responses after the selected machine changes", async () => {
    const load = deferred<PiWebConfigResponse>();
    vi.spyOn(configApi, "config").mockReturnValue(load.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    const loadPromise = callDialogPromise(dialog, "loadSessiondConfigForTarget");
    expect(getDialogProperty(dialog, "sessiondLoading")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    load.resolve(configResponse({ spawnSessions: false }));
    await loadPromise;

    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "sessiondError")).toBe("");
    expect(getDialogProperty(dialog, "sessiondLoading")).toBe(false);
  });

  it("ignores stale session-daemon save responses after the selected machine changes", async () => {
    stubWindowTimers();
    const save = deferred<PiWebConfigResponse>();
    vi.spyOn(configApi, "saveConfig").mockReturnValue(save.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    const savePromise = callDialogPromise(dialog, "saveSessiondConfig", { subsessions: true });
    expect(getDialogProperty(dialog, "saving")).toBe(true);

    dialog.machine = secondRemoteMachine;
    save.resolve(configResponse({ subsessions: true }));
    await savePromise;

    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "savedMessage")).toBe("");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("loads selected-machine settings without capability metadata", async () => {
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(configResponse({ spawnSessions: true }));
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([pluginInfo("info", true)]));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = runtimeWithoutSelectedMachineSettings;

    await callDialogPromise(dialog, "loadSessiondConfigForTarget");
    await callDialogPromise(dialog, "loadAccessConfigForTarget");
    await callDialogPromise(dialog, "loadPluginsForTarget");

    expect(configSpy).toHaveBeenCalledWith(remoteMachine.id);
    expect(pluginsSpy).toHaveBeenCalledWith(remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBeDefined();
    expect(getDialogProperty(dialog, "accessConfigResponse")).toBeDefined();
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBeDefined();
  });

  it("saves remote selected-machine settings without capability metadata", async () => {
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(configResponse({ spawnSessions: true }));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = runtimeWithoutSelectedMachineSettings;
    setDialogProperty(dialog, "selectedPluginConfigResponse", configResponse({ plugins: { info: { enabled: true } } }));

    await callDialogPromise(dialog, "saveSessiondConfig", { spawnSessions: true });
    await callDialogPromise(dialog, "saveMachineAccessConfig", { pathAccess: { allowedPaths: ["/mnt/share"] } });
    await callDialogPromise(dialog, "togglePlugin", "info", false);

    expect(saveSpy.mock.calls).toEqual([
      [{ spawnSessions: true }, remoteMachine.id],
      [{ pathAccess: { allowedPaths: ["/mnt/share"] } }, remoteMachine.id],
      [{ plugins: { info: { enabled: false } } }, remoteMachine.id],
    ]);
  });

  it("shows selected-machine settings errors with the selected target name", async () => {
    vi.spyOn(configApi, "config").mockRejectedValue(new Error("Remote machine unavailable"));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadSessiondConfigForTarget");

    expect(getDialogProperty(dialog, "sessiondError")).toBe("从 Lab Mac（远程机器） 加载会话守护进程配置失败：无法连接 Lab Mac 以获取所选机器设置。请检查机器连接后重试。");
    expect(getDialogProperty(dialog, "sessiondLoading")).toBe(false);
  });
});

describe("settings-dialog general settings machine targeting", () => {
  it("renders the active settings panel without the old global scope note", () => {
    const dialog = new SettingsDialog();
    dialog.section = "general";
    dialog.machine = remoteMachine;

    const strings = collectTemplateStrings(dialog.render()).join("");

    expect(strings).toContain("<settings-general-panel");
    expect(strings).not.toContain("scope-note");
    expect(strings).not.toContain("This tab edits:");
  });

  it("keeps gateway server config saves on the gateway config endpoint", async () => {
    stubWindowTimers();
    const savedConfig = configResponse({ host: "0.0.0.0", port: 9000, allowedHosts: true });
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    const onConfigSaved = vi.fn();
    const dialog = new SettingsDialog();
    dialog.onConfigSaved = onConfigSaved;

    await callDialogPromise(dialog, "saveConfig", { host: "0.0.0.0", port: 9000, allowedHosts: true });

    expect(saveSpy.mock.calls).toEqual([[{ host: "0.0.0.0", port: 9000, allowedHosts: true }]]);
    expect(getDialogProperty(dialog, "configResponse")).toBe(savedConfig);
    expect(onConfigSaved).toHaveBeenCalledWith({ host: "0.0.0.0", port: 9000, allowedHosts: true });
    expect(getDialogProperty(dialog, "savedMessage")).toBe("配置已保存。");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("loads file access and upload config from the selected machine", async () => {
    const config = configResponse({ pathAccess: { allowedPaths: ["/mnt/share"] }, uploads: { defaultFolder: "manual/uploads" } });
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(config);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadAccessConfigForTarget");

    expect(configSpy.mock.calls).toEqual([["remote-a"]]);
    expect(getDialogProperty(dialog, "accessConfigResponse")).toBe(config);
    expect(getDialogProperty(dialog, "accessError")).toBe("");
    expect(getDialogProperty(dialog, "accessLoading")).toBe(false);
  });

  it("saves selected-machine file access and upload config through the selected-machine endpoint", async () => {
    stubWindowTimers();
    const patch = { pathAccess: { allowedPaths: ["/mnt/share", "~/SDKs"] }, uploads: { defaultFolder: "manual/uploads" } };
    const savedConfig = configResponse(patch);
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "saveMachineAccessConfig", patch);

    expect(saveSpy.mock.calls).toEqual([[patch, "remote-a"]]);
    expect(getDialogProperty(dialog, "accessConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "configResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "savedMessage")).toBe("配置已保存。");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("merges local selected-machine access saves into gateway config without dropping gateway-only values", async () => {
    stubWindowTimers();
    const gatewayConfig = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: true } },
      spawnSessions: false,
      pathAccess: { allowedPaths: ["/old"] },
      uploads: { defaultFolder: "old/uploads" },
      maxUploadBytes: 1234,
    });
    const patch = { pathAccess: { allowedPaths: ["~/SDKs"] }, uploads: {} };
    const savedConfig = configResponse({ pathAccess: { allowedPaths: ["~/SDKs"] }, uploads: {}, maxUploadBytes: 5678 });
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    const onConfigSaved = vi.fn();
    const dialog = new SettingsDialog();
    dialog.onConfigSaved = onConfigSaved;
    setDialogProperty(dialog, "configResponse", gatewayConfig);

    await callDialogPromise(dialog, "saveMachineAccessConfig", patch);

    expect(saveSpy.mock.calls).toEqual([[patch, "local"]]);
    expect(getDialogProperty(dialog, "accessConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "configResponse")).toMatchObject({
      config: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        spawnSessions: false,
        pathAccess: { allowedPaths: ["~/SDKs"] },
        uploads: {},
        maxUploadBytes: 5678,
      },
      effectiveConfig: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        spawnSessions: false,
        pathAccess: { allowedPaths: ["~/SDKs"] },
        uploads: {},
        maxUploadBytes: 5678,
      },
    });
    expect(onConfigSaved).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: true } },
      spawnSessions: false,
      pathAccess: { allowedPaths: ["~/SDKs"] },
      uploads: {},
      maxUploadBytes: 5678,
    });
  });

  it("ignores stale file access load responses after the selected machine changes", async () => {
    const load = deferred<PiWebConfigResponse>();
    vi.spyOn(configApi, "config").mockReturnValue(load.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    const loadPromise = callDialogPromise(dialog, "loadAccessConfigForTarget");
    expect(getDialogProperty(dialog, "accessLoading")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    load.resolve(configResponse({ pathAccess: { allowedPaths: ["/stale"] } }));
    await loadPromise;

    expect(getDialogProperty(dialog, "accessConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "accessError")).toBe("");
    expect(getDialogProperty(dialog, "accessLoading")).toBe(false);
  });

  it("ignores stale file access save responses after the selected machine changes", async () => {
    const save = deferred<PiWebConfigResponse>();
    vi.spyOn(configApi, "saveConfig").mockReturnValue(save.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    const savePromise = callDialogPromise(dialog, "saveMachineAccessConfig", { pathAccess: { allowedPaths: ["/mnt/share"] }, uploads: { defaultFolder: "manual" } });
    expect(getDialogProperty(dialog, "saving")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    save.resolve(configResponse({ pathAccess: { allowedPaths: ["/mnt/share"] }, uploads: { defaultFolder: "manual" } }));
    await savePromise;

    expect(getDialogProperty(dialog, "accessConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "savedMessage")).toBe("");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("shows selected-machine file access errors with the selected target name", async () => {
    vi.spyOn(configApi, "config").mockRejectedValue(new Error("Remote machine unavailable"));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadAccessConfigForTarget");

    expect(getDialogProperty(dialog, "accessError")).toBe("从 Lab Mac（远程机器） 加载文件访问/上传配置失败：无法连接 Lab Mac 以获取所选机器设置。请检查机器连接后重试。");
    expect(getDialogProperty(dialog, "accessLoading")).toBe(false);
  });
});

describe("settings-dialog Pi package orchestration", () => {
  it("loads package data from the selected machine and ignores stale target responses", async () => {
    const remotePackages = { packages: [packageInfo("npm:@acme/tools")] };
    const staleLoad = deferred<typeof remotePackages>();
    const packagesSpy = vi.spyOn(piPackagesApi, "packages").mockReturnValue(staleLoad.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = runtimeWithPackageManagement;

    const loadPromise = callDialogPromise(dialog, "loadPackagesForTarget");
    expect(packagesSpy.mock.calls).toEqual([["remote-a"]]);
    expect(getDialogProperty(dialog, "packageLoading")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    staleLoad.resolve(remotePackages);
    await loadPromise;

    expect(getDialogProperty(dialog, "packagesResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "packageError")).toBe("");
    expect(getDialogProperty(dialog, "packageMessage")).toBe("");
    expect(getDialogProperty(dialog, "packageLoading")).toBe(false);
  });

  it("runs remote package mutations against the selected machine without refreshing gateway plugins", async () => {
    const installedPackages = [packageInfo("npm:@acme/new-tools")];
    const install = deferred<PiPackageMutationResponse>();
    const installSpy = vi.spyOn(piPackagesApi, "install").mockReturnValue(install.promise);
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([pluginInfo("gateway", true)]));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = runtimeWithPackageManagement;

    const installPromise = callDialogPromise(dialog, "installPiPackage", "npm:@acme/new-tools");

    expect(installSpy.mock.calls).toEqual([["npm:@acme/new-tools", "remote-a"]]);
    expect(getDialogProperty(dialog, "saving")).toBe(true);
    expect(getDialogProperty(dialog, "packageOperation")).toEqual({ kind: "install", source: "npm:@acme/new-tools" });

    install.resolve(packageMutationResponse("install", installedPackages, "npm:@acme/new-tools"));
    await installPromise;

    expect(pluginsSpy).not.toHaveBeenCalled();
    expect(getDialogProperty(dialog, "packagesResponse")).toEqual({ packages: installedPackages });
    expect(getDialogProperty(dialog, "packageMessage")).toContain("Pi 包已安装（Lab Mac）");
    expect(getDialogProperty(dialog, "packageMessage")).toContain("Lab Mac 上每个空闲的 PI WEB 会话");
    expect(getDialogProperty(dialog, "packageError")).toBe("");
    expect(getDialogProperty(dialog, "packageOperation")).toBeUndefined();
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("refreshes gateway plugins after a local package mutation", async () => {
    const updatedPackages = [packageInfo("npm:@acme/tools")];
    const refreshedPlugins = pluginsResponse([pluginInfo("browser-helper", true)]);
    const updateSpy = vi.spyOn(piPackagesApi, "update").mockResolvedValue(packageMutationResponse("update", updatedPackages));
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(refreshedPlugins);
    const dialog = new SettingsDialog();

    await callDialogPromise(dialog, "updatePiPackage");

    expect(updateSpy.mock.calls).toEqual([[undefined, "local"]]);
    expect(pluginsSpy.mock.calls).toEqual([[]]);
    expect(getDialogProperty(dialog, "packagesResponse")).toEqual({ packages: updatedPackages });
    expect(getDialogProperty(dialog, "pluginsResponse")).toBe(refreshedPlugins);
    expect(getDialogProperty(dialog, "packageMessage")).toContain("PI WEB 浏览器插件变更");
    expect(getDialogProperty(dialog, "packageError")).toBe("");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });
});

describe("settings-dialog plugin settings machine targeting", () => {
  it("loads plugin config and plugin list from the selected machine", async () => {
    const config = configResponse({ plugins: { info: { enabled: true } } });
    const plugins = pluginsResponse([pluginInfo("info", true)]);
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(config);
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(plugins);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadPluginsForTarget");

    expect(configSpy.mock.calls).toEqual([["remote-a"]]);
    expect(pluginsSpy.mock.calls).toEqual([["remote-a"]]);
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBe(config);
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBe(plugins);
    expect(getDialogProperty(dialog, "pluginError")).toBe("");
    expect(getDialogProperty(dialog, "pluginLoading")).toBe(false);
  });

  it("keeps fulfilled plugin config when the selected machine plugin list is unsupported", async () => {
    const config = configResponse({ plugins: { info: { enabled: true } } });
    vi.spyOn(configApi, "config").mockResolvedValue(config);
    vi.spyOn(pluginsApi, "plugins").mockRejectedValue(new Error("route GET:/api/plugins not found"));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadPluginsForTarget");

    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBe(config);
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "pluginError")).toBe("从 Lab Mac（远程机器） 加载 PI WEB 插件设置失败：PI WEB 插件：Lab Mac 不支持所选机器设置。请更新并重启该机器上的 PI WEB，然后重试。");
    expect(getDialogProperty(dialog, "pluginLoading")).toBe(false);
  });

  it("saves selected-machine plugin toggles as plugin-only patches and refreshes the selected machine plugin list", async () => {
    stubWindowTimers();
    const baseConfig = configResponse({
      plugins: {
        keep: { enabled: true, settings: { level: 1 } },
        info: { settings: { color: "blue" } },
      },
    });
    const savedConfig = configResponse({
      plugins: {
        keep: { enabled: true, settings: { level: 1 } },
        info: { enabled: false, settings: { color: "blue" } },
      },
    });
    const refreshedPlugins = pluginsResponse([pluginInfo("info", false), pluginInfo("keep", true)]);
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(refreshedPlugins);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    setDialogProperty(dialog, "selectedPluginConfigResponse", baseConfig);

    await callDialogPromise(dialog, "togglePlugin", "info", false);

    expect(saveSpy.mock.calls).toEqual([[
      {
        plugins: {
          keep: { enabled: true, settings: { level: 1 } },
          info: { enabled: false, settings: { color: "blue" } },
        },
      },
      "remote-a",
    ]]);
    expect(pluginsSpy.mock.calls).toEqual([["remote-a"]]);
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBe(refreshedPlugins);
    expect(getDialogProperty(dialog, "savedMessage")).toBe("配置已保存。");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("merges local selected-machine plugin saves into gateway config without dropping gateway-only values", async () => {
    stubWindowTimers();
    const gatewayConfig = configResponse({
      host: "127.0.0.1",
      shortcuts: { "core:view.chat": "mod+1" },
      spawnSessions: false,
      plugins: { info: { enabled: false }, gateway: { settings: { theme: "dark" } } },
    });
    const savedConfig = configResponse({ plugins: { info: { enabled: true }, gateway: { settings: { theme: "dark" } } } });
    const refreshedPlugins = pluginsResponse([pluginInfo("info", true)]);
    const saveSpy = vi.spyOn(configApi, "saveConfig").mockResolvedValue(savedConfig);
    vi.spyOn(pluginsApi, "plugins").mockResolvedValue(refreshedPlugins);
    const onConfigSaved = vi.fn();
    const dialog = new SettingsDialog();
    dialog.onConfigSaved = onConfigSaved;
    setDialogProperty(dialog, "configResponse", gatewayConfig);
    setDialogProperty(dialog, "selectedPluginConfigResponse", configResponse({ plugins: { info: { enabled: false } } }));

    await callDialogPromise(dialog, "togglePlugin", "info", true);

    expect(saveSpy.mock.calls).toEqual([[{ plugins: { info: { enabled: true } } }, "local"]]);
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBe(refreshedPlugins);
    expect(getDialogProperty(dialog, "configResponse")).toMatchObject({
      config: {
        host: "127.0.0.1",
        shortcuts: { "core:view.chat": "mod+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, gateway: { settings: { theme: "dark" } } },
      },
      effectiveConfig: {
        host: "127.0.0.1",
        shortcuts: { "core:view.chat": "mod+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, gateway: { settings: { theme: "dark" } } },
      },
    });
    expect(onConfigSaved).toHaveBeenCalledWith({
      host: "127.0.0.1",
      shortcuts: { "core:view.chat": "mod+1" },
      spawnSessions: false,
      plugins: { info: { enabled: true }, gateway: { settings: { theme: "dark" } } },
    });
  });

  it("ignores stale plugin load responses after the selected machine changes", async () => {
    const configLoad = deferred<PiWebConfigResponse>();
    const pluginsLoad = deferred<PiWebPluginsResponse>();
    vi.spyOn(configApi, "config").mockReturnValue(configLoad.promise);
    vi.spyOn(pluginsApi, "plugins").mockReturnValue(pluginsLoad.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    const loadPromise = callDialogPromise(dialog, "loadPluginsForTarget");
    expect(getDialogProperty(dialog, "pluginLoading")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    configLoad.resolve(configResponse({ plugins: { info: { enabled: true } } }));
    pluginsLoad.resolve(pluginsResponse([pluginInfo("info", true)]));
    await loadPromise;

    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "pluginError")).toBe("");
    expect(getDialogProperty(dialog, "pluginLoading")).toBe(false);
  });

  it("ignores stale plugin save responses after the selected machine changes", async () => {
    const save = deferred<PiWebConfigResponse>();
    const pluginsSpy = vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([pluginInfo("info", false)]));
    vi.spyOn(configApi, "saveConfig").mockReturnValue(save.promise);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    setDialogProperty(dialog, "selectedPluginConfigResponse", configResponse({ plugins: { info: { enabled: true } } }));

    const savePromise = callDialogPromise(dialog, "togglePlugin", "info", false);
    expect(getDialogProperty(dialog, "saving")).toBe(true);

    dialog.machine = secondRemoteMachine;
    callDialogUpdated(dialog, new Map([["machine", remoteMachine]]));
    save.resolve(configResponse({ plugins: { info: { enabled: false } } }));
    await savePromise;

    expect(pluginsSpy).not.toHaveBeenCalled();
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "selectedPluginsResponse")).toBeUndefined();
    expect(getDialogProperty(dialog, "savedMessage")).toBe("");
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });
});

const runtimeWithoutSelectedMachineSettings = runtimeWithPackageManagement;
