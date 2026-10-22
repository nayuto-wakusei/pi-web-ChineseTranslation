import { spawn } from "node:child_process";
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, VERSION, type InlineExtension } from "../../piSdk.js";
import { createMcpOAuthCredentialOptions, type ScopedMcpOptions } from "./mcpOAuthCredentialAdapter.js";
import { McpAuthFlowService } from "./mcpAuthFlowService.js";

const cachedFactories = new Map<string, Promise<InlineExtension[]>>();

export async function getBuiltinExtensionFactories(mcpScope: ScopedMcpOptions): Promise<InlineExtension[]> {
  // Old hosts must never load or initialize the version-pinned credential adapter.
  if (VERSION === "0.86.1" || VERSION === "0.87.0") return [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime callers must not silently select global credentials either.
  if (mcpScope === undefined) throw new Error("MCP builtins require a private credential scope");
  const key = JSON.stringify([mcpScope.directory, mcpScope.configAgentDir]);
  let factories = cachedFactories.get(key);
  factories ??= (async () => {
    const scoped = await createMcpOAuthCredentialOptions(mcpScope);
    return [
      { name: "mcp", factory: createMcpExtension({ ...scoped, openUrl: openMcpUrl }), builtin: true, replaceable: true },
      { name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
      { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
    ];
  })();
  cachedFactories.set(key, factories);
  return factories;
}

function openMcpUrl(url: string): void {
  const operation = McpAuthFlowService.current();
  if (operation !== undefined) { operation.openUrl(url); return; }
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => { /* Pi also presents the URL through UI. */ }).unref();
}
