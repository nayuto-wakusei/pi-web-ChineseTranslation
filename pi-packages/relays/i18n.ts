type Translate = (key: string, fallback: string, params?: Readonly<Record<string, string | number>>) => string;

let translate: Translate | undefined;

export function setTranslator(value: Translate | undefined): void {
  translate = value;
}

export const t: Translate = (key, fallback, params) => translate?.(key, fallback, params)
  ?? fallback.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => String(params?.[name] ?? match));
