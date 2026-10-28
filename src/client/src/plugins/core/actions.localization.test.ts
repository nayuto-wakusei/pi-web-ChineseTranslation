import { afterEach, expect, it } from "vitest";
import { localization } from "../../localization/browser";
import { applyActiveShortcutPreferences } from "../../shortcutPreferences";
import { createCoreActions } from "./actions";
import { snapshotDisplayMetadata } from "../displayMetadata";
import { coreActionMessages as m } from "./messages";

const releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en-US" });
});

it("localizes every core command's presentation without changing identifiers, shortcuts or invocation policy", async () => {
  const actions = createCoreActions();
  const english = actions.map(({ title, description, group }) => ({ title, description, group }));
  const configuration = actions.map(({ id, shortcut, enabled, run }) => ({ id, shortcut, enabled, run }));
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    actions.forEach((action, index) => {
      expect(action.title).not.toBe(english[index]?.title);
      expect(action.group).not.toBe(english[index]?.group);
      if (action.description !== undefined) expect(action.description).not.toBe(english[index]?.description);
    });
    expect(actions.map(({ id, shortcut, enabled, run }) => ({ id, shortcut, enabled, run }))).toEqual(configuration);
    expect(actions.find(({ id }) => id === "auth.login")?.description).toContain("/login");
    expect(actions.find(({ id }) => id === "auth.logout")?.description).toContain("/logout");
    expect(actions.find(({ id }) => id === "session.reload")?.description).toContain("/reload");
  }
  await localization.setPreferences({ language: "en", formatLocale: "de-DE" });
  expect(actions.map(({ title, description, group }) => ({ title, description, group }))).toEqual(english);
});

it("keeps retained shortcut projections live and source commands unchanged", async () => {
  releases.push(localization.registerCatalog({ id: "core-actions-test", namespace: "core.actions", locale: "de", load: () => Promise.resolve({ actions_show_title: "Aktionen anzeigen", actions_show_description: "Befehle öffnen", groupGeneral: "Allgemein" }) }));
  const source = createCoreActions()[0];
  if (source === undefined) throw new Error("Missing core action");
  const qualified = snapshotDisplayMetadata(source, {
    id: "core:actions.show", title: source.title, description: source.description ?? "", group: source.group ?? "",
    shortcut: source.shortcut ?? "", run: () => undefined,
  });
  const [action] = applyActiveShortcutPreferences([qualified], { "core:actions.show": "mod+j" });
  await localization.setPreferences({ language: "de", formatLocale: "en-US" });
  expect(action).toMatchObject({ title: "Aktionen anzeigen", description: "Befehle öffnen", group: "Allgemein", shortcut: "mod+j", id: "core:actions.show" });
  expect(source.shortcut).toBe("mod+k");
  expect(m.t("auth_login_description", { command: "/login" })).toContain("/login");
  expect(m.t("session_reload_description", { command: "/reload" })).toContain("/reload");
});
