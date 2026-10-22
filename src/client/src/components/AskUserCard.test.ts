// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserOutcome, AskUserQuestion, AskUserRequest } from "../../../shared/apiTypes";
import { saveAskDraft } from "../askDrafts";
import { AskUserCard, type AskUserSubmitCallback } from "./AskUserCard";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("ask-user-card live form", () => {
  it("uses native labelled groups and updates progress for a keyboard-focusable single select", async () => {
    const card = await mountOpenAsk(openAsk([
      question("editor", "Choose an editor", [option("vim", "Vim", "Fast\n  and familiar."), option("code", "VS Code")], { detail: "Used for examples.\n  Keep the indentation." }),
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]));
    const root = renderRoot(card);
    expect(card).toBeInstanceOf(HTMLElement);
    expect(customElements.get("ask-user-card")).toBe(AskUserCard);
    const fieldsets = root.querySelectorAll("fieldset");
    const legends = root.querySelectorAll("legend");
    const vim = inputWithValue(root, "vim");
    const code = inputWithValue(root, "code");
    const web = inputWithValue(root, "web");

    expect(fieldsets).toHaveLength(2);
    expect(legends[0]?.textContent).toContain("Choose an editor");
    expect(fieldsets[0]?.getAttribute("aria-describedby")).toBe("ask-user-question-detail-0");
    expect(root.querySelector("#ask-user-question-detail-0")?.textContent).toBe("Used for examples.\n  Keep the indentation.");
    // happy-dom does not compute styles inside cascade layers.
    expect(AskUserCard.styles.cssText).toMatch(/\.question-detail\s*\{[^}]*white-space:\s*pre-wrap/);
    const optionDetail = requiredElement(root.querySelector(".option-detail"), "option detail");
    expect(optionDetail.textContent).toBe("Fast\n  and familiar.");
    expect(AskUserCard.styles.cssText).toMatch(/\.option-detail\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(vim.type).toBe("radio");
    expect(code.name).toBe(vim.name);
    expect(web.type).toBe("checkbox");
    expect(web.name).not.toBe(vim.name);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("已回答 0/2");

    // Focus and interaction run through the rendered native control rather than
    // extracting Lit handlers, so this exercises the form's browser boundary.
    vim.focus();
    expect(root.activeElement).toBe(vim);
    vim.click();
    await card.updateComplete;

    expect(vim.checked).toBe(true);
    expect(code.checked).toBe(false);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("已回答 1/2");
  });

  it("accumulates several checkbox values for a multi-select question", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "web").click();
    inputWithValue(root, "desktop").click();
    await card.updateComplete;

    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("已回答 1/1");
    buttonWithText(root, "发送回答").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "platforms", values: ["web", "desktop"] }],
    });
  });

  it("always offers and focuses a labelled custom field while preserving multi-select options", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("stack", "Pick the stack", [option("lit", "Lit"), option("react", "React")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "lit").click();
    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;
    await Promise.resolve();

    const textarea = requiredElement(root.querySelector("textarea"), "custom textarea");
    const label = requiredElement(textarea.closest("label"), "custom label");
    expect(label.textContent).toContain("自定义回答");
    expect(getComputedStyle(textarea).fontSize).toBe("16px");
    expect(root.activeElement).toBe(textarea);

    textarea.value = "Svelte";
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;
    buttonWithText(root, "发送回答").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "stack", values: ["lit"], otherText: "Svelte" }],
    });
  });

  it("shows and submits the custom field directly when no options were supplied", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("notes", "Anything else?", []),
    ]), onSubmit);
    const root = renderRoot(card);
    const textarea = requiredElement(root.querySelector("textarea"), "custom textarea");

    expect(root.querySelector("input")).toBeNull();
    expect(requiredElement(textarea.closest("label"), "custom label").textContent).toContain("自定义回答");
    textarea.value = "Keep the first version small.";
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;
    buttonWithText(root, "发送回答").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "notes", values: [], otherText: "Keep the first version small." }],
    });
  });

  it("skips all questions explicitly without sending retained draft values", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([question("editor", "Choose an editor", [option("vim", "Vim")])]), onSubmit);
    inputWithValue(renderRoot(card), "vim").click();
    await card.updateComplete;
    buttonWithText(renderRoot(card), "跳过问题").click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith("ask-1", { answers: [] });
    card.open = false;
    await card.updateComplete;
    expect(renderRoot(card).textContent).toContain("草稿回答 · 未发送");
    expect(renderRoot(card).textContent).toContain("Vim");
  });

  it("names unanswered questions before allowing a partial submit", async () => {
    const onSubmit = vi.fn<AskUserSubmitCallback>();
    const card = await mountOpenAsk(openAsk([
      question("editor", "Choose an editor", [option("vim", "Vim")]),
      question("deploy", "Choose a deployment target", [option("cloud", "Cloud")]),
      question("notes", "Add implementation notes", []),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "vim").click();
    await card.updateComplete;
    buttonWithText(root, "发送回答").click();
    await card.updateComplete;
    await Promise.resolve();

    const confirmation = requiredElement(root.querySelector("[aria-label='确认部分回答']"), "partial confirmation");
    expect(confirmation.textContent).toContain("以下问题尚未回答：");
    expect(confirmation.textContent).toContain("Choose a deployment target");
    expect(confirmation.textContent).toContain("Add implementation notes");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(buttonWithText(root, "仍然发送"));

    buttonWithText(root, "仍然发送").click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith("ask-1", {
      answers: [{ id: "editor", values: ["vim"] }],
    });
  });
});

describe("ask-user-card closed request", () => {
  it("is collapsed and retains every original option and supporting detail without answer controls", async () => {
    const card = new AskUserCard();
    card.ask = openAsk([question("editor", "Choose an editor", [
      { value: "vim", label: "Vim", detail: "Modal editing" },
      { value: "code", label: "VS Code", detail: "Graphical editor" },
    ], { detail: "Used for examples." })]);
    document.body.append(card);
    await card.updateComplete;
    const root = renderRoot(card);
    const disclosure = requiredElement(root.querySelector("details"), "closed question disclosure");
    expect(disclosure.open).toBe(false);
    requiredElement(disclosure.querySelector("summary"), "question summary").click();
    expect(disclosure.open).toBe(true);
    expect(root.textContent).toContain("Used for examples.");
    expect(root.textContent).toContain("Vim");
    expect(root.textContent).toContain("Modal editing");
    expect(root.textContent).toContain("VS Code");
    expect(root.textContent).toContain("Graphical editor");
    expect(root.textContent).toContain("未回答");
    expect(root.querySelector("input, textarea, button, select")).toBeNull();
  });

  it("restores drafts when the same question is remounted and never makes archived cards writable", async () => {
    const ask = openAsk([question("notes", "Anything else?", [])]);
    const card = await mountOpenAsk(ask);
    const textarea = requiredElement(renderRoot(card).querySelector("textarea"), "draft textarea");
    textarea.value = "Keep this draft";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await card.updateComplete;
    card.remove();
    const restored = await mountOpenAsk(ask);
    expect(renderRoot(restored).querySelector("textarea")?.value).toBe("Keep this draft");
    restored.onSubmit = undefined;
    await restored.updateComplete;
    expect(renderRoot(restored).querySelector("textarea, input, button")).toBeNull();
    expect(renderRoot(restored).textContent).toContain("Keep this draft");
    expect(renderRoot(restored).textContent).toContain("草稿回答 · 未发送");
  });
});

describe("ask-user-card record mode", () => {
  it("renders a fully answered outcome summary in Chinese", async () => {
    const outcome: AskUserOutcome = {
      askId: "ask-complete",
      reason: "submitted",
      askedAt: "2026-07-20T10:00:00.000Z",
      closedAt: "2026-07-20T10:05:00.000Z",
      questions: [{
        question: question("speed", "Preferred pace", [option("fast", "Fast")]),
        answered: true,
        values: ["fast"],
      }],
      answeredCount: 1,
      unansweredIds: [],
      summary: "Answered 1 of 1; none left unanswered",
    };
    const card = new AskUserCard();
    card.outcome = outcome;
    document.body.append(card);
    await card.updateComplete;
    const text = renderRoot(card).textContent;

    expect(text).toContain("已回答 1/1 个问题；全部问题均已回答");
    expect(text).not.toContain("Answered 1 of 1");
  });

  it("has no answer controls and displays draft answers retained for a superseded ask", async () => {
    const draftSessionId = "remote-a:session-1";
    saveAskDraft(draftSessionId, "ask-old", {
      speed: { values: ["fast"] },
      rationale: { values: [], otherText: "It keeps the feedback loop short." },
    });
    const outcome: AskUserOutcome = {
      askId: "ask-old",
      reason: "superseded",
      askedAt: "2026-07-20T10:00:00.000Z",
      closedAt: "2026-07-20T10:05:00.000Z",
      questions: [
        unansweredRecord(question("speed", "Preferred pace", [option("fast", "Fast"), option("careful", "Careful")])),
        unansweredRecord(question("rationale", "Why?", [])),
        unansweredRecord(question("region", "Deployment region", [option("eu", "Europe")])),
      ],
      answeredCount: 0,
      unansweredIds: ["speed", "rationale", "region"],
      summary: "Answered 0 of 3; unanswered: speed, rationale, region",
    };
    const card = new AskUserCard();
    card.draftSessionId = draftSessionId;
    card.outcome = outcome;
    document.body.append(card);
    await card.updateComplete;
    const root = renderRoot(card);

    expect(root.querySelector("input, textarea, button, select")).toBeNull();
    expect(root.textContent).toContain("已被替代");
    expect(root.textContent).toContain("Fast");
    expect(root.textContent).toContain("It keeps the feedback loop short.");
    expect(root.textContent).toContain("草稿回答 · 未发送");
    expect(root.textContent).toContain("Deployment region");
    expect(root.textContent).toContain("未回答");
  });
});

async function mountOpenAsk(ask: AskUserRequest, onSubmit: AskUserSubmitCallback = vi.fn<AskUserSubmitCallback>()): Promise<AskUserCard> {
  const card = new AskUserCard();
  card.ask = ask;
  card.open = true;
  card.draftSessionId = "local:session-1";
  card.onSubmit = onSubmit;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function renderRoot(card: AskUserCard): ShadowRoot {
  return requiredElement(card.shadowRoot, "ask-user-card shadow root");
}

function inputWithValue(root: ShadowRoot, value: string): HTMLInputElement {
  const input = [...root.querySelectorAll("input")].find((candidate) => candidate.value === value);
  return requiredElement(input, `input with value ${value}`);
}

function buttonWithText(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(button, `button named ${text}`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function openAsk(questions: AskUserQuestion[]): AskUserRequest {
  return { askId: "ask-1", askedAt: "2026-07-20T10:00:00.000Z", questions };
}

function question(
  id: string,
  text: string,
  options: AskUserQuestion["options"],
  settings: { detail?: string; multiple?: boolean } = {},
): AskUserQuestion {
  return {
    id,
    question: text,
    options,
    ...(settings.detail === undefined ? {} : { detail: settings.detail }),
    ...(settings.multiple === undefined ? {} : { multiple: settings.multiple }),
  };
}

function option(value: string, label: string, detail?: string): AskUserQuestion["options"][number] {
  return { value, label, ...(detail === undefined ? {} : { detail }) };
}

function unansweredRecord(questionValue: AskUserQuestion): AskUserOutcome["questions"][number] {
  return { question: questionValue, answered: false, values: [] };
}
