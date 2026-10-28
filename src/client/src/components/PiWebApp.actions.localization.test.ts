// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, expect, it, vi } from "vitest";
import type { AppAction } from "../actions";
import { localization } from "../localization/browser";
import { initialAppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import { ActionPalette } from "./ActionPalette";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en-US" });
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const actionIds = [
  "core:workspace.refresh-current",
  "app.navigation.open", "app.navigation.focus-machines", "app.navigation.focus-projects",
  "app.navigation.focus-workspaces", "app.navigation.focus-sessions",
  "app.layout.reset-navigation-panel-size", "app.layout.reset-workspace-panel-size", "app.layout.reset-panel-sizes",
];

function appActions(app: PiWebApp): AppAction[] {
  const getActions: unknown = Reflect.get(app, "getActions");
  if (!isActionProvider(getActions)) throw new Error("Missing action provider");
  const actions = getActions.call(app);
  return actions.filter(({ id }) => actionIds.includes(id));
}

function isActionProvider(value: unknown): value is (this: PiWebApp) => AppAction[] {
  return typeof value === "function";
}

it("localizes all retained app action metadata through both pseudo modes and shortcut overrides", async () => {
  const app = new PiWebApp();
  Reflect.set(app, "shortcutConfig", { "app.navigation.focus-machines": "mod+j", "app.navigation.focus-projects": null });
  const actions = appActions(app);
  expect(actions.map(({ id }) => id)).toEqual(actionIds);
  expect(actions.find(({ id }) => id === "core:workspace.refresh-current")?.enabled).toBe(false);
  expect(actions.find(({ id }) => id === "app.navigation.focus-machines")?.shortcut).toBe("mod+j");
  expect(actions.find(({ id }) => id === "app.navigation.focus-projects")?.shortcut).toBeUndefined();
  const english = actions.map(({ title, description, group }) => ({ title, description, group }));
  const policy = actions.map(({ id, shortcut, enabled, run }) => ({ id, shortcut, enabled, run }));
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "de-DE" });
    actions.forEach((action, index) => {
      expect(action.title).not.toBe(english[index]?.title);
      expect(action.group).not.toBe(english[index]?.group);
      if (action.description !== undefined) expect(action.description).not.toBe(english[index]?.description);
    });
    expect(actions.map(({ id, shortcut, enabled, run }) => ({ id, shortcut, enabled, run }))).toEqual(policy);
  }
  await localization.setPreferences({ language: "en", formatLocale: "ar-EG" });
  expect(actions.map(({ title, description, group }) => ({ title, description, group }))).toEqual(english);
});

it("updates an open action palette and its search without executing commands or losing focus", async () => {
  const app = new PiWebApp();
  Reflect.set(app, "state", { ...initialAppState(), selectedWorkspace: { id: "user-ws", projectId: "user-project", label: "User workspace", path: "/user/repo", isMain: true, effectiveConfig: {} } });
  const refresh = vi.fn(() => Promise.resolve());
  Reflect.set(app, "refreshCurrentWorkspaceSurface", refresh);
  const palette = new ActionPalette();
  palette.actions = appActions(app);
  palette.onRun = (action) => { void action.run(); };
  document.body.append(palette);
  await settleRenderedDialog(palette);
  const input = requiredElement(palette.shadowRoot?.querySelector("input"), "action search");
  input.value = "Aktualisieren";
  input.dispatchEvent(new Event("input"));
  input.focus();
  await settleRenderedDialog(palette);
  expect(palette.shadowRoot?.querySelector(".empty")).not.toBeNull();
  release = localization.registerCatalog({ id: "app-actions-test", namespace: "core.appActions", locale: "de", load: () => Promise.resolve({ refreshTitle: "Aktualisieren des Panels", groupWorkspace: "Arbeitsbereich" }) });
  await localization.setPreferences({ language: "de", formatLocale: "en-US" });
  await settleRenderedDialog(palette);
  expect(input.value).toBe("Aktualisieren");
  expect(deepActiveElement()).toBe(input);
  expect(palette.shadowRoot?.querySelector("strong")?.textContent).toBe("Aktualisieren des Panels");
  expect(palette.shadowRoot?.querySelector(".group")?.textContent).toBe("Arbeitsbereich");
  expect(refresh).not.toHaveBeenCalled();
  pressKey(input, "Enter");
  expect(refresh).toHaveBeenCalledOnce();
});
