import { describe, expect, it } from "vitest";
import type { CommandOption, SessionModelCatalogEntry } from "../api";
import { filterModelOptions, modelCatalogEntryValue, modelCatalogToggleAllPlan, modelCatalogView } from "./ModelPicker";

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
  it("preserves server order when catalog indexes are absent", () => {
    const view = modelCatalogView(catalog, "");

    expect(view.rows.map(modelCatalogEntryValue)).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ]);
  });

  it("filters by provider, id, and display name", () => {
    expect(modelCatalogView(catalog, "gpt").rows.map(modelCatalogEntryValue)).toEqual(["openai/gpt-5", "openai/gpt-4o"]);
    expect(modelCatalogView(catalog, "GOOGLE").rows.map(modelCatalogEntryValue)).toEqual(["google/gemini-2.5-pro"]);
    expect(modelCatalogView(catalog, "sonnet 4.5").rows.map(modelCatalogEntryValue)).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  it("restores natural catalog order from stable indexes", () => {
    const indexes = [2, 0, 1, 3] as const;
    const indexed = catalog.map((row, index) => ({ ...row, catalogIndex: indexes[index] ?? index }));
    expect(modelCatalogView(indexed, "").rows.map(modelCatalogEntryValue)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
      "openai/gpt-5",
      "google/gemini-2.5-pro",
    ]);
  });

  it("honors a dialog-owned stable order across regrouped responses", () => {
    const stableOrder = catalog.map(modelCatalogEntryValue);
    const regrouped = [catalog[2], catalog[0], catalog[3], catalog[1]].filter((entry): entry is SessionModelCatalogEntry => entry !== undefined);
    expect(modelCatalogView(regrouped, "", stableOrder).rows.map(modelCatalogEntryValue)).toEqual(stableOrder);
  });
});

describe("modelCatalogToggleAllPlan", () => {
  it("narrows a multi-model scope to the current model", () => {
    expect(modelCatalogToggleAllPlan(catalog, "openai/gpt-5")).toEqual({ mode: "current", canApply: true, hasChanges: true });
  });

  it("selects all when only the current model remains", () => {
    const onlyCurrent = catalog.map((row) => ({ ...row, enabled: modelCatalogEntryValue(row) === "openai/gpt-5" }));
    expect(modelCatalogToggleAllPlan(onlyCurrent, "openai/gpt-5")).toEqual({ mode: "all", canApply: true, hasChanges: true });
  });
});
