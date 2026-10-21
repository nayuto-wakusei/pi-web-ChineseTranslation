import bundled from "./zh-cn/bundled.json";
import main from "./zh-cn/main.json";
import server from "./zh-cn/server.json";
import serverMain from "./zh-cn/server-main.json";
import components from "./zh-cn/components.json";
import client from "./zh-cn/client.json";
const dictionary = { ...bundled, ...main, ...server, ...serverMain, ...components, ...client };

export function translateChinese(key: string, fallback: string, params?: Readonly<Record<string, string | number>>): string {
  const messages: Readonly<Record<string, string>> = dictionary;
  return (messages[key] ?? fallback).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}
