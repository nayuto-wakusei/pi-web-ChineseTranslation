import { describe, expect, it } from "vitest";
import type { CommandOption, SessionModelCatalogEntry } from "../api";
import { filterModelOptions, modelCatalogEntryValue, modelCatalogView } from "./ModelPicker";

function entry(provider: string, id: string, enabled: boolean, name?: string): SessionModelCatalogEntry {
  return { provider, id, enabled, ...(name === undefined ? {} : { name }) };
}

const catalog = [
  entry("openai", "gpt-5", true),
  entry("anthropic", "claude-sonnet-4-5", true, "Claude Sonnet 4.5"),
  entry("openai", "gpt-4o", false),
  entry("google", "gemini-2.5-pro", false),
];

describe("filterModelOptions", () => {
  it("matches enabled rows by label, provider, or value without changing order", () => {
    const options: CommandOption[] = [
      { value: "openai/gpt-5", label: "gpt-5", description: "openai" },
      { value: "anthropic/claude", label: "claude", description: "anthropic" },
    ];

    expect(filterModelOptions(options, "  ")).toEqual(options);
    expect(filterModelOptions(options, "ANTHROPIC").map((option) => option.value)).toEqual(["anthropic/claude"]);
  });
});

describe("modelCatalogView", () => {
  it("preserves the server order and groups a mixed unfiltered catalog", () => {
    const view = modelCatalogView(catalog, "");

    expect(view.rows.map(modelCatalogEntryValue)).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ]);
    expect(view.showGroupHeaders).toBe(true);
  });

  it("filters by provider, id, and display name and hides group headers while searching", () => {
    expect(modelCatalogView(catalog, "gpt").rows.map(modelCatalogEntryValue)).toEqual(["openai/gpt-5", "openai/gpt-4o"]);
    expect(modelCatalogView(catalog, "GOOGLE").rows.map(modelCatalogEntryValue)).toEqual(["google/gemini-2.5-pro"]);
    expect(modelCatalogView(catalog, "sonnet 4.5").rows.map(modelCatalogEntryValue)).toEqual(["anthropic/claude-sonnet-4-5"]);
    expect(modelCatalogView(catalog, "gpt").showGroupHeaders).toBe(false);
  });
});
