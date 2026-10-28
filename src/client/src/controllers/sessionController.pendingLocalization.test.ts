import { afterEach, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { localization } from "../localization/browser";
import { SessionController, type SessionControllerDependencies } from "./sessionController";
import { pendingSessionMessages as messages } from "./pendingSessionMessages";
import { emptyTranscriptApi, deferred, FakeSocket, oldSession, workspace, type SessionInfo } from "./sessionController.testSupport";

const controllers: SessionController[] = [];
afterEach(async () => {
  controllers.splice(0).forEach((controller) => { controller.dispose(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

function setup(overrides: Partial<typeof emptyTranscriptApi> = {}, navigation: Pick<SessionControllerDependencies, "navigateToSession"> = {}) {
  const request = deferred<SessionInfo>();
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined,
    undefined, { api: { ...emptyTranscriptApi, startSession: () => request.promise, ...overrides }, socket: new FakeSocket(), ...navigation });
  controllers.push(controller);
  return { controller, request, state: () => state, patch: (patch: Partial<AppState>) => { state = { ...state, ...patch }; } };
}

it("keeps retained pending activity, attachment previews and failed-start guidance live without translating values", async () => {
  const test = setup();
  const start = test.controller.startSession();
  const session = test.state().selectedSession;
  const waiting = test.state().activity;
  expect(session?.name).toBe("New session");
  expect(waiting?.detail).toBe("Waiting for the backend session to be ready");
  const raw = "Raw <tag> العربية";
  const names = ["one.png", "two.png", "three.png", "four.png"];
  await test.controller.send(raw, undefined, names.map((name) => ({ kind: "image", mimeType: "image/png", data: "QUJD", name })));
  const preview = Object.values(test.state().clientQueuedSessionMessages)[0]?.[0];
  expect(preview?.text).toBe(`${raw}\n\n[4 attachments queued: one.png, two.png, three.png, +1 more]`);
  const queuedActivity = test.state().activity;
  expect(queuedActivity?.detail).toBe("1 queued message will send when the backend session is ready");
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "de" });
    expect(session?.name).toBe(messages.t("newSession"));
    expect(waiting?.detail).toBe(messages.t("waiting"));
    expect(queuedActivity?.detail).toBe(messages.t("queued", { count: 1 }));
    expect(preview?.text).toContain(raw);
    expect(preview?.text).toContain("one.png, two.png, three.png");
    expect(preview?.text).not.toContain("four.png");
  }
  await test.controller.send("second raw prompt");
  expect(test.state().activity?.detail).toBe(messages.t("queued", { count: 2 }));
  const diagnostic = "backend <diagnostic> العربية";
  test.request.reject(new Error(diagnostic));
  await start;
  const failed = test.state().activity;
  const notice = Object.values(test.state().browserErrors)[0];
  expect(failed?.detail).toBe(messages.t("failedDetail", { detail: diagnostic, count: 2 }));
  expect(notice?.displayMessage?.()).toBe(messages.t("startFailure", { detail: diagnostic }));
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(failed?.label).toBe("Session creation failed");
  expect(failed?.detail).toBe(`${diagnostic} · 2 queued messages kept below`);
  expect(notice?.displayMessage?.()).toBe(`Failed to start session: ${diagnostic}`);
  await test.controller.send("retain this");
  const guidance = Object.values(test.state().browserErrors).find((entry) => entry.message.includes("Copy your message"));
  expect(guidance).toBeDefined();
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(guidance?.displayMessage?.()).toBe(messages.t("queueUnavailable"));
});

it("keeps queued payloads raw on successful startup and localizes input-required command guidance", async () => {
  const sent: string[] = [];
  const test = setup({
    prompt: (_session, text) => { sent.push(text); return Promise.resolve({ accepted: true }); },
    runCommand: () => Promise.resolve({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } }),
  });
  const start = test.controller.startSession();
  await test.controller.send("raw prompt");
  await test.controller.runCommand("/tree");
  test.patch({ selectedWorkspace: { ...workspace, id: "other" }, selectedSession: undefined, sessions: [] });
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  test.request.resolve(oldSession);
  await start;
  expect(sent).toEqual(["raw prompt"]);
  const guidance = Object.values(test.state().browserErrors)[0];
  expect(guidance?.displayMessage?.()).toBe(messages.t("commandInput", { command: "/tree" }));
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(guidance?.displayMessage?.()).toBe("Queued command “/tree” needs input; open the session and run it again.");
});

it.each(["changed", "failed"] as const)("retains live recovery guidance when post-start navigation is %s", async (outcome) => {
  const test = setup({}, { navigateToSession: () => outcome === "changed" ? Promise.resolve(false) : Promise.reject(new Error("raw navigation failure")) });
  const start = test.controller.startSession({ updateUrl: false });
  test.request.resolve(oldSession);
  await start;
  const notice = Object.values(test.state().browserErrors)[0];
  expect(notice?.scope).toMatchObject({ kind: "workspace", workspaceId: workspace.id });
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(notice?.displayMessage?.()).toBe(outcome === "changed" ? messages.t("navigationChanged") : messages.t("selectionFailure", { detail: "raw navigation failure" }));
});

it("retains localized late-start failures at the originating workspace", async () => {
  const test = setup();
  const start = test.controller.startSession();
  test.patch({ selectedWorkspace: { ...workspace, id: "other" }, selectedSession: undefined, sessions: [] });
  test.request.reject(new Error("raw failure"));
  await start;
  const notice = Object.values(test.state().browserErrors)[0];
  expect(notice?.scope).toMatchObject({ kind: "workspace", workspaceId: workspace.id });
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en" });
  expect(notice?.displayMessage?.()).toBe(messages.t("startFailure", { detail: "raw failure" }));
});
