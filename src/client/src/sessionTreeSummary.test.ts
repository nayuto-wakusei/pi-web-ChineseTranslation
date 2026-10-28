import { afterEach, describe, expect, it } from "vitest";
import type { SessionTreeNode, SessionTreeSummaryPresentation } from "../../shared/apiTypes";
import { projectSessionTree } from "../../server/sessions/sessionTreeProjection";
import { parseCommandResult, parseSessionTreeSnapshot } from "./api/parsers";
import { localization } from "./localization/browser";
import { sessionTreeSummary } from "./sessionTreeSummary";

function node(summaryPresentation?: SessionTreeSummaryPresentation): SessionTreeNode {
  return { id: "id", parentId: null, kind: "other", summary: "Legacy Tool error [image]", ...(summaryPresentation === undefined ? {} : { summaryPresentation }) };
}
afterEach(async () => { await localization.setPreferences({ language: "en", formatLocale: "en" }); });

describe("history summary presentation", () => {
  it("renders every semantic form with complete messages and native list formatting", async () => {
    await localization.setPreferences({ language: "en", formatLocale: "en-US" });
    const cases: [SessionTreeSummaryPresentation, string][] = [
      [{ type: "status", status: "assistant-aborted" }, "Assistant response aborted"],
      [{ type: "content", parts: [], fallback: "compaction-summary" }, "Compaction summary"],
      [{ type: "content", parts: [{ type: "text", text: "Literal [image]" }, { type: "image" }], fallback: "user-message" }, "Literal [image] [image]"],
      [{ type: "named", field: "model", value: "provider/model" }, "Model: provider/model"],
      [{ type: "named", field: "model" }, "Model changed"],
      [{ type: "named", field: "shell", value: "npm test" }, "Shell: npm test"],
      [{ type: "named", field: "shell" }, "Shell command"],
      [{ type: "named", field: "thinking-level", value: "high" }, "Thinking level: high"],
      [{ type: "named", field: "thinking-level" }, "Thinking level changed"],
      [{ type: "named", field: "session-name", value: "My session" }, "Session name: My session"],
      [{ type: "named", field: "session-name" }, "Session info changed"],
      [{ type: "named", field: "label", value: "checkpoint" }, "Label: checkpoint"],
      [{ type: "named", field: "label" }, "Label removed"],
      [{ type: "named", field: "custom-entry", value: "extension-type" }, "Custom entry: extension-type"],
      [{ type: "named", field: "custom-entry" }, "Custom entry"],
      [{ type: "named", field: "entry", value: "future_entry" }, "Entry: future_entry"],
      [{ type: "named", field: "entry" }, "Other session entry"],
      [{ type: "assistant-tools", names: ["read", "bash", "edit"] }, `Tool call: ${new Intl.ListFormat("en-US").format(["read", "bash", "edit"])}`],
      [{ type: "tool-result", isError: false, parts: [] }, "Tool result"],
      [{ type: "tool-result", isError: true, toolName: "read", parts: [{ type: "text", text: "Raw diagnostic" }] }, "Tool error (read): Raw diagnostic"],
      [{ type: "tool-result", isError: false, toolName: "bash", parts: [] }, "Tool result (bash)"],
      [{ type: "tool-result", isError: true, parts: [{ type: "image" }] }, "Tool error: [image]"],
      [{ type: "custom-message", parts: [] }, "Custom message"],
      [{ type: "custom-message", customType: "notice", parts: [] }, "Custom message (notice)"],
      [{ type: "custom-message", customType: "notice", parts: [{ type: "text", text: "Raw notice" }] }, "Custom message (notice): Raw notice"],
      [{ type: "custom-message", parts: [{ type: "image" }] }, "Custom message: [image]"],
    ];
    for (const [presentation, expected] of cases) expect(sessionTreeSummary(node(presentation))).toBe(expected);
  });

  it.each(["en-XA", "ar-XB"])("translates only generated presentation in %s and preserves old-server previews", async (language) => {
    const text = "Tool error [image] العربية <script>";
    await localization.setPreferences({ language: "en", formatLocale: "en" });
    const status = node({ type: "status", status: "assistant-error" });
    const generatedImage = node({ type: "content", parts: [{ type: "text", text }, { type: "image" }], fallback: "user-message" });
    const before = sessionTreeSummary(generatedImage);
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    expect(sessionTreeSummary(status)).not.toBe("Assistant error");
    expect(sessionTreeSummary(generatedImage)).toContain(text);
    expect(sessionTreeSummary(generatedImage)).not.toBe(before);
    expect(sessionTreeSummary(node({ type: "content", parts: [{ type: "text", text }], fallback: "user-message" }))).toBe(text);
    expect(sessionTreeSummary(node())).toBe("Legacy Tool error [image]");
    const named = sessionTreeSummary(node({ type: "named", field: "label", value: text }));
    expect(named).toContain(text);
    expect(named).not.toBe(`Label: ${text}`);
  });

  it("carries every projected presentation through JSON and API parsing into localized summaries", async () => {
    const literal = "Tool error [image] العربية";
    const entries = [
      { type: "message", message: { role: "assistant", stopReason: "error" } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: literal }, { type: "image", data: "private" }] } },
      { type: "model_change", provider: "provider", modelId: "model" },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "read" }, { type: "toolCall", name: "bash" }] } },
      { type: "message", message: { role: "toolResult", isError: true, toolName: "read", content: literal } },
      { type: "custom_message", display: true, customType: "notice", content: literal },
      { type: "message", message: { role: "user", content: literal } },
    ];
    const projected = projectSessionTree(entries.map((entry, index) => ({
      entry: { id: String(index), parentId: null, ...entry }, children: [],
    })), "0");
    const wire: unknown = JSON.parse(JSON.stringify(projected));
    const parsed = parseSessionTreeSnapshot(wire);
    expect(parsed).toEqual(projected);
    expect(parseCommandResult({ type: "tree", tree: wire })).toEqual({ type: "tree", tree: projected });

    await localization.setPreferences({ language: "en", formatLocale: "en-US" });
    const english = parsed.nodes.map(sessionTreeSummary);
    expect(english).toEqual([
      "Assistant error", `${literal} [image]`, "Model: provider/model",
      `Tool call: ${new Intl.ListFormat("en-US").format(["read", "bash"])}`,
      `Tool error (read): ${literal}`, `Custom message (notice): ${literal}`, literal,
    ]);
    await localization.setPreferences({ language: "en-XA", formatLocale: "en-US" });
    const translated = parsed.nodes.map(sessionTreeSummary);
    for (let index = 0; index < 6; index += 1) expect(translated[index]).not.toBe(english[index]);
    for (const index of [1, 4, 5, 6]) expect(translated[index]).toContain(literal);
    expect(translated[2]).toContain("provider/model");
    expect(translated[3]).toContain("read");
    expect(translated[6]).toBe(literal);
  });

  it("renders raw fallback after API parsing of missing, malformed, or future metadata", async () => {
    await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
    for (const summaryPresentation of [undefined, null, { type: "future" }, { type: "status", status: "future" }, { type: "content", parts: [{ type: "future" }], fallback: "message" }]) {
      const wire: unknown = JSON.parse(JSON.stringify({
        nodes: [{ ...node(), summaryPresentation }], activeLeafId: "id", activePathIds: ["id"],
      }));
      const parsed = parseSessionTreeSnapshot(wire);
      expect(parsed.nodes).toEqual([node()]);
      expect(parsed.nodes.map(sessionTreeSummary)).toEqual(["Legacy Tool error [image]"]);
    }
  });

  it("bounds complete localized output without splitting a surrogate pair", async () => {
    await localization.setPreferences({ language: "en", formatLocale: "en" });
    const output = sessionTreeSummary(node({ type: "content", parts: [{ type: "text", text: `${"a".repeat(358)}😀tail` }], fallback: "user-message" }));
    expect(output).toBe(`${"a".repeat(358)}…`);
    expect(output.length).toBeLessThanOrEqual(360);
  });
});
