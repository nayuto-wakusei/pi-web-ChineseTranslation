import { afterEach, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { localization } from "../localization/browser";
import { localizedCommandResult } from "../commandResultMessages";
import { localizedChatText } from "../localizedChatPresentation";
import { parseCommandResult } from "../api/parsers";
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

it("retains validated command-result provenance in transcript parts and resolves it live", async () => {
  const presentation = { kind: "commandResult", feedback: { code: "named", name: "<raw name>" } } as const;
  const result = parseCommandResult({ type: "done", message: "Session named: <raw name>", presentation });
  const { controller, state } = setup(result);
  await controller.send("/name <raw name>");
  const part = state().messages.at(-1)?.parts[0];
  if (part?.type !== "text" || part.presentation === undefined) throw new Error("Missing command presentation");
  expect(part.text).toBe("Session named: <raw name>");
  for (const language of ["en", "en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(localizedChatText(part.presentation)).toBe(localizedCommandResult(presentation));
    expect(localizedChatText(part.presentation)).toContain("<raw name>");
    expect(state().messages.at(-1)?.parts[0]).toBe(part);
  }
});

it("updates an open fork select title without changing its request or user-authored options", async () => {
  const presentation = { kind: "commandResult", feedback: { code: "forkSelect" } } as const;
  const result = parseCommandResult({ type: "select", title: "Fork from message", requestId: "fork-request",
    options: [{ value: "raw-id", label: "Session forked" }], presentation });
  const { controller, state } = setup(result);
  await controller.send("/fork");
  const dialog = state().commandDialog;
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(state().commandDialog).toBe(dialog);
    expect(dialog?.title).toBe(localizedCommandResult(presentation));
    expect(dialog?.requestId).toBe("fork-request");
    expect(dialog?.options).toEqual([{ value: "raw-id", label: "Session forked" }]);
  }
});

it("keeps generated history guards live in session-owned banners", async () => {
  const presentation = { kind: "commandResult", feedback: { code: "treeActive" } } as const;
  const { controller, state } = setup({ type: "unsupported", message: "English wire fallback", presentation });
  await expect(controller.actOnMessage("raw-entry", "fork")).rejects.toThrow(localizedCommandResult(presentation));
  const notice = Object.values(state().browserErrors)[0];
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(notice?.displayMessage?.()).toBe(localizedCommandResult(presentation));
  }
});

it("does not translate legacy/runtime text without provenance", async () => {
  const { controller, state } = setup({ type: "unsupported", message: "Session forked" });
  await controller.send("/ext");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(state().messages.at(-1)?.parts).toEqual([{ type: "text", text: "Session forked" }]);
});
