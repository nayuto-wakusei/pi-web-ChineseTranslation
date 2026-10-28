// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { sessionsApi, type SessionCleanupRequest } from "../api";
import type { AppAction } from "../actions";
import { localization } from "../localization/browser";
import { sessionCleanupMessages as messages } from "../sessionCleanupMessages";
import { PiWebApp } from "./PiWebApp";
import { initialAppState } from "../appState";

afterEach(async () => {
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren(); localStorage.clear();
});
function createApp(): PiWebApp {
  vi.stubGlobal("window", { location: { search: "" }, localStorage });
  const app = new PiWebApp();
  Reflect.set(app, "state", { ...initialAppState(), machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now" } } });
  return app;
}
function cleanupMethod(app: PiWebApp, name: "previewSessionCleanup" | "runSessionCleanup"): (request: SessionCleanupRequest) => Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (!isCleanupMethod(method)) throw new Error(`Missing ${name}`);
  return (request) => method.call(app, request);
}
function isCleanupMethod(value: unknown): value is (request: SessionCleanupRequest) => Promise<void> { return typeof value === "function"; }
function cleanupError(app: PiWebApp): () => string {
  const dialog: unknown = Reflect.get(app, "sessionCleanupDialog");
  if (typeof dialog !== "object" || dialog === null || !("error" in dialog) || !isErrorMessage(dialog.error)) throw new Error("Missing live cleanup error");
  const error = dialog.error;
  return error;
}
function isErrorMessage(value: unknown): value is () => string { return typeof value === "function"; }

it("keeps preview failures live across locale changes without repeating the request", async () => {
  const app = createApp();
  const preview = vi.spyOn(sessionsApi, "cleanupPreview").mockRejectedValue(new Error("Raw backend <b>diagnostic</b>"));
  await cleanupMethod(app, "previewSessionCleanup")({ archiveIdleDays: 30, deleteArchivedDays: null });
  const error = cleanupError(app);
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "de-DE" });
    expect(error()).toBe(messages.t("previewFailed", { error: "Raw backend <b>diagnostic</b>" }));
    expect(preview).toHaveBeenCalledOnce();
  }
});

it("localizes stale-preview validation without executing cleanup", async () => {
  const app = createApp();
  const cleanup = vi.spyOn(sessionsApi, "cleanup");
  await cleanupMethod(app, "runSessionCleanup")({ archiveIdleDays: 30, deleteArchivedDays: null });
  const error = cleanupError(app);
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(error()).toBe(messages.t("previewRequired"));
  expect(cleanup).not.toHaveBeenCalled();
});

it("keeps execution errors and cleanup action metadata live", async () => {
  const app = createApp();
  const request = { archiveIdleDays: 30, deleteArchivedDays: null };
  Reflect.set(app, "sessionCleanupDialog", { preview: {}, previewRequest: request });
  const cleanup = vi.spyOn(sessionsApi, "cleanup").mockRejectedValue(new Error("Execution diagnostic"));
  await cleanupMethod(app, "runSessionCleanup")(request);
  const error = cleanupError(app);
  const method: unknown = Reflect.get(app, "sessionActions");
  if (!isActions(method)) throw new Error("Missing session actions");
  const action = method.call(app)[0];
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(error()).toBe(messages.t("runFailed", { error: "Execution diagnostic" }));
    expect(action?.title).toBe(messages.t("actionTitle"));
    expect(action?.description).toBe(messages.t("actionDescription"));
    expect(action?.group).toBe(messages.t("eyebrow"));
    expect(cleanup).toHaveBeenCalledOnce();
  }
});
function isActions(value: unknown): value is () => AppAction[] { return typeof value === "function"; }
