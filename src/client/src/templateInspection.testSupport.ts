import type { TemplateResult } from "lit";

/**
 * Shared escape hatch for the narrow Lit wiring tests that run without a DOM.
 * Keep lookups anchored to stable semantic markers and assert public effects.
 */
export function isTemplateResult(value: unknown): value is TemplateResult {
  return (
    typeof value === "object" &&
    value !== null &&
    isStringArray(Reflect.get(value, "strings")) &&
    Array.isArray(Reflect.get(value, "values"))
  );
}

export function templateStrings(template: TemplateResult): readonly string[] {
  const strings = Reflect.get(template, "strings");
  if (!isStringArray(strings)) throw new Error("TemplateResult strings were unavailable");
  return strings;
}

export function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("TemplateResult values were unavailable");
  return values.map((value: unknown) => value);
}

export function templateValuesAfterMarker(template: TemplateResult, marker: string): unknown[] {
  const matches: unknown[] = [];
  visit(template);
  return matches;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    const strings = templateStrings(value);
    const values = templateValues(value);
    for (let index = 0; index < values.length; index += 1) {
      if (strings[index]?.includes(marker) === true) matches.push(values[index]);
      visit(values[index]);
    }
  }
}

export function templateValueAfterMarker(template: TemplateResult, marker: string): unknown {
  const matches = templateValuesAfterMarker(template, marker);
  if (matches.length === 0) throw new Error(`Expected template marker ${marker}`);
  return matches[0];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
