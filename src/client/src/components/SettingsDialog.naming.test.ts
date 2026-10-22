// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi, type AuthRequestTarget } from "../api";
import { setClientTranslations } from "../i18n";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, deferred, pluginsResponse, remoteMachine, secondRemoteMachine } from "./SettingsDialog.testSupport";
import { installNativeDialogFake } from "./nativeDialog.testSupport";
import type { SettingsSessiondPanel } from "./settings/SettingsSessiondPanel";
installNativeDialogFake();

const target: AuthRequestTarget = { machineId: remoteMachine.id, projectId: "project-a" };
beforeEach(() => {
  setClientTranslations("en", {});
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(configApi, "namingModels").mockResolvedValue({ models: [{ provider: "provider", id: "naming" }] });
  vi.spyOn(configApi, "saveConfig").mockImplementation((config) => Promise.resolve(configResponse(config)));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
});
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

async function settle(dialog: SettingsDialog): Promise<void> {
  await dialog.updateComplete;
  await dialog.updateComplete;
  await panel(dialog).updateComplete;
}
function panel(dialog: SettingsDialog): SettingsSessiondPanel {
  const result = dialog.shadowRoot?.querySelector<SettingsSessiondPanel>("settings-sessiond-panel");
  if (!result) throw new Error("Missing sessiond panel");
  return result;
}
async function mount(context: AuthRequestTarget | undefined = target): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  dialog.machine = remoteMachine;
  dialog.namingModelsTarget = context;
  dialog.section = "sessiond";
  document.body.append(dialog);
  await settle(dialog);
  return dialog;
}

describe("project-scoped naming settings", () => {
  it("passes the captured authentication target and reloads naming models with daemon settings", async () => {
    const dialog = await mount();
    expect(configApi.namingModels).toHaveBeenCalledWith(target);
    expect(panel(dialog).namingModels).toEqual([{ provider: "provider", id: "naming" }]);
    vi.mocked(configApi.namingModels).mockClear().mockResolvedValue({ models: [] });
    await panel(dialog).onReload?.();
    await settle(dialog);
    expect(configApi.namingModels).toHaveBeenCalledExactlyOnceWith(target);
    expect(panel(dialog).namingModels).toEqual([]);
  });

  it.each([undefined, { machineId: "other", projectId: "project-a" }])("does not fall back to a global or mismatched model catalog (%j)", async (context) => {
    const dialog = await mount();
    vi.mocked(configApi.namingModels).mockClear();
    dialog.namingModelsTarget = context;
    await settle(dialog);
    expect(configApi.namingModels).not.toHaveBeenCalled();
    expect(panel(dialog).namingModels).toEqual([]);
    expect(panel(dialog).namingModelsError).toContain("Select a project");
    expect(panel(dialog).loading).toBe(false);
  });

  it("allows an explicit management target without guessing an ordinary project", async () => {
    const context = { machineId: remoteMachine.id };
    const dialog = await mount(context);
    expect(configApi.namingModels).toHaveBeenCalledWith(context);
    expect(panel(dialog).namingModelsError).toBe("");
  });

  it.each(["success", "failure"] as const)("rejects late catalog %s after project and machine ABA changes", async (outcome) => {
    const dialog = await mount();
    const stale = deferred<{ models: { provider: string; id: string }[] }>();
    vi.mocked(configApi.namingModels).mockReturnValueOnce(stale.promise).mockResolvedValue({ models: [{ provider: "current", id: "model" }] });
    const refresh = panel(dialog).onReload?.();
    await settle(dialog);
    dialog.namingModelsTarget = { ...target, projectId: "project-b" };
    dialog.machine = { ...remoteMachine };
    await settle(dialog);
    expect(configApi.namingModels).toHaveBeenLastCalledWith({ ...target, projectId: "project-b" });
    dialog.machine = secondRemoteMachine;
    dialog.namingModelsTarget = { machineId: secondRemoteMachine.id, projectId: "project-b" };
    await settle(dialog);
    dialog.machine = remoteMachine;
    dialog.namingModelsTarget = target;
    await settle(dialog);
    if (outcome === "success") stale.resolve({ models: [{ provider: "obsolete", id: "model" }] });
    else stale.reject(new Error("obsolete failure"));
    await refresh;
    await settle(dialog);
    expect(panel(dialog).namingModels).toEqual([{ provider: "current", id: "model" }]);
    expect(panel(dialog).namingModelsError).toBe("");
    expect(panel(dialog).namingModelsLoading).toBe(false);
  });

  it("keeps daemon configuration editable when the model catalog fails", async () => {
    vi.mocked(configApi.namingModels).mockRejectedValue(new Error("catalog offline"));
    const dialog = await mount();
    expect(panel(dialog).loading).toBe(false);
    expect(panel(dialog).error).toBe("");
    expect(panel(dialog).namingModelsError).toContain("catalog offline");
  });

  it("refuses a stale panel save callback after changing machines", async () => {
    const dialog = await mount();
    const save = panel(dialog).onSave;
    dialog.machine = secondRemoteMachine;
    dialog.namingModelsTarget = undefined;
    await settle(dialog);
    await save?.({ sessionNaming: { maxTokens: 48 } });
    expect(configApi.saveConfig).not.toHaveBeenCalled();
  });

  it.each([{ sessionNaming: { model: "provider/naming", maxTokens: 48 } }, { sessionNaming: {} }])("explains restart-free naming saves including resets (%j)", async (patch) => {
    const dialog = await mount();
    await panel(dialog).onSave?.(patch);
    await settle(dialog);
    expect(configApi.saveConfig).toHaveBeenLastCalledWith(patch, remoteMachine.id);
    expect(panel(dialog).savedMessage).toContain("without a restart");
    expect(panel(dialog).savedMessage).toContain("Existing names and in-progress naming requests are unchanged");
  });

  it("retains permission restart warnings when naming is saved in the same patch", async () => {
    const dialog = await mount();
    await panel(dialog).onSave?.({ askUser: true, sessionNaming: { timeoutMs: 30000 } });
    await settle(dialog);
    expect(panel(dialog).savedMessage).toContain("Restart the session daemon to apply agent permission changes");
    expect(panel(dialog).savedMessage).toContain("Naming changes apply to the next naming request without a restart");
  });
});
