import { createTranslator, parseTranslationMessages, type TranslationMessages, type Translator } from "../../shared/i18n";

let translate: Translator = createTranslator("en", {});
let locale = "en";

export const t: Translator = (key, fallback, parameters) => translate(key, fallback, parameters);

/** Called before importing UI modules, never in response to machine selection. */
export function setClientTranslations(language: string, messages: TranslationMessages): void {
  const parsed = parseTranslationMessages(messages);
  translate = createTranslator(language, parsed);
  locale = language;
}

export function clientLocale(): string {
  return locale;
}
