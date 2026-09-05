// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearStagedAttachments, loadStagedAttachments, moveStagedAttachments } from "../promptAttachmentStaging";
import { PromptEditor } from "./PromptEditor";

const SESSION_A = "staging-session-a";
const SESSION_B = "staging-session-b";
const PENDING_SESSION = "pending-staging-session";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  for (const id of [SESSION_A, SESSION_B, PENDING_SESSION]) clearStagedAttachments(`local:${id}`);
});

async function mountEditor(sessionId: string): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = "local";
  editor.sessionId = sessionId;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function control<T extends Element>(editor: PromptEditor, selector: string, type: new(...args: never[]) => T): T {
  const element = editor.shadowRoot?.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing ${selector}`);
  return element;
}

async function attachFile(editor: PromptEditor): Promise<void> {
  const input = control(editor, ".attachment-input", HTMLInputElement);
  const transfer = new DataTransfer();
  transfer.items.add(new File(["hello"], "notes.txt", { type: "text/plain" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => { expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(1); });
}

async function selectSession(editor: PromptEditor, sessionId: string): Promise<void> {
  editor.sessionId = sessionId;
  await editor.updateComplete;
}

describe("PromptEditor attachment staging lifecycle", () => {
  it("keeps unsent attachments when the controller promotes the pending session before the editor updates", async () => {
    const editor = await mountEditor(PENDING_SESSION);
    await attachFile(editor);

    moveStagedAttachments(`local:${PENDING_SESSION}`, `local:${SESSION_A}`);
    await selectSession(editor, SESSION_A);

    expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(loadStagedAttachments(`local:${SESSION_A}`)).toEqual([expect.objectContaining({ name: "notes.txt" })]);
    expect(loadStagedAttachments(`local:${PENDING_SESSION}`)).toEqual([]);
  });

  it("removes the staged attachment before the pending session is promoted", async () => {
    const editor = await mountEditor(PENDING_SESSION);
    await attachFile(editor);
    expect(loadStagedAttachments(`local:${PENDING_SESSION}`)).toHaveLength(1);
    control(editor, ".attachment-remove", HTMLButtonElement).click();
    await editor.updateComplete;

    expect(loadStagedAttachments(`local:${PENDING_SESSION}`)).toEqual([]);
    moveStagedAttachments(`local:${PENDING_SESSION}`, `local:${SESSION_A}`);
    await selectSession(editor, SESSION_A);

    expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(0);
    expect(loadStagedAttachments(`local:${SESSION_A}`)).toEqual([]);
  });

  it("clears staged attachments after sending and does not resurrect them on a later switch", async () => {
    const editor = await mountEditor(PENDING_SESSION);
    const onSend = vi.fn();
    editor.onSend = onSend;
    await attachFile(editor);
    moveStagedAttachments(`local:${PENDING_SESSION}`, `local:${SESSION_A}`);
    await selectSession(editor, SESSION_A);

    control(editor, ".send-button", HTMLButtonElement).click();
    await editor.updateComplete;
    expect(onSend).toHaveBeenCalledWith("", undefined, [expect.objectContaining({ name: "notes.txt" })], "folder", ".pi-web/attachments");
    expect(loadStagedAttachments(`local:${SESSION_A}`)).toEqual([]);
    expect(loadStagedAttachments(`local:${PENDING_SESSION}`)).toEqual([]);

    await selectSession(editor, SESSION_B);
    await selectSession(editor, SESSION_A);
    expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(0);
  });

  it("isolates and restores attachments across ordinary session switches", async () => {
    const editor = await mountEditor(SESSION_A);
    await attachFile(editor);

    await selectSession(editor, SESSION_B);
    expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(0);
    await selectSession(editor, SESSION_A);
    expect(editor.shadowRoot?.querySelectorAll(".attachment-chip")).toHaveLength(1);
  });
});
