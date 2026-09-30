import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { promptArgumentHintExtension, promptArgumentHintState, setPromptArgumentHint } from "./promptArgumentHint";

describe("prompt argument hint ghost", () => {
  it("clears on the next edit or cursor move", () => {
    const state = EditorState.create({
      doc: "/name ",
      extensions: promptArgumentHintExtension,
    });
    const shown = state.update({ effects: setPromptArgumentHint.of({ pos: 6, text: "<会话名称>" }) }).state;
    expect(shown.field(promptArgumentHintState)).toEqual({ pos: 6, text: "<会话名称>" });

    const edited = shown.update({ changes: { from: 6, insert: "a" } }).state;
    expect(edited.field(promptArgumentHintState)).toBeNull();

    const moved = shown.update({ selection: { anchor: 0 } }).state;
    expect(moved.field(promptArgumentHintState)).toBeNull();
    expect(EditorView).toBeTypeOf("function");
  });
});
