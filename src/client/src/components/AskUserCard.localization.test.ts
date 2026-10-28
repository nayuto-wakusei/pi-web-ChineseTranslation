// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { AskUserOutcome, AskUserRequest } from "../../../shared/apiTypes";
import { localization } from "../localization/browser";
import { loadAskDraft } from "../askDrafts";
import { AskUserCard, askUserMessages as messages, askUserOutcomeSummary } from "./AskUserCard";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  localStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});
const raw = "Raw <img> العربية";
const ask: AskUserRequest = { askId: "ask", askedAt: "2026-07-01T12:00:00Z", questions: [
  { id: "choice", question: raw, detail: raw, options: [{ value: "yes", label: raw, detail: raw }], multiple: true },
  { id: "text", question: "Free text?", options: [] },
] };
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected question-card element");
  return value;
}
async function mount(): Promise<AskUserCard> {
  const card = new AskUserCard();
  card.ask = ask;
  card.open = true;
  card.draftSessionId = "machine:session";
  card.onSubmit = vi.fn();
  document.body.append(card);
  await card.updateComplete;
  return card;
}
async function language(card: AskUserCard, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG" });
  await card.updateComplete;
}
function outcome(reason: AskUserOutcome["reason"] = "submitted"): AskUserOutcome {
  return { askId: ask.askId, reason, askedAt: ask.askedAt, closedAt: ask.askedAt,
    questions: ask.questions.map((question, index) => ({ question, answered: index === 0, values: index === 0 ? ["yes"] : [], ...(index === 0 ? { comment: raw } : {}) })),
    answeredCount: 1, unansweredIds: ["text"], summary: "MODEL-ONLY SUMMARY, never translate or display by English matching" };
}
it("keeps selected choices, comment drafts, custom text, focus and submission identity across live catalog/pseudo changes", async () => {
  release = localization.registerCatalog({ id: "ask-test", namespace: "core.askUser", locale: "de", load: () => Promise.resolve({ questions: "Fragen", send: "Antworten senden", comment: "Kommentar" }) });
  const card = await mount();
  const root = required(card.shadowRoot);
  const choice = required(root.querySelector<HTMLInputElement>('input[value="yes"]'));
  choice.click(); await card.updateComplete;
  required(root.querySelector<HTMLButtonElement>(".add-comment")).click(); await card.updateComplete;
  const comment = required(root.querySelector<HTMLTextAreaElement>("#ask-user-comment-0"));
  comment.value = raw; comment.dispatchEvent(new Event("input"));
  const custom = required(root.querySelector<HTMLTextAreaElement>("#ask-user-other-1"));
  custom.value = raw; custom.dispatchEvent(new Event("input")); await card.updateComplete;
  comment.focus();
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(card, locale);
    expect(root.querySelector("#ask-user-comment-0")).toBe(comment);
    expect(root.querySelector("#ask-user-other-1")).toBe(custom);
    expect(root.activeElement).toBe(comment);
    expect(comment.value).toBe(raw); expect(custom.value).toBe(raw); expect(choice.checked).toBe(true);
    expect(root.querySelector("h2")?.textContent).toBe(messages.t("questions"));
    expect(root.querySelector("legend > span:last-child")?.textContent).toBe(raw);
    expect(root.querySelector(".option-label")?.textContent).toBe(raw);
    expect(root.querySelector("legend > span:last-child")?.getAttribute("dir")).toBe("auto");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".header-status")?.textContent.trim()).toBe(messages.t("progress", { answered: 2, total: 2 }));
    expect(root.querySelector(".question-number")?.textContent).toBe(messages.t("questionNumber", { number: 1 }));
    expect(card.onSubmit).not.toHaveBeenCalled();
  }
  expect(loadAskDraft("machine:session", ask.askId)).toMatchObject({ choice: { values: ["yes"], comment: raw }, text: { otherText: raw } });
  required(root.querySelector<HTMLButtonElement>("button[type=submit]")).click();
  await Promise.resolve();
  expect(card.onSubmit).toHaveBeenCalledExactlyOnceWith("ask", { answers: [{ id: "choice", values: ["yes"], comment: raw }, { id: "text", values: [], otherText: raw }] });
});
it("retains partial confirmation and focus across locale changes, with functional question links and edit recovery", async () => {
  const card = await mount(); const root = required(card.shadowRoot);
  required(root.querySelector<HTMLButtonElement>("button[type=submit]")).click(); await card.updateComplete;
  const send = required(root.querySelector<HTMLButtonElement>(".send-anyway"));
  expect(root.activeElement).toBe(send);
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(card, locale);
    expect(root.activeElement).toBe(send);
    expect(root.querySelector(".partial-confirmation")?.getAttribute("aria-label")).toBe(messages.t("confirmPartial"));
    expect(root.querySelector(".partial-prompt p")?.textContent).toBe(messages.t("partialPrompt"));
    expect(root.querySelectorAll(".question-jump")).toHaveLength(2);
    expect(root.querySelector(".question-jump")?.textContent).toBe(raw);
  }
  required(root.querySelector<HTMLButtonElement>(".question-jump")).click(); await card.updateComplete; await Promise.resolve();
  expect(root.activeElement).toBe(root.querySelector("input"));
  required(root.querySelector<HTMLButtonElement>(".confirmation-actions button")).click(); await card.updateComplete;
  expect(root.querySelector(".partial-confirmation")).toBeNull();
  expect(card.onSubmit).not.toHaveBeenCalled();
});
it("retains a pending submission without retransmitting on locale changes and recovers with its drafts after rejection", async () => {
  const card = await mount(); const root = required(card.shadowRoot);
  let reject: ((reason: Error) => void) | undefined;
  const submit = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
  card.onSubmit = submit;
  required(root.querySelector<HTMLButtonElement>(".skip-questions")).click(); await Promise.resolve(); await card.updateComplete;
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(card, locale);
    expect([...root.querySelectorAll<HTMLButtonElement>(".form-footer button")].every((button) => button.disabled)).toBe(true);
    expect(root.querySelector("button[type=submit]")?.textContent.trim()).toBe(messages.t("sending"));
    expect(submit).toHaveBeenCalledExactlyOnceWith("ask", { answers: [] });
  }
  required(reject)(new Error("Raw transport diagnostic"));
  await new Promise((resolve) => { setTimeout(resolve, 0); }); await card.updateComplete;
  expect(required(root.querySelector<HTMLButtonElement>("button[type=submit]")).disabled).toBe(false);
});
it("localizes historical status and structured summaries, retaining raw options/answers and disclosure state", async () => {
  const card = await mount(); const root = required(card.shadowRoot);
  card.open = false; card.outcomes = [outcome()]; await card.updateComplete;
  const details = required(root.querySelector("details")); details.open = true;
  for (const locale of ["en", "en-XA", "ar-XB"]) {
    await language(card, locale);
    expect(details.open).toBe(true); expect(root.querySelector("details")).toBe(details);
    expect(root.querySelector(".header-status")?.textContent).toBe(messages.t("closed", { total: 2 }));
    expect(root.querySelector(".record-summary")?.textContent).toBe(askUserOutcomeSummary(outcome()));
    expect(root.textContent).toContain(raw); expect(root.textContent).not.toContain("MODEL-ONLY");
    expect(root.querySelector("img")).toBeNull(); expect(root.querySelector("input,textarea,button")).toBeNull();
  }
  for (const reason of ["submitted", "cancelled", "superseded"] as const) {
    card.outcome = outcome(reason); await card.updateComplete;
    for (const locale of ["en", "en-XA", "ar-XB"]) {
      await language(card, locale);
      expect(root.querySelector(".header-status")?.textContent).toBe(messages.t(reason === "submitted" ? "sent" : reason));
      expect(root.querySelector(".record-summary")?.textContent.trim()).toBe(reason === "superseded" ? messages.t("supersededSummary") : askUserOutcomeSummary(required(card.outcome)));
      expect(root.textContent).toContain(raw); expect(root.querySelector("img")).toBeNull();
    }
  }
  card.compact = true; card.outcome = { ...outcome(), answeredCount: 0 }; await card.updateComplete;
  expect(root.querySelector("h2")?.textContent).toBe(messages.t("answers"));
  expect(root.querySelector(".header-status")?.textContent).toBe(messages.t("skipped"));
  const complete = { ...outcome(), answeredCount: 2, unansweredIds: [] };
  expect(askUserOutcomeSummary(complete)).toBe(messages.t("completeSummary", { answered: 2, total: 2 }));
  expect(askUserOutcomeSummary({ ...outcome(), unansweredIds: ["first", "second", "third"] })).toContain(new Intl.ListFormat("ar-EG").format(["first", "second", "third"]));
});
