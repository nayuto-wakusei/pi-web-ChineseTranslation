import { afterEach, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { localization } from "../localization/browser";
import { HistoryActionError } from "../chatActionMessages";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession } from "./sessionController.testSupport";
import type { CommandResult } from "../api";

const controllers: SessionController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

function setup(result: CommandResult) {
  let state: AppState = { ...initialAppState(), selectedSession: oldSession };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined,
    undefined, { api: { ...defaultApi, runCommand: () => Promise.resolve(result) }, socket: new FakeSocket() });
  controllers.push(controller);
  return { controller, state: () => state };
}

it("retains a live localized history failure in the original session's banner", async () => {
  const { controller, state } = setup({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } });
  await expect(controller.actOnMessage("missing", "back")).rejects.toBeInstanceOf(HistoryActionError);
  const notice = Object.values(state().browserErrors)[0];
  expect(notice?.scope).toMatchObject({ kind: "session", machineId: "local", sessionId: oldSession.id });
  const identity = notice?.message;
  expect(identity).toContain("This message is no longer available in session history.");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(notice?.message).toBe(identity);
  expect(notice?.displayMessage?.()).not.toBe(identity);
  expect(notice?.displayMessage?.()).toContain("［");
});

it("localizes only the browser-owned fallback for a non-history response", async () => {
  const { controller, state } = setup({ type: "done" });
  await expect(controller.actOnMessage("missing", "back")).rejects.toThrow("Session history is unavailable.");
  const notice = Object.values(state().browserErrors)[0];
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  expect(notice?.displayMessage?.()).toContain("\u202e");
});

it("preserves runtime diagnostics verbatim even if they match a source message", async () => {
  const detail = "Session history is unavailable.";
  const { controller, state } = setup({ type: "unsupported", message: detail });
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await expect(controller.actOnMessage("missing", "fork")).rejects.toThrow(detail);
  const notice = Object.values(state().browserErrors)[0];
  expect(notice?.message).toBe(detail);
  expect(notice?.displayMessage).toBeUndefined();
});

it.each(["back", "fork"] as const)("localizes an absent tree for %s without changing history", async (action) => {
  const { controller } = setup({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } });
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  const result = action === "back" ? controller.navigateTree("missing", { mode: "none" }) : controller.forkFromTree("missing");
  await expect(result).rejects.toBeInstanceOf(HistoryActionError);
  await expect(result).rejects.not.toThrow("The session tree navigator is no longer available");
});
