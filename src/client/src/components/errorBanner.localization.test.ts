// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { render } from "lit";
import { localization } from "../localization/browser";
import { BrowserErrorReporter, browserErrorScopeKey, machineBrowserErrorScope } from "../browserErrors";
import { initialAppState } from "../appState";
import { AuthController } from "../controllers/authController";
import { errorBanner } from "./errorBanner";

const releases: (() => void)[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  for (const release of releases.splice(0)) release();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
});

it("translates whole dismiss labels and retry controls while preserving the diagnostic and callbacks", async () => {
  releases.push(localization.registerCatalog({ id: "banner-test", namespace: "core.banners", locale: "de", load: () => Promise.resolve({
    dismissError: "Fehler ausblenden", dismissWarning: "Warnung ausblenden", dismissInfo: "Hinweis ausblenden", retry: "Erneut versuchen",
  }) }));
  await localization.setPreferences({ language: "de", formatLocale: "en" });
  for (const [severity, label] of [["error", "Fehler ausblenden"], ["warning", "Warnung ausblenden"], ["info", "Hinweis ausblenden"]] as const) {
    const dismiss = vi.fn();
    const retry = vi.fn();
    render(errorBanner("Unchanged diagnostic", dismiss, severity, retry), document.body);
    expect(document.querySelector("[role='alert']")?.textContent).toContain("Unchanged diagnostic");
    const retryButton = document.querySelector<HTMLButtonElement>(".error-retry");
    const dismissButton = document.querySelector<HTMLButtonElement>(".error-dismiss");
    expect(retryButton?.textContent).toBe("Erneut versuchen");
    expect(dismissButton?.getAttribute("aria-label")).toBe(label);
    retryButton?.click();
    dismissButton?.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  }
});

it("retains localized authentication feedback until dismissal, following language changes without another auth request", async () => {
  let state = initialAppState();
  const setState = (patch: Partial<typeof state>): void => { state = { ...state, ...patch }; };
  const controller = new AuthController(() => state, setState, vi.fn(), { scope: "normal" });
  await controller.openMcpAuth("login");
  const scope = machineBrowserErrorScope("local");
  const error = state.browserErrors[browserErrorScopeKey(scope)];
  expect(error?.message).toBe("Select a session to authenticate MCP servers.");
  releases.push(localization.registerCatalog({ id: "auth-banner-test", namespace: "core.auth", locale: "de", load: () => Promise.resolve({
    selectSession: "Eine Sitzung auswählen.",
  }) }));
  await localization.setPreferences({ language: "de", formatLocale: "en" });
  expect(error?.displayMessage?.()).toBe("Eine Sitzung auswählen.");
  // The original fallback remains the dismissal identity, independent of locale.
  expect(state.browserErrors[browserErrorScopeKey(scope)]).toBe(error);
  const reporter = new BrowserErrorReporter(() => state, setState);
  reporter.clear(scope, error?.message);
  expect(state.browserErrors).toEqual({});
  controller.dispose();
});
