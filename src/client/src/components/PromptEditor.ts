import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type PromptAttachment, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, promptAttachmentsCanUseInlineDelivery, type CapturedAttachment } from "../promptAttachmentCapture";
import { inputModeForDraft } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { detectPromptCompletionTrigger, fileCompletionInsertText, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, saveDraft } from "../promptDraftStorage";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "../attachmentPreferences";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { promptEditorStyles, type CompletionItem } from "./shared";
import { renderAttachIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";

type PendingAttachment = CapturedAttachment & { id: string };

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) workspaceScopedFileSuggestions = false;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void | Promise<void>;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];
  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;
  @state() private draft = "";
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  @state() private attachments: PendingAttachment[] = [];
  @state() private attachmentDelivery: PromptAttachmentDelivery = loadAttachmentDelivery();
  @state() private attachmentError: string | undefined = undefined;
  private attachmentSeq = 0;
  private requestVersion = 0;
  private editor: EditorView | undefined;
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly mobilePromptEnterMedia = createMobilePromptEnterMedia();
  private explicitShiftKeyActive = false;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (!changed.has("sessionId") && !changed.has("machineId")) return;
    const previousSessionId = changed.has("sessionId") ? changed.get("sessionId") : this.sessionId;
    const previousMachineId = changed.has("machineId") ? changed.get("machineId") : this.machineId;
    const previousKey = draftStorageKey(previousMachineId, previousSessionId);
    if (previousKey !== undefined) saveDraft(previousKey, this.draft);
    const currentKey = draftStorageKey(this.machineId, this.sessionId);
    this.draft = currentKey !== undefined ? loadDraft(currentKey) : "";
    this.completions = [];
    this.selectedIndex = 0;
  }

  override firstUpdated(): void {
    this.createEditor();
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("draft") || changed.has("sessionId") || changed.has("machineId")) this.syncEditorDoc();
  }

  override disconnectedCallback(): void {
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const inputMode = inputModeForDraft(this.draft);
    const shellMode = inputMode.kind === "shell";
    const queuesInput = this.canSteer || this.isCompacting;
    const busy = this.disabled || this.sending;
    return html`
      <footer class=${shellMode ? "shell-mode" : ""} @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }} @dragover=${(event: DragEvent) => { this.handleDragOver(event); }} @drop=${(event: DragEvent) => { void this.handleDrop(event); }}>
        <div class="editor-wrap">
          <div class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`} aria-label="给 pi 发送消息" aria-disabled=${this.disabled ? "true" : "false"}></div>
          <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
          <button class="editor-attach icon-button" ?disabled=${busy} title="附加文件" aria-label="附加文件" @click=${() => { this.attachmentInput?.click(); }}>${renderAttachIcon()}</button>
          ${shellMode ? html`<div class="mode-hint">Shell 命令${inputMode.excludeFromContext ? " · 已排除上下文" : ""}</div>` : null}
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">正在压缩历史 · 消息将排队发送</div>` : null}
          ${this.renderAttachments()}
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderCompactStatus()}
          <button class="icon-button send-button" ?disabled=${busy} title=${queuesInput ? "当前活动结束后排队发送" : "发送"} aria-label=${queuesInput ? "排队发送" : "发送"} @click=${() => { this.send("followUp"); }}>${queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
          ${this.canSteer && !this.isCompacting ? html`<button class="icon-button steer-button" ?disabled=${busy} title="在下次模型调用前引导当前回复" aria-label="引导当前回复" @click=${() => { this.send("steer"); }}>${renderSteerIcon()}</button>` : null}
          <button class="icon-button stop-button" ?disabled=${this.disabled || !this.canStop} title=${this.canStop ? "停止当前工作并清空排队消息" : "当前没有运行任务"} aria-label="停止" @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
        </div>
      </footer>
    `;
  }

  focusInput() {
    this.editor?.focus();
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.editor;
  }

  private renderCompactStatus() {
    const status = this.status;
    if (status === undefined) return null;
    const model = status.model?.id ?? "无模型";
    const provider = status.model?.provider !== undefined && status.model.provider !== "" ? `${status.model.provider}/` : "";
    return html`
      <div class="compact-status" aria-label="会话状态">
        <button class="select-model" title="选择模型" @click=${() => this.onSelectModel?.()}>${provider}${model}</button>
        <button class="select-thinking icon-button" title=${`思考级别：${thinkingLevelLabel(status.thinkingLevel)}`} aria-label=${`思考级别：${thinkingLevelLabel(status.thinkingLevel)}`} @click=${() => this.onSelectThinking?.()}>${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}</button>
      </div>
    `;
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    const canUseInlineDelivery = promptAttachmentsCanUseInlineDelivery(this.attachments);
    const delivery = this.effectiveAttachmentDelivery();
    return html`
      <div class="attachments" aria-label="待发送附件">
        ${this.attachments.map((attachment) => html`
          <div class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`} title=${attachment.name}>
            ${this.renderAttachmentPreview(attachment)}
            <button type="button" class="attachment-remove" title="移除附件" aria-label=${`移除 ${attachment.name}`} @click=${() => { this.removeAttachment(attachment.id); }}>×</button>
          </div>
        `)}
        ${this.attachments.length > 0 ? html`
          <label class="attachment-delivery" title=${canUseInlineDelivery ? "附件发送给代理的方式" : "普通文件会保存到工作区并通过引用提及"}>
            <select .value=${delivery} @change=${(event: Event) => { this.changeDelivery(event); }}>
              <option value="inline" ?disabled=${!canUseInlineDelivery}>附加到消息${canUseInlineDelivery ? "" : "（仅图片）"}</option>
              <option value="folder">保存到 .pi-web/attachments</option>
            </select>
          </label>
        ` : null}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error">${this.attachmentError}</div>` : null}
      </div>
    `;
  }

  private renderAttachmentPreview(attachment: PendingAttachment) {
    if (isInlinePromptAttachment(attachment)) {
      return html`<img src=${`data:${attachment.mimeType};base64,${attachment.data}`} alt=${attachment.name} />`;
    }
    return html`
      <div class="attachment-file-preview" aria-hidden="true">${fileExtensionLabel(attachment.name)}</div>
      <span class="attachment-file-name">${attachment.name}</span>
    `;
  }

  private changeDelivery(event: Event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const requested = event.target.value === "folder" ? "folder" : "inline";
    if (requested === "inline" && !promptAttachmentsCanUseInlineDelivery(this.attachments)) {
      event.target.value = "folder";
      return;
    }
    this.attachmentDelivery = requested;
    saveAttachmentDelivery(this.attachmentDelivery);
  }

  private removeAttachment(id: string) {
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
  }

  private async handlePaste(event: ClipboardEvent) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent) {
    if (event.dataTransfer === null) return;
    if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
  }

  private async handleDrop(event: DragEvent) {
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private async handleFileInput(event: Event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]) {
    this.attachmentError = undefined;
    const { attachments, error } = await capturePromptAttachments(files, readFileAsBase64);
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }))];
    }
    if (error !== undefined) this.attachmentError = error;
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  private effectiveAttachmentDelivery(): PromptAttachmentDelivery {
    return effectivePromptAttachmentDelivery(this.attachmentDelivery, this.attachments);
  }

  private createEditor() {
    if (!this.editorHost || this.editor !== undefined) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(view.state.sliceDoc(0, view.state.selection.main.head))),
          EditorView.domEventHandlers({
            keyup: (event) => this.handleEditorKeyUp(event),
            blur: () => this.resetEditorModifierState(),
          }),
          placeholder("给 pi 发送消息... 使用 / 输入命令，@ 输入已跟踪文件，@ 空格显示所有文件"),
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.updateDraft(update.state.doc.toString());
          }),
          keymap.of([
            { any: (view, event) => this.handleEditorKeyDown(event, view) },
            { key: "ArrowDown", run: () => this.moveCompletion(1) },
            { key: "ArrowUp", run: () => this.moveCompletion(-1) },
            { key: "Escape", run: () => this.closeCompletions() },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
  }

  private syncEditorDoc() {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState() {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
    });
  }

  private updateDraft(value: string) {
    this.draft = value;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, this.draft);
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (trigger === undefined) {
      this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const commands = await api.commands({ id: this.sessionId, cwd: this.cwd }, this.machineId).catch(emptySlashCommands);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({
          kind: "command",
          replaceFrom: trigger.from,
          replaceTo: trigger.to,
          insertText: `/${command.name}`,
          detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
        }));
    } else if (trigger.kind === "file" && this.cwd !== undefined && this.cwd !== "") {
      const files = await api.files(this.cwd, trigger.query, { scope: trigger.fileScope, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId, workspaceScoped: this.workspaceScopedFileSuggestions }).catch(emptyFileSuggestions);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => {
          const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
          return {
            kind: "file",
            replaceFrom: trigger.from,
            replaceTo: trigger.to,
            insertText,
            detail: file.kind,
            ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
          };
        });
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    return true;
  }

  private closeCompletions(): boolean {
    if (!this.completions.length) return false;
    this.completions = [];
    return true;
  }

  private handleEditorKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    if (event.key === "Shift") {
      this.explicitShiftKeyActive = true;
      return false;
    }
    if (event.key !== "Enter") {
      this.explicitShiftKeyActive = false;
      return false;
    }
    if (event.defaultPrevented || event.isComposing || view.composing) return false;

    const shiftKey = shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive, this.mobilePromptEnterMedia);
    this.explicitShiftKeyActive = false;
    return this.handleEditorEnter(view, shiftKey);
  }

  private handleEditorKeyUp(event: KeyboardEvent): boolean {
    if (event.key === "Shift") this.explicitShiftKeyActive = false;
    return false;
  }

  private resetEditorModifierState(): boolean {
    this.explicitShiftKeyActive = false;
    return false;
  }

  private handleEditorEnter(view: EditorView, shiftKey: boolean): boolean {
    if (!shiftKey && this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    if (!shouldSendPromptOnEnterShortcut(shiftKey, this.mobilePromptEnterMedia, readPromptEnterPreference())) {
      return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
    }
    this.send(this.canSteer || this.isCompacting ? "followUp" : undefined);
    return true;
  }

  private handleEditorTab(view: EditorView): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    const trigger = this.currentTrigger();
    if (trigger?.kind === "file") {
      void this.refreshCompletions();
      return true;
    }
    return indentWithTab.run?.(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    this.completions = [];
  }

  private send(streamingBehavior?: "steer" | "followUp") {
    if (this.disabled || this.sending) return;
    const text = this.draft.trim();
    const pending = this.attachments;
    if (text === "" && pending.length === 0) return;
    const behavior = this.canSteer || this.isCompacting ? streamingBehavior : undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.effectiveAttachmentDelivery();
    this.resetComposer();
    // Sending is owned by the controller (it drives the chat activity dock and,
    // for folder mode, orchestrates the upload + reference rewrite), so this is
    // fire-and-forget here.
    void this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery);
  }

  private resetComposer() {
    this.draft = "";
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) clearDraft(key);
    this.completions = [];
    this.attachments = [];
    this.attachmentError = undefined;
  }

  static override styles = promptEditorStyles;
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
}

function pendingToPromptAttachment(attachment: PendingAttachment): PromptAttachment {
  if (attachment.kind === "image") {
    return { kind: "image", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
  }
  return { kind: "file", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
}

function fileExtensionLabel(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < trimmed.length - 1) return trimmed.slice(dotIndex + 1, dotIndex + 5).toUpperCase();
  return "FILE";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("读取文件失败")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("文件读取结果异常")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

const proseInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "true",
  autocorrect: "on",
  autocapitalize: "sentences",
  writingsuggestions: "true",
  dir: "auto",
};

const codeLikeInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  writingsuggestions: "false",
  dir: "auto",
};

function inputAssistanceContentAttributes(draftBeforeCursor: string): Record<string, string> {
  // CodeMirror is optimized for code and disables these by default, but the chat prompt is usually prose.
  return inputModeForDraft(draftBeforeCursor).kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
}

