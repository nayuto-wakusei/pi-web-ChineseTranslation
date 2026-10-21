import dictionary from "./zh-cn/bundled.json";

export function translateChinese(key: string, fallback: string, params?: Readonly<Record<string, string | number>>): string {
  const messages: Readonly<Record<string, string>> = dictionary;
  return (messages[key] ?? fallback).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}
