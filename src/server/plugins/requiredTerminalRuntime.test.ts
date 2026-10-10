import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerPluginActivation } from "../../server-plugin-api.js";
import type { PiWebPluginCatalogEntry } from "../piWebPluginCatalog.js";
import { REQUIRED_TERMINAL_SERVICE_CAPABILITY } from "../terminals/requiredTerminalService.js";
import { createServerPluginRuntime, type ServerPluginRuntime } from "./serverPluginRuntime.js";

const roots: string[] = [];
const runtimes: ServerPluginRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function entry(id = "pi-web.terminal"): PiWebPluginCatalogEntry {
  return {
    id, packageRoot: `/plugins/${id}`, source: "bundled", scope: "bundled", machineSpecific: true,
    browserModule: { path: "browser.js", filePath: `/plugins/${id}/browser.js`, revision: "browser-r1" },
    serverModule: { path: "server.js", filePath: `/plugins/${id}/server.js`, revision: "server-r1" },
    enabled: true, settings: {}, settingsRevision: "settings-r1",
  };
}

function activation(): ServerPluginActivation {
  return {
    peer: { request: () => null, openChannel: () => ({ receive: () => undefined }) },
    provides: [{ capability: REQUIRED_TERMINAL_SERVICE_CAPABILITY, value: {
      closeForCwd: () => undefined, bindActivitySink: () => undefined,
      runCommand: () => ({ id: "run", origin: "core", projectId: "p", workspaceId: "w", terminalId: "t", title: "Run", command: "true", status: "running", createdAt: "now", metadata: {} }),
    } }],
  };
}

async function start(plugins: PiWebPluginCatalogEntry[], activate = activation, safeStart?: "none" | "bundled-only") {
  const root = await mkdtemp(join(tmpdir(), "required-terminal-runtime-"));
  roots.push(root);
  const runtime = await createServerPluginRuntime({
    catalog: { snapshot: () => Promise.resolve({ plugins, diagnostics: [] }) }, dataDir: root,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    importer: () => Promise.resolve({ default: { apiVersion: 3, name: "Terminal", activate } }),
    ...(safeStart === undefined ? {} : { safeStart }),
  });
  runtimes.push(runtime);
  return runtime;
}

describe("required Terminal production startup", () => {
  it.each([
    ["missing", []],
    ["disabled", [{ ...entry(), enabled: false }]],
    ["non-bundled", [{ ...entry(), source: "local", scope: "local" }]],
    ["missing browser", [withoutBrowser()]],
    ["not machine-specific", [{ ...entry(), machineSpecific: false }]],
  ] satisfies [string, PiWebPluginCatalogEntry[]][])("rejects %s without a legacy fallback", async (_name, entries) => {
    await expect(start(entries)).rejects.toMatchObject({ name: "RequiredTerminalPluginError" });
  });

  it("requires both peer methods and a valid composition service, rolling activation back", async () => {
    const dispose = vi.fn();
    await expect(start([entry()], () => ({ peer: { request: () => null }, dispose })))
      .rejects.toMatchObject({ name: "RequiredTerminalPluginError" });
    expect(dispose).toHaveBeenCalledOnce();
    await expect(start([entry()], () => ({ ...activation(), provides: [] })))
      .rejects.toMatchObject({ name: "RequiredTerminalPluginError" });
  });

  it("rejects startup and unhealthy Terminal before publication", async () => {
    const dispose = vi.fn();
    await expect(start([entry()], () => ({ ...activation(), start: () => { throw new Error("PTY start failed"); }, dispose })))
      .rejects.toThrow("PTY start failed");
    expect(dispose).toHaveBeenCalledOnce();
    await expect(start([entry()], () => ({ ...activation(), health: () => ({ status: "unhealthy", message: "PTY unavailable" }) })))
      .rejects.toThrow("PTY unavailable");
  });

  it("publishes the required service in ordinary and bundled-only startup", async () => {
    for (const mode of [undefined, "bundled-only"] as const) {
      const runtime = await start([entry()], activation, mode);
      expect(runtime.resolve(REQUIRED_TERMINAL_SERVICE_CAPABILITY).runCommand({ projectId: "p", workspaceId: "w", cwd: "/repo", origin: "core", title: "Run", command: "true" })).toMatchObject({ id: "run" });
      expect(runtime.pairedBackendContributions()).toHaveLength(1);
    }
  });

  it("only explicit no-server-plugin recovery can omit Terminal", async () => {
    const runtime = await start([], activation, "none");
    expect(runtime.safeStartLevel()).toBe("none");
    expect(runtime.pairedBackendContributions()).toEqual([]);
    expect(() => runtime.resolve(REQUIRED_TERMINAL_SERVICE_CAPABILITY)).toThrow();
  });
});

function withoutBrowser(): PiWebPluginCatalogEntry {
  const value = entry();
  delete value.browserModule;
  return value;
}
