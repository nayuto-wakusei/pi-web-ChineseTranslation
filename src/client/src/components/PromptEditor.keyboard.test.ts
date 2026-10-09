// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import { PiWebApp } from "./PiWebApp";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

it.each(["mod+enter", "alt+s"])("lets the focused composer send with %s instead of a conflicting global action", async (shortcut) => {
  const editor = new PromptEditor();
  editor.shortcutConfig = { "composer.send.desktop": shortcut, "composer.send.mobile": shortcut };
  editor.onSend = vi.fn();
  document.body.append(editor);
  await editor.updateComplete;
  editor.replaceText("/name keyboard fixture");
  const content = editor.shadowRoot?.querySelector<HTMLElement>(".cm-content");
  if (content === null || content === undefined) throw new Error("Missing editor content");
  const app = new PiWebApp();
  const globalAction = vi.fn();
  Object.defineProperty(app, "promptEditor", { value: editor });
  Object.defineProperty(app, "getDefaultActions", { value: () => [{ id: "conflicting-global", title: "Global", shortcut, run: globalAction }] });
  const onKeyDown: unknown = Reflect.get(app, "onKeyDown");
  if (typeof onKeyDown !== "function") throw new Error("Missing app keyboard dispatcher");
  const capture = (event: KeyboardEvent) => { onKeyDown.call(app, event); };
  window.addEventListener("keydown", capture, true);
  try {
    content.dispatchEvent(new KeyboardEvent("keydown", { key: shortcut === "mod+enter" ? "Enter" : "s", ctrlKey: shortcut === "mod+enter", altKey: shortcut === "alt+s", bubbles: true, composed: true, cancelable: true }));
    expect(globalAction).not.toHaveBeenCalled();
    expect(editor.onSend).toHaveBeenCalledWith("/name keyboard fixture", undefined, undefined, undefined, undefined);
  } finally { window.removeEventListener("keydown", capture, true); }
});
