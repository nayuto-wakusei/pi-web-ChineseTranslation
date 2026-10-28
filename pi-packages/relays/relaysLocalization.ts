import type { MessageArguments, MessageValues, PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import definitions from "./relays.messages.js";

export function createRelaysContent(localization: PluginLocalization) {
  return { localization, messages: localization.registerMessages("browser", definitions) };
}
export type RelaysContent = ReturnType<typeof createRelaysContent>;

/** English fallback for older hosts and standalone custom-element consumers. */
export function relayText<Key extends keyof typeof definitions>(content: RelaysContent | undefined, key: Key, ...args: MessageArguments<(typeof definitions)[Key]>): string {
  if (content !== undefined) return content.messages.t(key, ...args);
  const values: MessageValues | undefined = args[0];
  return definitions[key].message.replace(/\{(\w+)\}/gu, (_, name: string) => {
    const value = values?.[name];
    return typeof value === "string" || typeof value === "number" ? String(value) : `{${name}}`;
  });
}

/** Isolate external values inside RTL messages without translating their contents. */
export function relayValue(content: RelaysContent | undefined, value: string): string {
  return content?.localization.direction === "rtl" ? `\u2068${value}\u2069` : value;
}
