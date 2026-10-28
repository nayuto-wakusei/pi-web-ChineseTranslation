import { afterEach, describe, expect, it, vi } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { configApi, pluginsApi, type PiWebConfigResponse, type PiWebPluginsResponse } from "../api";
import { SettingsDialog } from "./SettingsDialog";
import { createTranslator } from "../../../shared/i18n";
const t = createTranslator("en", {});
import { callDialogPromise, callDialogUpdated, configResponse, deferred, getDialogProperty, pluginInfo, pluginsResponse, remoteMachine, runtimeWithPackageManagement as runtimeWithoutSelectedMachineSettings, secondRemoteMachine, setDialogProperty, stubWindowTimers } from "./SettingsDialog.testSupport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings-dialog session daemon machine targeting", () => {
  it("saves session-daemon toggles on the selected remote machine", async () => {
    stubWindowTimers();
    const patch = { spawnSessions: false, subsessions: true };
    const saved = configResponse(patch);
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(saved);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    await callDialogPromise(dialog, "saveSessiondConfig", patch);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ set: patch, unset: [] }, remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(saved);
    expect(getDialogProperty(dialog, "savedMessage")).toBe(t("ui.sessionNaming.daemonSaved", "Session daemon settings saved for {machine}. Restart the session daemon to apply agent permission changes. Restarting interrupts active sessions.{naming}", { machine: remoteMachine.name, naming: "" }));
  });
  it("keeps gateway settings loads on the gateway config/plugin endpoints", async () => {
    const config = configResponse({ host: "127.0.0.1" });
    const plugins: PiWebPluginsResponse = pluginsResponse([]);
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

  it("reloads desired config and the active runtime descriptor together", async () => {
    const config = configResponse({ agent: { command: "agent-lab", dir: "/srv/agent-lab" } });
    const configSpy = vi.spyOn(configApi, "config").mockResolvedValue(config);
    const runtimeRefresh = vi.fn(() => Promise.resolve());
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.onRefreshMachineRuntime = runtimeRefresh;

    await callDialogPromise(dialog, "reloadSessiondState");

    expect(configSpy).toHaveBeenCalledWith(remoteMachine.id);
    expect(runtimeRefresh).toHaveBeenCalledWith(remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(config);
  });

  it("saves local session-daemon config through the local machine alias and updates local daemon state", async () => {
    stubWindowTimers();
    const gatewayConfig = configResponse({ host: "127.0.0.1", spawnSessions: false, subsessions: false });
    const savedConfig = configResponse({ spawnSessions: true, subsessions: false });
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(savedConfig);
    const dialog = new SettingsDialog();
    setDialogProperty(dialog, "configResponse", gatewayConfig);

    await callDialogPromise(dialog, "saveSessiondConfig", { spawnSessions: true });

    expect(saveSpy.mock.calls).toEqual([[{ set: { spawnSessions: true }, unset: [] }, "local"]]);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(savedConfig);
    expect(getDialogProperty(dialog, "configResponse")).toMatchObject({ config: { host: "127.0.0.1", spawnSessions: true, subsessions: false } });
    expect(getDialogProperty(dialog, "savedMessage")).toBe(t("ui.sessionNaming.daemonSaved", "Session daemon settings saved for {machine}. Restart the session daemon to apply agent permission changes. Restarting interrupts active sessions.{naming}", { machine: "本机", naming: "" }));
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });

  it("saves a remote agent profile without capability metadata", async () => {
    stubWindowTimers();
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(configResponse({ agent: { command: "agent-lab", dir: "/srv/agent-lab" } }));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = {
      machineId: remoteMachine.id,
      ok: true,
      checkedAt: "now",
      capabilities: [PI_WEB_CAPABILITIES.selectedMachineSettings],
    };

    await callDialogPromise(dialog, "saveSessiondConfig", { agent: { command: "agent-lab", dir: "/srv/agent-lab" } });

    expect(saveSpy).toHaveBeenCalledWith({ set: { agent: { command: "agent-lab", dir: "/srv/agent-lab" } }, unset: [] }, remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondError")).toBe("");
  });

  it("saves a remote agent profile when granular support is advertised", async () => {
    stubWindowTimers();
    const patch = { agent: { command: "agent-lab", dir: "/srv/agent-lab" } };
    const saved = configResponse(patch);
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(saved);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = {
      machineId: remoteMachine.id,
      ok: true,
      checkedAt: "now",
      capabilities: [PI_WEB_CAPABILITIES.selectedMachineSettings, PI_WEB_CAPABILITIES.agentProfileConfig],
    };

    await callDialogPromise(dialog, "saveSessiondConfig", patch);

    expect(saveSpy).toHaveBeenCalledWith({ set: patch, unset: [] }, remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(saved);
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
    vi.spyOn(configApi, "updateConfig").mockReturnValue(save.promise);
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
    expect(pluginsSpy).not.toHaveBeenCalled();
    expect(getDialogProperty(dialog, "pluginError")).toContain("Plugin lifecycle diagnostics are not available");
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBeDefined();
    expect(getDialogProperty(dialog, "accessConfigResponse")).toBeDefined();
    expect(getDialogProperty(dialog, "selectedPluginConfigResponse")).toBeDefined();
  });

  it("saves remote selected-machine settings without capability metadata", async () => {
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(configResponse({ spawnSessions: true }));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    dialog.machineRuntime = runtimeWithoutSelectedMachineSettings;
    setDialogProperty(dialog, "selectedPluginConfigResponse", configResponse({ plugins: { info: { enabled: true } } }));

    await callDialogPromise(dialog, "saveSessiondConfig", { spawnSessions: true });
    await callDialogPromise(dialog, "saveMachineAccessConfig", { pathAccess: { allowedPaths: ["/mnt/share"] } });
    await callDialogPromise(dialog, "togglePlugin", "info", false);

    expect(saveSpy.mock.calls).toEqual([
      [{ set: { spawnSessions: true }, unset: [] }, remoteMachine.id],
      [{ set: { pathAccess: { allowedPaths: ["/mnt/share"] } }, unset: [] }, remoteMachine.id],
      [{ set: { plugins: { info: { enabled: false } } } }, remoteMachine.id],
    ]);
  });

  it("shows selected-machine settings errors with the selected target name", async () => {
    vi.spyOn(configApi, "config").mockRejectedValue(new Error("Remote machine unavailable"));
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "loadSessiondConfigForTarget");

    expect(getDialogProperty(dialog, "sessiondError")).toBe("Failed to load session-daemon config from Lab Mac (remote machine): Remote machine unavailable");
    expect(getDialogProperty(dialog, "sessiondLoading")).toBe(false);
  });
});

describe("upstream naming reset contracts", () => {
it.each([
    { model: "provider/naming", maxTokens: 48 },
    { maxTokens: 64 },
  ])("confirms naming-only saves apply without a restart, including resets (%j)", async (sessionNaming) => {
    stubWindowTimers();
    const patch = { sessionNaming };
    const saved = configResponse(patch);
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(saved);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;

    await callDialogPromise(dialog, "saveSessiondConfig", patch);

    expect(saveSpy).toHaveBeenCalledWith({ set: patch, unset: [] }, remoteMachine.id);
    expect(getDialogProperty(dialog, "sessiondConfigResponse")).toBe(saved);
    expect(getDialogProperty(dialog, "savedMessage")).toBe(`Session naming settings saved for ${remoteMachine.name}. They apply to the next naming request without a restart. Existing names and in-progress naming requests are unchanged.`);
  });
it("resets a naming group in one request without deleting an enforced saved model", async () => {
    stubWindowTimers();
    const snapshot = configResponse({ sessionNaming: { model: "hidden", maxTokens: 48, timeoutMs: 30000 } });
    snapshot.enforcedSettings = { "/sessionNaming/model": "PI_WEB_SESSION_NAMING" };
    const saveSpy = vi.spyOn(configApi, "updateConfig").mockResolvedValue(snapshot);
    const dialog = new SettingsDialog();
    dialog.machine = remoteMachine;
    setDialogProperty(dialog, "sessiondConfigResponse", snapshot);
    await callDialogPromise(dialog, "saveSessiondConfig", {}, ["/sessionNaming"]);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ unset: ["/sessionNaming/maxTokens", "/sessionNaming/timeoutMs"] }, remoteMachine.id);
    expect(getDialogProperty(dialog, "savedMessage")).toContain("without a restart");
  });
it("keeps the permission restart warning when a patch also changes naming", async () => {
    stubWindowTimers();
    const patch = { askUser: true, sessionNaming: { maxTokens: 48 } };
    vi.spyOn(configApi, "updateConfig").mockResolvedValue(configResponse(patch));
    const dialog = new SettingsDialog();

    await callDialogPromise(dialog, "saveSessiondConfig", patch);

    expect(getDialogProperty(dialog, "savedMessage")).toBe("Session daemon settings saved for 本机. Restart the session daemon to apply agent permission changes. Restarting interrupts active sessions. Naming changes apply to the next naming request without a restart.");
  });
});
