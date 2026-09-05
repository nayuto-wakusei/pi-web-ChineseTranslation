import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER } from "../api";
import { clearStagedAttachments } from "../promptAttachmentStaging";
import { attachmentFolderDeliveryLabel, PromptEditor } from "./PromptEditor";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  clearStagedAttachments("local:session-a");
  clearStagedAttachments("local:session-b");
});

describe("PromptEditor attachments folder label", () => {
  it("defaults the attachments folder to the built-in default", () => {
    expect(new PromptEditor().attachmentsFolder).toBe(DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER);
    expect(DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER).toBe(".pi-web/attachments");
  });

  it("labels the folder delivery option with the workspace-effective folder", () => {
    expect(attachmentFolderDeliveryLabel(".pi-web/attachments")).toBe("保存到 .pi-web/attachments");
    expect(attachmentFolderDeliveryLabel("docs/inbox")).toBe("保存到 docs/inbox");
  });
});

describe("PromptEditor folder delivery sends the displayed folder", () => {
  function invokeSend(editor: PromptEditor): void {
    const send: unknown = Reflect.get(editor, "send");
    if (typeof send !== "function") throw new Error("PromptEditor.send was unavailable");
    Reflect.apply(send, editor, []);
  }

  it("passes the workspace-effective attachments folder to onSend for folder delivery", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-a";
    editor.attachmentsFolder = "project-attachments";
    Reflect.set(editor, "attachments", [{ id: "attachment-1", kind: "file" as const, name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=", size: 5 }]);
    Reflect.set(editor, "draft", "check this");
    const sent: unknown[][] = [];
    editor.onSend = (...args: unknown[]) => { sent.push(args); };

    invokeSend(editor);

    expect(attachmentFolderDeliveryLabel(editor.attachmentsFolder)).toBe("保存到 project-attachments");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(["check this", undefined, [expect.objectContaining({ name: "notes.txt" })], "folder", "project-attachments"]);
  });

  it("omits the folder for inline delivery", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-a";
    editor.attachmentsFolder = "project-attachments";
    Reflect.set(editor, "attachments", [{ id: "attachment-1", kind: "image" as const, name: "shot.png", mimeType: "image/png", data: "QUJD", size: 3 }]);
    Reflect.set(editor, "draft", "look");
    const sent: unknown[][] = [];
    editor.onSend = (...args: unknown[]) => { sent.push(args); };

    invokeSend(editor);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.[3]).toBe("inline");
    expect(sent[0]?.[4]).toBeUndefined();
  });
});
