import { afterEach, beforeEach, expect, it } from "vitest";
import { setClientTranslations } from "../../i18n";
import { localization } from "../../localization/browser";
import { piPackageMutationFollowUpMessage } from "./piPackageSettings";
import { loadGatewaySettingsData, loadPiPackagesData } from "./settingsDataLoading";
import { pluginLifecycleUnavailableMessage, settingsMachineTargetLabel } from "./settingsMachineTarget";
import { settingsFeedbackLifecycleUnavailable, settingsFeedbackPackageError, settingsFeedbackPackageFollowUp, settingsFeedbackSelectedError, settingsFeedbackTargetLabel } from "./settingsFeedback";

const raw = "raw <img> العربية {name}";
const remote = { id: "machine-id", name: raw, kind: "remote" } as const;
const local = { ...remote, kind: "local" } as const;
const releases: (() => void)[] = [];
beforeEach(() => { setClientTranslations("en", {}); });

afterEach(async () => {
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("preserves complete English feedback for each target and mutation action", () => {
  for (const target of [local, remote]) {
    expect(settingsFeedbackTargetLabel(target)).toBe(settingsMachineTargetLabel(target));
    expect(settingsFeedbackLifecycleUnavailable(target)).toBe(`Plugin lifecycle diagnostics are not available on ${target.name}. Update and restart PI WEB on that machine before loading server-backed plugins.`);
    for (const action of ["install", "remove", "update"] as const) {
      const verb = action === "install" ? "installed" : action === "remove" ? "removed" : "updated";
      const machine = target.kind === "remote" ? ` on ${target.name}` : "";
      const browserTarget = target.kind === "remote" ? ` served by ${target.name}` : "";
      expect(settingsFeedbackPackageFollowUp(action, target)).toBe(`Pi package ${verb}${machine}. Type /reload in each idle PI WEB session${machine} to refresh extensions, skills, prompts, and themes. Reload this browser tab for PI WEB browser plugin changes${browserTarget}. Server-plugin changes may also need a session daemon restart; restarting interrupts active sessions.`);
    }
  }
});

it("resolves current translations on every call without changing raw values", async () => {
  releases.push(localization.registerCatalog({
    id: "settings-feedback-test", namespace: "core.settingsFeedback", locale: "de",
    load: () => Promise.resolve({
      target: "{kind, select, local {Lokal: {name}} other {Fern: {name}}}",
      lifecycleUnavailable: "Diagnose fehlt: {name}",
      packageFollowUp: "{kind, select, local {Lokal} other {Fern {name}}}: {action, select, install {Installiert} remove {Entfernt} other {Aktualisiert}} {reload}",
    }),
  }));
  await localization.setPreferences({ language: "de", formatLocale: "en" });
  expect(settingsFeedbackTargetLabel(local)).toBe(`Lokal: ${raw}`);
  expect(settingsFeedbackTargetLabel(remote)).toBe(`Fern: ${raw}`);
  expect(settingsFeedbackLifecycleUnavailable(remote)).toBe(`Diagnose fehlt: ${raw}`);
  expect(settingsFeedbackPackageFollowUp("remove", remote)).toBe(`Fern ${raw}: Entfernt /reload`);
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(settingsFeedbackTargetLabel(remote)).toBe(`${raw} (remote machine)`);
});

it("pseudo-localizes authored feedback but never machine names, commands, or diagnostics", async () => {
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    for (const target of [local, remote]) {
      expect(settingsFeedbackTargetLabel(target)).toContain(raw);
      expect(settingsFeedbackTargetLabel(target)).not.toBe(settingsMachineTargetLabel(target));
      expect(settingsFeedbackLifecycleUnavailable(target)).toContain(raw);
      expect(settingsFeedbackLifecycleUnavailable(target)).not.toBe(pluginLifecycleUnavailableMessage(target));
      for (const action of ["install", "remove", "update"] as const) {
        const feedback = settingsFeedbackPackageFollowUp(action, target);
        expect(feedback).toContain("/reload");
        expect(feedback).not.toBe(piPackageMutationFollowUpMessage(action, target));
        if (target.kind === "remote") expect(feedback).toContain(raw);
      }
      for (const diagnostic of [raw, "Remote machine timeout", "Remote machine unavailable", ""]) {
        expect(settingsFeedbackSelectedError(`  ${diagnostic}  `, target)).toBe(diagnostic);
        expect(settingsFeedbackPackageError(`  ${diagnostic}  `, target)).toBe(diagnostic);
      }
    }
  }
});

it("retains raw config and plugin failure provenance alongside compatible English errors", async () => {
  const result = await loadGatewaySettingsData({
    loadConfig: () => Promise.reject(new Error(`  ${raw}  `)),
    loadPlugins: () => Promise.reject(new Error("Remote machine unavailable")),
  });
  expect(result.failure).toEqual({ config: `  ${raw}  `, plugins: "Remote machine unavailable" });
  expect(result.error).toBe(`Failed to load settings: config:   ${raw}  ；PI WEB plugins: Remote machine unavailable`);
  const partial = await loadGatewaySettingsData({
    loadConfig: () => Promise.reject(new Error("")),
    loadPlugins: () => Promise.reject(new Error("plugins")),
  });
  expect(partial.failure).toEqual({ config: "", plugins: "plugins" });
});

it("retains the raw package diagnostic rather than its English-friendly presentation", async () => {
  const result = await loadPiPackagesData(remote, () => Promise.reject(new Error("  Remote machine unavailable  ")));
  expect(result.failure).toBe("  Remote machine unavailable  ");
  expect(result.error).toContain(`Unable to connect to ${raw} for Pi package management.`);
});
