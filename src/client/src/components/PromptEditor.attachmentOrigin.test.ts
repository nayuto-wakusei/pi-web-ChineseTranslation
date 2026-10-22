// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import { clearStagedAttachments, loadStagedAttachments, moveStagedAttachments, saveStagedAttachments } from "../promptAttachmentStaging";

const original = "local:pending-origin";
const promoted = "local:durable-origin";
let readers: FileReader[] = [];

beforeEach(() => {
  readers = [];
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) { readers.push(this); });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  for (const key of [original, promoted, "remote:pending-origin", "local:other-origin"]) clearStagedAttachments(key);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "pending-origin";
  editor.cwd = "/origin";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function selectFile(editor: PromptEditor): void {
  const input = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-input");
  if (input === null) throw new Error("Expected attachment input");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "late.png", { type: "image/png" })] });
  input.dispatchEvent(new Event("change"));
  expect(readers).toHaveLength(1);
}

async function finishRead(editor: PromptEditor): Promise<void> {
  const reader = readers[0];
  if (reader === undefined) throw new Error("Expected pending FileReader");
  Object.defineProperty(reader, "result", { configurable: true, value: "data:image/png;base64,QUJD" });
  reader.dispatchEvent(new ProgressEvent("load"));
  await Promise.resolve();
  await Promise.resolve();
  await editor.updateComplete;
}

describe("attachment capture origin", () => {
  it("stages a completed read only for its unchanged conversation", async () => {
    const editor = await mount();
    selectFile(editor);
    await finishRead(editor);
    expect(loadStagedAttachments(original)).toEqual([expect.objectContaining({ name: "late.png" })]);
    expect(editor.renderRoot.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(["machine", "cwd", "session"] as const)("retires a read before a new %s context renders", async (change) => {
    const editor = await mount();
    selectFile(editor);
    if (change === "machine") editor.machineId = "remote";
    else if (change === "cwd") editor.cwd = "/other";
    else editor.sessionId = "other-origin";
    await finishRead(editor);
    expect(editor.renderRoot.querySelector(".attachment-chip")).toBeNull();
    expect(loadStagedAttachments(original)).toEqual([]);
    expect(loadStagedAttachments("remote:pending-origin")).toEqual([]);
    expect(loadStagedAttachments("local:other-origin")).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("Attachment selection ignored after conversation changed");
  });

  it("does not resurrect a temporary key after its already staged attachments move to the durable session", async () => {
    const attachment = { id: "existing", kind: "image" as const, name: "existing.png", mimeType: "image/png", data: "QUJD", size: 3 };
    saveStagedAttachments(original, [attachment]);
    const editor = await mount();
    selectFile(editor);
    moveStagedAttachments(original, promoted);
    editor.sessionId = "durable-origin";
    await finishRead(editor);
    expect(loadStagedAttachments(original)).toEqual([]);
    expect(loadStagedAttachments(promoted)).toEqual([attachment]);
    expect(editor.renderRoot.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(editor.renderRoot.textContent).not.toContain("late.png");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("retires a read across a session ABA even when the final exact identity matches", async () => {
    const editor = await mount();
    selectFile(editor);
    editor.sessionId = "other-origin";
    await editor.updateComplete;
    editor.sessionId = "pending-origin";
    await finishRead(editor);
    expect(loadStagedAttachments(original)).toEqual([]);
    expect(editor.renderRoot.querySelector(".attachment-chip")).toBeNull();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("does not stage a read after the composer disconnects", async () => {
    const editor = await mount();
    selectFile(editor);
    editor.remove();
    await finishRead(editor);
    expect(loadStagedAttachments(original)).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
