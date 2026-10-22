import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { piRuntimePackageInfo } from "../../piRuntime.js";
import { getAgentDir } from "../../piSdk.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { createMcpOAuthCredentialOptions, mcpOAuthStorageDirectory } from "./mcpOAuthCredentialAdapter.js";
import { projectSettingsScopeDirectory } from "./projectSettingsScope.js";
import { stubExtensionToolContext, testManagementContext } from "./piSessionService.testSupport.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pi-scoped-mcp-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it.each(["0.86.1", "0.87.0", "1.3.1", "1.3.0-unknown"])("refuses unapproved host %s before importing internal modules or creating storage", async (version) => {
  const importModule = vi.fn(() => Promise.resolve({}));
  const directory = join(root, "unused");
  await expect(createMcpOAuthCredentialOptions({ directory }, {
    packageInfo: () => Promise.resolve({ directory: root, version }), sdkVersion: version, importModule,
  })).rejects.toThrow("version 1.3.0");
  expect(importModule).not.toHaveBeenCalled();
  await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses a runtime VERSION that does not match the selected package manifest", async () => {
  const importModule = vi.fn(() => Promise.resolve({}));
  await expect(createMcpOAuthCredentialOptions({ directory: join(root, "unused") }, {
    packageInfo: () => Promise.resolve({ directory: root, version: "1.3.0" }), sdkVersion: "different", importModule,
  })).rejects.toThrow("matching package identity");
  expect(importModule).not.toHaveBeenCalled();
});

it("does not fall back to a repository SDK when a selected internal module is missing", async () => {
  const importModule = vi.fn(() => Promise.resolve({}));
  await expect(createMcpOAuthCredentialOptions({ directory: join(root, "unused") }, {
    packageInfo: () => Promise.resolve({ directory: root, version: "1.3.0" }), sdkVersion: "1.3.0", importModule,
  })).rejects.toMatchObject({ code: "ENOENT" });
  expect(importModule).not.toHaveBeenCalled();
});

it.each([{}, { McpOAuthCredentialStore: () => undefined }, { FileAuthStorageBackend: () => undefined }, { loadMcpConfig: true }])("rejects missing or incompatible internal exports: %j", async (exports) => {
  await expect(createMcpOAuthCredentialOptions({ directory: join(root, "unused") }, { importModule: () => Promise.resolve(exports) })).rejects.toThrow("adapter contracts");
  await expect(stat(join(root, "unused"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("uses genuine constructors from the selected host and isolates project, mode and complete management identities", async () => {
  const data = join(root, "data");
  const context = testManagementContext();
  context.sandbox = { env: { PRIVATE_MCP_SENTINEL: "identity-secret" } };
  const other = { ...context, user: { ...context.user, id: "other-account" } };
  const changedPermissions = { ...context, user: { ...context.user, permissions: ["runtime:read"] } };
  const normalProject = projectSettingsScopeDirectory(data, join(root, "project-a"), "normal");
  const directories = [
    mcpOAuthStorageDirectory(normalProject),
    mcpOAuthStorageDirectory(projectSettingsScopeDirectory(data, join(root, "project-b"), "normal")),
    ...[context, other, changedPermissions].map((identity) => mcpOAuthStorageDirectory(
      projectSettingsScopeDirectory(data, join(root, "project-a"), "management"), eventScopeFromManagementContext(identity),
    )),
  ];
  expect(new Set(directories).size).toBe(directories.length);
  expect(directories.join("\n")).not.toContain("identity-secret");
  expect(directories.join("\n")).not.toContain("account-1");
  const info = await piRuntimePackageInfo();
  const oauthModule: unknown = await import(pathToFileURL(join(info.directory, "dist/extensions/mcp/oauth.js")).href);
  if (typeof oauthModule !== "object" || oauthModule === null) throw new Error("Missing real SDK OAuth module");
  const credentialClass: unknown = Reflect.get(oauthModule, "McpOAuthCredentialStore");
  if (typeof credentialClass !== "function") throw new Error("Missing real SDK OAuth class");
  const options = await Promise.all(directories.map((directory) => createMcpOAuthCredentialOptions({ directory })));
  for (const [index, option] of options.entries()) {
    const store = required(option.credentials);
    expect(store).toBeInstanceOf(credentialClass);
    await store.forServer("same-server", "https://mcp.example/").save({ serverUrl: "https://mcp.example/", tokens: { access_token: `scope-${String(index)}`, token_type: "Bearer" } });
    expect(required(option.logPath).startsWith(required(directories[index]))).toBe(true);
  }
  expect(info.version).toBe("1.3.0");
  const reopened = await createMcpOAuthCredentialOptions({ directory: required(directories[0]) });
  expect(required(reopened.credentials).tokens("same-server", "https://mcp.example/")?.access_token).toBe("scope-0");
  for (const [index, directory] of directories.entries()) {
    const content = await readFile(join(directory, "mcp-auth.json"), "utf8");
    expect(content).toContain(`scope-${String(index)}`);
    if (index > 0) expect(content).not.toContain("scope-0");
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "mcp-auth.json"))).mode & 0o777).toBe(0o600);
    }
  }
});

it("keeps normal global and trusted-project configuration semantics without copying global credentials or config into management", async () => {
  const global = join(root, "global-agent");
  const project = join(root, "project");
  const managed = join(root, "managed-private");
  await mkdir(global);
  await mkdir(join(project, ".pi"), { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", global);
  expect(getAgentDir()).toBe(global);
  const globalCredentials = '{"sentinel":"global-oauth-must-not-migrate"}\n';
  await writeFile(join(global, "mcp-auth.json"), globalCredentials);
  await writeFile(join(global, "mcp.json"), JSON.stringify({ mcpServers: { global: { url: "https://global.example/mcp", headers: { Authorization: "global-literal-secret" } } } }));
  await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { project: { command: "node", args: ["project-server"] } } }));
  const normal = await createMcpOAuthCredentialOptions({ directory: join(root, "normal-private") });
  const management = await createMcpOAuthCredentialOptions({ directory: managed, configAgentDir: managed });
  const ctx = stubExtensionToolContext({ cwd: project, isProjectTrusted: () => true });
  const normalConfig = required(normal.loadConfig)(ctx);
  const managedConfig = required(management.loadConfig)(ctx);
  expect(normalConfig.servers.map(({ name }) => name)).toEqual(["global", "project"]);
  expect(JSON.stringify(normalConfig)).toContain("global-literal-secret");
  expect(managedConfig.servers.map(({ name }) => name)).toEqual(["project"]);
  expect(JSON.stringify(managedConfig)).not.toContain("global-literal-secret");
  expect(required(management.loadConfig)(stubExtensionToolContext({ cwd: project, isProjectTrusted: () => false })).servers).toEqual([]);
  await expect(stat(join(managed, "mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(join(managed, "mcp-auth.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(global, "mcp-auth.json"), "utf8")).toBe(globalCredentials);
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value");
  return value;
}
