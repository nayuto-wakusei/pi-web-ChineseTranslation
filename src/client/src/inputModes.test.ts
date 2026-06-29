import { describe, expect, it } from "vitest";
import { inputModeForDraft, inputModesEqual, isShellInput } from "./inputModes";

describe("inputModeForDraft", () => {
  it("detects shell input and context-excluded shell input after leading whitespace", () => {
    expect(inputModeForDraft(" ! npm test")).toEqual({ kind: "shell", excludeFromContext: false });
    expect(inputModeForDraft("\n!! secret command")).toEqual({ kind: "shell", excludeFromContext: true });
    expect(isShellInput(" ! pwd")).toBe(true);
  });

  it("detects slash commands only for the current token", () => {
    expect(inputModeForDraft("/compact")).toEqual({ kind: "command" });
    expect(inputModeForDraft("please /compact")).toEqual({ kind: "command" });
    expect(inputModeForDraft("please mention/path")).toEqual({ kind: "normal" });
  });

  it("treats modes as equal only when kind and shell context-exclusion match", () => {
    expect(inputModesEqual({ kind: "normal" }, { kind: "normal" })).toBe(true);
    expect(inputModesEqual({ kind: "normal" }, { kind: "command" })).toBe(false);
    expect(inputModesEqual({ kind: "shell", excludeFromContext: false }, { kind: "shell", excludeFromContext: false })).toBe(true);
    expect(inputModesEqual({ kind: "shell", excludeFromContext: false }, { kind: "shell", excludeFromContext: true })).toBe(false);
  });

  it("detects file completion contexts", () => {
    expect(inputModeForDraft("open @src/main.ts")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open @ ")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open @ A FILE")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open !@vendor/file.ts")).toEqual({ kind: "file" });
    expect(inputModeForDraft("!@vendor/file.ts")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open @ \"src/main.ts")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open !@\"vendor/file.ts")).toEqual({ kind: "file" });
    expect(inputModeForDraft("open \"src/main.ts")).toEqual({ kind: "normal" });
  });
});
