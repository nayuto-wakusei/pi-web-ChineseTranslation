import type { ExtensionFactory, McpExtensionOptions } from "../../piSdk.js";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../piSdk.js");
  vi.doUnmock("./mcpOAuthCredentialAdapter.js");
  vi.resetModules();
});

async function fixture(version = "1.3.0") {
  vi.resetModules();
  const createOptions = vi.fn((scope: { directory: string }) => Promise.resolve({ logPath: `${scope.directory}/mcp.log` }));
  const createMcpExtension = vi.fn<(options: McpExtensionOptions) => ExtensionFactory>(() => () => undefined);
  vi.doMock("../../piSdk.js", () => ({ VERSION: version, createMcpExtension, createCodemodeExtension: () => () => undefined, createToolSearchExtension: () => () => undefined }));
  vi.doMock("./mcpOAuthCredentialAdapter.js", () => ({ createMcpOAuthCredentialOptions: createOptions }));
  return { getFactories: (await import("./builtinExtensionFactories.js")).getBuiltinExtensionFactories, createOptions, createMcpExtension };
}

it("requires an explicit private MCP scope and never creates global-default factories", async () => {
  const { getFactories, createOptions, createMcpExtension } = await fixture();
  await expect(Reflect.apply(getFactories, undefined, [])).rejects.toThrow("private credential scope");
  expect(createOptions).not.toHaveBeenCalled();
  expect(createMcpExtension).not.toHaveBeenCalled();
});

it("caches only within the same project and management credential/config identity", async () => {
  const { getFactories, createOptions, createMcpExtension } = await fixture();
  const scope = { directory: "/project-a/mcp" };
  const [first, concurrent] = await Promise.all([getFactories(scope), getFactories(scope)]);
  expect(first).toBe(concurrent);
  expect(await getFactories(scope)).toBe(first);
  for (const other of [{ directory: "/project-b/mcp" }, { directory: "/management/identity-a", configAgentDir: "/management/identity-a" }, { directory: scope.directory, configAgentDir: "/other-config" }]) {
    expect(await getFactories(other)).not.toBe(first);
  }
  expect(createOptions).toHaveBeenCalledTimes(4);
  expect(createMcpExtension).toHaveBeenCalledTimes(4);
  expect(createMcpExtension).toHaveBeenNthCalledWith(1, expect.objectContaining({ logPath: "/project-a/mcp/mcp.log" }));
});

it.each(["0.86.1", "0.87.0"])("does not initialize the version-pinned adapter on legacy host %s", async (version) => {
  const { getFactories, createOptions, createMcpExtension } = await fixture(version);
  expect(await getFactories({ directory: "/private/unused" })).toEqual([]);
  expect(createOptions).not.toHaveBeenCalled();
  expect(createMcpExtension).not.toHaveBeenCalled();
});

it("routes the builtin SDK browser callback into the active structured MCP flow", async () => {
  const { getFactories, createMcpExtension } = await fixture();
  const { McpAuthFlowService } = await import("./mcpAuthFlowService.js");
  await getFactories({ directory: "/private/flow" });
  const openUrl = createMcpExtension.mock.calls[0]?.[0].openUrl;
  if (openUrl === undefined) throw new Error("Missing builtin URL callback");
  const flows = new McpAuthFlowService();
  const owner = { scope: "normal", sessionId: "flow-session", cwd: "/workspace" };
  const flow = flows.start({ owner, identity: {}, isCurrent: () => true, run: () => {
    openUrl("https://issuer.example/authorize?state=private-flow");
    return Promise.resolve();
  } });
  await vi.waitFor(() => { expect(flows.get(flow.flowId, owner)).toMatchObject({ status: "complete", auth: { url: "https://issuer.example/authorize?state=private-flow" } }); });
  flows.dispose();
});
