import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import type { MessageDefinitions, TranslationCatalog } from "../../../shared/localization.js";

function signature(elements: MessageFormatElement[], result = new Set<string>()): string[] {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    // Date and time both consume a date; cardinal and ordinal plurals consume a number.
    const kind = element.type === TYPE.plural || element.type === TYPE.number ? "number"
      : element.type === TYPE.date || element.type === TYPE.time ? "date" : String(element.type);
    result.add(`${element.value}:${kind}`);
    if (element.type === TYPE.tag) signature(element.children, result);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) signature(option.value, result);
    }
  }
  return [...result].sort();
}

/** Partial catalogs are valid. Unknown keys, malformed ICU and changed arguments/tags are not. */
export function validateCatalog(source: MessageDefinitions, catalog: TranslationCatalog): string[] {
  const errors: string[] = [];
  for (const [key, translated] of Object.entries(catalog)) {
    const definition = source[key];
    if (!definition) {
      errors.push(`${key}: unknown message`);
      continue;
    }
    try {
      if (typeof translated !== "string") throw new Error("Expected an ICU string");
      const expected = signature(parse(definition.message));
      const actual = signature(parse(translated));
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        errors.push(`${key}: arguments/tags differ (expected ${expected.join(", ")}; got ${actual.join(", ")})`);
      }
    } catch (error) {
      errors.push(`${key}: ${String(error)}`);
    }
  }
  return errors;
}

export function validateMessages(source: MessageDefinitions): string[] {
  const errors: string[] = [];
  for (const [key, definition] of Object.entries(source)) {
    if (!definition.description.trim()) errors.push(`${key}: missing translator description`);
    try { parse(definition.message); }
    catch (error) { errors.push(`${key}: ${String(error)}`); }
  }
  return errors;
}

const accented: Record<string, string> = {
  a: "á", e: "ë", i: "ï", o: "ö", u: "ü", A: "Á", E: "Ë", I: "Ï", O: "Ö", U: "Ü",
};

/** Only literal AST nodes change: user values, markup callbacks and ICU syntax remain intact. */
export function pseudoLocalize(elements: MessageFormatElement[], rtl: boolean): MessageFormatElement[] {
  return elements.map((element): MessageFormatElement => {
    if (element.type === TYPE.literal) {
      if (!element.value.trim()) return element;
      const value = element.value.replace(/[aeiouAEIOU]/g, (letter) => accented[letter] ?? letter);
      return { ...element, value: rtl ? `\u202e${value}\u202c` : `［${value}${"~".repeat(Math.ceil(value.length * 0.3))}］` };
    }
    if (element.type === TYPE.tag) return { ...element, children: pseudoLocalize(element.children, rtl) };
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      return { ...element, options: Object.fromEntries(Object.entries(element.options).map(([key, option]) =>
        [key, { ...option, value: pseudoLocalize(option.value, rtl) }])) };
    }
    return element;
  });
}
