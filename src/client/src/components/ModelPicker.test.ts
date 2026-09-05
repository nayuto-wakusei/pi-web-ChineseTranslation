// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionModelCatalogEntry } from "../api";
import type { ModalSurface } from "./ModalSurface";
import { ModelPicker } from "./ModelPicker";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("model-picker", () => {
  it("opens in the localized enabled view with the current model selected", async () => {
    const picker = await mountPicker({ selectedValue: "anthropic/claude-sonnet-4-5" });

    expect(scopeToggle(picker, "已启用").getAttribute("aria-pressed")).toBe("true");
    expect(scopeToggle(picker, "全部模型").getAttribute("aria-pressed")).toBe("false");
    expect(enabledRows(picker).map((row) => requiredElement(row.querySelector("span"), "model label").textContent)).toEqual(["gpt-5", "claude-sonnet-4-5"]);
    expect(selectedRow(picker).textContent).toContain("claude-sonnet-4-5");
  });

  it("shows the complete catalog with controlled checkboxes", async () => {
    const picker = await mountPicker();

    scopeToggle(picker, "全部模型").click();
    await settle(picker);

    expect(catalogRows(picker).map(rowValue)).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ]);
    expect(catalogRows(picker).map((row) => rowCheckbox(row).checked)).toEqual([true, true, false, false]);
    expect(groupHeaders(picker)).toEqual([]);
  });

  it("requests a scope edit without picking the model and waits for the fresh catalog", async () => {
    const onPick = vi.fn<(value: string) => void>();
    let finishToggle: (() => void) | undefined;
    const onToggleEnabled = vi.fn(() => new Promise<void>((resolve) => { finishToggle = resolve; }));
    const picker = await mountPicker({ onPick, onToggleEnabled });
    scopeToggle(picker, "全部模型").click();
    await settle(picker);

    const checkbox = rowCheckbox(catalogRow(picker, "openai/gpt-4o"));
    checkbox.click();
    await settle(picker);

    expect(onToggleEnabled).toHaveBeenCalledWith("openai", "gpt-4o", true);
    expect(onPick).not.toHaveBeenCalled();
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);

    picker.catalog = defaultCatalog().map((entry) => entry.id === "gpt-4o" ? { ...entry, enabled: true } : entry);
    finishToggle?.();
    await settle(picker);
    expect(rowCheckbox(catalogRow(picker, "openai/gpt-4o")).checked).toBe(true);
  });

  it("filters both views and preserves model picking", async () => {
    const onPick = vi.fn<(value: string) => void>();
    const picker = await mountPicker({ onPick });

    typeSearch(picker, "claude");
    await settle(picker);
    expect(enabledRows(picker)).toHaveLength(1);
    enabledRows(picker)[0]?.click();
    expect(onPick).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5");

    typeSearch(picker, "");
    scopeToggle(picker, "全部模型").click();
    typeSearch(picker, "gpt-4o");
    await settle(picker);
    expect(catalogRows(picker).map(rowValue)).toEqual(["openai/gpt-4o"]);
    expect(groupHeaders(picker)).toEqual([]);
  });

  it("keeps the current model enabled and applies the atomic scope preset", async () => {
    const onSetScope = vi.fn<(mode: "all" | "current") => Promise<void>>().mockResolvedValue();
    const picker = await mountPicker({ selectedValue: "openai/gpt-5", onSetScope });

    scopeToggle(picker, "全部模型").click();
    await settle(picker);
    expect(rowCheckbox(catalogRow(picker, "openai/gpt-5")).disabled).toBe(true);

    requiredElement(
      [...(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent.trim() === "除当前模型外全部取消"),
      "scope preset",
    ).click();
    await settle(picker);
    expect(onSetScope).toHaveBeenCalledWith("current");
  });

  it("renders workspace-controlled catalogs read-only", async () => {
    const onToggleEnabled = vi.fn().mockResolvedValue(undefined);
    const picker = await mountPicker({ onToggleEnabled });
    picker.catalog = defaultCatalog().map((entry) => ({ ...entry, editable: false }));
    scopeToggle(picker, "全部模型").click();
    await settle(picker);

    expect(picker.shadowRoot?.querySelector(".scope-notice")?.textContent).toContain(".pi/settings.json");
    expect(catalogRows(picker).every((row) => rowCheckbox(row).disabled)).toBe(true);
    rowCheckbox(catalogRows(picker)[0] ?? document.createElement("div")).click();
    expect(onToggleEnabled).not.toHaveBeenCalled();
  });
});

interface PickerProps {
  selectedValue?: string;
  onPick?: (value: string) => void;
  onToggleEnabled?: (provider: string, modelId: string, enabled: boolean) => Promise<void>;
  onSetScope?: (mode: "all" | "current") => Promise<void>;
}

function entry(provider: string, id: string, enabled: boolean): SessionModelCatalogEntry {
  return { provider, id, enabled };
}

function defaultCatalog(): SessionModelCatalogEntry[] {
  return [
    entry("openai", "gpt-5", true),
    entry("anthropic", "claude-sonnet-4-5", true),
    entry("openai", "gpt-4o", false),
    entry("google", "gemini-2.5-pro", false),
  ];
}

async function mountPicker(props: PickerProps = {}): Promise<ModelPicker> {
  const picker = new ModelPicker();
  picker.options = [
    { value: "openai/gpt-5", label: "gpt-5", description: "openai" },
    { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5", description: "anthropic" },
  ];
  picker.catalog = defaultCatalog();
  if (props.selectedValue !== undefined) picker.selectedValue = props.selectedValue;
  if (props.onPick !== undefined) picker.onPick = props.onPick;
  if (props.onToggleEnabled !== undefined) picker.onToggleEnabled = props.onToggleEnabled;
  if (props.onSetScope !== undefined) picker.onSetScope = props.onSetScope;
  document.body.append(picker);
  await settle(picker);
  return picker;
}

async function settle(picker: ModelPicker): Promise<void> {
  await picker.updateComplete;
  const surface = requiredElement(picker.shadowRoot?.querySelector<ModalSurface>("modal-surface"), "modal surface");
  await surface.updateComplete;
  await picker.updateComplete;
}

function scopeToggle(picker: ModelPicker, label: string): HTMLButtonElement {
  return requiredElement(
    [...(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>(".scope-toggle button") ?? [])]
      .find((button) => button.textContent.trim() === label),
    `${label} toggle`,
  );
}

function enabledRows(picker: ModelPicker): HTMLButtonElement[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>(".options > button") ?? [])];
}

function catalogRows(picker: ModelPicker): HTMLElement[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLElement>(".catalog-row") ?? [])];
}

function catalogRow(picker: ModelPicker, value: string): HTMLElement {
  return requiredElement(catalogRows(picker).find((row) => rowValue(row) === value), value);
}

function rowValue(row: HTMLElement): string {
  return row.dataset["modelValue"] ?? (rowCheckbox(row).getAttribute("aria-label") ?? "").replace(/^(启用|禁用) /, "");
}

function rowCheckbox(row: HTMLElement): HTMLInputElement {
  return requiredElement(row.querySelector<HTMLInputElement>("input[type='checkbox']"), "model checkbox");
}

function groupHeaders(picker: ModelPicker): string[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLElement>(".group-header") ?? [])].map((header) => header.textContent.trim());
}

function selectedRow(picker: ModelPicker): HTMLElement {
  return requiredElement(picker.shadowRoot?.querySelector<HTMLElement>(".options > button.selected, .catalog-row.selected"), "selected row");
}

function typeSearch(picker: ModelPicker, query: string): void {
  const input = requiredElement(picker.shadowRoot?.querySelector<HTMLInputElement>("input.search"), "search input");
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
