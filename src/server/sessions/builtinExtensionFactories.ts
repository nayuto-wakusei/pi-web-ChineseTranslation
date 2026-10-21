import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, VERSION, type InlineExtension } from "../../piSdk.js";

let cachedPromise: Promise<InlineExtension[]> | undefined;

export function getBuiltinExtensionFactories(): Promise<InlineExtension[]> {
  cachedPromise ??= Promise.resolve().then(() => {
    // The supported pre-1.x SDKs have no builtin factories; keep their existing resource behavior.
    if (VERSION === "0.86.1" || VERSION === "0.87.0") return [];
    return [
      { name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
      { name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
      { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
    ];
  });
  return cachedPromise;
}
