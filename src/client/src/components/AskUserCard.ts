import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n.js";
import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  ASK_USER_OTHER_TEXT_MAX_LENGTH,
  type AskUserOutcome,
  type AskUserQuestion,
  type AskUserQuestionRecord,
  type AskUserSubmission,
  type AskUserRequest,
} from "../../../shared/apiTypes";
import {
  answeredCount,
  loadAskDraft,
  saveAskDraft,
  toSubmission,
  unansweredQuestions,
  type AskDraftAnswer,
  type AskDraftAnswers,
} from "../askDrafts";

export type AskUserSubmitCallback = (askId: string, submission: AskUserSubmission) => void | Promise<void>;

interface DisplayedRecordAnswer {
  values: string[];
  otherText?: string;
  fromDraft: boolean;
}

/**
 * One question set posted by `ask_user`.
 *
 * The transcript projection owns availability. This component owns only local
 * drafts; closed requests and response records never expose answer controls.
 */
@customElement("ask-user-card")
export class AskUserCard extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) ask?: AskUserRequest;
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) outcomes: readonly AskUserOutcome[] = [];
  @property({ attribute: false }) outcome?: AskUserOutcome;
  /** A response alongside an original request need not repeat offered options. */
  @property({ type: Boolean }) compact = false;
  /** Machine-scoped session cache key used by the ask draft store. */
  @property({ attribute: false }) draftSessionId = "";
  @property({ attribute: false }) onSubmit: AskUserSubmitCallback | undefined;

  @state() private answers: AskDraftAnswers = {};
  @state() private confirmingPartialSubmit = false;
  @state() private submitting = false;
  private modelIdentity: string | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("ask") && !changed.has("outcome") && !changed.has("draftSessionId")) return;
    const identity = this.currentModelIdentity();
    if (identity === this.modelIdentity) return;
    this.modelIdentity = identity;
    this.answers = this.loadCurrentDraft();
    this.confirmingPartialSubmit = false;
    this.submitting = false;
  }

  override render(): TemplateResult | null {
    if (this.outcome !== undefined) return this.renderRecord(this.outcome);
    if (this.ask !== undefined) return this.open && this.onSubmit !== undefined
      ? this.renderOpenAsk(this.ask) : this.renderClosedAsk(this.ask);
    return null;
  }

  private renderOpenAsk(ask: AskUserRequest): TemplateResult {
    const count = answeredCount(ask.questions, this.answers);
    const unanswered = unansweredQuestions(ask.questions, this.answers);
    return html`
      <article class="card open-card" aria-labelledby="ask-user-heading">
        <header class="card-header">
          <h2 id="ask-user-heading">${t("ui.askUserCard.questions", "Questions")}</h2>
          <span class="header-status" role="status" aria-live="polite" aria-atomic="true">
            ${t("ui.extensionDialogCard.answered", "Answered")} ${count}/${ask.questions.length}
          </span>
        </header>
        <form class="ask-form" @submit=${(event: SubmitEvent) => { this.handleSubmit(event, ask); }}>
          <div class="questions">
            ${ask.questions.map((question, index) => this.renderQuestion(ask, question, index))}
          </div>
          <footer class="form-footer">
            <button class="secondary-action skip-questions" type="button" ?disabled=${this.submitting}
              @click=${() => { this.submitAnswers(ask, { answers: [] }); }}>${t("ui.askUserCard.skipQuestions", "Skip questions")}</button>
            ${this.confirmingPartialSubmit && unanswered.length > 0
              ? this.renderPartialSubmitConfirmation(ask, unanswered)
              : html`
                  <button class="primary-action" type="submit" ?disabled=${this.submitting}>
                    ${this.submitting ? t("ui.askUserCard.sending", "Sending…") : t("ui.askUserCard.sendAnswers", "Send answers")}
                  </button>
                `}
          </footer>
        </form>
      </article>
    `;
  }

  private renderQuestion(ask: AskUserRequest, question: AskUserQuestion, index: number): TemplateResult {
    const answer = this.answers[question.id];
    const answered = answeredCount([question], this.answers) === 1;
    const detailId = question.detail === undefined ? undefined : this.questionDetailId(index);
    const freeTextOnly = question.options.length === 0;
    const customSelected = freeTextOnly || this.isOtherSelected(question, answer);
    const inputType = question.multiple === true ? "checkbox" : "radio";
    return html`
      <fieldset
        id=${this.questionFieldsetId(index)}
        class=${`question${answered ? " answered" : ""}`}
        aria-describedby=${ifDefined(detailId)}
        tabindex="-1"
      >
        <legend>
          <span class="question-number">${String(index + 1)}.</span>
          <span>${question.question}</span>
        </legend>
        ${question.detail === undefined ? null : html`<p class="question-detail" id=${detailId}>${question.detail}</p>`}
        <div class="options">
          ${question.options.map((option) => html`
            <label class="option">
              <input
                type=${inputType}
                name=${this.questionGroupName(ask, question)}
                value=${option.value}
                .checked=${answer?.values.includes(option.value) === true}
                @change=${(event: Event) => { this.changeOption(question, option.value, event); }}
              />
              <span class="option-copy">
                <span class="option-label">${option.label}</span>
                ${option.detail === undefined ? null : html`<span class="option-detail">${option.detail}</span>`}
              </span>
            </label>
          `)}
          ${freeTextOnly ? null : html`
            <label class="option other-option">
              <input
                type=${inputType}
                name=${this.questionGroupName(ask, question)}
                value="__pi_web_other__"
                .checked=${customSelected}
                @change=${(event: Event) => { this.changeOther(question, index, event); }}
              />
              <span class="option-copy"><span class="option-label">${t("ui.main.custom", "Custom")}</span></span>
            </label>
          `}
          ${customSelected ? html`
            <label class="other-answer" for=${this.otherInputId(index)}>
              <span>${t("ui.askUserCard.customAnswer", "Custom answer")}</span>
              <textarea
                id=${this.otherInputId(index)}
                rows="3"
                maxlength=${String(ASK_USER_OTHER_TEXT_MAX_LENGTH)}
                .value=${answer?.otherText ?? ""}
                @input=${(event: Event) => { this.changeOtherText(question, event); }}
              ></textarea>
            </label>
          ` : null}
        </div>
      </fieldset>
    `;
  }

  private renderPartialSubmitConfirmation(ask: AskUserRequest, unanswered: AskUserQuestion[]): TemplateResult {
    return html`
      <div class="partial-confirmation" role="group" aria-label="${t("ui.askUserCard.confirmPartialAnswers", "Confirm partial answers")}">
        <p>
          <strong>${t("ui.askUserCard.theFollowingQuestionsAreUnanswered", "The following questions are unanswered:")}</strong>
          ${unanswered.map((question, index) => html`${index === 0 ? " " : ", "}<button
            class="question-jump"
            type="button"
            @click=${() => { this.focusQuestion(ask.questions.indexOf(question)); }}
          >${question.question}</button>`)}?
        </p>
        <div class="confirmation-actions">
          <button class="secondary-action" type="button" @click=${() => { this.keepEditing(ask, unanswered); }}>${t("ui.askUserCard.keepEditing", "Keep editing")}</button>
          <button class="primary-action send-anyway" type="button" ?disabled=${this.submitting} @click=${() => { this.submitAnswers(ask); }}>
            ${this.submitting ? t("ui.askUserCard.sending", "Sending…") : t("ui.askUserCard.sendAnyway", "Send anyway")}
          </button>
        </div>
      </div>
    `;
  }

  private renderClosedAsk(ask: AskUserRequest): TemplateResult {
    return html`
      <details class="card closed-card">
        <summary class="card-header"><h2><span class="disclosure-indicator" aria-hidden="true">▸</span> ${t("ui.askUserCard.questions", "Questions")}</h2><span class="header-status">${t("ui.askUserCard.closedQuestions", "Closed · {count} questions", { count: ask.questions.length })}</span></summary>
        ${this.outcomes.map((outcome) => html`<p class="record-summary">${outcome.summary}</p>`)}
        <div class="record-questions">
          ${ask.questions.map((question, index) => html`
            <section class="record-question" aria-labelledby=${this.recordQuestionHeadingId(index)}>
              <h3 id=${this.recordQuestionHeadingId(index)}><span class="question-number">${String(index + 1)}.</span><span>${question.question}</span></h3>
              ${question.detail === undefined ? null : html`<p class="question-detail">${question.detail}</p>`}
              ${this.renderOfferedOptions(question)}
              ${this.outcomes.length === 0
                ? this.renderRecordedAnswer(undefined, { question, answered: false, values: [] })
                : this.outcomes.map((outcome) => {
                    const record = outcome.questions.find((item) => item.question.id === question.id);
                    return record === undefined ? null : this.renderRecordedAnswer(outcome, record);
                  })}
            </section>
          `)}
        </div>
      </details>
    `;
  }

  private renderOfferedOptions(question: AskUserQuestion): TemplateResult {
    return html`${question.multiple === true ? html`<p class="question-detail">${t("ui.askUserCard.multipleChoicesAllowed", "Multiple choices allowed")}</p>` : null}<ul class="offered-options">
      ${question.options.map((option) => html`<li><span>${option.label}</span>${option.detail === undefined ? null : html`<p class="option-detail">${option.detail}</p>`}</li>`)}
      <li>${question.options.length === 0 ? t("ui.askUserCard.customAnswer", "Custom answer") : t("ui.main.custom", "Custom")}</li>
    </ul>`;
  }

  private renderRecord(outcome: AskUserOutcome): TemplateResult {
    const recordLabel = outcome.reason === "submitted"
      ? outcome.answeredCount === 0 ? t("ui.askUserCard.questionsSkipped", "Questions skipped") : t("ui.askUserCard.answersSent", "Answers sent")
      : outcome.reason === "superseded"
        ? t("ui.askUserCard.superseded", "Superseded")
        : t("client.shellMessages.cancelled.a37778", "Cancelled");
    return html`
      <article class="card record-card" aria-labelledby="ask-user-record-heading">
        <header class="card-header">
          <h2 id="ask-user-record-heading">${this.compact ? t("ui.askUserCard.answers", "Answers") : t("ui.askUserCard.questions", "Questions")}</h2>
          <span class=${`header-status ${outcome.reason}`}>${recordLabel}</span>
        </header>
        <p class="record-summary">
          ${outcome.reason === "superseded"
            ? t("ui.askUserCard.aNewerQuestionSetReplacedThisOneThe", "A newer question set replaced this one. The draft answers below were not sent to the model.")
            : askOutcomeSummary(outcome)}
        </p>
        <div class="record-questions">
          ${outcome.questions.map((record, index) => this.renderQuestionRecord(outcome, record, index))}
        </div>
      </article>
    `;
  }

  private renderQuestionRecord(outcome: AskUserOutcome, record: AskUserQuestionRecord, index: number): TemplateResult {
    return html`
      <section class="record-question" aria-labelledby=${this.recordQuestionHeadingId(index)}>
        <h3 id=${this.recordQuestionHeadingId(index)}>
          <span class="question-number">${String(index + 1)}.</span>
          <span>${record.question.question}</span>
        </h3>
        ${record.question.detail === undefined ? null : html`<p class="question-detail">${record.question.detail}</p>`}
        ${this.compact ? null : this.renderOfferedOptions(record.question)}
        ${this.renderRecordedAnswer(outcome, record)}
      </section>
    `;
  }

  private renderRecordedAnswer(outcome: AskUserOutcome | undefined, record: AskUserQuestionRecord): TemplateResult {
    const answer = this.displayedRecordAnswer(outcome, record);
    return html`
        ${answer === undefined
          ? html`<p class="unanswered-record">${t("ui.askUserCard.unanswered", "Unanswered")}</p>`
          : html`
              <ul class="record-answers">
                ${answer.values.map((value) => html`<li>${this.optionLabel(record.question, value)}</li>`)}
                ${answer.otherText === undefined ? null : html`<li><strong>${t("ui.askUserCard.other", "Other:")}</strong> <span class="other-record-text">${answer.otherText}</span></li>`}
              </ul>
              ${answer.fromDraft ? html`<p class="draft-note">${t("ui.askUserCard.draftAnswerNotSent", "Draft answer · Not sent")}</p>` : null}
            `}
    `;
  }

  private changeOption(question: AskUserQuestion, value: string, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (question.multiple !== true) {
      if (input.checked) this.setAnswer(question, { values: [value] });
      return;
    }
    const current = this.answers[question.id];
    const values = input.checked
      ? [...new Set([...(current?.values ?? []), value])]
      : (current?.values ?? []).filter((selected) => selected !== value);
    this.setAnswer(question, {
      values,
      ...(current?.otherText === undefined ? {} : { otherText: current.otherText }),
    });
  }

  private changeOther(question: AskUserQuestion, index: number, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const current = this.answers[question.id];
    if (question.multiple === true) {
      this.setAnswer(question, {
        values: [...(current?.values ?? [])],
        ...(input.checked ? { otherText: current?.otherText ?? "" } : {}),
      });
    } else if (input.checked) {
      this.setAnswer(question, { values: [], otherText: this.isOtherSelected(question, current) ? current?.otherText ?? "" : "" });
    }
    if (input.checked) void this.focusOtherInput(index);
  }

  private changeOtherText(question: AskUserQuestion, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLTextAreaElement)) return;
    const current = this.answers[question.id];
    this.setAnswer(question, {
      values: [...(current?.values ?? [])],
      otherText: input.value.slice(0, ASK_USER_OTHER_TEXT_MAX_LENGTH),
    });
  }

  private setAnswer(question: AskUserQuestion, answer: AskDraftAnswer): void {
    const next: AskDraftAnswers = answer.values.length === 0 && answer.otherText === undefined
      ? Object.fromEntries(Object.entries(this.answers).filter(([id]) => id !== question.id))
      : { ...this.answers, [question.id]: answer };
    this.answers = next;
    this.confirmingPartialSubmit = false;
    if (this.ask !== undefined && this.draftSessionId !== "") saveAskDraft(this.draftSessionId, this.ask.askId, next);
  }

  private handleSubmit(event: SubmitEvent, ask: AskUserRequest): void {
    event.preventDefault();
    if (this.submitting) return;
    if (unansweredQuestions(ask.questions, this.answers).length > 0) {
      void this.showPartialSubmitConfirmation();
      return;
    }
    this.submitAnswers(ask);
  }

  private submitAnswers(ask: AskUserRequest, submission = toSubmission(ask.questions, this.answers)): void {
    if (this.submitting || !this.open) return;
    this.submitting = true;
    const callback = this.onSubmit;
    if (callback === undefined) {
      this.submitting = false;
      return;
    }
    const askId = ask.askId;
    void Promise.resolve()
      .then(() => callback(askId, submission))
      .catch(() => {
        // The parent controller owns the visible transport error. Keeping this
        // card and its draft intact is the only recovery needed at this boundary.
      })
      .finally(() => {
        if (this.ask?.askId === askId) this.submitting = false;
      });
  }

  private async showPartialSubmitConfirmation(): Promise<void> {
    this.confirmingPartialSubmit = true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(".send-anyway")?.focus();
  }

  private keepEditing(ask: AskUserRequest, unanswered: AskUserQuestion[]): void {
    this.confirmingPartialSubmit = false;
    const first = unanswered[0];
    if (first !== undefined) this.focusQuestion(ask.questions.indexOf(first));
  }

  private focusQuestion(index: number): void {
    if (index < 0) return;
    void this.updateComplete.then(() => {
      const fieldset = this.renderRoot.querySelector<HTMLElement>(`#${this.questionFieldsetId(index)}`);
      const firstControl = fieldset?.querySelector<HTMLElement>("input, textarea");
      (firstControl ?? fieldset)?.focus();
    });
  }

  private async focusOtherInput(index: number): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`#${this.otherInputId(index)}`)?.focus();
  }

  private isOtherSelected(question: AskUserQuestion, answer: AskDraftAnswer | undefined): boolean {
    if (answer?.otherText === undefined) return false;
    return question.multiple === true || answer.values.length === 0;
  }

  private displayedRecordAnswer(outcome: AskUserOutcome | undefined, record: AskUserQuestionRecord): DisplayedRecordAnswer | undefined {
    if (record.answered) {
      return {
        values: [...record.values],
        ...(record.otherText === undefined ? {} : { otherText: record.otherText }),
        fromDraft: false,
      };
    }
    if (outcome !== undefined && outcome.reason !== "superseded") return undefined;
    const answer = toSubmission([record.question], this.answers).answers[0];
    if (answer === undefined) return undefined;
    return {
      values: [...answer.values],
      ...(answer.otherText === undefined ? {} : { otherText: answer.otherText }),
      fromDraft: true,
    };
  }

  private optionLabel(question: AskUserQuestion, value: string): string {
    return question.options.find((option) => option.value === value)?.label ?? value;
  }

  private currentModelIdentity(): string | undefined {
    if (this.outcome !== undefined) return `record:${this.draftSessionId}:${this.outcome.askId}`;
    if (this.ask !== undefined) return `request:${this.draftSessionId}:${this.ask.askId}`;
    return undefined;
  }

  private loadCurrentDraft(): AskDraftAnswers {
    const askId = this.outcome?.askId ?? this.ask?.askId;
    if (askId === undefined || this.draftSessionId === "") return {};
    return loadAskDraft(this.draftSessionId, askId);
  }

  private questionGroupName(ask: AskUserRequest, question: AskUserQuestion): string {
    return `ask-user:${ask.askId}:${question.id}`;
  }

  private questionFieldsetId(index: number): string {
    return `ask-user-question-${String(index)}`;
  }

  private questionDetailId(index: number): string {
    return `ask-user-question-detail-${String(index)}`;
  }

  private otherInputId(index: number): string {
    return `ask-user-other-${String(index)}`;
  }

  private recordQuestionHeadingId(index: number): string {
    return `ask-user-record-question-${String(index)}`;
  }

  static override styles = css`
    @layer pi-web-base {
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin: 0 0 14px;
      color: var(--pi-text);
      font: 14px var(--pi-font, system-ui, sans-serif);
      container-type: inline-size;
    }
    .card {
      --question-number-column: 25px;
      --question-copy-gap: 5px;
      border: 1px solid var(--pi-border);
      border-radius: 10px;
      background: var(--pi-surface);
    }
    .card-header {
      position: sticky;
      top: var(--pi-chat-sticky-top, 0px);
      z-index: 6;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 22px;
      padding: 7px 10px 6px;
      border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent);
      border-radius: 9px 9px 0 0;
      background: var(--pi-surface);
      box-shadow: 0 8px 18px var(--pi-shadow-soft);
    }
    h2, h3, p { margin-top: 0; }
    h2 {
      margin-bottom: 0;
      color: var(--pi-accent);
      font-size: 12px;
      line-height: 1.3;
      text-transform: uppercase;
    }
    .header-status { flex: 0 1 auto; color: var(--pi-muted); font-size: 11px; text-align: end; }
    .header-status.submitted { color: var(--pi-success); }
    .header-status.superseded { color: var(--pi-warning); }
    .questions { display: grid; padding-top: 8px; }
    fieldset.question {
      min-width: 0;
      margin: 0;
      border: 0;
      border-top: 1px solid var(--pi-border-muted);
      padding: 0 16px 16px;
      background: transparent;
    }
    fieldset.question:first-child { border-top: 0; }
    fieldset.question:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
    legend {
      box-sizing: border-box;
      width: 100%;
      display: grid;
      grid-template-columns: var(--question-number-column) minmax(0, 1fr);
      align-items: start;
      gap: var(--question-copy-gap);
      color: var(--pi-text);
      padding: 0;
      font-weight: 650;
      line-height: 1.35;
    }
    .question-number { justify-self: end; color: var(--pi-muted); }
    fieldset.question.answered .question-number { color: var(--pi-success); }
    .question-detail {
      margin: 4px 0 10px;
      color: var(--pi-muted);
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    fieldset.question > .question-detail, .record-question > .question-detail { padding-inline-start: calc(var(--question-number-column) + var(--question-copy-gap)); }
    .options { display: grid; gap: 7px; }
    legend + .options { margin-top: 10px; }
    .option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      gap: 8px;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 7px 8px;
      cursor: pointer;
    }
    .option:hover { border-color: var(--pi-border-muted); background: var(--pi-surface-hover); }
    .option:has(input:checked) { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    input { margin: 2px 0 0; accent-color: var(--pi-accent); }
    input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .option-copy { min-width: 0; display: grid; gap: 2px; }
    .option-label { line-height: 1.35; }
    .option-detail { color: var(--pi-muted); font-size: 12px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
    .other-answer { display: grid; gap: 5px; color: var(--pi-muted); font-size: 12px; padding: 4px 8px 4px 32px; }
    .other-answer:only-child { padding-left: 0; padding-right: 0; }
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 68px;
      resize: vertical;
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-bg);
      color: var(--pi-text);
      padding: 8px;
      font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif);
    }
    .form-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      border-top: 1px solid var(--pi-border-muted);
      padding: 12px 16px;
    }
    button {
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-surface);
      color: var(--pi-text);
      padding: 7px 10px;
      font: inherit;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--pi-surface-hover); }
    button:disabled { cursor: wait; opacity: .65; }
    .primary-action { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-accent-contrast, white); font-weight: 650; }
    .primary-action:hover:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); }
    .partial-confirmation { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
    .partial-confirmation p { min-width: 0; margin: 0; color: var(--pi-warning); font-size: 12px; line-height: 1.4; }
    .question-jump {
      display: inline;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .confirmation-actions { flex: 0 0 auto; display: flex; gap: 7px; }
    .closed-card > summary { cursor: pointer; position: static; }
    .disclosure-indicator { display: inline-block; }
    .closed-card[open] .disclosure-indicator { transform: rotate(90deg); }
    .offered-options { display: grid; gap: 5px; margin: 0 0 12px; padding-left: 22px; color: var(--pi-muted); }
    .offered-options .option-detail { margin: 2px 0 0; }
    .record-summary { margin: 0; color: var(--pi-muted); padding: 12px 16px; font-size: 12px; }
    .record-questions { display: grid; }
    .record-question { min-width: 0; padding: 14px 16px; }
    .record-question + .record-question { border-top: 1px solid var(--pi-border-muted); }
    .record-question h3 { display: grid; grid-template-columns: var(--question-number-column) minmax(0, 1fr); align-items: start; gap: var(--question-copy-gap); margin-bottom: 8px; font-size: 14px; line-height: 1.35; }
    .record-answers { display: grid; gap: 4px; margin: 0; padding-left: 22px; line-height: 1.4; }
    .other-record-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .unanswered-record { margin: 0; color: var(--pi-muted); font-style: italic; }
    .draft-note { margin: 7px 0 0; color: var(--pi-warning); font-size: 11px; }
    @container (max-width: 580px) {
      fieldset.question { padding: 0 12px 14px; }
      .record-question { padding: 14px 12px; }
      .record-summary { padding-inline: 12px; }
      .form-footer { align-items: stretch; flex-direction: column; padding: 12px; }
      .partial-confirmation { align-items: stretch; flex-direction: column; }
      .confirmation-actions { justify-content: flex-end; }
      .primary-action { min-height: 42px; }
    }

    }
  `;
}

function askOutcomeSummary(outcome: AskUserOutcome): string {
  const total = outcome.questions.length;
  const answered = t("ui.main.e5972b436af4", "Answered {arg0}/{arg1} questions", { arg0: outcome.answeredCount.toString(), arg1: total.toString() });
  return outcome.unansweredIds.length === 0
    ? t("ui.main.607a56ddb3a3", "{arg0}; all questions answered", { arg0: answered })
    : t("ui.main.507046aea4a4", "{arg0}; unanswered: {arg1}", { arg0: answered, arg1: outcome.unansweredIds.join("、") });
}

declare global {
  interface HTMLElementTagNameMap {
    "ask-user-card": AskUserCard;
  }
}
