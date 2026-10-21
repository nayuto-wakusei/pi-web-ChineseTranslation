import { createTranslator, userFacingErrorMessage, type TranslationParameters, type Translator } from "../../shared/i18n.js";

const english = createTranslator("en", {});

/** Retains stable English diagnostics while exposing owned UI copy at HTTP boundaries. */
export class WorkspaceUserError extends Error {
  constructor(
    readonly key: string,
    readonly fallback: string,
    readonly parameters: TranslationParameters = {},
    options?: ErrorOptions,
  ) {
    super(english(key, fallback, parameters), options);
    this.name = "WorkspaceUserError";
  }
}

export function workspaceErrorMessage(error: unknown, translate: Translator): string {
  return error instanceof WorkspaceUserError
    ? translate(error.key, error.fallback, error.parameters)
    : userFacingErrorMessage(error, translate);
}
