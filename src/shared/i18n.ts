import type { TranslationMessages, TranslationParameters, Translator } from "./pluginApiTypes.js";
export type { LocalizationContribution, TranslationMessages, TranslationParameters, Translator } from "./pluginApiTypes.js";

/** Preserve internal error text for status handling; localize only at the UI boundary. */
export class UserFacingError extends Error {
  constructor(
    readonly messageKey: string,
    readonly fallback: string,
    readonly parameters?: TranslationParameters,
  ) {
    super(createTranslator("en", {})(messageKey, fallback, parameters));
    this.name = "UserFacingError";
  }
}

export function userFacingErrorMessage(error: unknown, translate: Translator): string {
  return error instanceof UserFacingError
    ? translate(error.messageKey, error.fallback, error.parameters)
    : error instanceof Error ? error.message : String(error);
}

const parameterPattern = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu;

function parametersIn(message: string): string[] {
  return [...new Set([...message.matchAll(parameterPattern)].map((match) => match[1] ?? ""))].sort();
}

/** Only catalog text is interpolated; values are never recursively translated. */
export function createTranslator(locale: string, messages: TranslationMessages): Translator {
  return (key, fallback, parameters = {}) => {
    const translation = locale === "en" || !Object.hasOwn(messages, key) ? undefined : messages[key];
    const template = translation !== undefined && parametersIn(translation).join(",") === parametersIn(fallback).join(",")
      ? translation
      : fallback;
    return template.replace(parameterPattern, (placeholder: string, name: string) =>
      Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder);
  };
}

export function parseTranslationMessages(value: unknown): TranslationMessages {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid translation catalog");
  const entries: [string, string][] = [];
  for (const [key, message] of Object.entries(value)) {
    if (key === "" || typeof message !== "string") throw new Error("Invalid translation catalog");
    entries.push([key, message]);
  }
  return Object.fromEntries(entries);
}
