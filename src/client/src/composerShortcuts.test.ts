import { describe, expect, it } from "vitest";
import { composerSendShortcut, matchesComposerSend } from "./composerShortcuts";

const enterEvent = (shiftKey: boolean) => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey,
  isComposing: false,
  target: null,
});

describe("composer send shortcuts", () => {
  it("keeps the browser Enter preference until a composer binding is saved", () => {
    expect(composerSendShortcut({}, { matches: false }, "newline")).toBe("shift+enter");
    expect(composerSendShortcut({}, { matches: true }, "auto")).toBe("shift+enter");
    expect(composerSendShortcut({ "composer.send.desktop": null }, { matches: false }, "send")).toBeNull();
    expect(matchesComposerSend(enterEvent(false), "enter")).toBe(true);
    expect(matchesComposerSend(enterEvent(true), "enter")).toBe(false);
    expect(matchesComposerSend(enterEvent(true), "shift+enter")).toBe(true);
  });
});
