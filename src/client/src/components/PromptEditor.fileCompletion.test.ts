// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("debounces file queries and aborts them on trigger removal, workspace change and disconnect", async () => {
  const files = vi.spyOn(api, "files").mockResolvedValue([]);
  const editor = new PromptEditor();
  editor.cwd = "/repo";
  editor.sessionId = "s1";
  document.body.append(editor);
  await editor.updateComplete;
  const content = editor.shadowRoot?.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) throw new Error("Missing CodeMirror editor");
  const view = EditorView.findFromDOM(content);
  if (view === null) throw new Error("Missing editor view");
  const type = (text: string) => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } }); };
  vi.useFakeTimers();
  type("@s");
  type("@sr");
  type("@src");
  await vi.advanceTimersByTimeAsync(149);
  expect(files).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(files).toHaveBeenCalledTimes(1);
  const firstSignal = files.mock.calls[0]?.[2]?.signal;
  type("plain text");
  expect(firstSignal?.aborted).toBe(true);
  type("@next");
  editor.cwd = "/other";
  await editor.updateComplete;
  await vi.advanceTimersByTimeAsync(150);
  expect(files).toHaveBeenCalledTimes(1);
  type("@last");
  await vi.advanceTimersByTimeAsync(150);
  const lastSignal = files.mock.calls[1]?.[2]?.signal;
  editor.remove();
  expect(lastSignal?.aborted).toBe(true);
});
